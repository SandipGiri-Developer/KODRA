/**
 * Tool: find_symbol
 *
 * Searches for a named symbol (function, class, interface, variable, etc.)
 * anywhere in the workspace using VS Code's built-in workspace symbol provider.
 * Falls back to regex-based text search when the language server is unavailable.
 *
 * This prevents the agent from having to manually grep every file to locate
 * a definition when it already knows the symbol name.
 */

import * as vscode from 'vscode';
import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService, isUriInWorkspace } from '../workspaceService';

/** Maps a VS Code SymbolKind integer to a human-readable string. */
function symbolKindLabel(kind: vscode.SymbolKind): string {
  const labels: Record<number, string> = {
    [vscode.SymbolKind.File]: 'File',
    [vscode.SymbolKind.Module]: 'Module',
    [vscode.SymbolKind.Namespace]: 'Namespace',
    [vscode.SymbolKind.Package]: 'Package',
    [vscode.SymbolKind.Class]: 'Class',
    [vscode.SymbolKind.Method]: 'Method',
    [vscode.SymbolKind.Property]: 'Property',
    [vscode.SymbolKind.Field]: 'Field',
    [vscode.SymbolKind.Constructor]: 'Constructor',
    [vscode.SymbolKind.Enum]: 'Enum',
    [vscode.SymbolKind.Interface]: 'Interface',
    [vscode.SymbolKind.Function]: 'Function',
    [vscode.SymbolKind.Variable]: 'Variable',
    [vscode.SymbolKind.Constant]: 'Constant',
    [vscode.SymbolKind.String]: 'String',
    [vscode.SymbolKind.Number]: 'Number',
    [vscode.SymbolKind.Boolean]: 'Boolean',
    [vscode.SymbolKind.Array]: 'Array',
    [vscode.SymbolKind.Object]: 'Object',
    [vscode.SymbolKind.Key]: 'Key',
    [vscode.SymbolKind.Null]: 'Null',
    [vscode.SymbolKind.EnumMember]: 'EnumMember',
    [vscode.SymbolKind.Struct]: 'Struct',
    [vscode.SymbolKind.Event]: 'Event',
    [vscode.SymbolKind.Operator]: 'Operator',
    [vscode.SymbolKind.TypeParameter]: 'TypeParameter',
  };
  return labels[kind] ?? `Symbol(${kind})`;
}

const MAX_OUTPUT_CHARS = 8000;

