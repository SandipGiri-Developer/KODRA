/**
 * Anthropic Claude LLM Provider.
 *
 * Uses the Anthropic Messages API with streaming.
 * Claude has its own message format and tool-calling convention.
 * Users must provide their own API key.
 */
import { ChatMessage, CompletionOptions, ILLMProvider, ProviderCapabilities, StreamChunk, DiscoveredModel } from './types';
export declare class AnthropicProvider implements ILLMProvider {
    private apiKey;
    readonly id = "anthropic";
    readonly displayName = "Anthropic Claude";
    readonly capabilities: ProviderCapabilities;
    private readonly baseUrl;
    constructor(apiKey: string);
    streamChat(messages: ChatMessage[], options: CompletionOptions): AsyncGenerator<StreamChunk>;
    discoverModels(): Promise<DiscoveredModel[]>;
    testConnection(): Promise<string[]>;
    getDefaultModel(): string;
    dispose(): void;
    private convertMessages;
    private handleHttpError;
}
//# sourceMappingURL=anthropic.d.ts.map