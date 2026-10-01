/**
 * Tool: terminal (run_command)
 * 
 * Safely executes a single terminal command within the workspace after explicit user approval.
 * Enforces single-command execution by rejecting command chaining (&&, ;, ||, |, newlines).
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class TerminalTool implements ITool {
  readonly name: string;
  readonly description =
    'Execute a single shell command within the current workspace directory. ' +
    'Requires explicit user approval before execution. Command chaining is prohibited.';

  readonly requiresApproval = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The single shell command to execute (e.g., "npm test", "git status").',
      },
    },
    required: ['command'],
  };

  constructor(
    toolName: string = 'terminal',
    private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
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
    const command = typeof args.command === 'string' ? args.command.trim() : '';

    if (!command) {
      return {
        content: 'Error: Missing required argument "command".',
        success: false,
      };
    }

    // Single-command validation: Reject chained or piped commands
    if (this.isChainedCommand(command)) {
      return {
        content:
          'Error: Chained or compound commands (&&, ;, ||, |, newlines) are prohibited for safety. ' +
          'Please request only one discrete command at a time.',
        success: false,
      };
    }

    const ws = this.workspaceService.getActiveWorkspaceFolder();
    const cwd = ws ? ws.fsPath : (vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());

    return this.runProcess(command, cwd, signal);
  }

  /**
   * Detect command chaining operators.
   */
  private isChainedCommand(command: string): boolean {
    // Check for newlines
    if (/[\r\n]/.test(command)) {
      return true;
    }
    // Check for logical AND (&&) or pipe (||, |) or semicolon (;)
    // (Ensure we don't trigger on simple flags like --test or grep patterns inside quotes unless unquoted)
    const unquoted = command.replace(/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, '');
    return /(&&|\|\||[;&|])/.test(unquoted);
  }

  /**
   * Execute child process with timeout, cancellation, and stdout/stderr capture.
   */
  private runProcess(
    command: string,
    cwd: string,
    signal?: AbortSignal,
    timeoutMs: number = 30_000,
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      if (signal?.aborted) {
        resolve({
          content: 'Command execution cancelled before start.',
          success: false,
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Determine shell based on platform
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
      const shellFlag = isWindows ? '/d /s /c' : '-c';

      const child = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill();
        resolve({
          content: `Error: Command timed out after ${timeoutMs / 1000}s.\nPartial stdout:\n${stdout}\nPartial stderr:\n${stderr}`,
          success: false,
          metadata: { timedOut: true },
        });
      }, timeoutMs);

      const abortHandler = () => {
        killed = true;
        child.kill();
        clearTimeout(timer);
        resolve({
          content: `Command cancelled by user.\nPartial output:\n${stdout}`,
          success: false,
          metadata: { cancelled: true },
        });
      };

      signal?.addEventListener('abort', abortHandler, { once: true });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Prevent buffer explosion
        if (stdout.length > 50_000) {
          stdout = stdout.slice(-50_000);
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 20_000) {
          stderr = stderr.slice(-20_000);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        if (killed) { return; }
        resolve({
          content: `Failed to start process: ${err.message}`,
          success: false,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        if (killed) { return; }

        const exitCode = code ?? 0;
        const success = exitCode === 0;

        let content = `Command executed: "${command}" (exit code: ${exitCode})\n`;
        if (stdout.trim().length > 0) {
          content += `\n--- STDOUT ---\n${stdout.trim()}`;
        }
        if (stderr.trim().length > 0) {
          content += `\n--- STDERR ---\n${stderr.trim()}`;
        }
        if (stdout.trim().length === 0 && stderr.trim().length === 0) {
          content += '\n(No output produced)';
        }

        resolve({
          content: content.trim(),
          success,
          metadata: {
            exitCode,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          },
        });
      });
    });
  }
}
