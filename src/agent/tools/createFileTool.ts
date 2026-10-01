/**
 * Tool: create_file
 * 
 * Creates a new file in the workspace with the specified content.
 * Automatically creates parent directories if needed.
 * Prevents accidental overwrites unless overwrite: true is explicitly provided.
 */

import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class CreateFileTool implements ITool {
  readonly name = 'create_file';
  readonly description =
    'Create a new file in the workspace with specified content. ' +
    'Parent directories are created automatically. ' +
    'Fails safely if the file already exists unless overwrite: true is set.';

  readonly isDestructive = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'The path of the file to create (relative to the workspace root).',
      },
      content: {
        type: 'string',
        description: 'The full text content to write to the new file.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Whether to overwrite the file if it already exists. Defaults to false.',
      },
    },
    required: ['file', 'content'],
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
    // Support argument aliases
    const rawPath =
      typeof args.file === 'string'
        ? args.file
        : typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.path === 'string'
        ? args.path
        : '';

    const content = typeof args.content === 'string' ? args.content : undefined;
    const overwrite = Boolean(args.overwrite);

    if (!rawPath || rawPath.trim().length === 0) {
      return {
        content: 'Error: Missing required argument "file". Specify a file path to create.',
        success: false,
      };
    }

    if (content === undefined) {
      return {
        content: 'Error: Missing required argument "content". Provide the content for the file.',
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

    try {
      const res = await this.workspaceService.createFile(rawPath, content, overwrite);
      const lineCount = content.split(/\r?\n/).length;

      return {
        content: `Successfully created "${res.path}" (${res.bytesWritten} bytes, ${lineCount} lines).`,
        success: true,
        filepath: res.path,
        metadata: {
          path: res.path,
          bytesWritten: res.bytesWritten,
          lineCount,
        },
      };
    } catch (err: any) {
      return {
        content: `Error creating file "${rawPath}": ${err.message || String(err)}`,
        success: false,
        filepath: rawPath,
      };
    }
  }
}
