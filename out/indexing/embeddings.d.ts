/**
 * Provider-agnostic embedding subsystem for KODRA.
 *
 * Supports:
 * - LocalTransformersProvider (default, out-of-the-box, zero setup via Transformers.js)
 * - OllamaEmbeddingProvider (configurable for local Ollama users)
 * - FallbackEmbeddingProvider (pure in-memory n-gram hashing as last resort)
 *
 * Architecture rules:
 * - Provider-agnostic: CodebaseIndexer interacts ONLY with IEmbeddingProvider
 * - Default provider is LOCAL (no Ollama, no model pull, no API keys needed)
 * - Dimensions are NEVER hardcoded — dynamically extracted from model output
 * - Real download progress tracking & graceful offline handling
 */
import { EmbeddingConfig } from './types';
/** Download / loading progress emitted by embedding provider during initialization. */
export interface EmbeddingDownloadProgress {
    stage: 'downloading' | 'loading' | 'ready';
    loadedBytes?: number;
    totalBytes?: number;
    percent?: number;
    message?: string;
}
/** Unified interface for all embedding providers. */
export interface IEmbeddingProvider {
    /** Provider identifier, e.g. 'local', 'ollama', 'fallback' */
    readonly providerId: string;
    /** Full composite model identifier (used in index metadata to detect changes) */
    readonly modelId: string;
    /** Name of the model without provider prefix */
    readonly modelName: string;
    /** Vector dimension produced by this model */
    readonly dimensions: number;
    /** Initialize the provider (e.g. acquire model weights, verify connection) */
    initialize(onProgress?: (p: EmbeddingDownloadProgress) => void): Promise<void>;
    /**
     * Embed a batch of texts into vectors.
     * Returns one normalized vector per input text, in the exact same order.
     */
    embed(texts: string[]): Promise<number[][]>;
    /** Clean up resources */
    dispose(): void;
}
/**
 * Local in-process embedding provider powered by Transformers.js.
 * Runs completely locally within Node.js without requiring external daemons or API keys.
 * Uses 8-bit quantized all-MiniLM-L6-v2 (~23MB ONNX model) producing 384-dimensional vectors.
 */
export declare class LocalTransformersProvider implements IEmbeddingProvider {
    readonly providerId = "local";
    readonly modelName: string;
    readonly modelId: string;
    private _dimensions;
    private pipelineInstance;
    private isInitializing;
    private initPromise;
    private readonly huggingFaceModelId;
    private readonly cacheDir;
    constructor(modelName?: string, cacheDir?: string);
    get dimensions(): number;
    /**
     * Initialize model pipeline.
     * Automatically downloads model if missing, with real byte progress reporting.
     * Reuses local cache if present, operating fully offline.
     */
    initialize(onProgress?: (p: EmbeddingDownloadProgress) => void): Promise<void>;
    embed(texts: string[]): Promise<number[][]>;
    dispose(): void;
}
/**
 * Ollama-based embedding provider.
 * Connects to Ollama's /api/embed endpoint.
 * Detects vector dimension dynamically on initialization.
 */
export declare class OllamaEmbeddingProvider implements IEmbeddingProvider {
    readonly providerId = "ollama";
    readonly modelName: string;
    readonly modelId: string;
    private readonly endpoint;
    private _dimensions;
    private initialized;
    constructor(endpoint?: string, model?: string, dimensions?: number);
    get dimensions(): number;
    initialize(onProgress?: (p: EmbeddingDownloadProgress) => void): Promise<void>;
    embed(texts: string[]): Promise<number[][]>;
    private executeEmbed;
    dispose(): void;
}
/**
 * Fallback character n-gram hashing provider.
 * Used only as emergency fallback when all models/providers fail.
 */
export declare class FallbackEmbeddingProvider implements IEmbeddingProvider {
    readonly providerId = "fallback";
    readonly modelName = "ngram-hash";
    readonly modelId = "fallback:ngram-hash";
    readonly dimensions = 256;
    initialize(): Promise<void>;
    embed(texts: string[]): Promise<number[][]>;
    private hashEmbed;
    dispose(): void;
}
/**
 * Factory for creating embedding providers based on configuration.
 * Default provider is LOCAL ('all-MiniLM-L6-v2').
 */
export declare function createEmbeddingProvider(config?: Partial<EmbeddingConfig>, storagePath?: string): IEmbeddingProvider;
//# sourceMappingURL=embeddings.d.ts.map