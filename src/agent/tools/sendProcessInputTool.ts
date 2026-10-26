import { ToolDefinition } from '../../providers/types';
import { IProcessManager, ProcessManager } from '../process';
import { ITool, ToolCapability, ToolParameterSchema, ToolResult } from '../types';

export class SendProcessInputTool implements ITool {
  readonly name = 'send_process_input';
  readonly capability: ToolCapability = 'process_input';
  readonly description =
    'Send text or commands to the standard input (stdin) of a running KODRA-managed process. ' +
    'Requires explicit user approval.';

  readonly requiresApproval = true;
  readonly isDestructive = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      processId: {
        type: 'string',
        description: 'Unique identifier of the running process.',
      },
      input: {
        type: 'string',
        description: 'The text to write to stdin.',
      },
      addNewline: {
        type: 'boolean',
        description: 'Whether to append a newline (\\n) to the input if not already present (default: true).',
      },
    },
    required: ['processId', 'input'],
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

    if (typeof args.input !== 'string') {
      return {
        content: 'Error: Missing required argument "input" (must be a string).',
        success: false,
      };
    }

    const addNewline = args.addNewline !== false;
    let inputData = args.input;
    if (addNewline && !inputData.endsWith('\n') && !inputData.endsWith('\r\n')) {
      inputData += '\n';
    }

    const res = await this.processManager.sendInput(processId, inputData);

    return {
      content: res.message,
      success: res.success,
      metadata: {
        processId,
        bytesWritten: res.bytesWritten,
      },
    };
  }
}
