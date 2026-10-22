/**
 * Tool: go_to_definition
 *
 * Navigates to the definition of a symbol at a specific file position using
 * VS Code's language provider APIs (executeDefinitionProvider).
 * Falls back to a regex-based text search for declaration patterns when the
 * language server is unavailable.
 *
 * Enables the agent to resolve "where is X defined?" without manually
 * scanning every file.
 */

import * as vscode from 'vscode';
import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService, isUriInWorkspace } from '../workspaceService';

const MAX_OUTPUT_CHARS = 8000;

export class GoToDefinitionTool implements ITool {
  readonly name = 'go_to_definition';
  readonly description =
    'Find where a symbol is defined given its file path and line/column position. ' +
    'Positions are 1-based at the tool boundary (line 1 is the first line, column 1 is the first column). ' +
    'Returns the definition file, line, and column. ' +
    'Use this when you have found a symbol usage and need to navigate to its declaration. ' +
    'Requires an active language server for full accuracy; falls back to text search otherwise. ' +
    'IMPORTANT: Use find_symbol first if you only know the name and not the exact position.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Workspace-relative (or absolute) path to the file containing the symbol usage.',
      },
      line: {
        type: 'number',
        description: '1-based line number of the symbol in the file (1 is the first line).',
      },
      column: {
        type: 'number',
        description: '1-based column number of the symbol in the file. Defaults to 1.',
      },
      symbolName: {
        type: 'string',
        description:
          'Optional: the symbol name at this position. Improves text-search fallback accuracy.',
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

    // Attempt VS Code definition provider
    try {
      const uri = vscode.Uri.file(resolvedPath);
      // VS Code positions are 0-based
      const position = new vscode.Position(lineArg - 1, colArg - 1);

      const locations: (vscode.Location | vscode.LocationLink)[] = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        uri,
        position,
      );

      if (Array.isArray(locations) && locations.length > 0) {
        const lines: string[] = [
          `Definition(s) for symbol at ${relativePath}:${lineArg}:${colArg}:`,
          '',
        ];

        const wsFolders = this.workspaceService.getWorkspaceFolders();
        for (const loc of locations) {
          const uri = 'targetUri' in loc ? loc.targetUri : loc.uri;
          const range = 'targetRange' in loc ? loc.targetRange : loc.range;
          const defLine = range.start.line + 1;
          const defCol = range.start.character + 1;

          if (isUriInWorkspace(uri, wsFolders)) {
            const defRelPath = vscode.workspace.asRelativePath(uri, false);
            lines.push(`  → ${defRelPath}:${defLine}:${defCol}`);
          } else {
            lines.push(`  → (external) ${uri.fsPath}:${defLine}:${defCol}`);
          }
        }

        const rawOutput = lines.join('\n');
        const truncatedContent =
          rawOutput.length > MAX_OUTPUT_CHARS
            ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
            : rawOutput;

        return {
          content: truncatedContent,
          success: true,
          metadata: {
            definitionCount: locations.length,
            file: relativePath,
            line: lineArg,
            column: colArg,
            source: 'language-server',
            truncated: rawOutput.length > MAX_OUTPUT_CHARS,
          },
        };
      }
    } catch {
      // Language server not available — fall through to text search
    }

    // Fallback: text-search for declaration pattern if symbolName is known
    if (symbolName) {
      return await this.fallbackSearch(symbolName, ws.fsPath);
    }

    return {
      content:
        `Could not resolve definition for symbol at ${relativePath}:${lineArg}:${colArg}. ` +
        'Language server may be unavailable. ' +
        'Try providing "symbolName" to enable text-search fallback, or use find_symbol with the symbol name.',
      success: false,
      metadata: { file: relativePath, line: lineArg, column: colArg, source: 'none' },
    };
  }

  private async fallbackSearch(symbolName: string, _rootPath: string): Promise<ToolResult> {
    try {
      const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        `(?:export\\s+)?(?:abstract\\s+)?class\\s+${escaped}\\b`,
        `(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`,
        `(?:export\\s+)?interface\\s+${escaped}\\b`,
        `(?:export\\s+)?type\\s+${escaped}\\s*=`,
        `(?:export\\s+)?enum\\s+${escaped}\\b`,
        `(?:const|let|var)\\s+${escaped}\\s*[=:]`,
        `def\\s+${escaped}\\s*\\(`,
      ];
      const combinedRx = new RegExp(patterns.join('|'), 'i');

      const matches = await this.workspaceService.searchFiles(symbolName, {
        isRegex: false,
        caseSensitive: false,
        maxResults: 50,
      });

      const declarations = matches.filter((m) => combinedRx.test(m.content));

      if (declarations.length === 0) {
        return {
          content: `No declaration found for "${symbolName}" via text-search fallback.`,
          success: false,
          metadata: { query: symbolName, source: 'text-search-fallback' },
        };
      }

      const lines: string[] = [
        `Definition(s) for "${symbolName}" (text-search fallback):`,
        '',
      ];
      for (const d of declarations.slice(0, 10)) {
        lines.push(`  → ${d.file}:${d.line} | ${d.content.trim()}`);
      }

      const rawOutput = lines.join('\n');
      const truncatedContent =
        rawOutput.length > MAX_OUTPUT_CHARS
          ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
          : rawOutput;

      return {
        content: truncatedContent,
        success: true,
        metadata: {
          definitionCount: declarations.length,
          query: symbolName,
          source: 'text-search-fallback',
          truncated: rawOutput.length > MAX_OUTPUT_CHARS,
        },
      };
    } catch (err: any) {
      return {
        content: `Error during fallback search for "${symbolName}": ${err.message || String(err)}`,
        success: false,
      };
    }
  }
}
