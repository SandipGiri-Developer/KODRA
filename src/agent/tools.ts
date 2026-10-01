/**
 * Default agent tool factory for KODRA.
 * 
 * Provides the six foundational tools for coding agents:
 * - read_file
 * - search_code
 * - list_directory
 * - edit_file
 * - create_file
 * - terminal (with run_command alias)
 */

import { ITool } from './types';
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';
import { ReadFileTool } from './tools/readFileTool';
import { ListDirectoryTool } from './tools/listDirectoryTool';
import { SearchCodeTool } from './tools/searchCodeTool';
import { EditFileTool } from './tools/editFileTool';
import { CreateFileTool } from './tools/createFileTool';
import { TerminalTool } from './tools/terminalTool';

export { ReadFileTool } from './tools/readFileTool';
export { ListDirectoryTool } from './tools/listDirectoryTool';
export { SearchCodeTool } from './tools/searchCodeTool';
export { EditFileTool } from './tools/editFileTool';
export { CreateFileTool } from './tools/createFileTool';
export { TerminalTool } from './tools/terminalTool';

/**
 * Get the complete set of default tools for the Agent Runtime.
 */
export function getAllTools(workspaceService: IWorkspaceService = new VSCodeWorkspaceService()): ITool[] {
  return [
    new ReadFileTool(workspaceService),
    new ListDirectoryTool(workspaceService),
    new SearchCodeTool(workspaceService),
    new EditFileTool(workspaceService),
    new CreateFileTool(workspaceService),
    new TerminalTool('terminal', workspaceService),
    new TerminalTool('run_command', workspaceService), // alias for models that prefer run_command
  ];
}
