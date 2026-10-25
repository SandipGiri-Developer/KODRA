import { ChildProcess, spawn, spawnSync } from 'child_process';
import { Logger } from '../../utils/logger';
import {
  GetOutputOptions,
  GetOutputResult,
  IProcessManager,
  LaunchProcessOptions,
  ProcessOutputChunk,
  ProcessRecord,
  SendInputResult,
  StopProcessOptions,
  StopProcessResult,
} from './types';

export const DEFAULT_MAX_OUTPUT_BYTES = 50_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const MAX_COMMAND_TIMEOUT_MS = 600_000;
export const MAX_COMPLETED_PROCESSES = 50;
export const MAX_ACTIVE_PROCESSES = 10;
export const DEFAULT_MAX_CHUNK_BYTES = 100_000;
export const DEFAULT_MAX_CHUNKS = 500;

/**
 * Safely trims the oldest text from the front of a string so that the remaining
 * text does not exceed `maxBytes` when encoded in UTF-8.
 * Trimming is done strictly on Unicode code point boundaries to prevent producing
 * malformed UTF-8 characters or splitting surrogate pairs.
 */
export function trimOldestUtf8Safe(
  text: string,
  maxBytes: number,
): { text: string; bytesDropped: number } {
  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (totalBytes <= maxBytes) {
    return { text, bytesDropped: 0 };
  }
  const bytesToDrop = totalBytes - maxBytes;
  let droppedBytes = 0;
  let charIndex = 0;

  while (charIndex < text.length && droppedBytes < bytesToDrop) {
    const codePoint = text.codePointAt(charIndex);
    if (codePoint === undefined) {
      break;
    }
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    let cpBytes = 1;
    if (codePoint > 0x7f) {
      if (codePoint <= 0x7ff) {
        cpBytes = 2;
      } else if (codePoint <= 0xffff) {
        cpBytes = 3;
      } else {
        cpBytes = 4;
      }
    }
    droppedBytes += cpBytes;
    charIndex += codeUnits;
  }

  return {
    text: text.slice(charIndex),
    bytesDropped: droppedBytes,
  };
}

/**
 * Safely slices a string based on UTF-8 byte offset `startByte` and maximum `maxBytes`.
 * Slicing is performed strictly at Unicode code point boundaries so that no surrogate pair
 * or multibyte sequence is split.
 */
export function sliceUtf8Safe(
  text: string,
  startByte: number,
  maxBytes: number,
): { slice: string; byteLength: number } {
  const totalBytes = Buffer.byteLength(text, 'utf8');
  if (startByte <= 0 && totalBytes <= maxBytes) {
    return { slice: text, byteLength: totalBytes };
  }

  let currentByte = 0;
  let startIndex = 0;
  let startFound = false;

  let endIndex = text.length;
  let sliceBytes = 0;

  let i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) {
      break;
    }
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    let cpBytes = 1;
    if (codePoint > 0x7f) {
      if (codePoint <= 0x7ff) {
        cpBytes = 2;
      } else if (codePoint <= 0xffff) {
        cpBytes = 3;
      } else {
        cpBytes = 4;
      }
    }

    if (!startFound) {
      if (currentByte + cpBytes > startByte) {
        startIndex = i;
        startFound = true;
      }
    }

    if (startFound) {
      if (sliceBytes + cpBytes > maxBytes) {
        endIndex = i;
        break;
      }
      sliceBytes += cpBytes;
    }

    currentByte += cpBytes;
    i += codeUnits;
  }

  if (!startFound) {
    return { slice: '', byteLength: 0 };
  }

  return {
    slice: text.slice(startIndex, endIndex),
    byteLength: sliceBytes,
  };
}

export class ProcessManager implements IProcessManager {
  private static instance: ProcessManager | null = null;
  private readonly processes: Map<string, ProcessRecord> = new Map();
  private readonly chunkListeners: Map<string, Array<(chunk: string, stream: 'stdout' | 'stderr') => void>> = new Map();
  private readonly exitListeners: Map<string, (record: ProcessRecord) => void> = new Map();
  private readonly processTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private readonly logger = Logger.getInstance();
  private readonly maxOutputBytes: number;
  private readonly maxCompletedProcesses: number;
  private readonly maxActiveProcesses: number;
  private readonly maxChunkBytes: number;
  private readonly maxChunks: number;
  private totalChunkBytes: number = 0;

