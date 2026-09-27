/**
 * Embedding provider interface and simple local implementation.
 *
 * KODRA uses BaseLLM for embeddings with multiple providers.
 * For KODRA v1.0, we provide:
 * 1. A simple local embeddings approach using the provider's embed endpoint
 * 2. An interface for future expansion (TransformersJS, OpenAI embeddings, etc.)
 *
 * The embedding vector dimensions must stay consistent within an index —
 * changing the model requires a full re-index.
 */
/** Interface for embedding text into vectors. */
export interface IEmbeddingProvider {
    /** Unique identifier for this embedding model (used to detect model changes) */
    readonly modelId: string;
    /** Vector dimension for this model */
    readonly dimensions: number;
    /**
     * Embed a batch of texts into vectors.
     * Returns one vector per input text, in the same order.
     */
    embed(texts: string[]): Promise<number[][]>;
    /** Clean up resources. */
    dispose(): void;
}
/**
 * Ollama-based embedding provider.
 * Uses Ollama's /api/embed endpoint with a specified model.
 */
export declare class OllamaEmbeddingProvider implements IEmbeddingProvider {
    private readonly endpoint;
    private readonly model;
    readonly modelId: string;
    readonly dimensions: number;
    constructor(endpoint?: string, model?: string, dimensions?: number);
    embed(texts: string[]): Promise<number[][]>;
    dispose(): void;
}
/**
 * Simple TF-IDF-like fallback embedding for when no embedding model is available.
 * This produces low-quality embeddings but ensures the system works without
 * requiring the user to install an embedding model.
 *
 * Uses character n-gram hashing to produce fixed-dimension vectors.
 */
export declare class FallbackEmbeddingProvider implements IEmbeddingProvider {
    readonly modelId = "fallback:ngram-hash";
    readonly dimensions = 256;
    embed(texts: string[]): Promise<number[][]>;
    private hashEmbed;
    dispose(): void;
}
//# sourceMappingURL=embeddings.d.ts.map