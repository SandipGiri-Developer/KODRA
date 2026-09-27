/**
 * OpenAI LLM Provider.
 * Connects to OpenAI's API (or any OpenAI-compatible endpoint).
 *
 * Uses the Chat Completions API with streaming and tool/function calling.
 * Users must provide their own API key — KODRA does not include one.
 */
import { ChatMessage, CompletionOptions, ILLMProvider, ProviderCapabilities, StreamChunk, DiscoveredModel } from './types';
export declare class OpenAIProvider implements ILLMProvider {
    private apiKey;
    private baseUrl;
    readonly id = "openai";
    readonly displayName = "OpenAI";
    readonly capabilities: ProviderCapabilities;
    constructor(apiKey: string, baseUrl?: string);
    streamChat(messages: ChatMessage[], options: CompletionOptions): AsyncGenerator<StreamChunk>;
    discoverModels(): Promise<DiscoveredModel[]>;
    testConnection(): Promise<string[]>;
    getDefaultModel(): string;
    dispose(): void;
    private convertMessages;
    private handleHttpError;
}
//# sourceMappingURL=openai.d.ts.map