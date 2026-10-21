/**
 * Agent Runtime for KODRA.
 * 
 * Orchestrates the core agent execution loop:
 *   ContextManager (Workspace/Prompt/RAG)
 *   → Model/Provider (Streaming Chat & Tool Selection)
 *   → ToolExecutor (Validation, PermissionManager, ToolRegistry, Execution)
 *   → Tool Result returned to Model
 *   → Model Continuation / Final Response
 *   → Normalized events emitted via AgentEventBus
 */

import * as crypto from 'crypto';
import {
  ChatMessage,
  CompletionOptions,
  ILLMProvider,
  ToolCall,
} from '../providers/types';
import { ErrorReason, isCancellationError, KodraError, toError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { AgentEventBus, IAgentEventBus } from './agentEventBus';
import { ContextManager, IContextManager } from './contextManager';
import { IPermissionManager, PermissionManager } from './permissionManager';
import { IToolExecutor, ToolExecutor } from './toolExecutor';
import { IToolRegistry, ToolRegistry } from './toolRegistry';
import {
  AgentExecutionState,
  AgentNormalizedEvent,
  AgentStatus,
  ToolResult,
} from './types';

export interface AgentRuntimeOptions {
  maxIterations?: number;
  model?: string;
  maxTokens?: number;
  toolCalling?: boolean;
  contextFiles?: string[];
  customInstructions?: string;
  firstTokenTimeoutMs?: number;
  idleChunkTimeoutMs?: number;
}

/**
 * Wraps a model provider's streaming async iterable with lifecycle timeout protections:
 * - Enforces firstTokenTimeoutMs until the first chunk is received.
 * - Enforces idleChunkTimeoutMs between subsequent chunks to detect stalled connections.
 * - Immediately aborts on signal abortion without waiting indefinitely.
 * - Safely clears timers and listeners on exit.
 */
export async function* withStreamTimeout<T>(
  stream: AsyncIterable<T>,
  options: {
    firstTokenTimeoutMs?: number;
    idleChunkTimeoutMs?: number;
    signal?: AbortSignal;
    onFirstToken?: () => void;
  } = {},
): AsyncGenerator<T, void, unknown> {
  const firstTokenTimeout = options.firstTokenTimeoutMs ?? 120_000;
  const idleChunkTimeout = options.idleChunkTimeoutMs ?? 60_000;

  const iterator = stream[Symbol.asyncIterator]();
  let firstTokenReceived = false;

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new KodraError(ErrorReason.Cancelled, 'Request was cancelled.');
      }

      const currentTimeoutMs = firstTokenReceived ? idleChunkTimeout : firstTokenTimeout;

      let timer: NodeJS.Timeout | null = null;
      let abortListener: (() => void) | null = null;

      try {
        const nextPromise = iterator.next();

        const timeoutPromise = new Promise<never>((_, reject) => {
          if (currentTimeoutMs > 0) {
            timer = setTimeout(() => {
              if (!firstTokenReceived) {
                reject(
                  new KodraError(
                    ErrorReason.ProviderTimeout,
                    `Request timed out waiting for model to respond (${Math.round(currentTimeoutMs / 1000)}s). The provider may be unresponsive or loading a large model.`,
                  ),
                );
              } else {
                reject(
                  new KodraError(
                    ErrorReason.ProviderTimeout,
                    `Model stream stalled: No response tokens received for ${Math.round(currentTimeoutMs / 1000)} seconds.`,
                  ),
                );
              }
            }, currentTimeoutMs);
          }

          if (options.signal) {
            abortListener = () => {
              reject(new KodraError(ErrorReason.Cancelled, 'Request was cancelled by user.'));
            };
            options.signal.addEventListener('abort', abortListener, { once: true });
          }
        });

        const result = await Promise.race([nextPromise, timeoutPromise]);

        if (timer) clearTimeout(timer);
        if (options.signal && abortListener) {
          options.signal.removeEventListener('abort', abortListener);
        }

        if (result.done) {
          break;
        }

        if (!firstTokenReceived) {
          firstTokenReceived = true;
          options.onFirstToken?.();
        }

        yield result.value;
      } finally {
        if (timer) clearTimeout(timer);
        if (options.signal && abortListener) {
          options.signal.removeEventListener('abort', abortListener);
        }
      }
    }
  } finally {
    try {
      const returnPromise = iterator.return?.();
      if (returnPromise) {
        await Promise.race([
          returnPromise,
          new Promise((resolve) => setTimeout(resolve, 50)),
        ]).catch(() => {});
      }
    } catch {
      // ignore stream closure error
    }
  }
}

