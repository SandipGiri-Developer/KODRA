import { ToolDefinition } from '../../providers/types';
import { IProcessManager, ProcessManager } from '../process';
import { ITool, ToolCapability, ToolParameterSchema, ToolResult } from '../types';

export class StopProcessTool implements ITool {
  readonly name = 'stop_process';
  readonly capability: ToolCapability = 'process_management';
  readonly description =
    'Stop a running KODRA-managed process. Attempts graceful termination first, ' +
    'escalating to forced termination if needed. Requires explicit user approval.';

  readonly requiresApproval = true;
  readonly isDestructive = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      processId: {
        type: 'string',
        description: 'Unique identifier of the process to stop.',
      },
      force: {
        type: 'boolean',
        description: 'Whether to force-kill the process immediately without waiting for graceful exit (default: false).',
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

    const force = Boolean(args.force);
    const result = await this.processManager.stopProcess(processId, { force });

    return {
      content: result.message,
      success: result.success,
      metadata: {
        processId,
        status: result.status,
        alreadyExited: result.alreadyExited,
        exitCode: result.exitCode,
        pid: result.pid,
      },
    };
  }
}
