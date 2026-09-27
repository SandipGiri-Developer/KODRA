/**
 * Vector store for KODRA codebase indexing.
 * 
 * Uses a simple JSON-based vector storage with cosine similarity search.
 * Inspired by KODRA's LanceDbIndex.ts pattern but uses a pure-TypeScript
 * approach for cross-platform compatibility (no native dependencies).
 * 
 * Storage format: JSON files in the .KODRA/ directory within the workspace.
 * Each entry stores: id, filepath, content, startLine, endLine, digest, vector.
 * 
 * For v1.0 this is intentionally simple. Can migrate to LanceDB, SQLite+vectors,
 * or vectra in a future version if performance requires it.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { Chunk, SearchResult } from './types';

interface VectorEntry {
  id: string;
  filepath: string;
  content: string;
  startLine: number;
  endLine: number;
  digest: string;
  vector: number[];
}

interface IndexMetadata {
  version: number;
  embeddingModelId: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
}

const INDEX_VERSION = 1;
const INDEX_DIR_NAME = '.KODRA';
const VECTORS_FILE = 'vectors.json';
const METADATA_FILE = 'metadata.json';

export class VectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  private indexDir: string;
  private dirty = false;
  private metadata: IndexMetadata | null = null;

  constructor(private readonly workspaceRoot: string) {
    this.indexDir = path.join(workspaceRoot, INDEX_DIR_NAME);
  }

  /**
   * Load the index from disk.
   * Returns true if an existing index was loaded, false if starting fresh.
   */
  async load(expectedModelId: string): Promise<boolean> {
    const logger = Logger.getInstance();

    try {
      await fs.mkdir(this.indexDir, { recursive: true });

      // Check metadata
      const metadataPath = path.join(this.indexDir, METADATA_FILE);
      try {
        const metaContent = await fs.readFile(metadataPath, 'utf-8');
        this.metadata = JSON.parse(metaContent) as IndexMetadata;

        // Check if the embedding model changed — requires full re-index
        if (this.metadata.embeddingModelId !== expectedModelId) {
          logger.warn(
            `Embedding model changed: ${this.metadata.embeddingModelId} → ${expectedModelId}. Re-indexing required.`,
          );
          await this.clear();
          return false;
        }

        // Check version compatibility
        if (this.metadata.version !== INDEX_VERSION) {
          logger.warn(`Index version mismatch. Re-indexing required.`);
          await this.clear();
          return false;
        }
      } catch {
        // No metadata file — fresh index
        return false;
      }

      // Load vectors
      const vectorsPath = path.join(this.indexDir, VECTORS_FILE);
      try {
        const content = await fs.readFile(vectorsPath, 'utf-8');
        const entries = JSON.parse(content) as VectorEntry[];
        this.entries.clear();
        for (const entry of entries) {
          this.entries.set(entry.id, entry);
        }
        logger.info(`Loaded ${this.entries.size} vectors from index`);
        return true;
      } catch {
        return false;
      }
    } catch (error) {
      logger.error('Failed to load vector index', error);
      return false;
    }
  }

  /**
   * Save the index to disk (if dirty).
   */
  async save(embeddingModelId: string): Promise<void> {
    if (!this.dirty && this.metadata) {
      return;
    }

    const logger = Logger.getInstance();

    try {
      await fs.mkdir(this.indexDir, { recursive: true });

      // Write vectors
      const entries = Array.from(this.entries.values());
      const vectorsPath = path.join(this.indexDir, VECTORS_FILE);
      await fs.writeFile(vectorsPath, JSON.stringify(entries), 'utf-8');

      // Write metadata
      this.metadata = {
        version: INDEX_VERSION,
        embeddingModelId,
        createdAt: this.metadata?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entryCount: entries.length,
      };
      const metadataPath = path.join(this.indexDir, METADATA_FILE);
      await fs.writeFile(metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');

      this.dirty = false;
      logger.info(`Saved ${entries.length} vectors to index`);
    } catch (error) {
      logger.error('Failed to save vector index', error);
      throw error;
    }
  }

  /**
   * Add or update entries in the store.
   */
  addEntries(chunks: Chunk[], vectors: number[][]): void {
    if (chunks.length !== vectors.length) {
      throw new Error(`Chunk count (${chunks.length}) doesn't match vector count (${vectors.length})`);
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      this.entries.set(chunk.id, {
        id: chunk.id,
        filepath: chunk.filepath,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        digest: chunk.digest,
        vector: vectors[i],
      });
    }
    this.dirty = true;
  }

  /**
   * Remove all entries for a given file path.
   */
  removeByFilepath(filepath: string): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.filepath === filepath) {
        this.entries.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.dirty = true;
    }
    return removed;
  }

  /**
   * Remove entries by their IDs.
   */
  removeByIds(ids: string[]): void {
    for (const id of ids) {
      this.entries.delete(id);
    }
    if (ids.length > 0) {
      this.dirty = true;
    }
  }

  /**
   * Search for the most similar chunks to a query vector.
   * Uses cosine similarity.
   */
  search(queryVector: number[], topK: number = 10, minScore: number = 0.0): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      const score = cosineSimilarity(queryVector, entry.vector);
      if (score >= minScore) {
        results.push({
          chunk: {
            id: entry.id,
            filepath: entry.filepath,
            content: entry.content,
            startLine: entry.startLine,
            endLine: entry.endLine,
            digest: entry.digest,
            index: 0,
          },
          score,
        });
      }
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Get all indexed file paths.
   */
  getIndexedFiles(): Set<string> {
    const files = new Set<string>();
    for (const entry of this.entries.values()) {
      files.add(entry.filepath);
    }
    return files;
  }

  /**
   * Get the digest (content hash) for a file, if indexed.
   */
  getFileDigest(filepath: string): string | undefined {
    for (const entry of this.entries.values()) {
      if (entry.filepath === filepath) {
        return entry.digest;
      }
    }
    return undefined;
  }

  /**
   * Get the total number of entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear the entire index.
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.metadata = null;
    this.dirty = false;

    try {
      const vectorsPath = path.join(this.indexDir, VECTORS_FILE);
      const metadataPath = path.join(this.indexDir, METADATA_FILE);
      await fs.unlink(vectorsPath).catch(() => {});
      await fs.unlink(metadataPath).catch(() => {});
    } catch {
      // Best effort cleanup
    }
  }

  dispose(): void {
    this.entries.clear();
  }
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}
