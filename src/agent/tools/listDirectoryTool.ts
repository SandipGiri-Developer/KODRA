/**
 * Tool: list_directory
 * 
 * Safely inspects the structure of workspace directories.
 * Returns formatted listings of files and subdirectories.
 * Essential for autonomous project exploration and file discovery.
 */

import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { DEFAULT_IGNORED_DIRS, IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

const MAX_OUTPUT_CHARS = 8000;

export class ListDirectoryTool implements ITool {
  readonly name = 'list_directory';
  readonly description =
    'List the contents of a directory in the workspace. Returns file and folder names. ' +
    'If path is empty or omitted, lists the root workspace directory. ' +
    'Use this tool to explore the project structure and discover files.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (relative to workspace root). Defaults to the workspace root if empty.',
      },
      pattern: {
        type: 'string',
        description:
          'Optional glob pattern to discover files matching across the workspace (e.g. "**/*.ts", "src/**/*.json"). ' +
          'When provided, searches files matching the pattern instead of listing a single directory.',
      },
      exclude: {
        type: 'string',
        description: 'Optional glob pattern of files/directories to exclude when pattern is provided (e.g. "**/*.spec.ts").',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of files to return when discovering files. Defaults to 50.',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list subdirectories recursively (up to 2 levels deep). Defaults to false.',
      },
    },
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
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const ws = this.workspaceService.getActiveWorkspaceFolder();
    if (!ws) {
      return {
        content: 'Error: No workspace folder is currently open.',
        success: false,
      };
    }

    // Check for file discovery pattern mode
    const pattern =
      typeof args.pattern === 'string' && args.pattern.trim()
        ? args.pattern.trim()
        : typeof args.filePattern === 'string' && args.filePattern.trim()
        ? args.filePattern.trim()
        : typeof args.glob === 'string' && args.glob.trim()
        ? args.glob.trim()
        : undefined;

    if (pattern) {
      try {
        const exclude =
          typeof args.exclude === 'string' && args.exclude.trim()
            ? args.exclude.trim()
            : typeof args.excludePattern === 'string' && args.excludePattern.trim()
            ? args.excludePattern.trim()
            : undefined;

        const maxResults =
          typeof args.maxResults === 'number' ? Math.min(Math.max(args.maxResults, 1), 500) : 50;

        const files = await this.workspaceService.findFiles(pattern, {
          excludePattern: exclude,
          maxResults,
        });

        if (files.length === 0) {
          return {
            content: `No files matching pattern "${pattern}"${exclude ? ` (excluding "${exclude}")` : ''} found in workspace.`,
            success: true,
            metadata: { itemCount: 0, pattern, exclude },
          };
        }

        const lines = [
          `Discovered ${files.length} file(s) matching "${pattern}"` +
            (exclude ? ` (excluding "${exclude}")` : '') +
            ':',
          '',
          ...files.map((f) => `[FILE] ${f}`),
        ];

        const rawContent = lines.join('\n');
        const truncatedContent =
          rawContent.length > MAX_OUTPUT_CHARS
            ? rawContent.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
            : rawContent;

        return {
          content: truncatedContent,
          success: true,
          metadata: {
            itemCount: files.length,
            pattern,
            exclude,
            files,
            truncated: rawContent.length > MAX_OUTPUT_CHARS,
          },
        };
      } catch (err: any) {
        return {
          content: `Error discovering files with pattern "${pattern}": ${err.message || String(err)}`,
          success: false,
        };
      }
    }

    // Support argument aliases: path, dir, directory, folder
    const rawPath =
      typeof args.path === 'string'
        ? args.path
        : typeof args.dir === 'string'
        ? args.dir
        : typeof args.directory === 'string'
        ? args.directory
        : typeof args.folder === 'string'
        ? args.folder
        : '';

    const recursive = Boolean(args.recursive);

    try {
      const { relativePath, inWorkspace } = this.workspaceService.resolvePath(rawPath);
      if (!inWorkspace) {
        return {
          content: `Error: Access denied. Directory "${rawPath}" is outside workspace boundaries.`,
          success: false,
        };
      }

      const displayPath = relativePath ? `${relativePath}/` : '/ (workspace root)';

      if (!recursive) {
        const entries = await this.workspaceService.readDirectory(rawPath);

        // Filter standard noise unless we are explicitly inside an ignored dir
        const isListingIgnored = DEFAULT_IGNORED_DIRS.has(relativePath.split('/')[0]);
        const filtered = isListingIgnored
          ? entries
          : entries.filter((e) => !DEFAULT_IGNORED_DIRS.has(e.name));

        // Sort: directories first, then alphabetical
        filtered.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        const formatted = filtered.map((e) => {
          if (e.isDirectory) {
            return `[DIR]  ${e.name}/`;
          }
          return `[FILE] ${e.name}`;
        });

        const rawOutput = [
          `Directory: ${displayPath}`,
          `Total items: ${filtered.length}`,
          '',
          formatted.length > 0 ? formatted.join('\n') : '(empty directory)',
        ].join('\n');

        const truncatedContent =
          rawOutput.length > MAX_OUTPUT_CHARS
            ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
            : rawOutput;

        return {
          content: truncatedContent,
          success: true,
          metadata: {
            itemCount: filtered.length,
            path: relativePath,
            truncated: rawOutput.length > MAX_OUTPUT_CHARS,
          },
        };
      }

      // Recursive listing (depth 2 max)
      const lines: string[] = [];
      const rootEntries = await this.workspaceService.readDirectory(rawPath);
      const filteredRoot = rootEntries.filter((e) => !DEFAULT_IGNORED_DIRS.has(e.name));

      filteredRoot.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      for (const entry of filteredRoot) {
        if (entry.isDirectory) {
          lines.push(`[DIR]  ${entry.name}/`);
          try {
            const subPath = rawPath ? `${rawPath}/${entry.name}` : entry.name;
            const subEntries = await this.workspaceService.readDirectory(subPath);
            const subFiltered = subEntries.filter((s) => !DEFAULT_IGNORED_DIRS.has(s.name));
            subFiltered.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)));
            for (const sub of subFiltered) {
              lines.push(`  ${sub.isDirectory ? '[DIR] ' : '[FILE]'} ${entry.name}/${sub.name}${sub.isDirectory ? '/' : ''}`);
            }
          } catch {
            // Skip sub-directory read errors
          }
        } else {
          lines.push(`[FILE] ${entry.name}`);
        }
      }

      const rawOutput = [
        `Directory (recursive): ${displayPath}`,
        `Total entries listed: ${lines.length}`,
        '',
        lines.length > 0 ? lines.join('\n') : '(empty directory)',
      ].join('\n');

      const truncatedContent =
        rawOutput.length > MAX_OUTPUT_CHARS
          ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + '\n... (truncated — output exceeded limit)'
          : rawOutput;

      return {
        content: truncatedContent,
        success: true,
        metadata: {
          entryCount: lines.length,
          path: relativePath,
          entries: lines,
          truncated: rawOutput.length > MAX_OUTPUT_CHARS,
        },
      };
    } catch (err: any) {
      return {
        content: `Error listing directory "${rawPath}": ${err.message || String(err)}`,
        success: false,
      };
    }
  }
}
