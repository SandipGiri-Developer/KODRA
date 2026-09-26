/**
 * LLM Provider abstraction for ARC1610.
 * 
 * Inspired by ARC's BaseLLM interface but simplified for the first release.
 * Each provider implements streaming chat completion with tool support where available.
 */

/** A single message in a conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For tool result messages */
  toolCallId?: string;
  /** Tool calls requested by the assistant */
  toolCalls?: ToolCall[];
}

/** A tool call request from the model. */
export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** A tool definition to provide to the model. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** A single streamed chunk from the model. */
export interface StreamChunk {
  /** Text content delta */
  content?: string;
  /** Tool call deltas */
  toolCalls?: Partial<ToolCall>[];
  /** Whether this is the final chunk */
  done?: boolean;
  /** Token usage info (available on final chunk for some providers) */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Options for a completion request. */
export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/** Provider capability flags. */
export interface ProviderCapabilities {
  /** Whether this provider supports streaming */
  streaming: boolean;
  /** Whether this provider supports tool/function calling */
  toolCalling: boolean;
  /** Whether this provider supports vision/image input */
  vision: boolean;
}

/** Model capability flags for a specific model (not just the provider). */
export interface ModelCapabilities {
  /** Whether this model supports streaming */
  streaming: boolean;
  /** Whether this model supports tool/function calling */
  toolCalling: boolean;
  /** Whether this model supports vision/image input */
  vision: boolean;
  /** Whether this model is known to have advanced reasoning capabilities */
  reasoning: boolean;
}

/** Information about a model discovered from the provider. */
export interface DiscoveredModel {
  /** Unique model identifier for API calls (e.g., 'gpt-4o', 'gemini-1.5-pro') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Provider identifier (e.g., 'openai', 'ollama') */
  provider: string;
  /** Detected capabilities for this specific model */
  capabilities: ModelCapabilities;
  /** Context window length in tokens, if known */
  contextLength?: number;
}

/**
 * The core LLM provider interface.
 * All providers must implement this to work with ARC1610's agent loop.
 */
export interface ILLMProvider {
  /** Unique provider identifier (e.g., 'ollama', 'openai', 'anthropic', 'gemini') */
  readonly id: string;
  /** Human-readable provider name */
  readonly displayName: string;
  /** General provider capabilities (defaults) */
  readonly capabilities: ProviderCapabilities;

  /**
   * Stream a chat completion.
   * Yields chunks as they arrive from the provider.
   * The final chunk should have `done: true`.
   */
  streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Discover available models from this provider.
   * Returns a detailed list of models and their capabilities.
   */
  discoverModels(): Promise<DiscoveredModel[]>;

  /**
   * Verify the provider is reachable and properly configured.
   * Returns a list of available models or throws on failure.
   */
  testConnection(): Promise<string[]>;

  /**
   * Get the default model for this provider.
   * @deprecated Use dynamic discovery instead.
   */
  getDefaultModel(): string;

  /**
   * Clean up provider resources.
   */
  dispose(): void;
}


/**
 * Provider configuration, read from VS Code settings and SecretStorage.
 * @deprecated Use ProviderSettings instead.
 */
export interface ProviderConfig {
  provider: string;
  modelName: string;
  endpoint?: string;
  apiKey?: string;
  maxTokens: number;
}

/**
 * Modern provider settings to support multiple stored configurations.
 */
export interface ProviderSettings {
  id: string; // unique ID for this configuration (e.g. 'gemini-1')
  name: string; // user-friendly name (e.g. 'My Gemini Key')
  provider: string; // 'ollama', 'gemini', 'openai', 'anthropic'
  endpoint?: string;
  apiKeySecret?: boolean; // Indicates if an API key is stored in SecretStorage for this config
}

/**
 * Models explicitly added to the workspace.
 */
export interface WorkspaceModel {
  id: string; // Matches DiscoveredModel.id
  displayName: string;
  providerConfigId: string; // Matches ProviderSettings.id
  provider: string; // Base provider string (e.g. 'ollama')
  capabilities: ModelCapabilities;
  contextLength?: number;
}
