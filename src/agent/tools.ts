/**
 * Default agent tool factory for KODRA.
 *
 * Phase 1 Active Tools (read-only, no approval required):
 *   - read_file       — incremental file reading (120 lines per call)
 *   - list_directory  — workspace directory exploration
 *
 * Architecture note: all other tool implementations are preserved in
 * src/agent/tools/ and can be activated simply by importing and adding them
 * to the array returned by getActiveTools() below. No other code changes are
 * needed to extend the tool set.
 */

import { ITool } from './types';
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';
import { ReadFileTool } from './tools/readFileTool';
import { ListDirectoryTool } from './tools/listDirectoryTool';

// Re-export all tool implementations so callers can import them without
// reaching into the internal tools/ directory.
export { ReadFileTool } from './tools/readFileTool';
export { ListDirectoryTool } from './tools/listDirectoryTool';
export { SearchCodeTool } from './tools/searchCodeTool';
export { EditFileTool } from './tools/editFileTool';
export { CreateFileTool } from './tools/createFileTool';
export { TerminalTool } from './tools/terminalTool';

/**
 * Returns the currently active set of tools for the Agent Runtime.
 *
 * Only read_file and list_directory are active in Phase 1.
 * To activate additional tools in future phases, import them above and
 * add new entries to this array.
 */
export function getAllTools(workspaceService: IWorkspaceService = new VSCodeWorkspaceService()): ITool[] {
  return [
    new ReadFileTool(workspaceService),
    new ListDirectoryTool(workspaceService),
  ];
}