export class AgentRuntime {
  private readonly eventBus: IAgentEventBus;
  private readonly toolRegistry: IToolRegistry;
  private readonly permissionManager: IPermissionManager;
  private readonly toolExecutor: IToolExecutor;
  private readonly contextManager: IContextManager;

  private abortController: AbortController | null = null;
  private currentExecution: AgentExecutionState | null = null;

  constructor(
    toolRegistry: IToolRegistry = new ToolRegistry(),
    permissionManager: IPermissionManager = new PermissionManager(),
    options?: {
      eventBus?: IAgentEventBus;
      toolExecutor?: IToolExecutor;
      contextManager?: IContextManager;
    },
  ) {
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
    this.eventBus = options?.eventBus ?? new AgentEventBus();
    this.toolExecutor =
      options?.toolExecutor ??
      new ToolExecutor(this.toolRegistry, this.permissionManager, this.eventBus);
    this.contextManager = options?.contextManager ?? new ContextManager();
  }

  /**
   * Subscribe to normalized runtime events emitted by the AgentEventBus.
   */
  onEvent(listener: (event: AgentNormalizedEvent) => void): () => void {
    return this.eventBus.on(listener);
  }

  /**
   * Get the active execution state snapshot or null if idle.
   */
  getExecutionState(): AgentExecutionState | null {
    return this.currentExecution;
  }

  /**
   * Get the current agent lifecycle status.
   */
  getStatus(): AgentStatus {
    return this.currentExecution?.status ?? 'idle';
  }

  /**
   * Access the ToolRegistry.
   */
  getRegistry(): IToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Access the PermissionManager.
   */
  getPermissionManager(): IPermissionManager {
    return this.permissionManager;
  }

  /**
   * Access the ToolExecutor.
   */
  getToolExecutor(): IToolExecutor {
    return this.toolExecutor;
  }

  /**
   * Access the ContextManager.
   */
  getContextManager(): IContextManager {
    return this.contextManager;
  }

  /**
   * Access the AgentEventBus.
   */
  getEventBus(): IAgentEventBus {
    return this.eventBus;
  }

  /**
   * Resolve an approval request from the user/UI.
   */
  resolveApproval(approved: boolean, requestId?: string): boolean {
    if (requestId) {
      return this.permissionManager.resolveRequest(requestId, approved);
    }
    if (this.permissionManager instanceof PermissionManager) {
      return this.permissionManager.resolveLatest(approved);
    }
    return false;
  }

