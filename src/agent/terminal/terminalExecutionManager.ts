/**
 * Terminal Execution Manager for Kodra.
 * 
 * Manages the lifecycle of integrated terminals, terminal sessions, and command executions:
 * - Deterministic terminal reuse: Reuses compatible, idle KODRA terminals before creating new ones.
 * - Per-command vs per-session identity separation: One session can run many executions sequentially.
 * - Prevents sending commands into busy terminals.
 * - Interactive pseudoterminal: handles user input and Ctrl+C, keeps terminal open for inspection and reuse.
 * - Non-blocking execution with reliable wait, status polling, cancellation, and process tree termination.
 * - Exact terminal reveal: reveals only the exact associated terminal session without fallbacks.
 * - Safe handling of externally closed terminals and resource disposal.
 */

import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';
import {
  ExecuteCommandOptions,
  ITerminalExecutionManager,
  TerminalExecutionRecord,
  TerminalExecutionStatus,
  TerminalSessionInfo,
} from './types';

export const MAX_OUTPUT_LENGTH = 50_000;

interface TerminalSession {
  sessionId: string;
  terminalId: string;
  terminalName: string;
  workspaceId: string;
  cwd: string;
  terminal?: vscode.Terminal;
  writeEmitter?: vscode.EventEmitter<string>;
  closeEmitter?: vscode.EventEmitter<number | void>;
  pty?: vscode.Pseudoterminal;
  isBusy: boolean;
  isClosed: boolean;
  activeExecutionId?: string;
  activeChild?: ChildProcess;
  createdAt: number;
  completedExecutionsCount: number;
  lastCommand?: string;
}

export class TerminalExecutionManager implements ITerminalExecutionManager {
  private static instance: TerminalExecutionManager | null = null;
  private readonly logger = Logger.getInstance();

