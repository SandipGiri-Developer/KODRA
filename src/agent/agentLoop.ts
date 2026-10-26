/**
 * Agent Loop for KODRA.
 * 
 * Provides the high-level bridge between the extension/UI and AgentRuntime.
 * Connects codebase context retrieval, model streaming, and tool execution.
 * Streams AgentEvents in real-time to the caller.
 */

import { CodebaseIndexer } from '../indexing/indexer';
import { ChatMessage, ILLMProvider } from '../providers/types';
import { Logger } from '../utils/logger';
import { AgentEventBus } from './agentEventBus';
import { AgentRuntime } from './agentRuntime';
import { ContextManager } from './contextManager';
import { PermissionManager } from './permissionManager';
import { IToolRegistry, ToolRegistry } from './toolRegistry';
import { getAllTools } from './tools';
import { AgentEvent, AgentNormalizedEvent, ITool } from './types';
import { ContextEngine, IContextEngine } from './contextEngine';
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';

/**
 * Asynchronous event queue for real-time streaming to the UI.
 * Prevents deadlocks during user approval requests and ensures zero-lag tool events.
 */
class AsyncEventQueue<T> {
  private queue: T[] = [];
  private waiter: ((val: IteratorResult<T>) => void) | null = null;
  private isDone = false;

  push(event: T): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  finish(): void {
    this.isDone = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as any, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      return { value: this.queue.shift()!, done: false };
    }
    if (this.isDone) {
      return { value: undefined as any, done: true };
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waiter = resolve;
    });
  }
}

import { ApprovalGate } from './terminal/approvalGate';
import { ApprovalPolicyService } from './terminal/approvalPolicyService';
import { ApprovalDecisionType, IApprovalGate } from './terminal/types';

export class AgentLoop {
  private readonly runtime: AgentRuntime;
  private readonly registry: IToolRegistry;
  private readonly permissionManager: PermissionManager;
  private readonly approvalGate: IApprovalGate;
  private readonly contextManager: ContextManager;
  private readonly workspaceService: IWorkspaceService;
  private readonly contextEngine: IContextEngine;
  private readonly eventBus: AgentEventBus;

  private readonly pendingContextOps: Promise<void>[] = [];

  constructor(
    private readonly indexer?: CodebaseIndexer,
    private readonly requireApproval: boolean = true,
    initialTools?: ITool[],
    workspaceService?: IWorkspaceService,
    contextEngine?: IContextEngine,
  ) {
    this.workspaceService = workspaceService ?? new VSCodeWorkspaceService();
    this.contextEngine = contextEngine ?? ContextEngine.createForWorkspace(this.workspaceService);
    const toolsToRegister = initialTools ?? getAllTools(this.workspaceService, { includeProcessTools: true });
    this.registry = new ToolRegistry(toolsToRegister);
    this.permissionManager = new PermissionManager(!this.requireApproval);
    this.eventBus = new AgentEventBus();
    this.approvalGate = new ApprovalGate(
      ApprovalPolicyService.getInstance(),
      this.permissionManager,
      this.eventBus,
    );
    this.contextManager = new ContextManager(this.workspaceService, this.contextEngine);

    this.runtime = new AgentRuntime(this.registry, this.permissionManager, {
      eventBus: this.eventBus,
      contextManager: this.contextManager,
      approvalGate: this.approvalGate,
    });

    // Update ContextEngine on tool completion and persist on agent completion
    this.eventBus.on((event: AgentNormalizedEvent) => {
      try {
        if (event.type === 'tool.completed') {
          const p = this.contextEngine
            .recordToolCompletion(event.toolName, event.args || {}, event.result)
            .catch((err) => {
              Logger.getInstance().warn('ContextEngine event processing error (non-fatal)', err);
            });
          this.pendingContextOps.push(p);
        } else if (event.type === 'agent.completed') {
          const p = this.contextEngine.save().catch((err) => {
            Logger.getInstance().warn('ContextEngine save error (non-fatal)', err);
          });
          this.pendingContextOps.push(p);
        }
      } catch (err) {
        Logger.getInstance().warn('ContextEngine event dispatch error (non-fatal)', err);
      }
    });
  }

  /**
   * Get the underlying ToolRegistry.
   */
  getRegistry(): IToolRegistry {
    return this.registry;
  }

  /**
   * Get the underlying AgentRuntime.
   */
  getRuntime(): AgentRuntime {
    return this.runtime;
  }

