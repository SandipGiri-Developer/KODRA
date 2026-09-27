/**
 * OpenAI LLM Provider.
 * Connects to OpenAI's API (or any OpenAI-compatible endpoint).
 * 
 * Uses the Chat Completions API with streaming and tool/function calling.
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

interface OpenAIChatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export class OpenAIProvider implements ILLMProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: false,
  };

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1',
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
        'Failed to connect to OpenAI API.',
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.handleHttpError(response.status, errorBody, model);
    }

    if (!response.body) {
      throw new KodraError(ErrorReason.ProviderConnectionFailed, 'Empty response from OpenAI');
    }

    // Accumulate tool calls across chunks (OpenAI streams them in pieces)
    const toolCallAccumulator = new Map<number, { id: string; name: string; args: string }>();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            // Emit accumulated tool calls if any
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

            if (delta?.content) {
              chunk.content = delta.content;
            }

            // Accumulate tool call chunks
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
              // Usage on the final event
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
          throw new KodraError(ErrorReason.ProviderAuthFailed, 'Invalid OpenAI API key.');
        }
        throw new Error(`OpenAI responded with ${response.status}`);
      }
      
      const data = await response.json() as { data?: Array<{ id: string }> };
      const models = data.data || [];
      
      const discovered: DiscoveredModel[] = [];

      for (const m of models) {
        const id = m.id;
        
        // Filter to mostly chat models, ignore embeddings/whisper/etc
        if (!id.startsWith('gpt-') && !id.startsWith('o1') && !id.startsWith('o3') && !id.startsWith('o4') && !id.startsWith('chatgpt-')) {
          continue;
        }

        const isReasoning = id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4');
        const isVision = id.includes('vision') || id.includes('gpt-4o') || id === 'gpt-4-turbo';

        discovered.push({
          id,
          displayName: id,
          provider: this.id,
          capabilities: {
            streaming: true, // Most do, o1-mini supports it now
            toolCalling: true, // Nearly all GPT models support tools
            vision: isVision,
            reasoning: isReasoning,
          }
        });
      }

      // Sort models to put newer ones first (e.g. gpt-4o, o1, etc)
      discovered.sort((a, b) => b.id.localeCompare(a.id));

      return discovered;
    } catch (error: unknown) {
      if (error instanceof KodraError) { throw error; }
      throw new KodraError(
        ErrorReason.ProviderConnectionFailed,
        'Cannot reach OpenAI API.',
        error instanceof Error ? error : undefined,
      );
    }
  }

  async testConnection(): Promise<string[]> {
    const models = await this.discoverModels();
    return models.map(m => m.id);
  }

  getDefaultModel(): string {
    return '';
  }

  dispose(): void {
    // No persistent resources
  }

  private convertMessages(messages: ChatMessage[]): OpenAIChatMessage[] {
    return messages.map(msg => {
      const oaiMsg: OpenAIChatMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.toolCalls) {
        oaiMsg.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        oaiMsg.content = msg.content || null;
      }
      if (msg.toolCallId) {
        oaiMsg.tool_call_id = msg.toolCallId;
      }
      return oaiMsg;
    });
  }

  private handleHttpError(status: number, body: string, model: string): never {
    if (status === 401) {
      throw new KodraError(ErrorReason.ProviderAuthFailed, 'Invalid OpenAI API key.');
    }
    if (status === 429) {
      throw new KodraError(ErrorReason.ProviderRateLimit, 'OpenAI rate limit exceeded.');
    }
    if (status === 404) {
      throw new KodraError(ErrorReason.ProviderModelNotFound, `Model "${model}" not found.`);
    }
    // Try to extract error message from body
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
    throw new KodraError(ErrorReason.ProviderConnectionFailed, `OpenAI error ${status}: ${body.slice(0, 200)}`);
  }
}
