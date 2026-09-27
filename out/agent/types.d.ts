/**
 * Agent and Tool type definitions for KODRA.
 */
import { ChatMessage, ToolDefinition } from '../providers/types';
/** Result of executing a tool. */
export interface ToolResult {
    /** Result content (may be text, file content, search results, etc.) */
    content: string;
    /** Whether the tool execution succeeded */
    success: boolean;
    /** For file operations: the affected file path */
    filepath?: string;
    /** For edit operations: the proposed diff */
    diff?: string;
    /** Whether this result requires user approval before taking effect */
    requiresApproval?: boolean;
}
/** A tool implementation. */
export interface ITool {
    /** Tool name (matches the function name in ToolDefinition) */
    readonly name: string;
    /** Human-readable description */
    readonly description: string;
    /** Whether this tool modifies files (requires approval) */
    readonly isDestructive: boolean;
    /** The tool definition to send to the model */
    getDefinition(): ToolDefinition;
    /** Execute the tool with parsed arguments */
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}
/** Agent loop state. */
export interface AgentState {
    /** Conversation history */
    messages: ChatMessage[];
    /** Current iteration number */
    iteration: number;
    /** Maximum allowed iterations */
    maxIterations: number;
    /** Whether the agent is waiting for user approval */
    pendingApproval: boolean;
    /** The pending action details (for approval) */
    pendingAction?: {
        toolName: string;
        description: string;
        diff?: string;
        filepath?: string;
        resolve: (approved: boolean) => void;
    };
}
/** Events emitted by the agent. */
export type AgentEvent = {
    type: 'content';
    content: string;
} | {
    type: 'toolCall';
    toolName: string;
    args: Record<string, unknown>;
} | {
    type: 'toolResult';
    toolName: string;
    result: ToolResult;
} | {
    type: 'approval';
    toolName: string;
    description: string;
    diff?: string;
    filepath?: string;
} | {
    type: 'error';
    error: string;
} | {
    type: 'done';
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
} | {
    type: 'cancelled';
};
//# sourceMappingURL=types.d.ts.map