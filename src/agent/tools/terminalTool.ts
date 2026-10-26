/**
 * Tool: terminal (run_command)
 * 
 * Safely executes a shell command within the workspace using the real VS Code
 * TerminalExecutionManager after explicit user approval.
 * Supports deterministic terminal reuse, background command monitoring, cancellation,
 * and lifecycle management.
 */

import * as vscode from 'vscode';
import { ToolDefinition } from '../../providers/types';
import { CommandMatcher } from '../terminal/commandMatcher';
import { TerminalExecutionManager } from '../terminal/terminalExecutionManager';
import { ITerminalExecutionManager, TerminalAction } from '../terminal/types';
import { ITool, ToolCapability, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class TerminalTool implements ITool {
  readonly name: string;
  readonly capability: ToolCapability = 'command_execution';
  readonly description =
    'Execute shell commands in the workspace using a real VS Code integrated terminal with terminal reuse, ' +
    'or manage running tasks (status, wait, cancel, close, list_sessions). ' +
    'Executing new commands requires explicit user approval. Chained commands are prohibited.';

  readonly requiresApproval = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (required when action is "execute").',
      },
      action: {
        type: 'string',
        enum: ['execute', 'status', 'wait', 'cancel', 'close', 'list_sessions'],
        description:
          'Lifecycle action to perform: "execute" (default, runs command), "status" (check running command), ' +
          '"wait" (wait for active command to finish), "cancel" (stop running command), "close" (close terminal session), ' +
          'or "list_sessions" (list active KODRA terminals).',
      },
      executionId: {
        type: 'string',
        description: 'Command execution ID (used for status, wait, or cancel actions).',
      },
      terminalSessionId: {
        type: 'string',
        description: 'Specific terminal session ID to target or close.',
      },
      waitMs: {
        type: 'number',
        description: 'Milliseconds to wait synchronously before returning (default 3000ms). Use 0 for immediate background launch.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum command execution timeout in milliseconds (default 120000ms).',
      },
      reuseTerminal: {
        type: 'boolean',
        description: 'Whether to reuse an existing compatible idle KODRA terminal (defaults to true).',
      },
      preserveTerminal: {
        type: 'boolean',
        description: 'Whether to keep the terminal open after execution completes (defaults to true).',
      },
    },
    required: [],
  };

  constructor(
    toolName: string = 'terminal',
    private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
    private readonly executionManager: ITerminalExecutionManager = TerminalExecutionManager.getInstance(),
  ) {
    this.name = toolName;
  }

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
    const action = (typeof args.action === 'string' ? args.action.trim() : 'execute') as TerminalAction;
    const command = typeof args.command === 'string' ? args.command.trim() : '';

    if (action === 'execute') {
      if (!command) {
        return {
          content: 'Error: Missing required argument "command" for action "execute".',
          success: false,
        };
      }

      // Single-command validation: Reject chained or piped commands
      if (CommandMatcher.isCompoundCommand(command)) {
        return {
          content:
            'Error: Chained or compound commands (&&, ;, ||, |, newlines) are prohibited for safety. ' +
            'Please request only one discrete command at a time.',
          success: false,
        };
      }
    }

    // Resolve working directory from trusted args or workspace service
    const trustedCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined;
    const ws = this.workspaceService.getActiveWorkspaceFolder();
    const cwd = trustedCwd || (ws ? ws.fsPath : (vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()));

    const executionId = (args.executionId as string) || (args._executionId as string);
    const terminalSessionId = args.terminalSessionId as string | undefined;
    const waitMs = typeof args.waitMs === 'number' ? args.waitMs : undefined;
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;
    const reuseTerminal = typeof args.reuseTerminal === 'boolean' ? args.reuseTerminal : true;
    const preserveTerminal = typeof args.preserveTerminal === 'boolean' ? args.preserveTerminal : true;

    try {
      const record = await this.executionManager.executeCommand({
        command,
        action,
        cwd,
        executionId,
        terminalSessionId,
        waitMs,
        timeoutMs,
        reuseTerminal,
        preserveTerminal,
        signal,
      });

      const exitCode = record.exitCode;
      const isRunning = record.status === 'running';
      const success = record.status === 'completed' || isRunning;

      let content = '';
      if (action === 'list_sessions') {
        content = `Active KODRA Terminal Sessions:\n${record.output}`;
      } else if (action === 'close') {
        content = record.output || `Terminal session closed successfully.`;
      } else if (isRunning) {
        content = `Command "${record.command}" is running in terminal "${record.terminalName}" (executionId: ${record.executionId}).\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- CURRENT OUTPUT ---\n${record.output.trim()}\n`;
        }
        content += '\nThe process is continuing in the background. Use action "status" or "wait" to check progress.';
      } else if (record.status === 'completed') {
        content = `Command executed successfully: "${record.command}" (exit code: ${exitCode ?? 0})\n`;
        if (record.output.trim().length > 0) {
          content += `\n--- OUTPUT ---\n${record.output.trim()}`;
        } else {
          content += '\n(No output produced)';
        }
      } else if (record.status === 'cancelled') {
        content = `Command cancelled: "${record.command}".\n`;
        if (record.output.trim().length > 0) {
          content += `Partial output:\n${record.output.trim()}`;
        }
      } else if (record.status === 'timed_out') {
        content = `Command timed out: "${record.command}".\n${record.output.trim()}`;
      } else {
        content = `Command failed: "${record.command}" (exit code: ${exitCode ?? 1})\n${record.output.trim()}`;
        if (record.error) {
          content += `\nError: ${record.error}`;
        }
      }

      return {
        content: content.trim(),
        success,
        metadata: {
          executionId: record.executionId,
          terminalSessionId: record.terminalSessionId,
          terminalId: record.terminalId,
          terminalName: record.terminalName,
          status: record.status,
          exitCode: record.exitCode,
          isTruncated: record.isTruncated,
          outputLength: record.output.length,
        },
      };
    } catch (err: any) {
      return {
        content: `Terminal tool operation failed: ${err.message}`,
        success: false,
      };
    }
  }
}
