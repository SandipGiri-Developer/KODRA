/**
 * Provider Registry — Factory for creating and managing LLM providers.
 * 
 * Reads configuration from VS Code settings and SecretStorage,
 * instantiates the appropriate provider, and caches it for reuse.
 */

import * as vscode from 'vscode';
import { KodraError, ErrorReason } from '../utils/errors';
import { Logger } from '../utils/logger';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { DiscoveredModel, ILLMProvider, ProviderConfig, ModelCapabilities } from './types';
import { SettingsManager } from '../utils/settingsManager';

export class ProviderRegistry {
  private currentProvider: ILLMProvider | null = null;
  private currentConfig: ProviderConfig | null = null;
  private discoveredModelsCache: Map<string, DiscoveredModel[]> = new Map();
  /**
   * Stable capabilities cache keyed by "provider:modelId".
   * Survives provider recreation and is not cleared on config changes.
   * Populated lazily or via warmCapabilities().
   */
  private capabilitiesCache: Map<string, ModelCapabilities> = new Map();

  constructor(private readonly secretStorage: vscode.SecretStorage) {}

  /**
   * Get the current provider, creating it if necessary.
   * Re-creates the provider if configuration has changed.
   */
  async getProvider(): Promise<ILLMProvider> {
    const config = await this.readConfig();

    // Check if we need to recreate the provider
    if (this.currentProvider && this.currentConfig &&
        this.configsMatch(this.currentConfig, config)) {
      return this.currentProvider;
    }

    // Dispose old provider
    this.currentProvider?.dispose();
    this.currentProvider = null;

    // Create new provider
    this.currentProvider = await this.createProvider(config);
    this.currentConfig = config;

    Logger.getInstance().info(`Provider initialized: ${this.currentProvider.displayName}`);
    return this.currentProvider;
  }

  /**
   * Read provider configuration from SettingsManager or legacy VS Code settings.
   */
  async readConfig(): Promise<ProviderConfig> {
    const settings = vscode.workspace.getConfiguration('KODRA');
    const modelName = settings.get<string>('modelName', '');
    const maxTokens = settings.get<number>('maxTokens', 4096);
    let provider = settings.get<string>('provider', 'ollama');

    let endpoint: string | undefined;
    let apiKey: string | undefined;

    // Try to load from new modular settings architecture first
    try {
      const manager = SettingsManager.getInstance();
      const workspaceModels = await manager.getWorkspaceModels();
      const activeModel = workspaceModels.find(m => m.id === modelName);

      if (activeModel) {
        const providers = await manager.getProviders();
        const activeProviderConfig = providers.find(p => p.id === activeModel.providerConfigId);

        if (activeProviderConfig) {
          provider = activeProviderConfig.provider;
          endpoint = activeProviderConfig.endpoint;
          if (activeProviderConfig.apiKeySecret) {
            apiKey = await manager.getApiKey(activeProviderConfig.id);
          }
          return { provider, modelName, endpoint, apiKey, maxTokens };
        }
      }
    } catch (e) {
      Logger.getInstance().warn('Failed to load from modular settings, falling back to legacy', e);
    }

    // Fallback to legacy settings
    switch (provider) {
      case 'ollama':
        endpoint = settings.get<string>('ollama.endpoint', 'http://127.0.0.1:11434');
        break;
      case 'openai':
        endpoint = settings.get<string>('openai.baseUrl', 'https://api.openai.com/v1');
        apiKey = await this.secretStorage.get('KODRA.openai.apiKey');
        break;
      case 'anthropic':
        apiKey = await this.secretStorage.get('KODRA.anthropic.apiKey');
        break;
      case 'gemini':
        endpoint = settings.get<string>('gemini.endpoint', 'https://generativelanguage.googleapis.com/v1beta');
        apiKey = await this.secretStorage.get('KODRA.gemini.apiKey');
        break;
    }

    return { provider, modelName, endpoint, apiKey, maxTokens };
  }

  /**
   * Dynamically discover available models for a given provider.
   * Creates a temporary provider instance to perform the discovery.
   */
  async discoverModels(
    providerName: string,
    apiKey?: string,
    endpoint?: string
  ): Promise<DiscoveredModel[]> {
    // If key/endpoint not provided in the request, fall back to stored config
    if (!apiKey || !endpoint) {
      const config = await this.readConfig();
      // Only use stored config if it matches the requested provider
      if (config.provider === providerName) {
        if (!apiKey) apiKey = config.apiKey;
        if (!endpoint) endpoint = config.endpoint;
      } else {
        // We're querying a different provider, get its specific settings
        if (!apiKey) apiKey = await this.secretStorage.get(`KODRA.${providerName}.apiKey`);
        if (!endpoint) {
          const settings = vscode.workspace.getConfiguration('KODRA');
          if (providerName === 'ollama') endpoint = settings.get<string>('ollama.endpoint', 'http://127.0.0.1:11434');
          if (providerName === 'openai') endpoint = settings.get<string>('openai.baseUrl', 'https://api.openai.com/v1');
          if (providerName === 'gemini') endpoint = settings.get<string>('gemini.endpoint', 'https://generativelanguage.googleapis.com/v1beta');
        }
      }
    }

    // Create a temporary configuration for discovery
    const tempConfig: ProviderConfig = {
      provider: providerName,
      modelName: '', // not needed for discovery
      apiKey,
      endpoint,
      maxTokens: 10,
    };

    const provider = await this.createProvider(tempConfig);
    try {
      const models = await provider.discoverModels();
      this.discoveredModelsCache.set(providerName, models);
      return models;
    } finally {
      provider.dispose();
    }
  }

