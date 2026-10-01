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

    const ws = this.workspaceService.getActiveWorkspaceFolder();
    if (!ws) {
      return {
        content: 'Error: No workspace folder is currently open.',
        success: false,
      };
    }

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

        const output = [
          `Directory: ${displayPath}`,
          `Total items: ${filtered.length}`,
          '',
          formatted.length > 0 ? formatted.join('\n') : '(empty directory)',
        ].join('\n');

        return {
          content: output,
          success: true,
          metadata: {
            itemCount: filtered.length,
            path: relativePath,
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

      const output = [
        `Directory (recursive): ${displayPath}`,
        `Total entries listed: ${lines.length}`,
        '',
        lines.length > 0 ? lines.join('\n') : '(empty directory)',
      ].join('\n');

      return {
        content: output,
        success: true,
        metadata: {
          entryCount: lines.length,
          path: relativePath,
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
