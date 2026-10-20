/**
 * DeepSeek LLM Provider.
 * Connects to DeepSeek's API (https://api.deepseek.com) or any DeepSeek-compatible endpoint.
 *
 * Uses the OpenAI-compatible Chat Completions API with streaming, reasoning, and tool calling.
 * Users must provide their own API key — KODRA does not include one.
 */

import { KodraError, ErrorReason, isCancellationError } from '../utils/errors';
import {
  ChatMessage,
  CompletionOptions,
  ILLMProvider,
  ProviderCapabilities,
  StreamChunk,
  ToolCall,
  DiscoveredModel,
} from './types';

interface DeepSeekChatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export class DeepSeekProvider implements ILLMProvider {
  readonly id = 'deepseek';
  readonly displayName = 'DeepSeek';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
  };

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.deepseek.com',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async *streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const model = options.model || this.getDefaultModel();

    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(messages),
      stream: true,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      stop: options.stop,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (isCancellationError(error)) {
        throw new KodraError(ErrorReason.Cancelled, 'Request cancelled');
      }
      throw new KodraError(
        ErrorReason.ProviderConnectionFailed,
        'Failed to connect to DeepSeek API.',
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.handleHttpError(response.status, errorBody, model);
    }

    if (!response.body) {
      throw new KodraError(ErrorReason.ProviderConnectionFailed, 'Empty response from DeepSeek');
    }

    // Accumulate tool calls across chunks (DeepSeek streams them in pieces)
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inThinkTag = false;
    let pendingThinkBuffer = '';

    const filterThinking = (content: string): string => {
      let result = '';
      let text = pendingThinkBuffer + content;
      pendingThinkBuffer = '';

      while (text.length > 0) {
        if (!inThinkTag) {
          const thinkStart = text.indexOf('<think>');
          if (thinkStart === -1) {
            const match = text.match(/<t?(h?(i?(n?k?)?)?)?$/);
            if (match && match.index !== undefined && match[0].length > 0) {
              result += text.slice(0, match.index);
              pendingThinkBuffer = match[0];
            } else {
              result += text;
            }
            break;
          } else {
            result += text.slice(0, thinkStart);
            text = text.slice(thinkStart + '<think>'.length);
            inThinkTag = true;
          }
        } else {
          const thinkEnd = text.indexOf('</think>');
          if (thinkEnd === -1) {
            break;
          } else {
            text = text.slice(thinkEnd + '</think>'.length);
            inThinkTag = false;
          }
        }
      }

      return result;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) { continue; }
          const data = trimmed.slice(6);

          if (data === '[DONE]') {
            if (toolCallAccumulator.size > 0) {
              const toolCalls: ToolCall[] = [];
              for (const [, tc] of toolCallAccumulator) {
                toolCalls.push({
                  id: tc.id,
                  function: { name: tc.name, arguments: tc.args },
                });
              }
              yield { toolCalls, done: true };
            } else {
              yield { done: true };
            }
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) { continue; }

            const delta = choice.delta;
            const chunk: StreamChunk = {};

            // Omit delta.reasoning_content and delta.reasoning, and strip any <think> tags from content
            if (delta?.content) {
              const cleanContent = filterThinking(delta.content);
              if (cleanContent.length > 0) {
                chunk.content = cleanContent;
              }
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallAccumulator.has(idx)) {
                  toolCallAccumulator.set(idx, {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    args: '',
                  });
                }
                const acc = toolCallAccumulator.get(idx)!;
                if (tc.id) { acc.id = tc.id; }
                if (tc.function?.name) { acc.name = tc.function.name; }
                if (tc.function?.arguments) { acc.args += tc.function.arguments; }
              }
            }

            if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
              chunk.done = true;
              if (parsed.usage) {
                chunk.usage = {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0,
                };
              }
            }

            if (chunk.content || chunk.done) {
              yield chunk;
            }
          } catch {
            // Skip malformed SSE events
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new KodraError(ErrorReason.ProviderAuthFailed, 'Invalid DeepSeek API key.');
        }
        throw new Error(`DeepSeek responded with ${response.status}`);
      }

      const data = await response.json() as { data?: Array<{ id: string }> };
      const models = data.data || [];

      const discovered: DiscoveredModel[] = [];

      for (const m of models) {
        const id = m.id;
        const isReasoning = id.includes('reasoner') || id.includes('r1');
        discovered.push({
          id,
          displayName: id === 'deepseek-chat' ? 'DeepSeek-V3 (Chat)' : id === 'deepseek-reasoner' ? 'DeepSeek-R1 (Reasoner)' : id,
          provider: this.id,
          capabilities: {
            streaming: true,
            toolCalling: !isReasoning,
            vision: false,
            reasoning: isReasoning,
          },
        });
      }

      if (discovered.length === 0) {
        discovered.push(
          {
            id: 'deepseek-chat',
            displayName: 'DeepSeek-V3 (Chat)',
            provider: this.id,
            capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
          },
          {
            id: 'deepseek-reasoner',
            displayName: 'DeepSeek-R1 (Reasoner)',
            provider: this.id,
            capabilities: { streaming: true, toolCalling: false, vision: false, reasoning: true },
          },
        );
      }

      discovered.sort((a, b) => a.id.localeCompare(b.id));
      return discovered;
    } catch (error: unknown) {
      if (error instanceof KodraError) { throw error; }
      throw new KodraError(
        ErrorReason.ProviderConnectionFailed,
        'Cannot reach DeepSeek API.',
        error instanceof Error ? error : undefined,
      );
    }
  }

  async testConnection(): Promise<string[]> {
    const models = await this.discoverModels();
    return models.map(m => m.id);
  }

  getDefaultModel(): string {
    return 'deepseek-chat';
  }

  dispose(): void {
    // No persistent resources
  }

  private convertMessages(messages: ChatMessage[]): DeepSeekChatMessage[] {
    return messages.map(msg => {
      const dsMsg: DeepSeekChatMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.toolCalls) {
        dsMsg.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        dsMsg.content = msg.content || null;
      }
      if (msg.toolCallId) {
        dsMsg.tool_call_id = msg.toolCallId;
      }
      return dsMsg;
    });
  }

  private handleHttpError(status: number, body: string, model: string): never {
    if (status === 401) {
      throw new KodraError(ErrorReason.ProviderAuthFailed, 'Invalid DeepSeek API key.');
    }
    if (status === 429) {
      throw new KodraError(ErrorReason.ProviderRateLimit, 'DeepSeek rate limit exceeded.');
    }
    if (status === 404) {
      throw new KodraError(ErrorReason.ProviderModelNotFound, `Model "${model}" not found.`);
    }

    try {
      const parsed = JSON.parse(body);
      if (parsed.error?.message) {
        if (parsed.error.message.includes('context_length_exceeded')) {
          throw new KodraError(ErrorReason.ProviderContextLength, parsed.error.message);
        }
        throw new KodraError(ErrorReason.ProviderConnectionFailed, parsed.error.message);
      }
    } catch (e) {
      if (e instanceof KodraError) { throw e; }
    }
    throw new KodraError(ErrorReason.ProviderConnectionFailed, `DeepSeek error ${status}: ${body.slice(0, 200)}`);
  }
}
