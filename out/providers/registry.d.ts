/**
 * Provider Registry — Factory for creating and managing LLM providers.
 *
 * Reads configuration from VS Code settings and SecretStorage,
 * instantiates the appropriate provider, and caches it for reuse.
 */
import * as vscode from 'vscode';
import { DiscoveredModel, ILLMProvider, ProviderConfig, ModelCapabilities, ProviderFactory } from './types';
export declare class ProviderRegistry {
    private readonly secretStorage;
    private currentProvider;
    private currentConfig;
    private discoveredModelsCache;
    /**
     * Stable capabilities cache keyed by "provider:modelId".
     * Survives provider recreation and is not cleared on config changes.
     * Populated lazily or via warmCapabilities().
     */
    private capabilitiesCache;
    private readonly factories;
    constructor(secretStorage: vscode.SecretStorage);
    private registerBuiltinProviders;
    /**
     * Register a new provider factory dynamically.
     */
    registerProvider(providerId: string, factory: ProviderFactory): void;
    /**
     * Unregister a provider factory.
     */
    unregisterProvider(providerId: string): boolean;
    /**
     * Check if a provider is registered.
     */
    hasProvider(providerId: string): boolean;
    /**
     * Get the current provider, creating it if necessary.
     * Re-creates the provider if configuration has changed.
     */
    getProvider(): Promise<ILLMProvider>;
    /**
     * Read provider configuration from SettingsManager or legacy VS Code settings.
     */
    readConfig(): Promise<ProviderConfig>;
    /**
     * Dynamically discover available models for a given provider.
     * Creates a temporary provider instance to perform the discovery.
     */
    discoverModels(providerName: string, apiKey?: string, endpoint?: string): Promise<DiscoveredModel[]>;
    /**
     * Get the capabilities of a specific model.
     *
     * Uses a stable in-process cache keyed by "provider:modelId" so that
     * discoverModels() is NEVER called during a chat request. The cache is
     * pre-populated by warmCapabilities() which should be called once after
     * provider setup, or lazily on first call (accepting the one-time cost).
     */
    getModelCapabilities(providerName: string, modelId: string): Promise<ModelCapabilities | undefined>;
    /**
     * Pre-warm the capabilities cache for the current provider and model.
     * Call this after provider configuration is changed (not per-request).
     * Fire-and-forget — errors are silently ignored.
     */
    warmCapabilities(): Promise<void>;
    /**
     * Store an API key securely in SecretStorage.
     */
    setApiKey(provider: string, key: string): Promise<void>;
    /**
     * Delete a stored API key.
     */
    deleteApiKey(provider: string): Promise<void>;
    /**
     * Interactively configure an API key for a provider.
     */
    promptForApiKey(provider: string): Promise<boolean>;
    /**
     * Get the list of supported provider IDs.
     */
    getSupportedProviders(): string[];
    dispose(): void;
    private createProvider;
    private configsMatch;
}
//# sourceMappingURL=registry.d.ts.map