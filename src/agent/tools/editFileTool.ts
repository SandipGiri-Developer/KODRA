/**
 * Tool: edit_file
 * 
 * Safely and deterministically applies exact text replacements to workspace files.
 * Rejects ambiguous edits (multiple occurrences) or missing target strings.
 * Uses the workspace service for file operations.
 */

import { ToolDefinition } from '../../providers/types';
import { ITool, ToolParameterSchema, ToolResult } from '../types';
import { IWorkspaceService, VSCodeWorkspaceService } from '../workspaceService';

export class EditFileTool implements ITool {
  readonly name = 'edit_file';
  readonly description =
    'Replace a specific target text segment (oldText) with newText in an existing workspace file. ' +
    'The oldText must match exactly and appear uniquely in the file.';

  readonly isDestructive = true;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'The path of the file to edit (relative to workspace root).',
      },
      oldText: {
        type: 'string',
        description: 'The exact string currently in the file to be replaced.',
      },
      newText: {
        type: 'string',
        description: 'The replacement string to insert in place of oldText.',
      },
    },
    required: ['file', 'oldText', 'newText'],
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
    // Support argument aliases: file/filePath/path, oldText/oldString, newText/newString
    const rawPath =
      typeof args.file === 'string'
        ? args.file
        : typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.path === 'string'
        ? args.path
        : '';

    const oldText =
      typeof args.oldText === 'string'
        ? args.oldText
        : typeof args.oldString === 'string'
        ? args.oldString
        : null;

    const newText =
      typeof args.newText === 'string'
        ? args.newText
        : typeof args.newString === 'string'
        ? args.newString
        : null;

    if (!rawPath || rawPath.trim().length === 0) {
      return {
        content: 'Error: Missing required argument "file". Specify which file to edit.',
        success: false,
      };
    }

    if (oldText === null || newText === null) {
      return {
        content: 'Error: Missing required arguments "oldText" and/or "newText". Both are required for deterministic replacement.',
        success: false,
        filepath: rawPath,
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
        content: `Error: Access denied. Cannot edit file outside workspace boundaries: "${rawPath}"`,
        success: false,
        filepath: rawPath,
      };
    }

    // 1. Verify file exists and is not a directory
    try {
      const stat = await this.workspaceService.stat(rawPath);
      if (stat.isDirectory) {
        return {
          content: `Error: Cannot edit "${rawPath}" because it is a directory.`,
          success: false,
          filepath: rawPath,
        };
      }
    } catch {
      return {
        content: `Error: File not found: "${rawPath}". Cannot edit a non-existent file. Use create_file to create new files.`,
        success: false,
        filepath: rawPath,
      };
    }

    // 2. Read existing content
    let currentContent: string;
    try {
      currentContent = await this.workspaceService.readFile(rawPath);
    } catch (readErr: any) {
      return {
        content: `Error: Failed to read "${rawPath}": ${readErr.message || String(readErr)}`,
        success: false,
        filepath: rawPath,
      };
    }

    // 3. Verify oldText exists
    if (!currentContent.includes(oldText)) {
      return {
        content: `Error: oldText was not found in "${rawPath}". Ensure exact whitespace and line endings match.`,
        success: false,
        filepath: rawPath,
      };
    }

    // 4. Verify oldText matches unambiguously (single occurrence)
    const occurrences = currentContent.split(oldText).length - 1;
    if (occurrences > 1) {
      return {
        content: `Error: Found ${occurrences} occurrences of oldText in "${rawPath}". Ambiguous edits are rejected. Include more surrounding lines in oldText to make it unique.`,
        success: false,
        filepath: rawPath,
      };
    }

    // 5. Apply the replacement
    const updatedContent = currentContent.replace(oldText, newText);

    // 6. Write to disk using workspace service
    try {
      await this.workspaceService.writeFile(rawPath, updatedContent);

      const diffSnippet = `--- old\n+++ new\n-${oldText.slice(0, 100)}\n+${newText.slice(0, 100)}`;

      return {
        content: `Successfully modified "${relativePath}". Replaced 1 occurrence of oldText with newText.`,
        success: true,
        filepath: relativePath,
        diff: diffSnippet,
        metadata: {
          replacementCount: 1,
          sizeBefore: currentContent.length,
          sizeAfter: updatedContent.length,
        },
      };
    } catch (writeErr: any) {
      return {
        content: `Error writing changes to "${rawPath}": ${writeErr.message || String(writeErr)}`,
        success: false,
        filepath: rawPath,
      };
    }
  }
}