  constructor(options?: {
    maxOutputBytes?: number;
    maxCompletedProcesses?: number;
    maxActiveProcesses?: number;
    maxChunkBytes?: number;
    maxChunks?: number;
  }) {
    this.maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.maxCompletedProcesses = options?.maxCompletedProcesses ?? MAX_COMPLETED_PROCESSES;
    this.maxActiveProcesses = options?.maxActiveProcesses ?? MAX_ACTIVE_PROCESSES;
    this.maxChunkBytes = options?.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES;
    this.maxChunks = options?.maxChunks ?? DEFAULT_MAX_CHUNKS;
  }

  public getTotalChunkBytes(): number {
    return this.totalChunkBytes;
  }

  private registerTimer(processId: string, timer: NodeJS.Timeout): void {
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    let list = this.processTimers.get(processId);
    if (!list) {
      list = [];
      this.processTimers.set(processId, list);
    }
    list.push(timer);
  }

  private unregisterTimer(processId: string, timer: NodeJS.Timeout): void {
    const list = this.processTimers.get(processId);
    if (!list) return;
    const remaining = list.filter((registered) => registered !== timer);
    if (remaining.length > 0) this.processTimers.set(processId, remaining);
    else this.processTimers.delete(processId);
  }

  private clearTimer(processId: string, timer: NodeJS.Timeout): void {
    clearTimeout(timer);
    this.unregisterTimer(processId, timer);
  }

  private clearTimers(processId: string): void {
    const list = this.processTimers.get(processId);
    if (list) {
      for (const timer of list) clearTimeout(timer);
      this.processTimers.delete(processId);
    }
  }

  public static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  public static resetInstance(): void {
    if (ProcessManager.instance) {
      ProcessManager.instance.dispose();
      ProcessManager.instance = null;
    }
  }

  public getActiveProcessCount(): number {
    let count = 0;
    for (const record of this.processes.values()) {
      if (record.status === 'running') {
        count++;
      }
    }
    return count;
  }