  /**
   * Get the capabilities of a specific model.
   * 
   * Uses a stable in-process cache keyed by "provider:modelId" so that
   * discoverModels() is NEVER called during a chat request. The cache is
   * pre-populated by warmCapabilities() which should be called once after
   * provider setup, or lazily on first call (accepting the one-time cost).
   */
  async getModelCapabilities(providerName: string, modelId: string): Promise<ModelCapabilities | undefined> {
    const cacheKey = `${providerName}:${modelId}`;

    // Fast path — return from stable cache
    if (this.capabilitiesCache.has(cacheKey)) {
      return this.capabilitiesCache.get(cacheKey);
    }

    // Use in-session discovered models cache if already populated
    let models = this.discoveredModelsCache.get(providerName);
    if (models && models.length > 0) {
      const caps = models.find(m => m.id === modelId)?.capabilities;
      if (caps) {
        this.capabilitiesCache.set(cacheKey, caps);
        return caps;
      }
    }

    // Lazy populate — discover once and cache for the session
    try {
      models = await this.discoverModels(providerName);
      const caps = models.find(m => m.id === modelId)?.capabilities;
      if (caps) {
        this.capabilitiesCache.set(cacheKey, caps);
      }
      return caps;
    } catch {
      return undefined;
    }
  }

  /**
   * Pre-warm the capabilities cache for the current provider and model.
   * Call this after provider configuration is changed (not per-request).
   * Fire-and-forget — errors are silently ignored.
   */
  async warmCapabilities(): Promise<void> {
    try {
      const config = await this.readConfig();
      if (config.provider && config.modelName) {
        await this.getModelCapabilities(config.provider, config.modelName);
      }
    } catch {
      // Non-critical — capabilities will be lazily fetched later
    }
  }

  /**
   * Store an API key securely in SecretStorage.
   */
  async setApiKey(provider: string, key: string): Promise<void> {
    await this.secretStorage.store(`KODRA.${provider}.apiKey`, key);
    // Force provider recreation on next use
    this.currentProvider?.dispose();
    this.currentProvider = null;
    this.currentConfig = null;
    Logger.getInstance().info(`API key stored for provider: ${provider}`);
  }

  /**
   * Delete a stored API key.
   */
  async deleteApiKey(provider: string): Promise<void> {
    await this.secretStorage.delete(`KODRA.${provider}.apiKey`);
    this.currentProvider?.dispose();
    this.currentProvider = null;
    this.currentConfig = null;
  }

  /**
   * Interactively configure an API key for a provider.
   */
  async promptForApiKey(provider: string): Promise<boolean> {
    const providerNames: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      gemini: 'Google Gemini',
    };

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${providerNames[provider] || provider} API key`,
      password: true,
      placeHolder: 'sk-...',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length < 10) {
          return 'API key seems too short. Please enter a valid key.';
        }
        return null;
      },
    });

    if (key) {
      await this.setApiKey(provider, key.trim());
      return true;
    }
    return false;
  }

  /**
   * Get the list of supported provider IDs.
   */
  getSupportedProviders(): string[] {
    return ['ollama', 'openai', 'anthropic', 'gemini'];
  }

  dispose(): void {
    this.currentProvider?.dispose();
    this.currentProvider = null;
  }

  private async createProvider(config: ProviderConfig): Promise<ILLMProvider> {
    switch (config.provider) {
      case 'ollama':
        return new OllamaProvider(config.endpoint);

      case 'openai': {
        if (!config.apiKey) {
          throw new KodraError(
            ErrorReason.ProviderNotConfigured,
            'OpenAI API key not configured. Use "Kodra: Configure AI Provider" to set it up.',
          );
        }
        return new OpenAIProvider(config.apiKey, config.endpoint);
      }

      case 'anthropic': {
        if (!config.apiKey) {
          throw new KodraError(
            ErrorReason.ProviderNotConfigured,
            'Anthropic API key not configured. Use "Kodra: Configure AI Provider" to set it up.',
          );
        }
        return new AnthropicProvider(config.apiKey);
      }

      case 'gemini': {
        if (!config.apiKey) {
          throw new KodraError(
            ErrorReason.ProviderNotConfigured,
            'Google Gemini API key not configured. Use "Kodra: Configure AI Provider" to set it up.',
          );
        }
        return new GeminiProvider(config.apiKey, config.endpoint);
      }

      default:
        throw new KodraError(
          ErrorReason.ConfigInvalid,
          `Unknown provider: "${config.provider}". Supported providers: ollama, openai, anthropic, gemini.`,
        );
    }
  }

  private configsMatch(a: ProviderConfig, b: ProviderConfig): boolean {
    return a.provider === b.provider
      && a.modelName === b.modelName
      && a.endpoint === b.endpoint
      && a.apiKey === b.apiKey
      && a.maxTokens === b.maxTokens;
  }
}
