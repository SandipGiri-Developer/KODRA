/**
 * Agent Loop for KODRA.
 *
 * Provides the high-level bridge between the extension/UI and AgentRuntime.
 * Connects codebase context retrieval, model streaming, and tool execution.
 * Streams AgentEvents in real-time to the caller.
 */
import { CodebaseIndexer } from '../indexing/indexer';
import { ChatMessage, ILLMProvider } from '../providers/types';
import { AgentRuntime } from './agentRuntime';
import { ContextManager } from './contextManager';
import { IToolRegistry } from './toolRegistry';
import { AgentEvent, ITool } from './types';
import { IWorkspaceService } from './workspaceService';
export declare class AgentLoop {
    private readonly indexer?;
    private readonly requireApproval;
    private readonly runtime;
    private readonly registry;
    private readonly permissionManager;
    private readonly contextManager;
    private readonly workspaceService;
    private readonly eventBus;
    constructor(indexer?: CodebaseIndexer | undefined, requireApproval?: boolean, initialTools?: ITool[], workspaceService?: IWorkspaceService);
    /**
     * Get the underlying ToolRegistry.
     */
    getRegistry(): IToolRegistry;
    /**
     * Get the underlying AgentRuntime.
     */
    getRuntime(): AgentRuntime;
    /**
     * Get the underlying ContextManager.
     */
    getContextManager(): ContextManager;
    /**
     * Get the underlying WorkspaceService.
     */
    getWorkspaceService(): IWorkspaceService;
    /**
     * Run the agent loop for a user message.
     * Yields AgentEvents in real-time for UI consumption.
     */
    run(userMessage: string, conversationHistory: ChatMessage[], provider: ILLMProvider, options?: {
        maxIterations?: number;
        model?: string;
        maxTokens?: number;
        contextFiles?: string[];
        toolCalling?: boolean;
    }): AsyncGenerator<AgentEvent>;
    /**
     * Cancel the active agent run.
     */
    cancel(): void;
    /**
     * Resolve an approval request.
     */
    resolveApproval(approved: boolean, requestId?: string): void;
}
//# sourceMappingURL=agentLoop.d.ts.map