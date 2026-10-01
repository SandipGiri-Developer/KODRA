/**
 * Tool: search_code
 * 
 * Searches for text, symbols, or regex patterns across workspace files.
 * Returns matching lines with line numbers and file paths.
 * Essential for finding entry points, function definitions, usages, and configurations.
 */

import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class SearchCodeTool implements ITool {
  readonly name = 'search_code';
  readonly description =
    'Search for text, symbols, or regex patterns across files in the workspace. ' +
    'Returns matching file paths, line numbers, and code snippets. ' +
    'Use this to locate entry points, definitions, configurations, and usages across the codebase.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search string or regex pattern to look for.',
      },
      filePattern: {
        type: 'string',
        description: 'Optional file filter pattern (e.g., "*.ts", "*.json", "src/**").',
      },
      isRegex: {
        type: 'boolean',
        description: 'Whether the search query should be treated as a regex pattern. Defaults to false.',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search should be case sensitive. Defaults to false.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of matching lines to return (defaults to 50).',
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
    // Support aliases: query / pattern / searchTerm
    const query =
      typeof args.query === 'string'
        ? args.query
        : typeof args.pattern === 'string'
        ? args.pattern
        : typeof args.searchTerm === 'string'
        ? args.searchTerm
        : '';

    if (!query || query.trim().length === 0) {
      return {
        content: 'Error: Missing required argument "query". Please provide a search term.',
        success: false,
      };
    }

    const filePattern =
      typeof args.filePattern === 'string'
        ? args.filePattern
        : typeof args.include === 'string'
        ? args.include
        : undefined;

    const isRegex = Boolean(args.isRegex);
    const caseSensitive = Boolean(args.caseSensitive);
    const maxResults = typeof args.maxResults === 'number' ? Math.min(args.maxResults, 100) : 50;

    const ws = this.workspaceService.getActiveWorkspaceFolder();
    if (!ws) {
      return {
        content: 'Error: No workspace folder is currently open.',
        success: false,
      };
    }

    try {
      const matches = await this.workspaceService.searchFiles(query, {
        filePattern,
        isRegex,
        caseSensitive,
        maxResults,
      });

      if (matches.length === 0) {
        return {
          content: `No matches found for "${query}"${filePattern ? ` matching pattern "${filePattern}"` : ''} in workspace.`,
          success: true,
          metadata: { matchCount: 0, query },
        };
      }

      // Group matches by file
      const grouped = new Map<string, Array<{ line: number; content: string }>>();
      for (const m of matches) {
        if (!grouped.has(m.file)) {
          grouped.set(m.file, []);
        }
        grouped.get(m.file)!.push({ line: m.line, content: m.content });
      }

      const outputLines: string[] = [
        `Search Results for "${query}" (${matches.length} matches across ${grouped.size} files):`,
        '',
      ];

      for (const [file, fileMatches] of grouped) {
        outputLines.push(`${file}:`);
        for (const m of fileMatches) {
          outputLines.push(`  ${m.line} | ${m.content}`);
        }
        outputLines.push('');
      }

      return {
        content: outputLines.join('\n').trim(),
        success: true,
        metadata: {
          matchCount: matches.length,
          fileCount: grouped.size,
          query,
        },
      };
    } catch (err: any) {
      return {
        content: `Error executing search for "${query}": ${err.message || String(err)}`,
        success: false,
      };
    }
  }
}