  /**
   * Get the underlying ContextManager.
   */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * Get the underlying ContextEngine.
   */
  getContextEngine(): IContextEngine {
    return this.contextEngine;
  }

  /**
   * Get the underlying WorkspaceService.
   */
  getWorkspaceService(): IWorkspaceService {
    return this.workspaceService;
  }

  /**
   * Run the agent loop for a user message.
   * Yields AgentEvents in real-time for UI consumption.
   */
  async *run(
    userMessage: string,
    conversationHistory: ChatMessage[],
    provider: ILLMProvider,
    options: {
      maxIterations?: number;
      model?: string;
      maxTokens?: number;
      contextFiles?: string[];
      toolCalling?: boolean;
      firstTokenTimeoutMs?: number;
      idleChunkTimeoutMs?: number;
      mode?: string;
      workspaceId?: string;
      cwd?: string;
    } = {},
  ): AsyncGenerator<AgentEvent> {
    const logger = Logger.getInstance();
    const eventQueue = new AsyncEventQueue<AgentEvent>();

    // Subscribe to normalized runtime events from the AgentEventBus
    const unsubscribe = this.eventBus.on((event: AgentNormalizedEvent) => {
      switch (event.type) {
        case 'agent.started':
          eventQueue.push({
            type: 'agentStarted',
            executionId: event.executionId,
          });
          break;

        case 'tool.requested':
          eventQueue.push({
            type: 'toolCall',
            toolName: event.toolName,
            args: event.args,
            toolCallId: event.toolCallId,
          });
          break;

        case 'tool.started':
          eventQueue.push({
            type: 'toolStarted',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
          });
          break;

        case 'tool.approval_required':
          eventQueue.push({
            type: 'approval',
            toolName: event.toolName,
            description: event.description,
            command: event.command,
            filepath: event.filepath,
            diff: event.diff,
            requestId: (event as any).requestId,
            executionId: event.executionId,
          });
          break;

        case 'tool.completed':
          eventQueue.push({
            type: 'toolResult',
            toolName: event.toolName,
            result: event.result,
            toolCallId: event.toolCallId,
            durationMs: event.durationMs,
          });
          break;

        case 'tool.failed':
          eventQueue.push({
            type: 'toolResult',
            toolName: event.toolName,
            result: { content: event.error, success: false },
            toolCallId: event.toolCallId,
            durationMs: event.durationMs,
          });
          break;

        case 'agent.completed':
          eventQueue.push({ type: 'done', usage: event.usage });
          break;

        case 'agent.cancelled':
          eventQueue.push({ type: 'cancelled' });
          break;

        case 'agent.failed':
          eventQueue.push({ type: 'error', error: event.error });
          break;
      }
    });

    // Start background runtime execution
    (async () => {
      try {
        // Automatically ensure ContextEngine state is loaded before message construction
        try {
          await this.contextEngine.ensureLoaded();
        } catch {
          // non-fatal
        }

        // Build initial messages with ContextManager
        const messages = await this.contextManager.buildMessages(userMessage, conversationHistory, {
          indexer: this.indexer,
          contextFiles: options.contextFiles,
          contextEngine: this.contextEngine,
        });

        const textStream = this.runtime.run(userMessage, messages, provider, {
          maxIterations: options.maxIterations,
          model: options.model,
          maxTokens: options.maxTokens,
          toolCalling: options.toolCalling,
          firstTokenTimeoutMs: options.firstTokenTimeoutMs,
          idleChunkTimeoutMs: options.idleChunkTimeoutMs,
          mode: options.mode,
          workspaceId: options.workspaceId,
          cwd: options.cwd,
        });

        for await (const chunk of textStream) {
          eventQueue.push({ type: 'content', content: chunk });
        }
      } catch (err: any) {
        logger.error('Error during agent execution in AgentLoop', err);
        eventQueue.push({ type: 'error', error: err.message || String(err) });
      } finally {
        try {
          await Promise.all(this.pendingContextOps);
        } catch {
          // non-fatal
        }
        eventQueue.finish();
      }
    })();

    try {
      while (true) {
        const item = await eventQueue.next();
        if (item.done) {
          break;
        }
        yield item.value;
      }
    } finally {
      unsubscribe();
    }
  }

  /**
   * Cancel the active agent run.
   */
  cancel(): void {
    this.runtime.cancel();
  }

  /**
   * Resolve an approval request.
   */
  resolveApproval(decision: boolean | ApprovalDecisionType, requestId?: string): void {
    this.runtime.resolveApproval(decision, requestId);
  }
}

