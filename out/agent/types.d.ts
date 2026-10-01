/**
 * Agent and Tool type definitions for KODRA.
 *
 * Provides a generic, extensible foundation for:
 * - Tool definitions & schemas (compatible with OpenAI/Anthropic/Ollama function calling)
 * - Agent execution state machine (idle, running, waiting_for_approval, etc.)
 * - Normalized runtime event stream
 * - Permission & approval contracts
 */
import { ToolDefinition } from '../providers/types';
export { IWorkspaceService, WorkspaceFolderInfo, DirectoryEntry, SearchMatch } from './workspaceService';
export { IAgentEventBus } from './agentEventBus';
export { IToolExecutor, ToolExecutionResponse } from './toolExecutor';
export { IContextManager, BuildMessagesOptions } from './contextManager';
/** Result of executing an agent tool. */
export interface ToolResult {
    /** Textual or structured result representation returned to the model */
    content: string;
    /** Whether execution succeeded without fatal error */
    success: boolean;
    /** Optional file path affected by the operation */
    filepath?: string;
    /** Optional unified diff for file edits */
    diff?: string;
    /** Additional structured metadata */
    metadata?: Record<string, unknown>;
}
/** JSON Schema property specification for tool parameters. */
export interface ToolPropertySchema {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
    items?: Record<string, unknown>;
}
/** Parameter schema for a tool. */
export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
}
/** Tool metadata for capabilities, UI display, and permissions. */
export interface ToolMetadata {
    /** Human-readable category (e.g., 'filesystem', 'terminal', 'search') */
    category?: string;
    /** Whether this tool modifies disk or state */
    isDestructive?: boolean;
    /** Whether this tool requires user approval before execution */
    requiresApproval?: boolean;
    /** Short summary of what the tool does for UI display */
    displaySummary?: (args: Record<string, unknown>) => string;
}
/** Generic tool interface. All Kodra tools implement this contract. */
export interface ITool {
    /** Unique tool identifier */
    readonly name: string;
    /** Human-readable description provided to the LLM */
    readonly description: string;
    /** Parameter schema definition */
    readonly parameters?: ToolParameterSchema;
    /** Whether execution requires explicit approval from the user */
    readonly requiresApproval?: boolean;
    /** Whether this tool modifies files/state (backward compatibility) */
    readonly isDestructive?: boolean;
    /** Optional metadata and capabilities */
    readonly metadata?: ToolMetadata;
    /** Convert to provider-compatible ToolDefinition */
    getDefinition(): ToolDefinition;
    /** Execute the tool with validated arguments */
    execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}
/** Explicit runtime states of an agent execution. */
export type AgentStatus = 'idle' | 'running' | 'waiting_for_approval' | 'executing_tool' | 'completed' | 'failed' | 'cancelled';
/** Record of a single tool invocation within an agent turn. */
export interface ToolCallRecord {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    timestamp: number;
}
/** Record of a tool execution result. */
export interface ToolResultRecord {
    toolCallId: string;
    toolName: string;
    result: ToolResult;
    durationMs: number;
    timestamp: number;
}
/** Normalized state snapshot of an active or past agent execution. */
export interface AgentExecutionState {
    executionId: string;
    turnId: string;
    status: AgentStatus;
    iteration: number;
    maxIterations: number;
    toolCalls: ToolCallRecord[];
    toolResults: ToolResultRecord[];
    startTime: number;
    endTime?: number;
    error?: string;
}
/** Normalized runtime events emitted by AgentRuntime. */
export type AgentNormalizedEvent = {
    type: 'agent.started';
    executionId: string;
    turnId: string;
    timestamp: number;
} | {
    type: 'tool.requested';
    executionId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    timestamp: number;
} | {
    type: 'tool.approval_required';
    executionId: string;
    toolCallId: string;
    toolName: string;
    description: string;
    command?: string;
    filepath?: string;
    diff?: string;
    timestamp: number;
} | {
    type: 'tool.approved';
    executionId: string;
    toolCallId: string;
    toolName: string;
    timestamp: number;
} | {
    type: 'tool.rejected';
    executionId: string;
    toolCallId: string;
    toolName: string;
    reason?: string;
    timestamp: number;
} | {
    type: 'tool.started';
    executionId: string;
    toolCallId: string;
    toolName: string;
    timestamp: number;
} | {
    type: 'tool.completed';
    executionId: string;
    toolCallId: string;
    toolName: string;
    result: ToolResult;
    durationMs: number;
    timestamp: number;
} | {
    type: 'tool.failed';
    executionId: string;
    toolCallId: string;
    toolName: string;
    error: string;
    durationMs: number;
    timestamp: number;
} | {
    type: 'agent.completed';
    executionId: string;
    durationMs: number;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
    timestamp: number;
} | {
    type: 'agent.failed';
    executionId: string;
    error: string;
    timestamp: number;
} | {
    type: 'agent.cancelled';
    executionId: string;
    timestamp: number;
};
/** Backward-compatible streaming generator event for UI callers. */
export type AgentEvent = {
    type: 'content';
    content: string;
} | {
    type: 'toolCall';
    toolName: string;
    args: Record<string, unknown>;
    toolCallId?: string;
} | {
    type: 'toolResult';
    toolName: string;
    result: ToolResult;
} | {
    type: 'approval';
    toolName: string;
    description: string;
    command?: string;
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
/** Permission request payload passed to PermissionManager. */
export interface PermissionRequest {
    requestId: string;
    executionId: string;
    toolCallId: string;
    toolName: string;
    description: string;
    command?: string;
    filepath?: string;
    diff?: string;
    metadata?: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map