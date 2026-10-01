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
import { IWorkspaceService } from './workspaceService';
export { ReadFileTool } from './tools/readFileTool';
export { ListDirectoryTool } from './tools/listDirectoryTool';
export { SearchCodeTool } from './tools/searchCodeTool';
export { EditFileTool } from './tools/editFileTool';
export { CreateFileTool } from './tools/createFileTool';
export { TerminalTool } from './tools/terminalTool';
/**
 * Get the complete set of default tools for the Agent Runtime.
 */
export declare function getAllTools(workspaceService?: IWorkspaceService): ITool[];
//# sourceMappingURL=tools.d.ts.map