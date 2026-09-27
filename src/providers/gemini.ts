/**
 * Google Gemini LLM Provider.
 * 
 * Uses the latest Generative Language API (v1beta).
 * Supports streaming chat completions and tool/function calling
 * via the standard REST interactions API.
 */

import { KodraError, ErrorReason, isCancellationError } from '../utils/errors';
import {
  ChatMessage,
  CompletionOptions,
  DiscoveredModel,
  ILLMProvider,
  ProviderCapabilities,
  StreamChunk,
  ToolCall,
} from './types';

export class GeminiProvider implements ILLMProvider {
  readonly id = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    vision: true,
  };

  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async *streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const model = options.model || this.getDefaultModel();
    const systemPrompt = messages.find(m => m.role === 'system')?.content;
    const chatMessages = messages.filter(m => m.role !== 'system');

    const contents = this.convertMessages(chatMessages);

    const body: any = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature,
        topP: options.topP,
        stopSequences: options.stop,
      }
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    if (options.tools && options.tools.length > 0) {
      const functionDeclarations = options.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));
      body.tools = [{ functionDeclarations }];
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
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
        'Failed to connect to Google Gemini API.',
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.handleHttpError(response.status, errorBody, model);
    }

    if (!response.body) {
      throw new KodraError(ErrorReason.ProviderConnectionFailed, 'Empty response from Gemini');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const candidate = parsed.candidates?.[0];
            const chunk: StreamChunk = {};

            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  chunk.content = (chunk.content || '') + part.text;
                }
                if (part.functionCall) {
                  if (!chunk.toolCalls) chunk.toolCalls = [];
                  chunk.toolCalls.push({
                    id: `call_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {}),
                    }
                  } as ToolCall);
                }
              }
            }

            if (candidate?.finishReason) {
              chunk.done = true;
              if (parsed.usageMetadata) {
                chunk.usage = {
                  promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                  completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                  totalTokens: parsed.usageMetadata.totalTokenCount || 0,
                };
              }
            }

            if (chunk.content || chunk.toolCalls || chunk.done) {
              yield chunk;
            }
          } catch {
            // skip malformed
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
        headers: { 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        if (response.status === 400 || response.status === 403) {
          throw new KodraError(ErrorReason.ProviderAuthFailed, 'Invalid Google Gemini API key.');
        }
        throw new Error(`Gemini API responded with ${response.status}`);
      }

      const data = await response.json() as any;
      const models = data.models || [];
      const discovered: DiscoveredModel[] = [];

      for (const m of models) {
        // Only include models that support text/chat generation
        if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
        
        // Strip the "models/" prefix for the ID
        const id = m.name.replace(/^models\//, '');
        const isThinking = id.includes('thinking') || id.includes('pro');
        
        discovered.push({
          id,
          displayName: m.displayName || id,
          provider: this.id,
          contextLength: m.inputTokenLimit,
          capabilities: {
            streaming: true,
            toolCalling: true, // Most modern Gemini models support tools
            vision: id.includes('vision') || id.includes('pro') || id.includes('flash'),
            reasoning: isThinking,
          }
        });
      }

      return discovered;
    } catch (error: unknown) {
      if (error instanceof KodraError) throw error;
      throw new KodraError(
        ErrorReason.ProviderConnectionFailed,
        'Cannot reach Google Gemini API.',
        error instanceof Error ? error : undefined,
      );
    }
  }

  async testConnection(): Promise<string[]> {
    const models = await this.discoverModels();
    return models.map(m => m.id);
  }

  getDefaultModel(): string {
    return 'gemini-1.5-flash';
  }

  dispose(): void {}

  private convertMessages(messages: ChatMessage[]): any[] {
    const result: any[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
            }
          });
        }
        result.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        const parts: any[] = [
          {
            functionResponse: {
              name: msg.toolCallId || 'unknown_tool',
              response: { result: msg.content },
            }
          }
        ];

        // Combine consecutive tool results
        while (i + 1 < messages.length && messages[i + 1].role === 'tool') {
          i++;
          parts.push({
            functionResponse: {
              name: messages[i].toolCallId || 'unknown_tool',
              response: { result: messages[i].content },
            }
          });
        }

        result.push({
          role: 'user',
          parts,
        });
      } else {
        // Merge consecutive user messages (which can happen if a tool result user message is followed by a real user message)
        const lastMsg = result.length > 0 ? result[result.length - 1] : null;
        if (lastMsg && lastMsg.role === 'user' && msg.role === 'user') {
            lastMsg.parts.push({ text: msg.content || '' });
        } else {
            result.push({
              role: msg.role === 'user' ? 'user' : 'model',
              parts: [{ text: msg.content || '' }],
            });
        }
      }
    }
    return result;
  }

  private handleHttpError(status: number, body: string, model: string): never {
    if (status === 400 || status === 403) {
      throw new KodraError(ErrorReason.ProviderAuthFailed, 'Invalid Google Gemini API key.');
    }
    if (status === 429) {
      throw new KodraError(ErrorReason.ProviderRateLimit, 'Gemini rate limit exceeded.');
    }
    if (status === 404) {
      throw new KodraError(ErrorReason.ProviderModelNotFound, `Model "${model}" not found.`);
    }
    try {
      const parsed = JSON.parse(body);
      if (parsed.error?.message) {
        throw new KodraError(ErrorReason.ProviderConnectionFailed, parsed.error.message);
      }
    } catch {
      // Ignore parse errors
    }
    throw new KodraError(ErrorReason.ProviderConnectionFailed, `Gemini error ${status}: ${body.slice(0, 200)}`);
  }
}