export class FindSymbolTool implements ITool {
  readonly name = 'find_symbol';
  readonly description =
    'Search for a named symbol (function, class, interface, type, variable, constant, etc.) ' +
    'anywhere in the workspace. Returns matching symbol names, kinds, file paths, and line numbers. ' +
    'Use this to quickly locate a definition when you know the symbol name without manually scanning files. ' +
    'Supports partial name matching.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The symbol name or partial name to search for (e.g., "MyClass", "handleRequest", "IConfig").',
      },
      kind: {
        type: 'string',
        description:
          'Optional filter by symbol kind. Accepted values: "class", "function", "method", ' +
          '"interface", "variable", "constant", "enum", "property", "constructor". ' +
          'If omitted, all kinds are returned.',
        enum: [
          'class',
          'function',
          'method',
          'interface',
          'variable',
          'constant',
          'enum',
          'property',
          'constructor',
        ],
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of symbols to return. Defaults to 30.',
      },
    },
    required: ['query'],
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
    const query =
      typeof args.query === 'string'
        ? args.query.trim()
        : typeof args.symbol === 'string'
        ? args.symbol.trim()
        : typeof args.name === 'string'
        ? args.name.trim()
        : '';

    if (!query) {
      return {
        content: 'Error: Missing required argument "query". Provide a symbol name to search for.',
        success: false,
      };
    }

    const kindFilter = typeof args.kind === 'string' ? args.kind.toLowerCase() : undefined;
    const maxResults =
      typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 100) : 30;

    const ws = this.workspaceService.getActiveWorkspaceFolder();
    if (!ws) {
      return {
        content: 'Error: No workspace folder is currently open.',
        success: false,
      };
    }

    // Attempt VS Code workspace symbol provider (requires language server)
    try {
      const symbols: vscode.SymbolInformation[] = await vscode.commands.executeCommand(
        'vscode.executeWorkspaceSymbolProvider',
        query,
      );

      if (Array.isArray(symbols) && symbols.length > 0) {
        const kindMap: Record<string, number[]> = {
          class: [vscode.SymbolKind.Class],
          function: [vscode.SymbolKind.Function],
          method: [vscode.SymbolKind.Method, vscode.SymbolKind.Constructor],
          interface: [vscode.SymbolKind.Interface],
          variable: [vscode.SymbolKind.Variable],
          constant: [vscode.SymbolKind.Constant],
          enum: [vscode.SymbolKind.Enum, vscode.SymbolKind.EnumMember],
          property: [vscode.SymbolKind.Property, vscode.SymbolKind.Field],
          constructor: [vscode.SymbolKind.Constructor],
        };

        let filtered = symbols;
        if (kindFilter && kindMap[kindFilter]) {
          const allowedKinds = new Set(kindMap[kindFilter]);
          filtered = filtered.filter((s) => allowedKinds.has(s.kind));
        }

        // Restrict to workspace (supports multi-root and cross-platform path casing)
        const wsFolders = this.workspaceService.getWorkspaceFolders();
        filtered = filtered.filter((s) => isUriInWorkspace(s.location.uri, wsFolders));

        if (filtered.length === 0) {
          return {
            content: `No symbols named "${query}"${kindFilter ? ` of kind "${kindFilter}"` : ''} found in workspace.`,
            success: true,
            metadata: { matchCount: 0, query, source: 'language-server' },
          };
        }

        const limited = filtered.slice(0, maxResults);
        const lines: string[] = [
          `Found ${filtered.length} symbol(s) matching "${query}"${kindFilter ? ` (kind: ${kindFilter})` : ''}` +
            (filtered.length > maxResults ? ` (showing first ${maxResults}):` : ':'),
          '',
        ];

        for (const sym of limited) {
          const relPath = vscode.workspace.asRelativePath(sym.location.uri, false);
          const line = sym.location.range.start.line + 1;
          const col = sym.location.range.start.character + 1;
          const container = sym.containerName ? ` [in ${sym.containerName}]` : '';
          lines.push(
            `${symbolKindLabel(sym.kind).padEnd(14)} ${sym.name}${container}`,
            `  → ${relPath}:${line}:${col}`,
          );
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
            matchCount: filtered.length,
            query,
            source: 'language-server',
            truncated: rawOutput.length > MAX_OUTPUT_CHARS,
          },
        };
      }
    } catch {
      // Language server not available — fall through to text search
    }

    // Fallback: regex search across workspace source files
    return await this.fallbackTextSearch(query, kindFilter, maxResults, ws.fsPath);
  }

  /**
   * Regex-based fallback when language server is unavailable.
   * Searches for common declaration patterns in TypeScript/JavaScript/Python files.
   */
  private async fallbackTextSearch(
    query: string,
    kindFilter: string | undefined,
    maxResults: number,
    rootPath: string,
  ): Promise<ToolResult> {
    // Build pattern matching common declaration forms
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns: string[] = [
      `(?:export\\s+)?(?:abstract\\s+)?class\\s+${escaped}\\b`,
      `(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`,
      `(?:export\\s+)?interface\\s+${escaped}\\b`,
      `(?:export\\s+)?type\\s+${escaped}\\s*=`,
      `(?:export\\s+)?enum\\s+${escaped}\\b`,
      `(?:const|let|var)\\s+${escaped}\\s*[=:]`,
      `${escaped}\\s*(?:=\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>|\\(|function)`,
      `def\\s+${escaped}\\s*\\(`, // Python
    ];

    const combinedPattern = new RegExp(patterns.join('|'), 'i');

    try {
      const matches = await this.workspaceService.searchFiles(query, {
        filePattern: undefined,
        isRegex: false,
        caseSensitive: false,
        maxResults: maxResults * 3,
      });

      // Re-filter: only lines that match a declaration pattern
      const declarations = matches.filter((m) => combinedPattern.test(m.content));

      if (declarations.length === 0) {
        // Return all raw matches if no declaration patterns matched
        if (matches.length === 0) {
          return {
            content: `No symbols or references to "${query}" found in workspace.`,
            success: true,
            metadata: { matchCount: 0, query, source: 'text-search-fallback' },
          };
        }
        const lines: string[] = [
          `No symbol declarations found for "${query}". Showing ${Math.min(matches.length, maxResults)} text match(es):`,
          '',
        ];
        for (const m of matches.slice(0, maxResults)) {
          lines.push(`  ${m.file}:${m.line} | ${m.content}`);
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
            matchCount: matches.length,
            query,
            source: 'text-search-fallback',
            truncated: rawOutput.length > MAX_OUTPUT_CHARS,
          },
        };
      }

      const limited = declarations.slice(0, maxResults);
      const lines: string[] = [
        `Found ${declarations.length} potential declaration(s) for "${query}" (text-search fallback):`,
        '',
      ];
      for (const m of limited) {
        lines.push(`  ${m.file}:${m.line} | ${m.content.trim()}`);
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
          matchCount: declarations.length,
          query,
          source: 'text-search-fallback',
          truncated: rawOutput.length > MAX_OUTPUT_CHARS,
        },
      };
    } catch (err: any) {
      return {
        content: `Error searching for symbol "${query}": ${err.message || String(err)}`,
        success: false,
      };
    }
  }
}
