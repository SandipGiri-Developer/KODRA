/**
 * Default agent tool factory for KODRA.
 *
 * Active Agent Tools (Exactly 13):
 *   File operations:
 *     - read_file          — incremental file reading with line range slicing
 *     - edit_file          — exact match text replacement in existing files
 *     - create_file        — create new files with full content
 *     - list_directory     — workspace directory exploration and traversal
 *
 *   Code navigation and Git:
 *     - search_code        — text and regex search across workspace files
 *     - find_symbol        — symbol search by name + definition navigation by file/line
 *     - find_references    — find all usages of a symbol across the workspace
 *     - git_context        — read-only git log / blame / diff / status
 *
 *   Process management:
 *     - run_command        — run discrete command synchronously with timeout
 *     - start_process      — start background process and return processId
 *     - read_process_output— read captured stdout/stderr output incrementally
 *     - send_process_input — write input data to process stdin
 *     - stop_process       — gracefully or forcefully stop a KODRA-managed process
 *
 * Legacy Compatibility:
 *   TerminalTool and GoToDefinitionTool are retained for internal VS Code terminal
 *   and language server compatibility, but are not exposed directly to the model.
 */

import { ITool } from './types';
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';
import { ReadFileTool } from './tools/readFileTool';
import { ListDirectoryTool } from './tools/listDirectoryTool';
import { SearchCodeTool } from './tools/searchCodeTool';
import { EditFileTool } from './tools/editFileTool';
import { CreateFileTool } from './tools/createFileTool';
import { TerminalTool } from './tools/terminalTool';
import { FindSymbolTool } from './tools/findSymbolTool';
import { GoToDefinitionTool } from './tools/goToDefinitionTool';
import { FindReferencesTool } from './tools/findReferencesTool';
import { GitContextTool } from './tools/gitContextTool';

import { RunCommandTool } from './tools/runCommandTool';
import { StartProcessTool } from './tools/startProcessTool';
import { ReadProcessOutputTool } from './tools/readProcessOutputTool';
import { SendProcessInputTool } from './tools/sendProcessInputTool';
import { StopProcessTool } from './tools/stopProcessTool';

// Re-export all tool implementations so callers can import them without
// reaching into the internal tools/ directory.
export { ReadFileTool } from './tools/readFileTool';
export { ListDirectoryTool } from './tools/listDirectoryTool';
export { SearchCodeTool } from './tools/searchCodeTool';
export { EditFileTool } from './tools/editFileTool';
export { CreateFileTool } from './tools/createFileTool';
export { TerminalTool } from './tools/terminalTool';
export { FindSymbolTool } from './tools/findSymbolTool';
export { GoToDefinitionTool } from './tools/goToDefinitionTool';
export { FindReferencesTool } from './tools/findReferencesTool';
export { GitContextTool } from './tools/gitContextTool';
export { RunCommandTool } from './tools/runCommandTool';
export { StartProcessTool } from './tools/startProcessTool';
export { ReadProcessOutputTool } from './tools/readProcessOutputTool';
export { SendProcessInputTool } from './tools/sendProcessInputTool';
export { StopProcessTool } from './tools/stopProcessTool';

export interface GetAllToolsOptions {
  includeProcessTools?: boolean;
}

export function getProcessTools(
  workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
): ITool[] {
  return [
    new RunCommandTool(workspaceService),
    new StartProcessTool(workspaceService),
    new ReadProcessOutputTool(),
    new SendProcessInputTool(),
    new StopProcessTool(),
  ];
}

/**
 * Returns the full active tool set for the Agent Runtime.
 * Exactly 13 agent-facing tools covering file operations, code navigation,
 * Git context, and process management.
 */
export function getAllTools(
  workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
  _options?: GetAllToolsOptions,
): ITool[] {
  return [
    // File operations (4)
    new ReadFileTool(workspaceService),
    new EditFileTool(workspaceService),
    new CreateFileTool(workspaceService),
    new ListDirectoryTool(workspaceService),

    // Code navigation and Git (4)
    new SearchCodeTool(workspaceService),
    new FindSymbolTool(workspaceService),
    new FindReferencesTool(workspaceService),
    new GitContextTool(workspaceService),

    // Process management (5)
    new RunCommandTool(workspaceService),
    new StartProcessTool(workspaceService),
    new ReadProcessOutputTool(),
    new SendProcessInputTool(),
    new StopProcessTool(),
  ];
}
