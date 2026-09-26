/**
 * Ollama LLM Provider.
 * Connects to a local Ollama instance for private, free inference.
 * 
 * Uses Ollama's native /api/chat endpoint with streaming.
 * Supports tool calling for models that support it (e.g., llama3.1+, mistral, qwen2.5+).
 */

import { Arc1610Error, ErrorReason, isCancellationError } from '../utils/errors';
import {
  ChatMessage,
  CompletionOptions,
  ILLMProvider,
  ProviderCapabilities,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  DiscoveredModel,
} from './types';

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
    top_p?: number;
    stop?: string[];
  };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

export class OllamaProvider implements ILLMProvider {
  readonly id = 'ollama';
  readonly displayName = 'Ollama (Local)';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: true, // Supported by recent models
    vision: false,
  };

  constructor(private endpoint: string = 'http://127.0.0.1:11434') {
    // Normalize endpoint — remove trailing slash
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  async *streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<StreamChunk> {
    const model = options.model || this.getDefaultModel();

    const ollamaMessages = this.convertMessages(messages);
    const body: OllamaChatRequest = {
      model,
      messages: ollamaMessages,
      stream: true,
      options: {
        num_predict: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        stop: options.stop,
      },
    };

    // Only include tools if the model supports them and tools are provided
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (error: unknown) {
      if (isCancellationError(error)) {
        throw new Arc1610Error(ErrorReason.Cancelled, 'Request cancelled');
      }
      throw new Arc1610Error(
        ErrorReason.ProviderConnectionFailed,
        `Failed to connect to Ollama at ${this.endpoint}. Is Ollama running?`,
        error instanceof Error ? error : undefined,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      if (response.status === 404) {
        throw new Arc1610Error(
          ErrorReason.ProviderModelNotFound,
          `Model "${model}" not found. Run: ollama pull ${model}`,
        );
      }
      throw new Arc1610Error(
        ErrorReason.Unknown,
        `Ollama error ${response.status}: ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Arc1610Error(ErrorReason.ProviderConnectionFailed, 'Empty response from Ollama');
    }

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
          if (!line.trim()) { continue; }

          try {
            const parsed = JSON.parse(line);

            const chunk: StreamChunk = {};

            // Handle content
            if (parsed.message?.content) {
              chunk.content = parsed.message.content;
            }

            // Handle tool calls
            if (parsed.message?.tool_calls) {
              chunk.toolCalls = parsed.message.tool_calls.map(
                (tc: { function: { name: string; arguments: Record<string, unknown> } }, i: number) => ({
                  id: `call_${Date.now()}_${i}`,
                  function: {
                    name: tc.function.name,
                    arguments: JSON.stringify(tc.function.arguments),
                  },
                } as ToolCall),
              );
            }

            // Handle completion
            if (parsed.done) {
              chunk.done = true;
              if (parsed.eval_count !== undefined) {
                chunk.usage = {
                  promptTokens: parsed.prompt_eval_count || 0,
                  completionTokens: parsed.eval_count || 0,
                  totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
                };
              }
            }

            yield chunk;
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    try {
      // 1. Get the list of installed models
      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Ollama responded with ${response.status}`);
      }
      const data = await response.json() as { models?: Array<{ name: string; details?: any, capabilities?: string[] }> };
      const models = data.models || [];
      
      const discovered: DiscoveredModel[] = [];

      // 2. Map them to our format.
      for (const m of models) {
        const id = m.name;
        
        let hasToolCalling = false;
        let hasVision = false;
        let hasReasoning = false;
        let isEmbedding = false;

        // If the Ollama version provides capabilities natively
        if (m.capabilities && Array.isArray(m.capabilities)) {
          hasToolCalling = m.capabilities.includes('tools');
          hasVision = m.capabilities.includes('vision');
          hasReasoning = m.capabilities.includes('thinking') || m.capabilities.includes('reasoning');
          isEmbedding = m.capabilities.includes('embedding');
        } else {
          // Fallback heuristic if capabilities array is not provided
          const lowerId = id.toLowerCase();
          hasToolCalling = lowerId.includes('llama3.1') || 
                           lowerId.includes('llama3.2') || 
                           lowerId.includes('llama3.3') ||
                           lowerId.includes('qwen') || 
                           lowerId.includes('mistral') || 
                           lowerId.includes('mixtral');
          hasVision = lowerId.includes('llava') || lowerId.includes('vision');
          hasReasoning = lowerId.includes('deepseek-r1') || lowerId.includes('reasoning');
          isEmbedding = lowerId.includes('embed');
        }
        
        // If we know it's an embedding-only model (via name heuristic or explicit capability), skip it
        if (isEmbedding) {
          continue;
        }

        // If native capabilities are provided and it explicitly lacks 'completion', it's not a chat model
        if (m.capabilities && Array.isArray(m.capabilities) && !m.capabilities.includes('completion')) {
          continue;
        }

        discovered.push({
          id,
          displayName: id,
          provider: this.id,
          capabilities: {
            streaming: true,
            toolCalling: hasToolCalling,
            vision: hasVision,
            reasoning: hasReasoning,
          }
        });
      }

      return discovered;
    } catch (error: unknown) {
      if (error instanceof Arc1610Error) throw error;
      throw new Arc1610Error(
        ErrorReason.ProviderConnectionFailed,
        `Cannot reach Ollama at ${this.endpoint}. Is Ollama running?`,
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
    // No persistent resources to clean up
  }

  private convertMessages(messages: ChatMessage[]): OllamaMessage[] {
    return messages.map(msg => {
      const ollamaMsg: OllamaMessage = {
        role: msg.role === 'tool' ? 'tool' : msg.role,
        content: msg.content,
      };
      if (msg.toolCalls) {
        ollamaMsg.tool_calls = msg.toolCalls.map(tc => ({
          function: {
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          },
        }));
      }
      return ollamaMsg;
    });
  }
}