  /**
   * Cancel the current agent execution.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.permissionManager.cancelAll();
      if (this.currentExecution) {
        this.currentExecution.status = 'cancelled';
        this.currentExecution.endTime = Date.now();
        this.eventBus.emit({
          type: 'agent.cancelled',
          executionId: this.currentExecution.executionId,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Execute the agent loop for a user message.
   * Yields content tokens as they stream from the model.
   */
  async *run(
    userMessage: string,
    conversationHistory: ChatMessage[],
    provider: ILLMProvider,
    options: AgentRuntimeOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    const logger = Logger.getInstance();
    const maxIterations = options.maxIterations ?? 100;
    const maxRuntimeMs = 1000 * 1000;
    const executionId = crypto.randomUUID ? crypto.randomUUID() : `exec_${Date.now()}`;
    const turnId = `turn_${Date.now()}`;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.currentExecution = {
      executionId,
      turnId,
      status: 'running',
      iteration: 0,
      maxIterations,
      toolCalls: [],
      toolResults: [],
      startTime: Date.now(),
    };

    this.eventBus.emit({
      type: 'agent.started',
      executionId,
      turnId,
      timestamp: Date.now(),
    });

    logger.info(`[KODRA Lifecycle] Request started executionId=${executionId} turnId=${turnId} maxIterations=${maxIterations}`);

    // Build complete messages list using ContextManager if not already fully built
    let messages: ChatMessage[];
    const hasSystemMessage = conversationHistory.some((m) => m.role === 'system');

    if (!hasSystemMessage) {
      messages = await this.contextManager.buildMessages(userMessage, conversationHistory, {
        contextFiles: options.contextFiles,
        customInstructions: options.customInstructions,
      });
    } else {
      messages = [...conversationHistory];
      if (messages.length === 0 || messages[messages.length - 1].content !== userMessage) {
        messages.push({ role: 'user', content: userMessage });
      }
    }

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (signal.aborted) {
          this.handleCancelled();
          return;
        }

        if (Date.now() - this.currentExecution.startTime > maxRuntimeMs) {
          const limitError = `Agent reached the maximum runtime of ${maxRuntimeMs / 1000} seconds. Task stopped.`;
          this.handleFailed(limitError);
          yield `\n\n[Warning: ${limitError}]`;
          return;
        }

        this.currentExecution.iteration = iteration + 1;
        this.currentExecution.status = 'running';
        logger.debug(`[AgentRuntime] Iteration ${iteration + 1}/${maxIterations}`);

        // 1. Get model-compatible tool schemas dynamically from registry
        const toolDefinitions = this.toolRegistry.getToolDefinitions();
        const allowTools = options.toolCalling ?? provider.capabilities.toolCalling;

        const completionOptions: CompletionOptions = {
          model: options.model,
          maxTokens: options.maxTokens,
          signal,
          tools: allowTools && toolDefinitions.length > 0 ? toolDefinitions : undefined,
        };

        let iterationContent = '';
        const toolCalls: ToolCall[] = [];

        // 2. Stream response from model
        try {
          const tStream = Date.now();
          logger.info(`[KODRA Lifecycle] Provider request initiated executionId=${executionId} iteration=${iteration + 1} model=${options.model || '(default)'}`);

          const rawStream = provider.streamChat(messages, completionOptions);
          const stream = withStreamTimeout(rawStream, {
            firstTokenTimeoutMs: options.firstTokenTimeoutMs,
            idleChunkTimeoutMs: options.idleChunkTimeoutMs,
            signal,
            onFirstToken: () => {
              const ttft = Date.now() - tStream;
              logger.info(`[KODRA Lifecycle] First chunk received executionId=${executionId} ttft=${ttft}ms`);
            },
          });

          for await (const chunk of stream) {
            if (signal.aborted) {
              this.handleCancelled();
              return;
            }

            if (chunk.content) {
              iterationContent += chunk.content;
              yield chunk.content;
            }

            if (chunk.toolCalls) {
              toolCalls.push(...(chunk.toolCalls as ToolCall[]));
            }
          }

          logger.info(`[KODRA Lifecycle] Provider stream ended executionId=${executionId} iteration=${iteration + 1} contentTokens=${iterationContent.length} toolCalls=${toolCalls.length} elapsed=${Date.now() - tStream}ms`);
        } catch (error: unknown) {
          if (isCancellationError(error) || signal.aborted) {
            this.handleCancelled();
            return;
          }
          const err = error instanceof KodraError ? error : toError(error);
          const errMsg = err instanceof KodraError ? err.userMessage : err.message;
          this.handleFailed(errMsg);
          throw err;
        }

        if (signal.aborted) {
          this.handleCancelled();
          return;
        }

        // Add assistant message to history
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: iterationContent,
        };
        if (toolCalls.length > 0) {
          assistantMsg.toolCalls = toolCalls;
        }
        messages.push(assistantMsg);