  public async runCommand(options: LaunchProcessOptions): Promise<ProcessRecord> {
    if (this.getActiveProcessCount() >= this.maxActiveProcesses) {
      const record = this.createRecord(options);
      const errorMsg = `Maximum concurrent active processes limit (${this.maxActiveProcesses}) reached. Stop an active process before starting a new one.`;
      record.status = 'failed';
      record.closed = true;
      record.endTime = Date.now();
      record.durationMs = 0;
      record.error = errorMsg;
      record.output = `Error: Cannot run command. ${errorMsg}`;
      this.processes.set(record.processId, record);
      this.pruneCompletedProcesses();
      this.notifyExit(record);
      return record;
    }

    const record = this.createRecord(options);
    this.processes.set(record.processId, record);
    if (options.onChunk) this.addChunkListener(record.processId, options.onChunk);
    if (options.onExit) this.exitListeners.set(record.processId, options.onExit);

    return new Promise<ProcessRecord>((resolve) => {
      if (options.signal?.aborted) {
        record.status = 'cancelled';
        record.closed = true;
        record.endTime = Date.now();
        record.durationMs = 0;
        record.output = 'Command cancelled before execution.';
        this.cleanUpProcessResources(record);
        this.pruneCompletedProcesses();
        this.notifyExit(record);
        resolve(record);
        return;
      }

      const timeoutMs = Math.min(
        Math.max(1, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS),
        MAX_COMMAND_TIMEOUT_MS,
      );

      let child: ChildProcess;
      try {
        child = this.spawnChild(options.command, options.cwd, options.env);
      } catch (spawnErr: any) {
        record.status = 'failed';
        record.closed = true;
        record.endTime = Date.now();
        record.durationMs = record.endTime - record.startTime;
        record.error = spawnErr.message;
        record.output = `Failed to launch command: ${spawnErr.message}`;
        this.cleanUpProcessResources(record);
        this.pruneCompletedProcesses();
        this.notifyExit(record);
        resolve(record);
        return;
      }

      record.child = child;
      record.pid = child.pid;
      let isSettled = false;
      let isFinalized = false;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const settlePromise = () => {
        if (!isSettled) {
          isSettled = true;
          resolve(record);
        }
      };

      const finalizeClosedProcess = (code: number | null) => {
        if (isFinalized) return;
        isFinalized = true;
        record.closed = true;
        record.exitCode = code;
        record.endTime = Date.now();
        if (record.terminationRequested) {
          record.status = record.terminationRequested;
        } else if (record.status === 'running') {
          record.status = code === 0 ? 'completed' : 'failed';
          if (code !== 0 && !record.error) {
            record.error = `Process exited with code ${code}`;
          }
        }
        record.durationMs = record.endTime - record.startTime;
        this.clearTimers(record.processId);
        if (options.signal) options.signal.removeEventListener('abort', abortHandler);
        this.cleanUpProcessResources(record);
        this.notifyExit(record);
        if (record.cleanupAfterExit) {
          this.removeProcessRecord(record);
        } else {
          this.pruneCompletedProcesses();
        }
        settlePromise();
      };

      const abortHandler = async () => {
        if (record.closed || record.status !== 'running' || record.terminationRequested) return;
        record.terminationRequested = 'cancelled';
        this.appendChunk(record, '\n[Command cancelled by user]', 'stderr');
        if (timeoutTimer) this.clearTimer(record.processId, timeoutTimer);
        this.gracefulKill(child);
        let exited = await this.waitForExit(record, 1000);
        if (!exited) {
          this.forceKillProcess(child);
          exited = await this.waitForExit(record, 1000);
        }
        if (!exited) {
          record.error = 'Cancellation requested, but process termination has not yet been confirmed; the process remains tracked as running.';
          if (options.signal) options.signal.removeEventListener('abort', abortHandler);
          settlePromise();
          return;
        }
        record.status = 'cancelled';
        record.closed = true;
        record.endTime = record.endTime ?? Date.now();
        record.durationMs = record.endTime - record.startTime;
        this.cleanUpProcessResources(record);
        this.pruneCompletedProcesses();
        this.notifyExit(record);
        settlePromise();
      };

      if (options.signal) {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.attachOutputHandlers(record, child);
      child.on('error', (err) => {
        record.error = err.message;
        this.appendChunk(record, `\nProcess error: ${err.message}`, 'stderr');
        // A spawn error with no PID means no OS process was created. Otherwise wait
        // for "close" before considering the process and its stdio fully closed.
        if (child.pid === undefined) {
          isFinalized = true;
          record.status = record.terminationRequested ?? 'failed';
          record.closed = true;
          record.endTime = Date.now();
          record.durationMs = record.endTime - record.startTime;
          this.clearTimers(record.processId);
          if (options.signal) options.signal.removeEventListener('abort', abortHandler);
          this.cleanUpProcessResources(record);
          this.notifyExit(record);
          if (record.cleanupAfterExit) this.removeProcessRecord(record);
          else this.pruneCompletedProcesses();
          settlePromise();
        }
      });
      child.on('close', (code) => finalizeClosedProcess(code));

      timeoutTimer = setTimeout(async () => {
        this.unregisterTimer(record.processId, timeoutTimer!);
        if (record.closed || record.status !== 'running' || record.terminationRequested) return;
        record.isTimedOut = true;
        record.terminationRequested = 'timed_out';
        record.error = `Command timed out after ${timeoutMs / 1000}s`;
        this.appendChunk(record, `\n[Command timed out after ${timeoutMs / 1000}s]`, 'stderr');
        this.forceKillProcess(child);
        const exited = await this.waitForExit(record, 1000);
        if (!exited) {
          record.error += ' Termination has not yet been confirmed; the process remains tracked as running.';
          if (timeoutTimer) this.unregisterTimer(record.processId, timeoutTimer);
          if (options.signal) options.signal.removeEventListener('abort', abortHandler);
          settlePromise();
        } else {
          record.status = 'timed_out';
          record.closed = true;
          record.endTime = record.endTime ?? Date.now();
          record.durationMs = record.endTime - record.startTime;
          this.cleanUpProcessResources(record);
          this.pruneCompletedProcesses();
          this.notifyExit(record);
          settlePromise();
        }
      }, timeoutMs);
      this.registerTimer(record.processId, timeoutTimer);
    });
  }

  public async startProcess(options: LaunchProcessOptions): Promise<ProcessRecord> {
    if (this.getActiveProcessCount() >= this.maxActiveProcesses) {
      const record = this.createRecord(options);
      const errorMsg = `Maximum concurrent active processes limit (${this.maxActiveProcesses}) reached. Stop an active process before starting a new one.`;
      record.status = 'failed';
      record.closed = true;
      record.endTime = Date.now();
      record.durationMs = 0;
      record.error = errorMsg;
      record.output = `Error: Cannot start process. ${errorMsg}`;
      this.processes.set(record.processId, record);
      this.pruneCompletedProcesses();
      this.notifyExit(record);
      return record;
    }

    const record = this.createRecord(options);
    this.processes.set(record.processId, record);
    if (options.onChunk) this.addChunkListener(record.processId, options.onChunk);
    if (options.onExit) this.exitListeners.set(record.processId, options.onExit);

    if (options.signal?.aborted) {
      record.status = 'cancelled';
      record.closed = true;
      record.endTime = Date.now();
      record.durationMs = 0;
      record.output = 'Process cancelled before startup.';
      this.cleanUpProcessResources(record);
      this.pruneCompletedProcesses();
      this.notifyExit(record);
      return record;
    }

    return new Promise<ProcessRecord>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnChild(options.command, options.cwd, options.env);
      } catch (spawnErr: any) {
        record.status = 'failed';
        record.closed = true;
        record.endTime = Date.now();
        record.durationMs = record.endTime - record.startTime;
        record.error = spawnErr.message;
        record.output = `Failed to start process: ${spawnErr.message}`;
        this.cleanUpProcessResources(record);
        this.pruneCompletedProcesses();
        this.notifyExit(record);
        resolve(record);
        return;
      }

      record.child = child;
      record.pid = child.pid;
      let settled = false;
      let isFinalized = false;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const settlePromise = () => {
        if (!settled) {
          settled = true;
          resolve(record);
        }
      };

      const finalizeClosedProcess = (code: number | null) => {
        if (isFinalized) return;
        isFinalized = true;
        record.closed = true;
        record.exitCode = code;
        record.endTime = Date.now();
        if (record.terminationRequested) {
          record.status = record.terminationRequested;
        } else if (record.status === 'running') {
          record.status = code === 0 ? 'completed' : 'failed';
          if (code !== 0 && !record.error) {
            record.error = `Process exited with code ${code}`;
          }
        }
        record.durationMs = record.endTime - record.startTime;
        this.clearTimers(record.processId);
        if (options.signal) options.signal.removeEventListener('abort', abortHandler);
        this.cleanUpProcessResources(record);
        this.notifyExit(record);
        if (record.cleanupAfterExit) this.removeProcessRecord(record);
        else this.pruneCompletedProcesses();
        settlePromise();
      };

      const initialGraceTimer = setTimeout(() => {
        this.unregisterTimer(record.processId, initialGraceTimer);
        // This only resolves the start call; it must not clear the process timeout.
        settlePromise();
      }, 75);
      this.registerTimer(record.processId, initialGraceTimer);

      const abortHandler = async () => {
        if (record.closed || record.status !== 'running' || record.terminationRequested) return;
        record.terminationRequested = 'cancelled';
        this.appendChunk(record, '\n[Cancelled by user]', 'stderr');
        if (timeoutTimer) this.clearTimer(record.processId, timeoutTimer);
        this.gracefulKill(child);
        let exited = await this.waitForExit(record, 1000);
        if (!exited) {
          this.forceKillProcess(child);
          exited = await this.waitForExit(record, 1000);
        }
        if (!exited) {
          record.error = 'Cancellation requested, but process termination has not yet been confirmed; it remains tracked as running.';
          if (options.signal) options.signal.removeEventListener('abort', abortHandler);
        } else {
          record.status = 'cancelled';
          record.closed = true;
          record.endTime = record.endTime ?? Date.now();
          record.durationMs = record.endTime - record.startTime;
          this.cleanUpProcessResources(record);
          this.pruneCompletedProcesses();
          this.notifyExit(record);
        }
        settlePromise();
      };

      if (options.signal) {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.attachOutputHandlers(record, child);
      child.on('error', (err) => {
        record.error = err.message;
        this.appendChunk(record, `\nProcess error: ${err.message}`, 'stderr');
        if (child.pid === undefined) {
          record.status = record.terminationRequested ?? 'failed';
          record.closed = true;
          record.endTime = Date.now();
          record.durationMs = record.endTime - record.startTime;
          this.clearTimers(record.processId);
          if (options.signal) options.signal.removeEventListener('abort', abortHandler);
          this.cleanUpProcessResources(record);
          this.notifyExit(record);
          if (record.cleanupAfterExit) this.removeProcessRecord(record);
          else this.pruneCompletedProcesses();
          settlePromise();
        }
      });
      child.on('close', (code) => finalizeClosedProcess(code));

      if (options.timeoutMs && options.timeoutMs > 0) {
        const timeoutMs = Math.min(options.timeoutMs, MAX_COMMAND_TIMEOUT_MS);
        timeoutTimer = setTimeout(async () => {
          this.unregisterTimer(record.processId, timeoutTimer!);
          if (record.closed || record.status !== 'running' || record.terminationRequested) return;
          record.isTimedOut = true;
          record.terminationRequested = 'timed_out';
          record.error = `Process exceeded maximum lifetime (${timeoutMs / 1000}s)`;
          this.appendChunk(record, `\n[Process lifetime expired after ${timeoutMs / 1000}s]`, 'stderr');
          this.forceKillProcess(child);
          const exited = await this.waitForExit(record, 1000);
          if (!exited) {
            record.error += ' Termination has not yet been confirmed; it remains tracked as running.';
            if (timeoutTimer) this.unregisterTimer(record.processId, timeoutTimer);
          } else {
            record.status = 'timed_out';
            record.closed = true;
            record.endTime = record.endTime ?? Date.now();
            record.durationMs = record.endTime - record.startTime;
            this.cleanUpProcessResources(record);
            this.pruneCompletedProcesses();
            this.notifyExit(record);
          }
        }, timeoutMs);
        this.registerTimer(record.processId, timeoutTimer);
      }
    });
  }

  public getProcess(processId: string): ProcessRecord | undefined {
    return this.processes.get(processId);
  }

  public listProcesses(): ProcessRecord[] {
    return Array.from(this.processes.values());
  }

  public getOutput(processId: string, options?: GetOutputOptions): GetOutputResult | undefined {
    const record = this.processes.get(processId);
    if (!record) {
      return undefined;
    }

    const stream = options?.stream ?? 'all';
    let targetText = record.output;
    let targetBytes = record.totalBytes;
    let targetEarliest = record.earliestIndex;
    let targetIsTruncated = record.isTruncated;

    if (stream === 'stdout') {
      targetText = record.stdout;
      targetBytes = record.stdoutBytes;
      targetEarliest = Math.max(0, record.stdoutBytes - Buffer.byteLength(record.stdout, 'utf8'));
      targetIsTruncated = targetEarliest > 0;
    } else if (stream === 'stderr') {
      targetText = record.stderr;
      targetBytes = record.stderrBytes;
      targetEarliest = Math.max(0, record.stderrBytes - Buffer.byteLength(record.stderr, 'utf8'));
      targetIsTruncated = targetEarliest > 0;
    }

    let fromIndex = Math.max(0, options?.fromIndex ?? 0);
    // If requested cursor was truncated away, fast-forward to earliest available cursor
    if (targetIsTruncated && fromIndex < targetEarliest) {
      fromIndex = targetEarliest;
    }

    const maxBytes = Math.max(1, options?.maxBytes ?? this.maxOutputBytes);
    const relativeStartByte = Math.max(0, fromIndex - targetEarliest);

    const { slice, byteLength } = sliceUtf8Safe(targetText, relativeStartByte, maxBytes);
    const nextIndex = fromIndex + byteLength;
    const currentRetainedBytes = Buffer.byteLength(targetText, 'utf8');
    const hasMore =
      nextIndex < targetEarliest + currentRetainedBytes || record.status === 'running';

    // Chunks within the requested byte window
    const relevantChunks = record.chunks.filter((c) => {
      if (stream !== 'all' && c.stream !== stream) {
        return false;
      }
      if (c.byteOffset === undefined) {
        return true;
      }
      const cEnd = c.byteOffset + Buffer.byteLength(c.text, 'utf8');
      return cEnd > fromIndex && c.byteOffset < nextIndex;
    });

    const stdoutEarliest = Math.max(0, record.stdoutBytes - Buffer.byteLength(record.stdout, 'utf8'));
    const stdoutSlice =
      stream === 'stderr'
        ? ''
        : sliceUtf8Safe(
            record.stdout,
            Math.max(0, fromIndex - stdoutEarliest),
            maxBytes,
          ).slice;

    const stderrEarliest = Math.max(0, record.stderrBytes - Buffer.byteLength(record.stderr, 'utf8'));
    const stderrSlice =
      stream === 'stdout'
        ? ''
        : sliceUtf8Safe(
            record.stderr,
            Math.max(0, fromIndex - stderrEarliest),
            maxBytes,
          ).slice;

    return {
      output: slice,
      stdout: stdoutSlice,
      stderr: stderrSlice,
      chunks: relevantChunks,
      hasMore,
      nextIndex,
      totalBytes: targetBytes,
      stdoutBytes: record.stdoutBytes,
      stderrBytes: record.stderrBytes,
      isTruncated: targetIsTruncated,
      earliestIndex: targetEarliest,
    };
  }

  public async sendInput(processId: string, data: string): Promise<SendInputResult> {
    const record = this.processes.get(processId);
    if (!record) {
      return {
        success: false,
        message: `Process "${processId}" not found. Only active KODRA-managed processes can receive input.`,
      };
    }

    if (record.status !== 'running') {
      return {
        success: false,
        message: `Process "${processId}" is not running (status: ${record.status}, exit code: ${record.exitCode ?? 'unknown'}).`,
      };
    }

    if (!record.child?.stdin || !record.child.stdin.writable) {
      return {
        success: false,
        message: `Process "${processId}" does not support stdin or its stdin stream is closed.`,
      };
    }

    return new Promise<SendInputResult>((resolve) => {
      record.child!.stdin!.write(data, 'utf8', (err) => {
        if (err) {
          resolve({
            success: false,
            message: `Failed to write input to process "${processId}": ${err.message}`,
          });
        } else {
          resolve({
            success: true,
            message: `Successfully wrote ${Buffer.byteLength(data, 'utf8')} bytes to process "${processId}".`,
            bytesWritten: Buffer.byteLength(data, 'utf8'),
          });
        }
      });
    });
  }

  public async stopProcess(
    processId: string,
    options?: StopProcessOptions | string,
  ): Promise<StopProcessResult> {
    const record = this.processes.get(processId);
    if (!record) {
      return {
        success: false,
        status: 'failed',
        alreadyExited: false,
        message: `Process "${processId}" not found.`,
      };
    }

    if (record.closed || record.status !== 'running') {
      return {
        success: true,
        status: record.status,
        alreadyExited: true,
        message: `Process "${processId}" has already exited (status: ${record.status}, exit code: ${record.exitCode ?? 0}).`,
        exitCode: record.exitCode,
        pid: record.pid,
      };
    }

    if (!record.child) {
      return {
        success: false,
        status: record.status,
        alreadyExited: false,
        message: `Process "${processId}" has no child handle; termination cannot be confirmed.`,
        pid: record.pid,
      };
    }

    if ((record as any)._stopPromise) return (record as any)._stopPromise;

    const opts: StopProcessOptions =
      typeof options === 'string' ? { signal: options } : (options ?? {});
    const force = Boolean(opts.force);
    const graceTimeoutMs = opts.graceTimeoutMs ?? 500;

    const stopPromise = (async (): Promise<StopProcessResult> => {
      // A new explicit stop request supersedes an earlier timeout intent.
      // The status itself remains "running" until the child's close event.
      record.terminationRequested = 'cancelled';
      this.appendChunk(record, '\n[Cancellation requested by user]', 'stderr');

      if (!force) {
        this.gracefulKill(record.child!, opts.signal);
        if (await this.waitForExit(record, graceTimeoutMs)) {
          record.status = 'cancelled';
          record.closed = true;
          record.endTime = record.endTime ?? Date.now();
          record.durationMs = record.endTime - record.startTime;
          this.cleanUpProcessResources(record);
          this.pruneCompletedProcesses();
          this.notifyExit(record);
          return {
            success: true,
            status: 'cancelled',
            alreadyExited: false,
            message: `Process "${processId}" was gracefully stopped.`,
            pid: record.pid,
            exitCode: record.exitCode,
          };
        }
      }

      try {
        this.forceKillProcess(record.child!);
      } catch (err: any) {
        return {
          success: false,
          status: record.status,
          alreadyExited: false,
          message: `Failed to forcefully terminate process "${processId}": ${err.message}`,
          pid: record.pid,
          exitCode: record.exitCode,
        };
      }

      const forceExited = await this.waitForExit(record, 1000);
      if (!forceExited) {
        return {
          success: false,
          status: record.status,
          alreadyExited: false,
          message: `Termination of process "${processId}" could not be confirmed. It remains tracked as running and will be finalized only after its close event.`,
          pid: record.pid,
          exitCode: record.exitCode,
        };
      }

      record.status = 'cancelled';
      record.closed = true;
      record.endTime = record.endTime ?? Date.now();
      record.durationMs = record.endTime - record.startTime;
      this.cleanUpProcessResources(record);
      this.pruneCompletedProcesses();
      this.notifyExit(record);

      return {
        success: true,
        status: 'cancelled',
        alreadyExited: false,
        message: force
          ? `Process "${processId}" was forcefully terminated.`
          : `Process "${processId}" did not exit within ${graceTimeoutMs}ms; forcefully terminated.`,
        pid: record.pid,
        exitCode: record.exitCode,
      };
    })();

    (record as any)._stopPromise = stopPromise;
    try {
      return await stopPromise;
    } finally {
      delete (record as any)._stopPromise;
    }
  }

  public async waitForProcessExit(
    processId: string,
    timeoutMs: number,
  ): Promise<ProcessRecord | undefined> {
    const record = this.processes.get(processId);
    if (!record) {
      return undefined;
    }
    if (record.status !== 'running') {
      return record;
    }
    await this.waitForExit(record, timeoutMs);
    return record;
  }

  public cleanup(processId: string): boolean {
    const record = this.processes.get(processId);
    if (!record) return false;

    // Running processes stay registered, with listeners intact, until close is confirmed.
    if (!record.closed && record.status === 'running' && record.child) {
      record.cleanupAfterExit = true;
      if (!record.terminationRequested) record.terminationRequested = 'cancelled';
      if (!record.error) record.error = 'Cleanup requested; waiting for process termination to be confirmed.';
      this.forceKillProcess(record.child);
      return true;
    }

    this.removeProcessRecord(record);
    return true;
  }

  public dispose(): void {
    for (const record of Array.from(this.processes.values())) {
      if (!record.closed && record.status === 'running' && record.child) {
        record.status = 'cancelled';
        record.closed = true;
        record.endTime = Date.now();
        record.durationMs = record.endTime - record.startTime;
        this.forceKillProcess(record.child);
      }
      this.removeProcessRecord(record);
    }
    this.chunkListeners.clear();
    this.exitListeners.clear();
    this.processes.clear();
    this.processTimers.clear();
    this.totalChunkBytes = 0;
  }

  private removeProcessRecord(record: ProcessRecord): void {
    for (const chunk of record.chunks) {
      this.totalChunkBytes = Math.max(0, this.totalChunkBytes - Buffer.byteLength(chunk.text, 'utf8'));
    }
    record.chunks = [];
    this.clearTimers(record.processId);
    this.cleanUpProcessResources(record);
    this.chunkListeners.delete(record.processId);
    this.exitListeners.delete(record.processId);
    this.processes.delete(record.processId);
  }

  private cleanUpProcessResources(record: ProcessRecord): void {
    this.clearTimers(record.processId);
    if ((record as any)._cleanedUp) {
      return;
    }
    (record as any)._cleanedUp = true;

    const child = record.child;
    if (child) {
      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.removeAllListeners();
          child.stdin.destroy();
        }
      } catch {}

      try {
        if (child.stdout && !child.stdout.destroyed) {
          child.stdout.removeAllListeners();
          child.stdout.destroy();
        }
      } catch {}

      try {
        if (child.stderr && !child.stderr.destroyed) {
          child.stderr.removeAllListeners();
          child.stderr.destroy();
        }
      } catch {}

      try {
        child.removeAllListeners('data');
        child.removeAllListeners('error');
        child.removeAllListeners('close');
        child.removeAllListeners('exit');
      } catch {}

      try {
        if (typeof child.unref === 'function') {
          child.unref();
        }
      } catch {}
    }
  }

  private notifyExit(record: ProcessRecord): void {
    const listener = this.exitListeners.get(record.processId);
    if (listener) {
      this.exitListeners.delete(record.processId);
      try {
        listener(record);
      } catch {}
    }
  }

  private createRecord(options: LaunchProcessOptions): ProcessRecord {
    const processId =
      options.processId ||
      options.executionId ||
      `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      processId,
      executionId: processId,
      command: options.command,
      cwd: options.cwd,
      status: 'running',
      startTime: Date.now(),
      isTimedOut: false,
      closed: false,
      output: '',
      stdout: '',
      stderr: '',
      isTruncated: false,
      earliestIndex: 0,
      chunks: [],
      totalBytes: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      terminalSessionId: options.terminalSessionId,
      terminalId: options.terminalId,
      terminalName: options.terminalName,
      workspaceId: options.workspaceId,
      toolCallId: options.toolCallId,
      agentRunId: options.agentRunId,
    };
  }

  private spawnChild(command: string, cwd: string, customEnv?: NodeJS.ProcessEnv): ChildProcess {
    const isWin = process.platform === 'win32';
    return spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, ...customEnv, FORCE_COLOR: '0' },
      windowsHide: true,
      detached: !isWin, // Create dedicated process group on Unix for clean process-tree termination
    });
  }

  private attachOutputHandlers(record: ProcessRecord, child: ChildProcess): void {
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.appendChunk(record, text, 'stdout');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.appendChunk(record, text, 'stderr');
    });
  }

  private evictExcessChunks(): void {
    if (this.totalChunkBytes <= this.maxChunkBytes) {
      return;
    }

    // First evict from completed processes (oldest first)
    const completed: ProcessRecord[] = [];
    const running: ProcessRecord[] = [];
    for (const rec of this.processes.values()) {
      if (rec.status !== 'running') {
        completed.push(rec);
      } else {
        running.push(rec);
      }
    }
    completed.sort((a, b) => (a.endTime ?? a.startTime) - (b.endTime ?? b.startTime));

    for (const rec of [...completed, ...running]) {
      while (rec.chunks.length > 0 && this.totalChunkBytes > this.maxChunkBytes) {
        const shifted = rec.chunks.shift();
        if (shifted) {
          this.totalChunkBytes = Math.max(0, this.totalChunkBytes - Buffer.byteLength(shifted.text, 'utf8'));
        }
      }
      if (this.totalChunkBytes <= this.maxChunkBytes) {
        break;
      }
    }
  }

  private appendChunk(record: ProcessRecord, text: string, stream: 'stdout' | 'stderr'): void {
    const chunkBytes = Buffer.byteLength(text, 'utf8');
    const offset = record.totalBytes;
    record.totalBytes += chunkBytes;

    if (stream === 'stdout') {
      record.stdoutBytes += chunkBytes;
      record.stdout += text;
      if (Buffer.byteLength(record.stdout, 'utf8') > this.maxOutputBytes) {
        const trimmed = trimOldestUtf8Safe(record.stdout, this.maxOutputBytes);
        record.stdout = trimmed.text;
      }
    } else {
      record.stderrBytes += chunkBytes;
      record.stderr += text;
      if (Buffer.byteLength(record.stderr, 'utf8') > this.maxOutputBytes) {
        const trimmed = trimOldestUtf8Safe(record.stderr, this.maxOutputBytes);
        record.stderr = trimmed.text;
      }
    }

    record.output += text;
    if (Buffer.byteLength(record.output, 'utf8') > this.maxOutputBytes) {
      const trimmed = trimOldestUtf8Safe(record.output, this.maxOutputBytes);
      record.output = trimmed.text;
      record.isTruncated = true;
      record.earliestIndex += trimmed.bytesDropped;
    }

    record.chunks.push({
      text,
      stream,
      timestamp: Date.now(),
      byteOffset: offset,
    });
    this.totalChunkBytes += chunkBytes;

    while (
      record.chunks.length > this.maxChunks ||
      (this.totalChunkBytes > this.maxChunkBytes && record.chunks.length > 0)
    ) {
      const shifted = record.chunks.shift();
      if (shifted) {
        this.totalChunkBytes = Math.max(0, this.totalChunkBytes - Buffer.byteLength(shifted.text, 'utf8'));
      }
    }

    if (this.totalChunkBytes > this.maxChunkBytes) {
      this.evictExcessChunks();
    }

    const listeners = this.chunkListeners.get(record.processId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(text, stream);
        } catch {}
      }
    }
  }

  private addChunkListener(
    processId: string,
    listener: (chunk: string, stream: 'stdout' | 'stderr') => void,
  ): void {
    let list = this.chunkListeners.get(processId);
    if (!list) {
      list = [];
      this.chunkListeners.set(processId, list);
    }
    list.push(listener);
  }

  private pruneCompletedProcesses(): void {
    const completed: ProcessRecord[] = [];
    for (const record of this.processes.values()) {
      if (record.status !== 'running') {
        completed.push(record);
      }
    }

    if (completed.length > this.maxCompletedProcesses) {
      completed.sort((a, b) => (a.endTime ?? a.startTime) - (b.endTime ?? b.startTime));
      const toRemove = completed.slice(0, completed.length - this.maxCompletedProcesses);
      for (const rec of toRemove) {
        this.removeProcessRecord(rec);
      }
    }
  }

  private waitForExit(record: ProcessRecord, timeoutMs: number): Promise<boolean> {
    if (record.closed === true) return Promise.resolve(true);
    const child = record.child;
    if (!child) return Promise.resolve(false);
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (closed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('close', onClose);
        child.removeListener('exit', onClose);
        resolve(closed || record.closed === true || child.exitCode !== null || child.signalCode !== null);
      };
      const onClose = () => finish(true);
      const timer = setTimeout(
        () => finish(record.closed === true || child.exitCode !== null || child.signalCode !== null),
        Math.max(0, timeoutMs),
      );
      if (typeof timer.unref === 'function') timer.unref();
      child.once('close', onClose);
      child.once('exit', onClose);
      if (record.closed === true || child.exitCode !== null || child.signalCode !== null) finish(true);
    });
  }

  private gracefulKill(child: ChildProcess, signal?: string): void {
    if (!child.pid) {
      try {
        child.kill((signal as any) || 'SIGINT');
      } catch {}
      return;
    }

    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', child.pid.toString(), '/T'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {}
      try {
        child.kill('SIGINT');
      } catch {}
    } else {
      try {
        process.kill(-child.pid, (signal as any) || 'SIGINT');
      } catch {
        try {
          process.kill(child.pid, (signal as any) || 'SIGINT');
        } catch {
          try {
            child.kill((signal as any) || 'SIGINT');
          } catch {}
        }
      }
    }
  }

  private forceKillProcess(child: ChildProcess): void {
    if (!child.pid) {
      try {
        child.kill('SIGKILL');
      } catch {}
      return;
    }

    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {}
      try {
        child.kill();
      } catch {}
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }
    }
  }

  private killProcess(child: ChildProcess): void {
    this.forceKillProcess(child);
  }
}