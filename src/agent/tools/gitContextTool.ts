/**
 * Tool: git_context
 *
 * Provides targeted Git information about a specific file or the workspace:
 *   - "log"    — recent commit history for a file or the entire repo
 *   - "blame"  — line-by-line commit attribution for a file
 *   - "diff"   — unstaged/staged changes, or diff against a specific commit
 *   - "status" — working-tree status (modified, untracked, staged files)
 *
 * Uses child_process.execFile to invoke the native git binary, which is the
 * safest approach in a VS Code extension context. All commands are strictly
 * read-only and cannot mutate the repository.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

const execFileAsync = promisify(execFile);

/** Maximum output characters returned to the model. */
const MAX_OUTPUT_CHARS = 8000;

type GitOperation = 'log' | 'blame' | 'diff' | 'status';

export class GitContextTool implements ITool {
  readonly name = 'git_context';
  readonly description =
    'Get targeted Git history, blame, diff, or status information for a file or the workspace. ' +
    'Use "log" to see recent commits, "blame" to identify who last changed each line, ' +
    '"diff" to see current uncommitted changes, and "status" to see all modified files. ' +
    'All operations are read-only — this tool never modifies the repository.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description:
          'The Git operation to perform: ' +
          '"log" (recent commits for a file or whole repo), ' +
          '"blame" (line-by-line author attribution for a file), ' +
          '"diff" (uncommitted changes, optionally for a specific file), ' +
          '"status" (all modified/untracked/staged files in the workspace).',
        enum: ['log', 'blame', 'diff', 'status'],
      },
      file: {
        type: 'string',
        description:
          'Workspace-relative path to the file. ' +
          'Required for "blame". Optional for "log" and "diff" (omit to get repo-wide results).',
      },
      maxLines: {
        type: 'number',
        description:
          'For "log": maximum number of commits to show. Defaults to 10. ' +
          'For "blame": maximum number of lines to return. Defaults to 60.',
      },
      commit: {
        type: 'string',
        description:
          'For "diff": compare the working tree against this commit or ref (e.g., "HEAD", "main", "abc1234"). ' +
          'Defaults to unstaged changes (no ref).',
      },
      staged: {
        type: 'boolean',
        description:
          'For "diff": show staged changes (git diff --cached) instead of unstaged changes. Defaults to false.',
      },
    },
    required: ['operation'],
  };

  constructor(private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService()) {}

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
    const operation = (typeof args.operation === 'string' ? args.operation.toLowerCase() : '') as GitOperation;
    const validOps: GitOperation[] = ['log', 'blame', 'diff', 'status'];
    if (!validOps.includes(operation)) {
      return {
        content: `Error: Invalid operation "${operation}". Use one of: ${validOps.join(', ')}.`,
        success: false,
      };
    }

    const ws = this.workspaceService.getActiveWorkspaceFolder();
    if (!ws) {
      return {
        content: 'Error: No workspace folder is currently open.',
        success: false,
      };
    }

    if (operation === 'blame' && (!args.file || typeof args.file !== 'string' || !args.file.trim())) {
      return {
        content: 'Error: "blame" operation requires a "file" argument.',
        success: false,
      };
    }

    const commitRef = typeof args.commit === 'string' ? args.commit.trim() : undefined;
    if (commitRef !== undefined) {
      if (!commitRef || !/^[a-zA-Z0-9_.^~\-/]+$/.test(commitRef)) {
        return {
          content: `Error: Invalid commit or ref "${commitRef}". Commit refs must only contain alphanumeric characters and . _ ^ ~ - /`,
          success: false,
        };
      }
    }

    // Resolve optional file argument
    let relFilePath: string | undefined;
    if (typeof args.file === 'string' && args.file.trim()) {
      const { relativePath, inWorkspace } = this.workspaceService.resolvePath(args.file);
      if (!inWorkspace) {
        return {
          content: `Error: Access denied. "${args.file}" is outside the workspace boundary.`,
          success: false,
        };
      }
      relFilePath = relativePath;
    }

    const cwd = ws.fsPath;

    // Verify git is available
    const gitAvailable = await this.isGitAvailable(cwd);
    if (!gitAvailable) {
      return {
        content: 'Error: Git is not available or this workspace is not a Git repository.',
        success: false,
      };
    }

    const maxLines =
      typeof args.maxLines === 'number' ? Math.min(Math.max(Math.floor(args.maxLines), 1), 500) : undefined;
    const staged = Boolean(args.staged || args.cached);

    try {
      switch (operation) {
        case 'log':
          return await this.runLog(cwd, relFilePath, maxLines ?? 10);
        case 'blame':
          return await this.runBlame(cwd, relFilePath, maxLines ?? 60);
        case 'diff':
          return await this.runDiff(cwd, relFilePath, commitRef, staged);
        case 'status':
          return await this.runStatus(cwd);
      }
    } catch (err: any) {
      const msg = err.stderr || err.message || String(err);
      return {
        content: `Git error during "${operation}": ${msg}`,
        success: false,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async isGitAvailable(cwd: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private async runLog(cwd: string, file: string | undefined, maxCommits: number): Promise<ToolResult> {
    const format =
      '--format=commit %H%nauthor %an <%ae>%ndate   %ad%nsubject %s%n';
    const gitArgs = ['log', `--max-count=${maxCommits}`, '--date=short', format];
    if (file) {
      gitArgs.push('--', file);
    }

    const { stdout } = await execFileAsync('git', gitArgs, { cwd, timeout: 10000 });
    const output = stdout.trim();

    if (!output) {
      return {
        content: file
          ? `No commit history found for "${file}".`
          : 'No commit history found in this repository.',
        success: true,
        metadata: { operation: 'log', file, commitCount: 0 },
      };
    }

    const truncated = output.length > MAX_OUTPUT_CHARS ? output.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated)' : output;

    const header = file
      ? `Git log for "${file}" (last ${maxCommits} commits):`
      : `Git log for workspace (last ${maxCommits} commits):`;

    return {
      content: `${header}\n\n${truncated}`,
      success: true,
      metadata: { operation: 'log', file },
    };
  }

  private async runBlame(cwd: string, file: string | undefined, maxLines: number): Promise<ToolResult> {
    if (!file) {
      return {
        content: 'Error: "blame" operation requires a "file" argument.',
        success: false,
      };
    }

    const gitArgs = ['blame', '--date=short', '-p', '--', file];
    let { stdout } = await execFileAsync('git', gitArgs, { cwd, timeout: 15000 });

    if (!stdout.trim()) {
      return {
        content: `No blame information available for "${file}".`,
        success: true,
        metadata: { operation: 'blame', file },
      };
    }

    // Parse porcelain blame output into a human-readable table
    const lines = stdout.split('\n');
    const result: string[] = [`Git blame for "${file}" (first ${maxLines} lines):\n`];
    const commitInfo: Map<string, { author: string; date: string; summary: string }> = new Map();

    let currentHash = '';
    let lineNumber = 0;

    for (let i = 0; i < lines.length && lineNumber < maxLines; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^([0-9a-f]{40})\s/);
      if (headerMatch) {
        currentHash = headerMatch[1].slice(0, 8);
        if (!commitInfo.has(currentHash)) {
          commitInfo.set(currentHash, { author: '', date: '', summary: '' });
        }
        continue;
      }
      if (line.startsWith('author ')) {
        commitInfo.get(currentHash)!.author = line.slice(7);
        continue;
      }
      if (line.startsWith('author-time ')) {
        const ts = parseInt(line.slice(12), 10);
        if (!isNaN(ts)) {
          commitInfo.get(currentHash)!.date = new Date(ts * 1000).toISOString().slice(0, 10);
        }
        continue;
      }
      if (line.startsWith('summary ')) {
        commitInfo.get(currentHash)!.summary = line.slice(8);
        continue;
      }
      if (line.startsWith('\t')) {
        lineNumber++;
        const info = commitInfo.get(currentHash) ?? { author: '?', date: '?', summary: '' };
        const content = line.slice(1);
        result.push(
          `${String(lineNumber).padStart(4)} | ${currentHash} ${info.date} ${info.author.padEnd(20).slice(0, 20)} | ${content}`,
        );
      }
    }

    const output = result.join('\n');
    const truncated = output.length > MAX_OUTPUT_CHARS ? output.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated)' : output;

    return {
      content: truncated,
      success: true,
      metadata: { operation: 'blame', file, linesShown: lineNumber },
    };
  }

  private async runDiff(
    cwd: string,
    file: string | undefined,
    commitRef: string | undefined,
    staged: boolean = false,
  ): Promise<ToolResult> {
    // Validate commitRef if provided: reject invalid or unsafe characters
    let safeRef: string | undefined;
    if (commitRef !== undefined) {
      if (!commitRef || !/^[a-zA-Z0-9_.^~\-/]+$/.test(commitRef)) {
        return {
          content: `Error: Invalid commit or ref "${commitRef}". Commit refs must only contain alphanumeric characters and . _ ^ ~ - /`,
          success: false,
        };
      }
      safeRef = commitRef;
    }

    const gitArgs = ['diff', '--stat', '--patch'];
    if (staged) {
      gitArgs.push('--cached');
    }
    if (safeRef) {
      gitArgs.push(safeRef);
    }
    if (file) {
      gitArgs.push('--', file);
    }

    const { stdout } = await execFileAsync('git', gitArgs, { cwd, timeout: 10000 });
    const output = stdout.trim();

    const diffMode = staged ? 'staged' : (safeRef ? `vs "${safeRef}"` : 'unstaged');

    if (!output) {
      const ctx = file ? `for "${file}"` : 'in workspace';
      return {
        content: `No ${staged ? 'staged' : 'uncommitted'} changes (${diffMode}) found ${ctx}.`,
        success: true,
        metadata: { operation: 'diff', file, commit: safeRef, staged },
      };
    }

    const truncated = output.length > MAX_OUTPUT_CHARS ? output.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated)' : output;
    const header = file
      ? `Git diff for "${file}" (${diffMode}):`
      : `Git diff for workspace (${diffMode}):`;

    return {
      content: `${header}\n\n${truncated}`,
      success: true,
      metadata: { operation: 'diff', file, commit: safeRef, staged },
    };
  }

  private async runStatus(cwd: string): Promise<ToolResult> {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-u'], {
      cwd,
      timeout: 5000,
    });

    if (!stdout.trim()) {
      return {
        content: 'Git status: working tree is clean (no uncommitted changes).',
        success: true,
        metadata: { operation: 'status', fileCount: 0 },
      };
    }

    const statusLines = stdout.trim().split('\n');
    const grouped: Record<string, string[]> = {
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    };

    for (const line of statusLines) {
      if (line.length < 3) {
        continue;
      }
      const xy = line.slice(0, 2);
      const filePart = line.slice(3);

      if (xy === '??') {
        grouped.untracked.push(filePart);
      } else if (xy.includes('U') || xy === 'AA' || xy === 'DD') {
        grouped.conflicted.push(`${xy} ${filePart}`);
      } else {
        if (xy[0] !== ' ' && xy[0] !== '?') {
          grouped.staged.push(`${xy[0]} ${filePart}`);
        }
        if (xy[1] !== ' ' && xy[1] !== '?') {
          grouped.unstaged.push(`${xy[1]} ${filePart}`);
        }
      }
    }

    const lines: string[] = ['Git status:'];
    if (grouped.staged.length) {
      lines.push(`\nStaged (${grouped.staged.length}):`);
      grouped.staged.forEach((f) => lines.push(`  ${f}`));
    }
    if (grouped.unstaged.length) {
      lines.push(`\nUnstaged (${grouped.unstaged.length}):`);
      grouped.unstaged.forEach((f) => lines.push(`  ${f}`));
    }
    if (grouped.untracked.length) {
      lines.push(`\nUntracked (${grouped.untracked.length}):`);
      grouped.untracked.forEach((f) => lines.push(`  ${f}`));
    }
    if (grouped.conflicted.length) {
      lines.push(`\nConflicted (${grouped.conflicted.length}):`);
      grouped.conflicted.forEach((f) => lines.push(`  ${f}`));
    }

    const rawOutput = lines.join('\n');
    const truncatedOutput =
      rawOutput.length > MAX_OUTPUT_CHARS
        ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
        : rawOutput;

    return {
      content: truncatedOutput,
      success: true,
      metadata: {
        operation: 'status',
        fileCount: statusLines.length,
        staged: grouped.staged.length,
        unstaged: grouped.unstaged.length,
        untracked: grouped.untracked.length,
        truncated: rawOutput.length > MAX_OUTPUT_CHARS,
      },
    };
  }
}
