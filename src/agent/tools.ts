/**
 * Default agent tool factory for KODRA.
 *
 * Active Tools:
 *   Filesystem & Search:
 *     - read_file        — incremental file reading (120 lines per call)
 *     - list_directory   — workspace directory exploration
 *     - search_code      — regex/text search across workspace files
 *     - edit_file        — write / patch existing files
 *     - create_file      — create new files
 *     - terminal         — run shell commands (requires approval)
 *
 *   Code Exploration (Phase 2):
 *     - find_symbol      — workspace-wide symbol search (with language server + text fallback)
 *     - go_to_definition — navigate to a symbol definition by file position
 *     - find_references  — find all usages of a symbol across the workspace
 *     - git_context      — read-only git log / blame / diff / status
 *
 * Architecture note: all tool implementations live in src/agent/tools/.
 * Adding a new tool only requires importing it here and adding it to getAllTools().
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

/**
 * Returns the full active tool set for the Agent Runtime.
 * All ten tools are registered and available to the agent.
 */
export function getAllTools(workspaceService: IWorkspaceService = new VSCodeWorkspaceService()): ITool[] {
  return [
    // Core filesystem tools
    new ReadFileTool(workspaceService),
    new ListDirectoryTool(workspaceService),
    new SearchCodeTool(workspaceService),
    new EditFileTool(workspaceService),
    new CreateFileTool(workspaceService),
    new TerminalTool('terminal', workspaceService),
    // Code exploration tools
    new FindSymbolTool(workspaceService),
    new GoToDefinitionTool(workspaceService),
    new FindReferencesTool(workspaceService),
    new GitContextTool(workspaceService),
  ];
}
