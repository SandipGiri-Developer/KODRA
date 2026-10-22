/**
 * Tool: find_references
 *
 * Finds all references (usages) of a symbol at a specific file position using
 * VS Code's language provider APIs (executeReferenceProvider).
 * Falls back to a regex text search when the language server is unavailable.
 *
 * Enables the agent to understand where a function, class, or variable is used
 * throughout the codebase without manually scanning every file.
 */

import * as vscode from 'vscode';
import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService, isUriInWorkspace } from '../workspaceService';

const MAX_OUTPUT_CHARS = 8000;

export class FindReferencesTool implements ITool {
  readonly name = 'find_references';
  readonly description =
    'Find all usages and references of a symbol across the workspace, given its file position. ' +
    'Positions are 1-based at the tool boundary (line 1 is the first line, column 1 is the first column). ' +
    'Returns a list of files, lines, and code snippets where the symbol is referenced. ' +
    'Use this to understand the impact radius of a change or to trace how a function/class is used. ' +
    'Requires an active language server for full accuracy; falls back to text search otherwise.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Workspace-relative (or absolute) path to the file containing the symbol.',
      },
      line: {
        type: 'number',
        description: '1-based line number of the symbol (1 is the first line).',
      },
      column: {
        type: 'number',
        description: '1-based column number of the symbol. Defaults to 1.',
      },
      symbolName: {
        type: 'string',
        description:
          'Optional: the symbol name at this position. Enables text-search fallback when language server is unavailable.',
      },
      includeDeclaration: {
        type: 'boolean',
        description:
          'Whether to include the declaration itself in the results. Defaults to false.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of references to return. Defaults to 50.',
      },
    },
    required: ['file', 'line'],
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
    const rawFile =
      typeof args.file === 'string'
        ? args.file
        : typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.path === 'string'
        ? args.path
        : '';

    if (!rawFile.trim()) {
      return {
        content: 'Error: Missing required argument "file". Provide a workspace-relative file path.',
        success: false,
      };
    }

    // Positions are 1-based at the tool boundary. Reject zero, negative, non-numeric, or non-finite values.
    let lineArg = 1;
    if (args.line !== undefined) {
      const parsed = typeof args.line === 'number' ? args.line : Number(args.line);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        return {
          content: `Error: "line" must be a positive integer (1-based). Received: ${args.line}.`,
          success: false,
        };
      }
      lineArg = parsed;
    }

    let colArg = 1;
    if (args.column !== undefined) {
      const parsed = typeof args.column === 'number' ? args.column : Number(args.column);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        return {
          content: `Error: "column" must be a positive integer (1-based). Received: ${args.column}.`,
          success: false,
        };
      }
      colArg = parsed;
    }

    const symbolName = typeof args.symbolName === 'string' ? args.symbolName.trim() : undefined;
    const includeDeclaration = Boolean(args.includeDeclaration);
    const maxResults =
      typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 200) : 50;

    const ws = this.workspaceService.getActiveWorkspaceFolder();
    if (!ws) {
      return {
        content: 'Error: No workspace folder is currently open.',
        success: false,
      };
    }

    const { resolvedPath, relativePath, inWorkspace } = this.workspaceService.resolvePath(rawFile);
    if (!inWorkspace) {
      return {
        content: `Error: Access denied. "${rawFile}" is outside the workspace boundary.`,
        success: false,
      };
    }

    // Verify file exists
    try {
      const stat = await this.workspaceService.stat(rawFile);
      if (stat.isDirectory) {
        return {
          content: `Error: "${rawFile}" is a directory. Provide a file path.`,
          success: false,
        };
      }
    } catch {
      return {
        content: `Error: File not found: "${rawFile}".`,
        success: false,
      };
    }

    // Attempt VS Code reference provider
    try {
      const uri = vscode.Uri.file(resolvedPath);
      const position = new vscode.Position(lineArg - 1, colArg - 1);

      const locations: vscode.Location[] = await vscode.commands.executeCommand(
        'vscode.executeReferenceProvider',
        uri,
        position,
        { includeDeclaration },
      );

      if (Array.isArray(locations) && locations.length > 0) {
        // Restrict to workspace (supports multi-root and cross-platform path casing)
        const wsFolders = this.workspaceService.getWorkspaceFolders();
        const wsRefs = locations.filter((loc) => isUriInWorkspace(loc.uri, wsFolders));

        const limited = wsRefs.slice(0, maxResults);
        const label = symbolName ? `"${symbolName}"` : `symbol at ${relativePath}:${lineArg}:${colArg}`;

        const lines: string[] = [
          `Found ${wsRefs.length} reference(s) for ${label}` +
            (wsRefs.length > maxResults ? ` (showing first ${maxResults}):` : ':'),
          '',
        ];

        // Group by file for readability
        const grouped = new Map<string, Array<{ line: number; col: number }>>();
        for (const loc of limited) {
          const refRelPath = vscode.workspace.asRelativePath(loc.uri, false);
          if (!grouped.has(refRelPath)) {
            grouped.set(refRelPath, []);
          }
          grouped.get(refRelPath)!.push({
            line: loc.range.start.line + 1,
            col: loc.range.start.character + 1,
          });
        }

        for (const [file, refs] of grouped) {
          lines.push(`${file}:`);
          for (const ref of refs) {
            lines.push(`  line ${ref.line}, col ${ref.col}`);
          }
          lines.push('');
        }

        const rawOutput = lines.join('\n').trim();
        const truncatedContent =
          rawOutput.length > MAX_OUTPUT_CHARS
            ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
            : rawOutput;

        return {
          content: truncatedContent,
          success: true,
          metadata: {
            referenceCount: wsRefs.length,
            fileCount: grouped.size,
            file: relativePath,
            line: lineArg,
            column: colArg,
            source: 'language-server',
            truncated: rawOutput.length > MAX_OUTPUT_CHARS,
          },
        };
      }

      // Empty result from language server — might mean no references or provider absent
    } catch {
      // Language server not available — fall through
    }

    // Fallback: text search for the symbol name
    if (symbolName) {
      return await this.fallbackSearch(symbolName, maxResults);
    }

    return {
      content:
        `No references found for symbol at ${relativePath}:${lineArg}:${colArg}. ` +
        'Language server may be unavailable. Provide "symbolName" to enable text-search fallback.',
      success: true,
      metadata: {
        referenceCount: 0,
        file: relativePath,
        line: lineArg,
        column: colArg,
        source: 'none',
      },
    };
  }

  private async fallbackSearch(symbolName: string, maxResults: number): Promise<ToolResult> {
    try {
      const matches = await this.workspaceService.searchFiles(symbolName, {
        isRegex: false,
        caseSensitive: false,
        maxResults,
      });

      if (matches.length === 0) {
        return {
          content: `No references to "${symbolName}" found via text-search fallback.`,
          success: true,
          metadata: { referenceCount: 0, query: symbolName, source: 'text-search-fallback' },
        };
      }

      // Group by file
      const grouped = new Map<string, Array<{ line: number; content: string }>>();
      for (const m of matches) {
        if (!grouped.has(m.file)) {
          grouped.set(m.file, []);
        }
        grouped.get(m.file)!.push({ line: m.line, content: m.content });
      }

      const lines: string[] = [
        `Found ${matches.length} reference(s) to "${symbolName}" (text-search fallback):`,
        '',
      ];
      for (const [file, refs] of grouped) {
        lines.push(`${file}:`);
        for (const ref of refs) {
          lines.push(`  ${ref.line} | ${ref.content.trim()}`);
        }
        lines.push('');
      }

      const rawOutput = lines.join('\n').trim();
      const truncatedContent =
        rawOutput.length > MAX_OUTPUT_CHARS
          ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
          : rawOutput;

      return {
        content: truncatedContent,
        success: true,
        metadata: {
          referenceCount: matches.length,
          fileCount: grouped.size,
          query: symbolName,
          source: 'text-search-fallback',
          truncated: rawOutput.length > MAX_OUTPUT_CHARS,
        },
      };
    } catch (err: any) {
      return {
        content: `Error during fallback reference search for "${symbolName}": ${err.message || String(err)}`,
        success: false,
      };
    }
  }
}
