/**
 * Agent tool implementations for KODRA.
 *
 * Each tool implements the ITool interface and is registered with the agent loop.
 * Tools enforce workspace boundaries and validate arguments.
 *
 * Destructive tools (createFile, editFile) produce diffs for user approval
 * rather than applying changes directly.
 */
import { ToolDefinition } from '../providers/types';
import { ITool, ToolResult } from './types';
export declare class ReadFileTool implements ITool {
    readonly name = "read_file";
    readonly description = "Read the contents of a file in the workspace";
    readonly isDestructive = false;
    getDefinition(): ToolDefinition;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
    private resolveFilepath;
    private validatePath;
}
export declare class SearchFilesTool implements ITool {
    readonly name = "search_files";
    readonly description = "Search for text patterns in workspace files";
    readonly isDestructive = false;
    getDefinition(): ToolDefinition;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}
export declare class ListFilesTool implements ITool {
    readonly name = "list_files";
    readonly description = "List files and directories in a workspace path";
    readonly isDestructive = false;
    getDefinition(): ToolDefinition;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}
export declare class CreateFileTool implements ITool {
    readonly name = "create_file";
    readonly description = "Create a new file in the workspace";
    readonly isDestructive = true;
    getDefinition(): ToolDefinition;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
    /**
     * Apply the file creation after approval.
     */
    static apply(filepath: string, content: string): Promise<void>;
}
export declare class EditFileTool implements ITool {
    readonly name = "edit_file";
    readonly description = "Edit an existing file by replacing specific content";
    readonly isDestructive = true;
    getDefinition(): ToolDefinition;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
    /**
     * Apply the edit after approval.
     */
    static apply(filepath: string, search: string, replace: string): Promise<void>;
}
/**
 * Get all available tools.
 */
export declare function getAllTools(): ITool[];
//# sourceMappingURL=tools.d.ts.map