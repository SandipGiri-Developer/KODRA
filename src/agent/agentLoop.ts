/**
 * Agent Loop for ARC1610.
 * 
 * Implements a controlled agent loop:
 *  User request → gather context → call model → parse response/tool request
 *  → validate tool → execute → return result → continue until done/cancelled/limit
 * 
 * Inspired by ARC's core.ts handleToolCall pattern but simplified for v1.0.
 */

import * as vscode from 'vscode';
import { CodebaseIndexer } from '../indexing/indexer';
import { SearchResult } from '../indexing/types';
import {
  ChatMessage,
  CompletionOptions,
  ILLMProvider,
  StreamChunk,
  ToolCall,
  ToolDefinition,
} from '../providers/types';
import { Arc1610Error, ErrorReason, isCancellationError, toError } from '../utils/errors';
import { Logger } from '../utils/logger';
import { AgentEvent, ITool, ToolResult } from './types';
import { getAllTools } from './tools';

const SYSTEM_PROMPT = `You are KODRA, an expert AI coding assistant integrated into VS Code.

You have access to the user's workspace and can read, search, create, and edit files.
You can see relevant codebase context retrieved from the workspace index.

Guidelines:
- Be concise and precise in your responses.
- When asked to make changes, use the available tools to read files first, then make targeted edits.
- Always explain what you're about to do before making changes.
- Use the search_files tool to find relevant code before making assumptions.
- When editing files, provide the exact text to find and replace.
- If you're unsure about something, ask the user for clarification.
- Never modify files outside the workspace.
- Never read or modify files that contain secrets (.env, API keys, certificates).`;

export class AgentLoop {
  private tools: Map<string, ITool>;
  private abortController: AbortController | null = null;

