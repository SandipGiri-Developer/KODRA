/**
 * Tool: read_file
 * 
 * Safely reads the contents of a requested workspace file using the workspace service.
 * Supports line range slicing, line numbering, and boundary validation.
 */

import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class ReadFileTool implements ITool {
  readonly name = 'read_file';
  readonly description =
    'Read the contents of a file within the current workspace. ' +
    'Returns numbered lines. Optional startLine and endLine allow reading specific line ranges.';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'The path of the file to read (relative to the workspace root).',
      },
      startLine: {
        type: 'number',
        description: 'Optional 1-based start line to begin reading from.',
      },
      endLine: {
        type: 'number',
        description: 'Optional 1-based end line to stop reading at.',
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

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // Support aliases: file, filePath, path
    const rawPath =
      typeof args.file === 'string'
        ? args.file
        : typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.path === 'string'
        ? args.path
        : '';

    if (!rawPath || rawPath.trim().length === 0) {
      return {
        content: 'Error: Missing required argument "file". Please specify a file path to read.',
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
        content: `Error: Access denied. Cannot read file outside of workspace boundaries: "${rawPath}"`,
        success: false,
        filepath: rawPath,
      };
    }

    try {
      const stat = await this.workspaceService.stat(rawPath);
      if (stat.isDirectory) {
        return {
          content: `Error: "${rawPath}" is a directory, not a file. Use list_directory to view directory contents.`,
          success: false,
          filepath: rawPath,
        };
      }

      const content = await this.workspaceService.readFile(rawPath);
      const allLines = content.split(/\r?\n/);
      const totalLines = allLines.length;

      let start = 1;
      let end = totalLines;

      if (typeof args.startLine === 'number' && args.startLine > 0) {
        start = Math.max(1, Math.min(args.startLine, totalLines));
      }
      if (typeof args.endLine === 'number' && args.endLine >= start) {
        end = Math.min(args.endLine, totalLines);
      }

      // Slice requested range (convert 1-based to 0-based index)
      const selectedLines = allLines.slice(start - 1, end);
      const formattedLines = selectedLines
        .map((line, idx) => `${start + idx} | ${line}`)
        .join('\n');

      const isPartial = start > 1 || end < totalLines;
      const header = isPartial
        ? `File: ${relativePath}\nLines ${start}-${end} of ${totalLines}:\n\n`
        : `File: ${relativePath}\nTotal Lines: ${totalLines}\n\n`;

      return {
        content: `${header}${formattedLines}`,
        success: true,
        filepath: relativePath,
        metadata: {
          lineCount: totalLines,
          startLine: start,
          endLine: end,
          sizeBytes: stat.size,
        },
      };
    } catch (error: any) {
      const msg = error.message || String(error);
      if (msg.includes('FileNotFound') || msg.includes('not found') || error.code === 'ENOENT') {
        return {
          content: `Error: File not found: "${rawPath}". Verify the path and ensure it exists.`,
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
