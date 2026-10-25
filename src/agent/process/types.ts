import { ChildProcess } from 'child_process';

export type ProcessStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'unknown';

export interface ProcessOutputChunk {
  text: string;
  stream: 'stdout' | 'stderr';
  timestamp: number;
  byteOffset?: number;
}

export interface ProcessRecord {
  processId: string;
  executionId?: string;
  command: string;
  cwd: string;
  pid?: number;
  status: ProcessStatus;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  exitCode?: number | null;
  error?: string;
  isTimedOut: boolean;
  /** True only after the child's close event confirms process and stdio closure. */
  closed?: boolean;
  /** Termination intent; status stays 'running' until closure is confirmed. */
  terminationRequested?: 'cancelled' | 'timed_out';
  /** Remove this record after termination is confirmed. */
  cleanupAfterExit?: boolean;
  child?: ChildProcess;
  output: string;
  stdout: string;
  stderr: string;
  isTruncated: boolean;
  earliestIndex: number;
  chunks: ProcessOutputChunk[];
  totalBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  terminalSessionId?: string;
  terminalId?: string;
  terminalName?: string;
  workspaceId?: string;
  toolCallId?: string;
  agentRunId?: string;
}

export interface LaunchProcessOptions {
  command: string;
  cwd: string;
  processId?: string;
  executionId?: string;
  workspaceId?: string;
  toolCallId?: string;
  agentRunId?: string;
  terminalSessionId?: string;
  terminalId?: string;
  terminalName?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  onExit?: (record: ProcessRecord) => void;
}

export interface GetOutputOptions {
  fromIndex?: number;
  maxBytes?: number;
  stream?: 'all' | 'stdout' | 'stderr';
}

export interface GetOutputResult {
  output: string;
  stdout: string;
  stderr: string;
  chunks: ProcessOutputChunk[];
  hasMore: boolean;
  nextIndex: number;
  totalBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  isTruncated: boolean;
  earliestIndex: number;
}

export interface SendInputResult {
  success: boolean;
  message: string;
  bytesWritten?: number;
}

export interface StopProcessOptions {
  force?: boolean;
  graceTimeoutMs?: number;
  signal?: string;
}

export interface StopProcessResult {
  success: boolean;
  status: ProcessStatus;
  alreadyExited: boolean;
  message: string;
  exitCode?: number | null;
  pid?: number;
}

export interface IProcessManager {
  startProcess(options: LaunchProcessOptions): Promise<ProcessRecord>;
  runCommand(options: LaunchProcessOptions): Promise<ProcessRecord>;
  getProcess(processId: string): ProcessRecord | undefined;
  listProcesses(): ProcessRecord[];
  getActiveProcessCount?(): number;
  getOutput(processId: string, options?: GetOutputOptions): GetOutputResult | undefined;
  sendInput(processId: string, data: string): Promise<SendInputResult>;
  stopProcess(processId: string, options?: StopProcessOptions | string): Promise<StopProcessResult>;
  waitForProcessExit(processId: string, timeoutMs: number): Promise<ProcessRecord | undefined>;
  cleanup(processId: string): boolean;
  dispose(): void;
}