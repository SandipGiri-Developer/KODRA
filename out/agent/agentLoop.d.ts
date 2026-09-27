/**
 * Agent Loop for KODRA.
 *
 * Implements a controlled agent loop:
 *  User request → gather context → call model → parse response/tool request
 *  → validate tool → execute → return result → continue until done/cancelled/limit
 *
 * Inspired by KODRA's core.ts handleToolCall pattern but simplified for v1.0.
 */
import { CodebaseIndexer } from '../indexing/indexer';
import { ChatMessage, ILLMProvider } from '../providers/types';
import { AgentEvent } from './types';
export declare class AgentLoop {
    private readonly indexer;
    private readonly requireApproval;
    private tools;
    private abortController;
    constructor(indexer: CodebaseIndexer, requireApproval?: boolean);
    /**
     * Run the agent loop for a user message.
     *
     * Yields AgentEvents as the agent processes the request:
     * - content: streamed text from the model
     * - toolCall: tool being invoked
     * - toolResult: result of tool execution
     * - approval: waiting for user to approve a destructive action
     * - error: an error occurred
     * - done: agent finished
     * - cancelled: user cancelled
     */
    run(userMessage: string, conversationHistory: ChatMessage[], provider: ILLMProvider, options?: {
        maxIterations?: number;
        model?: string;
        maxTokens?: number;
        contextFiles?: string[];
        toolCalling?: boolean;
    }): AsyncGenerator<AgentEvent>;
    /**
     * Cancel the current agent run.
     */
    cancel(): void;
    /**
     * Resolve a pending approval request.
     */
    private approvalResolve;
    resolveApproval(approved: boolean): void;
    private waitForApproval;
    private applyToolResult;
    private gatherContext;
    private formatContext;
    private getToolDefinitions;
}
//# sourceMappingURL=agentLoop.d.ts.map