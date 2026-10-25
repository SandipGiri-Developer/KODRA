import * as vscode from 'vscode';
import { ToolDefinition } from '../../providers/types';
import { IProcessManager, ProcessManager } from '../process';
import { CommandMatcher } from '../terminal/commandMatcher';
import { ITool, ToolCapability, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class StartProcessTool implements ITool {
  readonly name = 'start_process';
  readonly capability: ToolCapability = 'command_execution';
  readonly description =
    'Start a long-running background command in the workspace without waiting for it to finish. ' +
    'Immediately returns a unique processId, status, and initial output. Requires explicit user approval.';

  readonly requiresApproval = true;
  readonly isDestructive = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The long-running shell command to start in the background.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory relative to workspace root.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional maximum lifetime for the process in milliseconds.',
      },
    },
    required: ['command'],
  };

  constructor(
    private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
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

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const rawCommand = typeof args.command === 'string' ? args.command.trim() : '';
    if (!rawCommand) {
      return {
        content: 'Error: Missing required argument "command".',
        success: false,
      };
    }

    if (CommandMatcher.isCompoundCommand(rawCommand)) {
      return {
        content:
          'Error: Chained or compound commands (&&, ;, ||, |, newlines) are prohibited for safety. ' +
          'Please request only one discrete command at a time.',
        success: false,
      };
    }

    if (CommandMatcher.hasUnbalancedQuotes(rawCommand)) {
      return {
        content: 'Error: Command has unbalanced quotes or dangling escape characters.',
        success: false,
      };
    }

    const trustedCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined;
    const ws = this.workspaceService.getActiveWorkspaceFolder();
    const cwd = trustedCwd || (ws ? ws.fsPath : (vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()));

    const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : undefined;

    try {
      const record = await this.processManager.startProcess({
        command: rawCommand,
        cwd,
        timeoutMs,
        signal,
      });

      const isRunning = record.status === 'running';
      const success = isRunning || record.status === 'completed';

      let content = '';
      if (isRunning) {
        content = `Background process started successfully (processId: "${record.processId}", PID: ${record.pid ?? 'unknown'}).\n` +
          `Command: "${record.command}"\nStatus: running\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- INITIAL OUTPUT ---\n${record.output.trim()}\n`;
        }
        content += '\nThe process is continuing to run in the background.';
      } else if (record.status === 'completed') {
        content = `Process started and finished immediately (processId: "${record.processId}", exit code: ${record.exitCode ?? 0}).\n` +
          `Command: "${record.command}"\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- OUTPUT ---\n${record.output.trim()}`;
        }
      } else {
        content = `Process failed to start or exited immediately (processId: "${record.processId}", status: ${record.status}).\n` +
          `Command: "${record.command}"\n`;
        if (record.error) {
          content += `Error: ${record.error}\n`;
        }
        if (record.output.trim().length > 0) {
          content += `\nOutput:\n${record.output.trim()}`;
        }
      }

      return {
        content: content.trim(),
        success,
        metadata: {
          processId: record.processId,
          pid: record.pid,
          status: record.status,
          command: record.command,
          cwd: record.cwd,
          startTime: record.startTime,
          isTruncated: record.isTruncated,
          outputLength: record.output.length,
        },
      };
    } catch (err: any) {
      return {
        content: `Failed to start process: ${err.message}`,
        success: false,
      };
    }
  }
}