        // 3. If no tool calls were requested, agent has finished its turn
        if (toolCalls.length === 0) {
          this.handleCompleted();
          return;
        }

        // 4. Execute tool calls sequentially via ToolExecutor
        this.currentExecution.status = 'executing_tool';

        for (const toolCall of toolCalls) {
          if (signal.aborted) {
            this.handleCancelled();
            return;
          }

          const execResponse = await this.toolExecutor.executeToolCall(toolCall, executionId, signal);

          // Record in execution state
          this.currentExecution.toolCalls.push({
            id: execResponse.toolCallId,
            toolName: execResponse.toolName,
            args: {},
            timestamp: Date.now(),
          });

          this.recordToolResult(
            execResponse.toolCallId,
            execResponse.toolName,
            execResponse.result,
            execResponse.durationMs,
          );

          // Append tool result to messages for the model's next turn
          messages.push({
            role: 'tool',
            toolCallId: execResponse.toolCallId,
            toolName: execResponse.toolName,
            content: execResponse.result.content,
          });
        }
      }

      // Max iterations reached
      const limitError = `Agent reached the maximum of ${maxIterations} iterations. Task stopped to prevent infinite loops.`;
      this.handleFailed(limitError);
      yield `\n\n[Warning: ${limitError}]`;
    } finally {
      this.abortController = null;
      Logger.getInstance().info(`[KODRA Lifecycle] Cleanup completed executionId=${executionId}`);
    }
  }

  private recordToolResult(
    toolCallId: string,
    toolName: string,
    result: ToolResult,
    durationMs: number,
  ): void {
    if (!this.currentExecution) {
      return;
    }
    this.currentExecution.toolResults.push({
      toolCallId,
      toolName,
      result,
      durationMs,
      timestamp: Date.now(),
    });
  }

  private handleCompleted(): void {
    if (!this.currentExecution) {
      return;
    }
    this.currentExecution.status = 'completed';
    this.currentExecution.endTime = Date.now();
    const durationMs = this.currentExecution.endTime - this.currentExecution.startTime;

    Logger.getInstance().info(`[KODRA Lifecycle] Request completed executionId=${this.currentExecution.executionId} duration=${durationMs}ms`);

    this.eventBus.emit({
      type: 'agent.completed',
      executionId: this.currentExecution.executionId,
      durationMs,
      timestamp: Date.now(),
    });
  }

  private handleFailed(error: string): void {
    if (!this.currentExecution) {
      return;
    }
    this.currentExecution.status = 'failed';
    this.currentExecution.endTime = Date.now();
    this.currentExecution.error = error;
    const durationMs = this.currentExecution.endTime - this.currentExecution.startTime;

    Logger.getInstance().info(`[KODRA Lifecycle] Request failed executionId=${this.currentExecution.executionId} error="${error.replace(/\r?\n/g, ' ')}" duration=${durationMs}ms`);

    this.eventBus.emit({
      type: 'agent.failed',
      executionId: this.currentExecution.executionId,
      error,
      timestamp: Date.now(),
    });
  }

  private handleCancelled(): void {
    if (!this.currentExecution) {
      return;
    }
    this.currentExecution.status = 'cancelled';
    this.currentExecution.endTime = Date.now();
    const durationMs = this.currentExecution.endTime - this.currentExecution.startTime;

    Logger.getInstance().info(`[KODRA Lifecycle] Request cancelled executionId=${this.currentExecution.executionId} duration=${durationMs}ms`);

    this.eventBus.emit({
      type: 'agent.cancelled',
      executionId: this.currentExecution.executionId,
      timestamp: Date.now(),
    });
  }
}