  private readonly sessions: Map<string, TerminalSession> = new Map();
  private readonly executions: Map<string, TerminalExecutionRecord> = new Map();
  private readonly executionToSession: Map<string, string> = new Map();
  private readonly activeProcesses: Map<string, ChildProcess> = new Map();
  private readonly executionResolvers: Map<string, Array<(record: TerminalExecutionRecord) => void>> = new Map();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Listen for terminal closures by user or system
    if (vscode.window && typeof vscode.window.onDidCloseTerminal === 'function') {
      const closeSub = vscode.window.onDidCloseTerminal((closedTerminal) => {
        this.handleTerminalClosed(closedTerminal);
      });
      this.disposables.push(closeSub);
    }
  }

  public static getInstance(): TerminalExecutionManager {
    if (!TerminalExecutionManager.instance) {
      TerminalExecutionManager.instance = new TerminalExecutionManager();
    }
    return TerminalExecutionManager.instance;
  }

  public static resetInstance(): void {
    if (TerminalExecutionManager.instance) {
      TerminalExecutionManager.instance.dispose();
      TerminalExecutionManager.instance = null;
    }
  }

  /**
   * Find a compatible, idle terminal session in the given workspace.
   */
  public findIdleSession(workspaceId?: string, cwd?: string): TerminalSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.isClosed || session.isBusy) {
        continue;
      }
      if (workspaceId && session.workspaceId && session.workspaceId !== workspaceId) {
        continue;
      }
      return session;
    }
    return undefined;
  }

  /**
   * Execute or manage a command in a real VS Code integrated terminal.
   */
  public async executeCommand(options: ExecuteCommandOptions): Promise<TerminalExecutionRecord> {
    const action = options.action || 'execute';

    // ── Handle Non-Execution Lifecycle Actions ──────────────────────────────
    if (action === 'status') {
      const execId = options.executionId;
      if (!execId) {
        throw new Error('Action "status" requires an "executionId".');
      }
      const existing = this.executions.get(execId);
      if (!existing) {
        throw new Error(`Execution not found with executionId: "${execId}".`);
      }
      return existing;
    }

    if (action === 'list_sessions') {
      const sessions = this.listSessions(options.workspaceId);
      const executionId = options.executionId || this.generateExecutionId('cmd_list_');
      const record: TerminalExecutionRecord = {
        executionId,
        toolCallId: options.toolCallId,
        agentRunId: options.agentRunId,
        terminalSessionId: 'none',
        terminalId: 'none',
        terminalName: 'KODRA Sessions',
        command: 'list_sessions',
        cwd: options.cwd || process.cwd(),
        workspaceId: options.workspaceId,
        status: 'completed',
        startTime: Date.now(),
        endTime: Date.now(),
        exitCode: 0,
        output: JSON.stringify(sessions, null, 2),
        isTruncated: false,
      };
      this.executions.set(executionId, record);
      return record;
    }

    if (action === 'close') {
      const sessId = options.terminalSessionId;
      const execId = options.executionId;
      let targetSessionId = sessId;
      if (!targetSessionId && execId) {
        targetSessionId = this.executionToSession.get(execId);
      }
      if (!targetSessionId) {
        throw new Error('Action "close" requires a "terminalSessionId" or valid "executionId".');
      }
      const closed = this.closeSession(targetSessionId);
      const commandExecId = execId || this.generateExecutionId('cmd_close_');
      const record: TerminalExecutionRecord = {
        executionId: commandExecId,
        toolCallId: options.toolCallId,
        agentRunId: options.agentRunId,
        terminalSessionId: targetSessionId,
        terminalId: targetSessionId,
        terminalName: `KODRA: Closed ${targetSessionId}`,
        command: `close ${targetSessionId}`,
        cwd: options.cwd || process.cwd(),
        workspaceId: options.workspaceId,
        status: closed ? 'completed' : 'failed',
        startTime: Date.now(),
        endTime: Date.now(),
        exitCode: closed ? 0 : 1,
        output: closed ? `Session "${targetSessionId}" closed.` : `Session "${targetSessionId}" not found or already closed.`,
        isTruncated: false,
      };
      this.executions.set(commandExecId, record);
      return record;
    }

    if (action === 'cancel') {
      const execId = options.executionId;
      if (!execId) {
        throw new Error('Action "cancel" requires an "executionId".');
      }
      this.cancelExecution(execId);
      const existing = this.executions.get(execId);
      if (existing) {
        return existing;
      }
      throw new Error(`Execution not found to cancel: "${execId}".`);
    }

    if (action === 'wait') {
      const execId = options.executionId;
      if (!execId) {
        throw new Error('Action "wait" requires an "executionId".');
      }
      const existing = this.executions.get(execId);
      if (!existing) {
        throw new Error(`Execution not found to wait for: "${execId}".`);
      }
      if (existing.status !== 'running') {
        return existing;
      }
      return this.waitForExecution(execId, options.waitMs ?? 30_000);
    }

    // ── Execute Command ─────────────────────────────────────────────────────
    const command = (options.command || '').trim();
    if (!command) {
      throw new Error('Command cannot be empty.');
    }

    const executionId = options.executionId || this.generateExecutionId('cmd_');

    // Avoid launching duplicate commands when checking an existing execution's status
    const existing = this.executions.get(executionId);
    if (existing) {
      if (existing.status === 'running') {
        if (typeof options.waitMs === 'number' && options.waitMs > 0) {
          return this.waitForExecution(executionId, options.waitMs);
        }
        return existing;
      }
      // If already completed or failed, return the existing completed record
      return existing;
    }

    // Validate working directory
    const cwd = this.resolveWorkingDirectory(options.cwd);
    const workspaceId = options.workspaceId || 'default';

    // ── Deterministic Terminal Session Selection & Reuse ────────────────────
    let session: TerminalSession;
    const reuse = options.reuseTerminal !== false && !options.isolated;

    if (options.terminalSessionId) {
      // Explicit targeted session
      const targeted = this.sessions.get(options.terminalSessionId);
      if (!targeted || targeted.isClosed) {
        throw new Error(`Targeted terminal session "${options.terminalSessionId}" not found or closed.`);
      }
      if (targeted.isBusy) {
        throw new Error(
          `Terminal session "${options.terminalSessionId}" is currently busy executing "${targeted.activeExecutionId}". ` +
          `Wait for the command to finish or execute in an idle terminal.`
        );
      }
      session = targeted;
    } else if (reuse) {
      // Look for a compatible idle terminal
      const idle = this.findIdleSession(workspaceId, cwd);
      if (idle) {
        session = idle;
        this.logger.info(`[KODRA Terminal] Reusing idle terminal session="${session.sessionId}"`);
      } else {
        session = this.createNewSession(workspaceId, cwd, 'no_compatible_idle_terminal');
      }
    } else {
      session = this.createNewSession(workspaceId, cwd, options.isolated ? 'isolated_execution' : 'reuse_disabled');
    }

    // Mark session as busy
    session.isBusy = true;
    session.activeExecutionId = executionId;
    session.lastCommand = command;
    session.cwd = cwd;

    this.executionToSession.set(executionId, session.sessionId);

    const record: TerminalExecutionRecord = {
      executionId,
      toolCallId: options.toolCallId,
      agentRunId: options.agentRunId,
      terminalSessionId: session.sessionId,
      terminalId: session.terminalId,
      terminalName: session.terminalName,
      command,
      cwd,
      workspaceId,
      status: 'running',
      startTime: Date.now(),
      output: '',
      isTruncated: false,
    };
    this.executions.set(executionId, record);

    return new Promise<TerminalExecutionRecord>((resolve) => {
      if (options.signal?.aborted) {
        record.status = 'cancelled';
        record.endTime = Date.now();
        record.output = 'Execution cancelled before start.';
        session.isBusy = false;
        session.activeExecutionId = undefined;
        resolve(record);
        return;
      }

      let killed = false;
      let hasResolved = false;
      const timeoutMs = options.timeoutMs ?? 120_000;
      const waitMs = options.waitMs ?? 3000;

      // Echo command start in the real VS Code terminal view
      session.writeEmitter?.fire(`\r\n\x1b[1m\x1b[36m> ${command}\x1b[0m\r\n`);

      // Spawn child process — authoritative source of truth for execution
      const child = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      session.activeChild = child;
      this.activeProcesses.set(executionId, child);

      const safeResolve = (rec: TerminalExecutionRecord) => {
        this.notifyExecutionResolvers(executionId, rec);
        if (!hasResolved) {
          hasResolved = true;
          resolve(rec);
        }
      };

      // Non-blocking timer: if waitMs elapses, return running record while command keeps running
      let waitTimer: NodeJS.Timeout | null = null;
      if (waitMs > 0) {
        waitTimer = setTimeout(() => {
          if (record.status === 'running') {
            safeResolve(record);
          }
        }, waitMs);
      } else if (waitMs === 0) {
        // Immediate background launch
        safeResolve(record);
      }

      let timeoutTimer: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          killed = true;
          if (waitTimer) {
            clearTimeout(waitTimer);
          }
          this.activeProcesses.delete(executionId);
          session.activeChild = undefined;
          this.killProcess(child);
          session.writeEmitter?.fire(`\r\n\x1b[31m[Command timed out after ${timeoutMs / 1000}s]\x1b[0m\r\n`);

          session.isBusy = false;
          session.activeExecutionId = undefined;

          record.status = 'timed_out';
          record.endTime = Date.now();
          record.error = `Command timed out after ${timeoutMs / 1000}s.`;
          this.appendOutput(record, `\n[Timed out after ${timeoutMs / 1000}s]`);

          if (options.preserveTerminal === false) {
            this.closeSession(session.sessionId);
          }
          safeResolve(record);
        }, timeoutMs);
      }

      const abortHandler = () => {
        killed = true;
        if (waitTimer) {
          clearTimeout(waitTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        this.activeProcesses.delete(executionId);
        session.activeChild = undefined;
        this.killProcess(child);
        session.writeEmitter?.fire('\r\n\x1b[33m[Cancelled by user]\x1b[0m\r\n');

        session.isBusy = false;
        session.activeExecutionId = undefined;

        record.status = 'cancelled';
        record.endTime = Date.now();
        this.appendOutput(record, '\n[Cancelled by user]');

        if (options.preserveTerminal === false) {
          this.closeSession(session.sessionId);
        }
        safeResolve(record);
      };

      options.signal?.addEventListener('abort', abortHandler, { once: true });

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        this.appendOutput(record, text);
        session.writeEmitter?.fire(text.replace(/\r?\n/g, '\r\n'));
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        this.appendOutput(record, text);
        session.writeEmitter?.fire(text.replace(/\r?\n/g, '\r\n'));
      });

      child.on('error', (err) => {
        if (waitTimer) {
          clearTimeout(waitTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        options.signal?.removeEventListener('abort', abortHandler);
        this.activeProcesses.delete(executionId);
        session.activeChild = undefined;
        if (killed) {
          return;
        }

        session.isBusy = false;
        session.activeExecutionId = undefined;

        record.status = 'failed';
        record.endTime = Date.now();
        record.error = err.message;
        this.appendOutput(record, `\nFailed to start process: ${err.message}`);
        session.writeEmitter?.fire(`\r\n\x1b[31mFailed to start process: ${err.message}\x1b[0m\r\n`);

        if (options.preserveTerminal === false) {
          this.closeSession(session.sessionId);
        }
        safeResolve(record);
      });

      child.on('close', (code) => {
        if (waitTimer) {
          clearTimeout(waitTimer);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        options.signal?.removeEventListener('abort', abortHandler);
        this.activeProcesses.delete(executionId);
        session.activeChild = undefined;
        if (killed) {
          return;
        }

        session.isBusy = false;
        session.activeExecutionId = undefined;
        session.completedExecutionsCount++;

        const exitCode = code ?? 0;
        record.exitCode = exitCode;
        record.endTime = Date.now();
        record.status = exitCode === 0 ? 'completed' : 'failed';

        if (exitCode !== 0) {
          record.error = `Process exited with code ${exitCode}`;
        }

        session.writeEmitter?.fire(`\r\n\x1b[${exitCode === 0 ? '32m' : '31m'}[Process exited with code ${exitCode}]\x1b[0m\r\n`);

        // If the caller explicitly decided NOT to preserve the terminal, close it.
        // Otherwise, DO NOT close the pty! Keep the terminal interactive and reusable.
        if (options.preserveTerminal === false) {
          this.closeSession(session.sessionId);
        }

        safeResolve(record);
      });
    });
  }

  /**
   * Create a new terminal session with a reusable Pseudoterminal.
   */
  private createNewSession(workspaceId: string, cwd: string, reason: string): TerminalSession {
    const sessionId = `term_sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const terminalId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const terminalName = `Kodra: Terminal ${this.sessions.size + 1}`;

    let writeEmitter: vscode.EventEmitter<string> | undefined;
    let closeEmitter: vscode.EventEmitter<number | void> | undefined;
    let pty: vscode.Pseudoterminal | undefined;

    try {
      if (vscode.EventEmitter) {
        writeEmitter = new vscode.EventEmitter<string>();
        closeEmitter = new vscode.EventEmitter<number | void>();
        pty = {
          onDidWrite: writeEmitter.event,
          onDidClose: closeEmitter.event,
          open: () => {},
          close: () => {
            const currentSession = this.sessions.get(sessionId);
            if (currentSession && currentSession.activeExecutionId) {
              this.cancelExecution(currentSession.activeExecutionId);
            }
          },
          handleInput: (data: string) => {
            // Forward Ctrl+C (\x03) to process cancellation
            if (data === '\x03' || data === '\u0003') {
              const currentSession = this.sessions.get(sessionId);
              if (currentSession && currentSession.activeExecutionId) {
                this.cancelExecution(currentSession.activeExecutionId);
              }
              return;
            }
            // Forward interactive input to the running child process stdin if open
            const currentSession = this.sessions.get(sessionId);
            if (currentSession?.activeChild?.stdin && currentSession.activeChild.stdin.writable) {
              try {
                currentSession.activeChild.stdin.write(data);
              } catch {
                // ignore write error
              }
            }
          },
        };
      }
    } catch {
      // EventEmitter not supported in test environment
    }

    let terminal: vscode.Terminal | undefined;
    try {
      if (vscode.window && typeof vscode.window.createTerminal === 'function') {
        terminal = pty
          ? vscode.window.createTerminal({ name: terminalName, pty })
          : vscode.window.createTerminal({ name: terminalName, cwd });
      }
    } catch (termErr) {
      this.logger.warn('Could not create VS Code integrated terminal; falling back to headless runner', termErr);
    }

    const session: TerminalSession = {
      sessionId,
      terminalId,
      terminalName,
      workspaceId,
      cwd,
      terminal,
      writeEmitter,
      closeEmitter,
      pty,
      isBusy: false,
      isClosed: false,
      createdAt: Date.now(),
      completedExecutionsCount: 0,
    };

    this.sessions.set(sessionId, session);
    this.logger.info(`[KODRA Terminal] Created new terminal session="${sessionId}" name="${terminalName}" reason="${reason}"`);
    return session;
  }

  /**
   * Append text to record output, respecting MAX_OUTPUT_LENGTH bound.
   */
  private appendOutput(record: TerminalExecutionRecord, text: string): void {
    record.output += text;
    if (record.output.length > MAX_OUTPUT_LENGTH) {
      record.output = record.output.slice(-MAX_OUTPUT_LENGTH);
      record.isTruncated = true;
    }
  }

  /**
   * Wait for an active running command to complete or reach wait timeout.
   */
  private waitForExecution(executionId: string, timeoutMs: number): Promise<TerminalExecutionRecord> {
    const existing = this.executions.get(executionId);
    if (!existing || existing.status !== 'running') {
      return Promise.resolve(existing || {
        executionId,
        terminalSessionId: 'none',
        terminalId: 'none',
        terminalName: 'Unknown',
        command: '',
        cwd: process.cwd(),
        status: 'unknown',
        startTime: Date.now(),
        output: 'Execution not found.',
        isTruncated: false,
      });
    }

    return new Promise<TerminalExecutionRecord>((resolve) => {
      let resolved = false;
      let timer: NodeJS.Timeout | null = null;

      const callback = (rec: TerminalExecutionRecord) => {
        if (!resolved) {
          resolved = true;
          if (timer) {
            clearTimeout(timer);
          }
          resolve(rec);
        }
      };

      if (!this.executionResolvers.has(executionId)) {
        this.executionResolvers.set(executionId, []);
      }
      this.executionResolvers.get(executionId)!.push(callback);

      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const current = this.executions.get(executionId) || existing;
          resolve(current);
        }
      }, timeoutMs);
    });
  }

  private notifyExecutionResolvers(executionId: string, record: TerminalExecutionRecord): void {
    const list = this.executionResolvers.get(executionId);
    if (list) {
      this.executionResolvers.delete(executionId);
      for (const cb of list) {
        try {
          cb(record);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Reveal the exact terminal instance corresponding to this execution or session.
   * Never falls back to an unrelated or merely most-recent terminal.
   */
  public revealTerminal(executionOrSessionId?: string): boolean {
    if (!executionOrSessionId) {
      return false;
    }

    // 1. Check if executionOrSessionId is a direct session ID
    const directSession = this.sessions.get(executionOrSessionId);
    if (directSession && !directSession.isClosed && directSession.terminal) {
      try {
        directSession.terminal.show(false);
        return true;
      } catch (err) {
        this.logger.warn(`Failed to reveal terminal session="${executionOrSessionId}"`, err);
        return false;
      }
    }

    // 2. Check if executionOrSessionId is a command execution ID
    const sessionId = this.executionToSession.get(executionOrSessionId);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session && !session.isClosed && session.terminal) {
        try {
          session.terminal.show(false);
          return true;
        } catch (err) {
          this.logger.warn(`Failed to reveal terminal for executionId="${executionOrSessionId}"`, err);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Get an existing execution record.
   */
  public getExecution(executionId: string): TerminalExecutionRecord | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Cancel an execution without affecting other terminal sessions.
   */
  public cancelExecution(executionId: string): boolean {
    const child = this.activeProcesses.get(executionId);
    const sessionId = this.executionToSession.get(executionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (child) {
      this.activeProcesses.delete(executionId);
      this.killProcess(child);

      if (session) {
        session.isBusy = false;
        session.activeExecutionId = undefined;
        session.activeChild = undefined;
        session.writeEmitter?.fire('\r\n\x1b[33m[Cancelled by user]\x1b[0m\r\n');
      }

      const record = this.executions.get(executionId);
      if (record) {
        record.status = 'cancelled';
        record.endTime = Date.now();
        this.appendOutput(record, '\n[Cancelled by user]');
        this.notifyExecutionResolvers(executionId, record);
      }
      return true;
    }

    const record = this.executions.get(executionId);
    if (record && record.status === 'running') {
      record.status = 'cancelled';
      record.endTime = Date.now();
      this.appendOutput(record, '\n[Cancelled by user]');
      if (session) {
        session.isBusy = false;
        session.activeExecutionId = undefined;
      }
      this.notifyExecutionResolvers(executionId, record);
      return true;
    }

    return false;
  }

  /**
   * Explicitly close and dispose a terminal session.
   */
  public closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.isClosed) {
      return false;
    }

    // Cancel any currently running execution in this session
    if (session.activeExecutionId) {
      this.cancelExecution(session.activeExecutionId);
    }

    session.isClosed = true;
    session.isBusy = false;

    try {
      session.closeEmitter?.fire();
    } catch {
      // ignore
    }

    try {
      session.terminal?.dispose();
    } catch {
      // ignore
    }

    this.logger.info(`[KODRA Terminal] Session "${sessionId}" closed and disposed.`);
    return true;
  }

  /**
   * List all terminal sessions, optionally filtered by workspaceId.
   */
  public listSessions(workspaceId?: string): TerminalSessionInfo[] {
    const result: TerminalSessionInfo[] = [];
    for (const s of this.sessions.values()) {
      if (workspaceId && s.workspaceId && s.workspaceId !== workspaceId) {
        continue;
      }
      result.push({
        sessionId: s.sessionId,
        terminalName: s.terminalName,
        workspaceId: s.workspaceId,
        cwd: s.cwd,
        isBusy: s.isBusy,
        isClosed: s.isClosed,
        activeExecutionId: s.activeExecutionId,
        lastCommand: s.lastCommand,
        createdAt: s.createdAt,
        completedExecutionsCount: s.completedExecutionsCount,
      });
    }
    return result;
  }

  /**
   * Get session information by sessionId.
   */
  public getSession(sessionId: string): TerminalSessionInfo | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return undefined;
    }
    return {
      sessionId: s.sessionId,
      terminalName: s.terminalName,
      workspaceId: s.workspaceId,
      cwd: s.cwd,
      isBusy: s.isBusy,
      isClosed: s.isClosed,
      activeExecutionId: s.activeExecutionId,
      lastCommand: s.lastCommand,
      createdAt: s.createdAt,
      completedExecutionsCount: s.completedExecutionsCount,
    };
  }

  /**
   * List all tracked executions.
   */
  public listExecutions(): TerminalExecutionRecord[] {
    return Array.from(this.executions.values());
  }

  /**
   * Stop a running process and its process tree safely.
   */
  private killProcess(child: ChildProcess): void {
    if (!child.pid) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      return;
    }

    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    } else {
      try {
        process.kill(-child.pid, 'SIGINT');
      } catch {
        try {
          child.kill('SIGINT');
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Resolve and validate working directory.
   */
  private resolveWorkingDirectory(cwd?: string): string {
    if (cwd && fs.existsSync(cwd)) {
      return cwd;
    }
    if (vscode.workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return process.cwd();
  }

  /**
   * Handle terminal close event triggered externally by user or VS Code.
   */
  private handleTerminalClosed(closedTerminal: vscode.Terminal): void {
    for (const session of this.sessions.values()) {
      if (session.terminal === closedTerminal) {
        session.isClosed = true;
        session.isBusy = false;

        if (session.activeExecutionId) {
          const record = this.executions.get(session.activeExecutionId);
          if (record && record.status === 'running') {
            record.status = 'unknown';
            record.endTime = Date.now();
            record.error = 'Terminal was closed externally while command was running.';
            this.appendOutput(record, '\n[Terminal closed by user or system]');
            this.notifyExecutionResolvers(session.activeExecutionId, record);
          }
          if (session.activeChild) {
            this.killProcess(session.activeChild);
            this.activeProcesses.delete(session.activeExecutionId);
            session.activeChild = undefined;
          }
          session.activeExecutionId = undefined;
        }

        this.logger.info(`[KODRA Terminal] Session "${session.sessionId}" marked closed after external terminal close.`);
        break;
      }
    }
  }

  private generateExecutionId(prefix: string): string {
    return crypto.randomUUID
      ? `${prefix}${crypto.randomUUID()}`
      : `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  public dispose(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this.disposables.length = 0;

    for (const [_, child] of this.activeProcesses) {
      try {
        this.killProcess(child);
      } catch {
        // ignore
      }
    }
    this.activeProcesses.clear();

    for (const session of this.sessions.values()) {
      try {
        session.closeEmitter?.fire();
      } catch {}
      try {
        session.terminal?.dispose();
      } catch {}
    }
    this.sessions.clear();
    this.executionToSession.clear();
    this.executionResolvers.clear();
  }
}
