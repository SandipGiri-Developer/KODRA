/**
 * Ollama LLM Provider.
 * Connects to a local Ollama instance for private, free inference.
 *
 * Uses Ollama's native /api/chat endpoint with streaming.
 * Supports tool calling for models that support it (e.g., llama3.1+, mistral, qwen2.5+).
 */
import { ChatMessage, CompletionOptions, ILLMProvider, ProviderCapabilities, StreamChunk, DiscoveredModel } from './types';
export declare class OllamaProvider implements ILLMProvider {
    private endpoint;
    readonly id = "ollama";
    readonly displayName = "Ollama (Local)";
    readonly capabilities: ProviderCapabilities;
    constructor(endpoint?: string);
    streamChat(messages: ChatMessage[], options: CompletionOptions): AsyncGenerator<StreamChunk>;
    discoverModels(): Promise<DiscoveredModel[]>;
    testConnection(): Promise<string[]>;
    getDefaultModel(): string;
    dispose(): void;
    private convertMessages;
}
//# sourceMappingURL=ollama.d.ts.map