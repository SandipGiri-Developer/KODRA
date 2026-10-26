import { ToolDefinition } from '../../providers/types';
import { IProcessManager, ProcessManager } from '../process';
import { ITool, ToolCapability, ToolParameterSchema, ToolResult } from '../types';

export class ReadProcessOutputTool implements ITool {
  readonly name = 'read_process_output';
  readonly capability: ToolCapability = 'read_only';
  readonly description =
    'Read captured stdout and stderr output from a KODRA-managed process. ' +
    'Supports incremental reading via cursor/offset to retrieve new output without repeating history.';

  readonly requiresApproval = false;
  readonly isDestructive = false;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      processId: {
        type: 'string',
        description: 'Unique identifier of the process to read output from.',
      },
      cursor: {
        type: 'number',
        description: 'Optional UTF-8 byte offset returned from previous call to fetch incremental output (default: 0).',
      },
      maxBytes: {
        type: 'number',
        description: 'Optional maximum number of UTF-8 bytes to return in this chunk (default: 50000).',
      },
      stream: {
        type: 'string',
        enum: ['all', 'stdout', 'stderr'],
        description: 'Optional stream filter: "all" (both stdout and stderr), "stdout", or "stderr" (default: "all").',
      },
    },
    required: ['processId'],
  };

  constructor(
    private readonly processManager: IProcessManager = ProcessManager.getInstance(),
  ) {}

  getDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: this.parameters.type,
          properties: this.parameters.properties,
          required: this.parameters.required,
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const processId = typeof args.processId === 'string' ? args.processId.trim() : '';
    if (!processId) {
      return {
        content: 'Error: Missing required argument "processId".',
        success: false,
      };
    }

    const proc = this.processManager.getProcess(processId);
    if (!proc) {
      return {
        content: `Error: Process "${processId}" not found. Verify the processId from start_process or run_command.`,
        success: false,
      };
    }

    const cursor = typeof args.cursor === 'number' && args.cursor >= 0 ? args.cursor : 0;
    const maxBytes = typeof args.maxBytes === 'number' && args.maxBytes > 0 ? args.maxBytes : undefined;
    const stream =
      args.stream === 'stdout' || args.stream === 'stderr' ? (args.stream as 'stdout' | 'stderr') : 'all';

    const result = this.processManager.getOutput(processId, { fromIndex: cursor, maxBytes, stream });
    if (!result) {
      return {
        content: `Error: Could not retrieve output for process "${processId}".`,
        success: false,
      };
    }

    const exitInfo = proc.exitCode !== undefined && proc.exitCode !== null ? ` (exit code: ${proc.exitCode})` : '';
    let header = `Process "${processId}" status: ${proc.status}${exitInfo} (cursor: ${result.nextIndex}, earliestCursor: ${result.earliestIndex}, totalBytes: ${result.totalBytes})`;

    let content = `${header}\n`;
    if (result.isTruncated && cursor < result.earliestIndex) {
      content += `[Notice: Earlier output was truncated due to buffer limits. Earliest available cursor is ${result.earliestIndex}]\n`;
    }

    if (result.output.length > 0) {
      if (stream === 'stdout') {
        content += `\n--- STDOUT ---\n${result.output}`;
      } else if (stream === 'stderr') {
        content += `\n--- STDERR ---\n${result.output}`;
      } else {
        content += `\n--- OUTPUT ---\n${result.output}`;
      }
    } else {
      content += '\n(No new output produced)';
    }

    return {
      content: content.trim(),
      success: true,
      metadata: {
        processId,
        status: proc.status,
        exitCode: proc.exitCode,
        cursor: result.nextIndex,
        earliestCursor: result.earliestIndex,
        hasMore: result.hasMore,
        totalBytes: result.totalBytes,
        stdoutBytes: result.stdoutBytes,
        stderrBytes: result.stderrBytes,
        isTruncated: result.isTruncated,
        output: result.output,
        stdout: result.stdout,
        stderr: result.stderr,
        chunks: result.chunks,
      },
    };
  }
}
