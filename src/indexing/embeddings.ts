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

import { KodraError, ErrorReason } from '../utils/errors';
import { Logger } from '../utils/logger';

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
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;

  constructor(
    private readonly endpoint: string = 'http://127.0.0.1:11434',
    private readonly model: string = 'nomic-embed-text',
    dimensions: number = 768,
  ) {
    this.modelId = `ollama:${model}`;
    this.dimensions = dimensions;
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) { return []; }

    const logger = Logger.getInstance();
    const batchSize = 32; // Process in batches to avoid overwhelming Ollama
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      try {
        const response = await fetch(`${this.endpoint}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            input: batch,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          if (response.status === 404) {
            throw new KodraError(
              ErrorReason.EmbeddingFailed,
              `Embedding model "${this.model}" not found. Run: ollama pull ${this.model}`,
            );
          }
          throw new KodraError(
            ErrorReason.EmbeddingFailed,
            `Ollama embedding error ${response.status}: ${errorBody.slice(0, 200)}`,
          );
        }

        const data = await response.json() as { embeddings: number[][] };
        if (!data.embeddings || data.embeddings.length !== batch.length) {
          throw new KodraError(
            ErrorReason.EmbeddingFailed,
            `Unexpected embeddings response: expected ${batch.length} vectors, got ${data.embeddings?.length ?? 0}`,
          );
        }

        allEmbeddings.push(...data.embeddings);
      } catch (error: unknown) {
        if (error instanceof KodraError) { throw error; }
        throw new KodraError(
          ErrorReason.EmbeddingFailed,
          `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined,
        );
      }

      logger.debug(`Embedded batch ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
    }

    return allEmbeddings;
  }

  dispose(): void {
    // No persistent resources
  }
}

/**
 * Simple TF-IDF-like fallback embedding for when no embedding model is available.
 * This produces low-quality embeddings but ensures the system works without
 * requiring the user to install an embedding model.
 * 
 * Uses character n-gram hashing to produce fixed-dimension vectors.
 */
export class FallbackEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId = 'fallback:ngram-hash';
  readonly dimensions = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.hashEmbed(text));
  }

  private hashEmbed(text: string): number[] {
    const vector = new Float64Array(this.dimensions);
    const normalized = text.toLowerCase();

    // Character trigram hashing
    for (let i = 0; i < normalized.length - 2; i++) {
      const trigram = normalized.substring(i, i + 3);
      let hash = 0;
      for (let j = 0; j < trigram.length; j++) {
        hash = ((hash << 5) - hash) + trigram.charCodeAt(j);
        hash = hash & hash; // Convert to 32-bit integer
      }
      const idx = Math.abs(hash) % this.dimensions;
      vector[idx] += 1;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] /= norm;
      }
    }

    return Array.from(vector);
  }

  dispose(): void {}
}
