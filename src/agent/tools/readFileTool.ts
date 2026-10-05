/**
 * Tool: read_file
 *
 * Incrementally reads workspace files using VS Code filesystem APIs.
 * Default page size is 120 lines per call, enabling the agent to read
 * large files iteratively rather than loading everything into one context.
 *
 * The tool returns rich metadata so the agent knows:
 *   - Whether more content remains (hasMore, nextStartLine)
 *   - Exact line range returned (startLine, endLine)
 *   - Total lines in the file (totalLines)
 *
 * Usage pattern:
 *   First call:  { file: "src/index.ts" }                          → lines 1–120
 *   Next call:   { file: "src/index.ts", startLine: 121 }          → lines 121–240
 *   Custom page: { file: "src/index.ts", startLine: 1, endLine: 50 } → lines 1–50
 */

import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

/** Default number of lines returned per call when no endLine is specified. */
const DEFAULT_PAGE_SIZE = 120;

export class ReadFileTool implements ITool {
  readonly name = 'read_file';
  readonly description =
    'Read the contents of a workspace file incrementally. ' +
    'By default reads 120 lines per call starting from startLine (default: 1). ' +
    'Returns numbered lines plus metadata: totalLines, startLine, endLine, hasMore, nextStartLine. ' +
    'If hasMore is true, call again with startLine=nextStartLine to continue reading. ' +
    'Always use this tool for file reading — do not request more than needed.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path of the file to read (workspace-relative or absolute within workspace).',
      },
      startLine: {
        type: 'number',
        description: '1-based line number to start reading from. Defaults to 1.',
      },
      endLine: {
        type: 'number',
        description:
          'Optional 1-based line number to stop reading at (inclusive). ' +
          'If omitted, reads up to ' + DEFAULT_PAGE_SIZE + ' lines from startLine.',
      },
    },
    required: ['file'],
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

  async execute(args: Record<string, unknown>, _signal?: AbortSignal): Promise<ToolResult> {
    // Accept common path argument aliases
    const rawPath =
      typeof args.file === 'string'
        ? args.file
        : typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.path === 'string'
        ? args.path
        : '';

    if (!rawPath.trim()) {
      return {
        content: 'Error: Missing required argument "file". Provide a workspace-relative file path.',
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

    const { relativePath, inWorkspace } = this.workspaceService.resolvePath(rawPath);
    if (!inWorkspace) {
      return {
        content: `Error: Access denied. "${rawPath}" is outside the workspace boundary.`,
        success: false,
        filepath: rawPath,
      };
    }

    try {
      const stat = await this.workspaceService.stat(rawPath);
      if (stat.isDirectory) {
        return {
          content: `Error: "${rawPath}" is a directory. Use list_directory to explore it.`,
          success: false,
          filepath: rawPath,
        };
      }

      const content = await this.workspaceService.readFile(rawPath);
      const allLines = content.split(/\r?\n/);
      const totalLines = allLines.length;

      // Resolve start line (1-based, clamp to valid range)
      const requestedStart = typeof args.startLine === 'number' && args.startLine > 0
        ? Math.floor(args.startLine)
        : 1;
      const startLine = Math.max(1, Math.min(requestedStart, totalLines));

      // Resolve end line — honour explicit endLine if provided, otherwise default page size
      let endLine: number;
      if (typeof args.endLine === 'number' && args.endLine >= startLine) {
        endLine = Math.min(Math.floor(args.endLine), totalLines);
      } else {
        endLine = Math.min(startLine + DEFAULT_PAGE_SIZE - 1, totalLines);
      }

      const selectedLines = allLines.slice(startLine - 1, endLine);
      const formattedLines = selectedLines
        .map((line, idx) => `${startLine + idx} | ${line}`)
        .join('\n');

      const hasMore = endLine < totalLines;
      const nextStartLine = hasMore ? endLine + 1 : null;

      const headerParts: string[] = [
        `File: ${relativePath}`,
        `Lines: ${startLine}–${endLine} of ${totalLines}`,
      ];
      if (hasMore && nextStartLine !== null) {
        headerParts.push(`Note: File has more content. Call read_file with startLine=${nextStartLine} to continue.`);
      } else {
        headerParts.push('Note: End of file.');
      }

      return {
        content: `${headerParts.join('\n')}\n\n${formattedLines}`,
        success: true,
        filepath: relativePath,
        metadata: {
          totalLines,
          startLine,
          endLine,
          hasMore,
          nextStartLine,
          pageSize: DEFAULT_PAGE_SIZE,
          sizeBytes: stat.size,
        },
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('FileNotFound') || msg.includes('not found') || (error as any)?.code === 'ENOENT') {
        return {
          content: `Error: File not found: "${rawPath}". Verify the path is correct.`,
          success: false,
          filepath: rawPath,
        };
      }
      return {
        content: `Error reading "${rawPath}": ${msg}`,
        success: false,
        filepath: rawPath,
      };
    }
  }
}
