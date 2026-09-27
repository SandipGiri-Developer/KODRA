/**
 * Agent tool implementations for KODRA.
 * 
 * Each tool implements the ITool interface and is registered with the agent loop.
 * Tools enforce workspace boundaries and validate arguments.
 * 
 * Destructive tools (createFile, editFile) produce diffs for user approval
 * rather than applying changes directly.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isSecurityConcern } from '../indexing/ignore';
import { isWithinWorkspace } from '../indexing/walkDir';
import { KodraError, ErrorReason } from '../utils/errors';
import { ToolDefinition } from '../providers/types';
import { ITool, ToolResult } from './types';

// ─── Read File Tool ────────────────────────────────────────────────────────

export class ReadFileTool implements ITool {
  readonly name = 'read_file';
  readonly description = 'Read the contents of a file in the workspace';
  readonly isDestructive = false;

  getDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: 'Read the contents of a file. Optionally specify a line range. The file must be within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            filepath: {
              type: 'string',
              description: 'Absolute or workspace-relative file path',
            },
            startLine: {
              type: 'number',
              description: 'Start line number (1-based, inclusive). Optional.',
            },
            endLine: {
              type: 'number',
              description: 'End line number (1-based, inclusive). Optional.',
            },
          },
          required: ['filepath'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filepath = this.resolveFilepath(String(args.filepath || ''));
    const startLine = typeof args.startLine === 'number' ? args.startLine : undefined;
    const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;

    this.validatePath(filepath);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      let result = content;

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split('\n');
        const start = Math.max(1, startLine ?? 1) - 1;
        const end = Math.min(lines.length, endLine ?? lines.length);
        result = lines.slice(start, end).join('\n');
        return {
          content: `File: ${filepath} (lines ${start + 1}-${end})\n\n${result}`,
          success: true,
          filepath,
        };
      }

      return {
        content: `File: ${filepath}\n\n${result}`,
        success: true,
        filepath,
      };
    } catch (error) {
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        filepath,
      };
    }
  }

  private resolveFilepath(filepath: string): string {
    if (path.isAbsolute(filepath)) {
      return filepath;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return path.join(folders[0].uri.fsPath, filepath);
    }
    return filepath;
  }

  private validatePath(filepath: string): void {
    if (!isWithinWorkspace(filepath)) {
      throw new KodraError(ErrorReason.OutsideWorkspace, `Path is outside workspace: ${filepath}`);
    }
    if (isSecurityConcern(filepath)) {
      throw new KodraError(ErrorReason.FileSecurityConcern, `File is a security concern: ${path.basename(filepath)}`);
    }
  }
}

// ─── Search Files Tool ─────────────────────────────────────────────────────

export class SearchFilesTool implements ITool {
  readonly name = 'search_files';
  readonly description = 'Search for text patterns in workspace files';
  readonly isDestructive = false;

  getDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: 'Search for a text pattern across workspace files. Returns matching file paths and line content.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The text pattern to search for',
            },
            includePattern: {
              type: 'string',
              description: 'Glob pattern to include (e.g., "**/*.ts"). Optional.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results (default: 20)',
            },
          },
          required: ['query'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query || '');
    const includePattern = args.includePattern ? String(args.includePattern) : '**/*';
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 20;

    if (!query) {
      return { content: 'Error: query is required', success: false };
    }

    try {
      const files = await vscode.workspace.findFiles(includePattern, '**/node_modules/**');
      let output = '';
      let matchCount = 0;

      for (const file of files) {
        if (matchCount >= maxResults) {
          break;
        }
        if (isSecurityConcern(file.fsPath)) {
          continue;
        }

        try {
          const content = await fs.readFile(file.fsPath, 'utf-8');
          const lines = content.split('\n');
          const fileMatches = [];

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(query)) {
              fileMatches.push(`  Line ${i + 1}: ${lines[i].trim()}`);
            }
          }

          if (fileMatches.length > 0) {
            output += `${file.fsPath}:\n${fileMatches.join('\n')}\n\n`;
            matchCount++;
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (matchCount === 0) {
        return { content: `No results found for "${query}"`, success: true };
      }

      return { content: `Found results in ${matchCount} file(s) for "${query}":\n\n${output.trimEnd()}`, success: true };
    } catch (error) {
      return {
        content: `Search error: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  }
}

// ─── List Files Tool ───────────────────────────────────────────────────────

export class ListFilesTool implements ITool {
  readonly name = 'list_files';
  readonly description = 'List files and directories in a workspace path';
  readonly isDestructive = false;

  getDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: 'List files and directories at a given path within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            dirPath: {
              type: 'string',
              description: 'Directory path (absolute or relative to workspace root). Leave empty for workspace root.',
            },
            recursive: {
              type: 'boolean',
              description: 'If true, list files recursively (default: false)',
            },
          },
          required: [],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return { content: 'No workspace folder open', success: false };
    }

    let dirPath = String(args.dirPath || '');
    if (!path.isAbsolute(dirPath)) {
      dirPath = path.join(folders[0].uri.fsPath, dirPath);
    }

    if (!isWithinWorkspace(dirPath)) {
      return { content: 'Error: path is outside workspace', success: false };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const lines: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') {
          continue; // Skip hidden files in listing
        }
        const type = entry.isDirectory() ? '📁' : '📄';
        lines.push(`${type} ${entry.name}`);
      }

      lines.sort();

      return {
        content: `Contents of ${dirPath}:\n\n${lines.join('\n')}`,
        success: true,
        filepath: dirPath,
      };
    } catch (error) {
      return {
        content: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  }
}

// ─── Create File Tool ──────────────────────────────────────────────────────

export class CreateFileTool implements ITool {
  readonly name = 'create_file';
  readonly description = 'Create a new file in the workspace';
  readonly isDestructive = true;

  getDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: 'Create a new file with the specified content. Will NOT overwrite existing files.',
        parameters: {
          type: 'object',
          properties: {
            filepath: {
              type: 'string',
              description: 'Path for the new file (absolute or relative to workspace)',
            },
            content: {
              type: 'string',
              description: 'Content to write to the file',
            },
          },
          required: ['filepath', 'content'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    let filepath = String(args.filepath || '');
    const content = String(args.content || '');

    const folders = vscode.workspace.workspaceFolders;
    if (!path.isAbsolute(filepath) && folders && folders.length > 0) {
      filepath = path.join(folders[0].uri.fsPath, filepath);
    }

    if (!isWithinWorkspace(filepath)) {
      return { content: 'Error: path is outside workspace', success: false };
    }

    // Check if file already exists
    try {
      await fs.access(filepath);
      return {
        content: `Error: file already exists: ${filepath}. Use edit_file to modify existing files.`,
        success: false,
        filepath,
      };
    } catch {
      // File doesn't exist — good
    }

    // Create parent directories
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });

    // Show diff for approval
    const diff = `+++ ${filepath} (new file)\n${content.split('\n').map(l => `+ ${l}`).join('\n')}`;

    return {
      content: `Create new file: ${filepath}\n\n${diff}`,
      success: true,
      filepath,
      diff,
      requiresApproval: true,
    };
  }

  /**
   * Apply the file creation after approval.
   */
  static async apply(filepath: string, content: string): Promise<void> {
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filepath, content, 'utf-8');
  }
}

// ─── Edit File Tool ────────────────────────────────────────────────────────

export class EditFileTool implements ITool {
  readonly name = 'edit_file';
  readonly description = 'Edit an existing file by replacing specific content';
  readonly isDestructive = true;

  getDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: 'Edit a file by finding and replacing content. The search text must exactly match existing content.',
        parameters: {
          type: 'object',
          properties: {
            filepath: {
              type: 'string',
              description: 'Path to the file to edit',
            },
            search: {
              type: 'string',
              description: 'The exact text to find in the file',
            },
            replace: {
              type: 'string',
              description: 'The text to replace it with',
            },
          },
          required: ['filepath', 'search', 'replace'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    let filepath = String(args.filepath || '');
    const search = String(args.search || '');
    const replace = String(args.replace || '');

    const folders = vscode.workspace.workspaceFolders;
    if (!path.isAbsolute(filepath) && folders && folders.length > 0) {
      filepath = path.join(folders[0].uri.fsPath, filepath);
    }

    if (!isWithinWorkspace(filepath)) {
      return { content: 'Error: path is outside workspace', success: false };
    }

    if (isSecurityConcern(filepath)) {
      return { content: 'Error: cannot edit security-sensitive files', success: false };
    }

    try {
      const content = await fs.readFile(filepath, 'utf-8');

      if (!content.includes(search)) {
        return {
          content: `Error: search text not found in ${filepath}. The search text must exactly match existing content.`,
          success: false,
          filepath,
        };
      }

      // Count occurrences
      const occurrences = content.split(search).length - 1;
      if (occurrences > 1) {
        return {
          content: `Warning: search text found ${occurrences} times in ${filepath}. Please provide more specific search text to avoid ambiguity.`,
          success: false,
          filepath,
        };
      }

      // Generate diff for approval
      const newContent = content.replace(search, replace);
      const diff = generateSimpleDiff(filepath, content, newContent);

      return {
        content: `Edit ${filepath}:\n\n${diff}`,
        success: true,
        filepath,
        diff,
        requiresApproval: true,
      };
    } catch (error) {
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        filepath,
      };
    }
  }

  /**
   * Apply the edit after approval.
   */
  static async apply(filepath: string, search: string, replace: string): Promise<void> {
    const content = await fs.readFile(filepath, 'utf-8');
    const newContent = content.replace(search, replace);
    await fs.writeFile(filepath, newContent, 'utf-8');
  }
}

// ─── Tool Registry ─────────────────────────────────────────────────────────

/**
 * Get all available tools.
 */
export function getAllTools(): ITool[] {
  return [
    new ReadFileTool(),
    new SearchFilesTool(),
    new ListFilesTool(),
    new CreateFileTool(),
    new EditFileTool(),
  ];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function generateSimpleDiff(filepath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff: string[] = [`--- ${filepath}`, `+++ ${filepath}`];

  // Simple line-by-line diff (not Myers, but adequate for single replacements)
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push(`  ${oldLines[i]}`);
      i++;
      j++;
    } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      diff.push(`- ${oldLines[i]}`);
      i++;
    } else {
      diff.push(`+ ${newLines[j]}`);
      j++;
    }
  }

  return diff.join('\n');
}