  constructor(
    private readonly indexer: CodebaseIndexer,
    private readonly requireApproval: boolean = true,
  ) {
    // Register tools
    this.tools = new Map();
    for (const tool of getAllTools()) {
      this.tools.set(tool.name, tool);
    }
  }

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
    } = {},
  ): AsyncGenerator<AgentEvent> {
    const maxIterations = options.maxIterations ?? 15;
    const logger = Logger.getInstance();
    this.abortController = new AbortController();

    try {
      // Build the initial message list
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversationHistory,
      ];

      // Gather codebase context
      const contextChunks = await this.gatherContext(userMessage);
      if (contextChunks.length > 0) {
        const contextText = this.formatContext(contextChunks);
        messages.push({
          role: 'system',
          content: `Relevant codebase context:\n\n${contextText}`,
        });
      }

      // Add explicit file context if provided
      if (options.contextFiles && options.contextFiles.length > 0) {
        for (const filepath of options.contextFiles) {
          try {
            const tool = this.tools.get('read_file')!;
            const result = await tool.execute({ filepath });
            if (result.success) {
              messages.push({
                role: 'system',
                content: `Attached file context:\n\n${result.content}`,
              });
            }
          } catch {
            // Skip unreadable context files
          }
        }
      }

      // Add the user message
      messages.push({ role: 'user', content: userMessage });

      // Determine if tools should be enabled based on model-specific capabilities
      // falling back to provider defaults
      const allowTools = options.toolCalling ?? provider.capabilities.toolCalling;

      // Get tool definitions
      const toolDefinitions = this.getToolDefinitions(allowTools);

      // Agent loop
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.abortController.signal.aborted) {
          yield { type: 'cancelled' };
          return;
        }

        logger.debug(`Agent iteration ${iteration + 1}/${maxIterations}`);

        // Call the model
        const completionOptions: CompletionOptions = {
          model: options.model,
          maxTokens: options.maxTokens,
          signal: this.abortController.signal,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        };

        let fullContent = '';
        let toolCalls: ToolCall[] = [];

        try {
          const stream = provider.streamChat(messages, completionOptions);

          for await (const chunk of stream) {
            if (this.abortController.signal.aborted) {
              yield { type: 'cancelled' };
              return;
            }

            if (chunk.content) {
              fullContent += chunk.content;
              yield { type: 'content', content: chunk.content };
            }

            if (chunk.toolCalls) {
              toolCalls.push(...(chunk.toolCalls as ToolCall[]));
            }

            if (chunk.done && chunk.usage) {
              // Will emit done event after processing tool calls
            }
          }
        } catch (error: unknown) {
          if (isCancellationError(error)) {
            yield { type: 'cancelled' };
            return;
          }
          const err = error instanceof Arc1610Error ? error : toError(error);
          yield { type: 'error', error: err instanceof Arc1610Error ? err.userMessage : err.message };
          return;
        }

        // Add assistant message to history
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullContent,
        };
        if (toolCalls.length > 0) {
          assistantMessage.toolCalls = toolCalls;
        }
        messages.push(assistantMessage);

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          yield { type: 'done' };
          return;
        }

        // Process tool calls
        for (const toolCall of toolCalls) {
          if (this.abortController.signal.aborted) {
            yield { type: 'cancelled' };
            return;
          }

          const tool = this.tools.get(toolCall.function.name);
          if (!tool) {
            const errorResult: ToolResult = {
              content: `Unknown tool: ${toolCall.function.name}`,
              success: false,
            };
            yield { type: 'toolResult', toolName: toolCall.function.name, result: errorResult };
            messages.push({
              role: 'tool',
              content: errorResult.content,
              toolCallId: toolCall.id,
            });
            continue;
          }

          // Parse arguments
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            const errorResult: ToolResult = {
              content: `Invalid tool arguments: ${toolCall.function.arguments}`,
              success: false,
            };
            yield { type: 'toolResult', toolName: tool.name, result: errorResult };
            messages.push({
              role: 'tool',
              content: errorResult.content,
              toolCallId: toolCall.id,
            });
            continue;
          }

          yield { type: 'toolCall', toolName: tool.name, args };

          // Execute the tool
          let result: ToolResult;
          try {
            result = await tool.execute(args);
          } catch (error: unknown) {
            const err = toError(error);
            result = {
              content: `Tool error: ${err instanceof Arc1610Error ? err.userMessage : err.message}`,
              success: false,
            };
          }

          // Handle approval for destructive tools
          if (result.requiresApproval && tool.isDestructive && this.requireApproval) {
            yield {
              type: 'approval',
              toolName: tool.name,
              description: result.content,
              diff: result.diff,
              filepath: result.filepath,
            };

            // Wait for approval (will be resolved by the webview)
            const approved = await this.waitForApproval();

            if (!approved) {
              result = {
                content: 'User rejected the proposed change.',
                success: false,
              };
            } else {
              // Apply the change
              try {
                await this.applyToolResult(tool.name, args);
                result = {
                  content: `Change applied successfully to ${result.filepath}`,
                  success: true,
                  filepath: result.filepath,
                };
              } catch (error: unknown) {
                result = {
                  content: `Failed to apply change: ${error instanceof Error ? error.message : String(error)}`,
                  success: false,
                };
              }
            }
          }

          yield { type: 'toolResult', toolName: tool.name, result };
          messages.push({
            role: 'tool',
            content: result.content,
            toolCallId: toolCall.id,
          });
        }
      }

      // Hit iteration limit
      yield {
        type: 'error',
        error: `Agent reached the maximum of ${maxIterations} iterations. The task may be too complex for a single request.`,
      };
      yield { type: 'done' };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel the current agent run.
   */
  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * Resolve a pending approval request.
   */
  private approvalResolve: ((approved: boolean) => void) | null = null;

  resolveApproval(approved: boolean): void {
    this.approvalResolve?.(approved);
  }

  private waitForApproval(): Promise<boolean> {
    return new Promise((resolve) => {
      this.approvalResolve = resolve;
    });
  }

  private async applyToolResult(toolName: string, args: Record<string, unknown>): Promise<void> {
    // @ts-ignore - Webpack handles this resolution, but tsc complains without .js
    const { CreateFileTool, EditFileTool } = await import('./tools');

    switch (toolName) {
      case 'create_file':
        await CreateFileTool.apply(
          String(args.filepath),
          String(args.content),
        );
        break;
      case 'edit_file':
        await EditFileTool.apply(
          String(args.filepath),
          String(args.search),
          String(args.replace),
        );
        break;
    }
  }

  private async gatherContext(query: string): Promise<SearchResult[]> {
    try {
      return await this.indexer.search(query, 8);
    } catch {
      return [];
    }
  }

  private formatContext(results: SearchResult[]): string {
    const chunks: string[] = [];
    const seenFiles = new Set<string>();

    for (const result of results) {
      // Deduplicate by file
      const fileKey = `${result.chunk.filepath}:${result.chunk.startLine}`;
      if (seenFiles.has(fileKey)) { continue; }
      seenFiles.add(fileKey);

      chunks.push(
        `--- ${result.chunk.filepath} (lines ${result.chunk.startLine + 1}-${result.chunk.endLine + 1}) ---\n` +
        result.chunk.content,
      );
    }

    return chunks.join('\n\n');
  }

  private getToolDefinitions(allowTools: boolean): ToolDefinition[] {
    if (!allowTools) {
      return [];
    }

    return Array.from(this.tools.values()).map(tool => tool.getDefinition());
  }
}
