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
import { IWorkspaceService } from './workspaceService';
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
export declare function getProcessTools(workspaceService?: IWorkspaceService): ITool[];
/**
 * Returns the full active tool set for the Agent Runtime.
 * Exactly 13 agent-facing tools covering file operations, code navigation,
 * Git context, and process management.
 */
export declare function getAllTools(workspaceService?: IWorkspaceService, _options?: GetAllToolsOptions): ITool[];
//# sourceMappingURL=tools.d.ts.map