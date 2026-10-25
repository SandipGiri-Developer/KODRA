import * as vscode from 'vscode';
import { ToolDefinition } from '../../providers/types';
import { IProcessManager, ProcessManager } from '../process';
import { CommandMatcher } from '../terminal/commandMatcher';
import { ITool, ToolCapability, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class RunCommandTool implements ITool {
  readonly name = 'run_command';
  readonly capability: ToolCapability = 'command_execution';
  readonly description =
    'Execute a finite shell command in the workspace, wait for completion, and return its exit code, ' +
    'captured stdout/stderr output, and duration. Requires explicit user approval.';

  readonly requiresApproval = true;
  readonly isDestructive = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory relative to workspace root.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum command execution timeout in milliseconds (default 60000ms).',
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
      const record = await this.processManager.runCommand({
        command: rawCommand,
        cwd,
        timeoutMs,
        signal,
      });

      const exitCode = record.exitCode;
      const success = record.status === 'completed';
      const durationMs = record.durationMs ?? 0;

      let content = '';
      if (record.status === 'completed') {
        content = `Command executed successfully: "${record.command}" (exit code: 0, duration: ${durationMs}ms)\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- OUTPUT ---\n${record.output.trim()}`;
        } else {
          content += '\n(No output produced)';
        }
      } else if (record.status === 'running' && record.terminationRequested) {
        const requestedOutcome =
          record.terminationRequested === 'timed_out' ? 'timed out' : 'was cancelled';
        content = `Command ${requestedOutcome}, but process termination is not confirmed (processId: "${record.processId}"). The process remains tracked as running.\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- PARTIAL OUTPUT ---\n${record.output.trim()}`;
        }
        if (record.error) content += `\nError: ${record.error}`;
      } else if (record.status === 'cancelled') {
        content = `Command cancelled: "${record.command}" (duration: ${durationMs}ms)\n`;
        if (record.output.trim().length > 0) {
          content += `\nPartial output:\n${record.output.trim()}`;
        }
      } else if (record.status === 'timed_out') {
        content = `Command timed out: "${record.command}"\n${record.output.trim()}`;
      } else {
        content = `Command failed: "${record.command}" (exit code: ${exitCode ?? 1}, duration: ${durationMs}ms)\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- OUTPUT ---\n${record.output.trim()}`;
        }
        if (record.error) {
          content += `\nError: ${record.error}`;
        }
      }

      return {
        content: content.trim(),
        success,
        metadata: {
          processId: record.processId,
          pid: record.pid,
          status: record.status,
          exitCode: record.exitCode,
          durationMs,
          isTruncated: record.isTruncated,
          outputLength: record.output.length,
        },
      };
    } catch (err: any) {
      return {
        content: `Command execution failed: ${err.message}`,
        success: false,
      };
    }
  }
}