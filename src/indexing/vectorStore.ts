/**
 * Vector store for KODRA codebase indexing.
 * 
 * Powered by Vectra (LocalIndex) with an in-memory acceleration layer for
 * low-latency search and content-addressable chunk caching.
 * 
 * Separation of Concerns:
 * - Embedding generation (IEmbeddingProvider)
 * - Index management (CodebaseIndexer)
 * - Vector storage & similarity (VectorStore / Vectra)
 * - Retrieval & scoring (VectorStore.search)
 * 
 * Key Features:
 * - Dynamic dimension support (never hardcoded)
 * - Content-addressable chunk hash map for instantaneous vector reuse
 * - Automated index compatibility verification (detects model / dimension mismatch)
 * - Safe index rebuilding on incompatible configuration
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { LocalIndex } from 'vectra';
import { Logger } from '../utils/logger';
import { Chunk, IndexMetadata, SearchResult } from './types';

export interface VectorEntry {
  id: string;
  filepath: string;
  content: string;
  startLine: number;
  endLine: number;
  digest: string;
  chunkHash: string;
  index: number;
  vector: number[];
}

const CURRENT_SCHEMA_VERSION = 2;
const INDEX_DIR_NAME = '.KODRA';
const METADATA_FILE = 'metadata.json';
const VECTRA_SUBDIR = 'vectra_index';

export interface IVectorStore {
  readonly size: number;
  load(expectedModelId: string, expectedDimensions?: number): Promise<boolean>;
  save(embeddingModelId: string, dimensions?: number, provider?: string): Promise<void>;
  addEntries(chunks: Chunk[], vectors: number[][]): void;
  removeByFilepath(filepath: string): number;
  removeByIds(ids: string[]): void;
  search(queryVector: number[], topK?: number, minScore?: number): SearchResult[];
  getIndexedFiles(): Set<string>;
  getFileDigest(filepath: string): string | undefined;
  getVectorByChunkHash(chunkHash: string): number[] | undefined;
  getChunkByHash(chunkHash: string): { chunk: Chunk; vector: number[] } | undefined;
  getMetadata(): IndexMetadata | null;
  clear(): Promise<void>;
  dispose(): void;
}

export class VectorStore implements IVectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  /** Mapping from sha256(chunkContent) -> vector for instantaneous reuse */
  private chunkHashMap: Map<string, number[]> = new Map();
  private indexDir: string;
  private vectraDir: string;
  private dirty = false;
  private metadata: IndexMetadata | null = null;
  private localIndex: LocalIndex | null = null;

  constructor(private readonly workspaceRoot: string) {
    this.indexDir = path.join(workspaceRoot, INDEX_DIR_NAME);
    this.vectraDir = path.join(this.indexDir, VECTRA_SUBDIR);
  }

  /**
   * Load the index from disk.
   * Automatically validates embedding model and dimension compatibility.
   * Returns true if existing compatible index was loaded, false if starting fresh.
   */
  async load(expectedModelId: string, expectedDimensions?: number): Promise<boolean> {
    const logger = Logger.getInstance();

    try {
      await fs.mkdir(this.indexDir, { recursive: true });

      const metadataPath = path.join(this.indexDir, METADATA_FILE);
      try {
        const metaContent = await fs.readFile(metadataPath, 'utf-8');
        this.metadata = JSON.parse(metaContent) as IndexMetadata;

        // Check if embedding model changed
        const modelMismatch = this.metadata.embeddingModelId !== expectedModelId;
        // Check if vector dimensions changed
        const dimMismatch =
          expectedDimensions !== undefined &&
          this.metadata.dimensions !== undefined &&
          this.metadata.dimensions !== expectedDimensions;

        if (modelMismatch || dimMismatch) {
          logger.warn(
            `Index incompatible: ${this.metadata.embeddingModelId} (${this.metadata.dimensions ?? 'unknown'}d) ` +
            `→ ${expectedModelId} (${expectedDimensions ?? 'unknown'}d). Rebuilding index safely.`,
          );
          await this.clear();
          return false;
        }
      } catch {
        // No metadata file — fresh index required
        return false;
      }

      // Initialize Vectra index
      this.localIndex = new LocalIndex(this.vectraDir);
      const isCreated = await this.localIndex.isIndexCreated();

      this.entries.clear();
      this.chunkHashMap.clear();

      if (isCreated) {
        try {
          const items = await this.localIndex.listItems();
          for (const item of items) {
            const meta = item.metadata as any;
            const entry: VectorEntry = {
              id: item.id,
              filepath: meta.filepath || '',
              content: meta.content || '',
              startLine: meta.startLine ?? 0,
              endLine: meta.endLine ?? 0,
              digest: meta.digest || '',
              chunkHash: meta.chunkHash || this.computeHash(meta.content || ''),
              index: meta.index ?? 0,
              vector: item.vector,
            };
            this.entries.set(entry.id, entry);
            if (entry.chunkHash) {
              this.chunkHashMap.set(entry.chunkHash, entry.vector);
            }
          }
          logger.info(`Loaded ${this.entries.size} vectors from Vectra index`);
          return true;
        } catch (readErr) {
          logger.warn('Failed to parse Vectra index data, attempting legacy fallback', readErr);
        }
      }

      // Legacy fallback: check vectors.json if present
      const legacyVectorsPath = path.join(this.indexDir, 'vectors.json');
      if (fsSync.existsSync(legacyVectorsPath)) {
        try {
          const content = await fs.readFile(legacyVectorsPath, 'utf-8');
          const entries = JSON.parse(content) as any[];
          for (const raw of entries) {
            const entry: VectorEntry = {
              id: raw.id,
              filepath: raw.filepath,
              content: raw.content,
              startLine: raw.startLine,
              endLine: raw.endLine,
              digest: raw.digest,
              chunkHash: raw.chunkHash || this.computeHash(raw.content),
              index: raw.index ?? 0,
              vector: raw.vector,
            };
            this.entries.set(entry.id, entry);
            if (entry.chunkHash) {
              this.chunkHashMap.set(entry.chunkHash, entry.vector);
            }
          }
          logger.info(`Migrated ${this.entries.size} vectors from legacy vectors.json to Vectra`);
          this.dirty = true;
          await this.save(expectedModelId, expectedDimensions);
          return true;
        } catch {
          // legacy corrupted
        }
      }

      return false;
    } catch (error) {
      logger.error('Failed to load vector store', error);
      return false;
    }
  }

  /**
   * Save the index and metadata to disk.
   */
  async save(embeddingModelId: string, dimensions?: number, provider?: string): Promise<void> {
    if (!this.dirty && this.metadata) {
      return;
    }

    const logger = Logger.getInstance();

    try {
      await fs.mkdir(this.indexDir, { recursive: true });
      await fs.mkdir(this.vectraDir, { recursive: true });

      // Initialize or rebuild Vectra index
      if (!this.localIndex) {
        this.localIndex = new LocalIndex(this.vectraDir);
      }

      const isCreated = await this.localIndex.isIndexCreated();
      if (!isCreated) {
        await this.localIndex.createIndex({ version: 1, deleteIfExists: true });
      }

      // Write items to Vectra in an atomic update batch
      await this.localIndex.beginUpdate();
      // Clear existing items in Vectra to mirror current entries
      const existingItems = await this.localIndex.listItems();
      for (const item of existingItems) {
        if (!this.entries.has(item.id)) {
          await this.localIndex.deleteItem(item.id);
        }
      }

      for (const entry of this.entries.values()) {
        await this.localIndex.upsertItem({
          id: entry.id,
          vector: entry.vector,
          metadata: {
            filepath: entry.filepath,
            content: entry.content,
            startLine: entry.startLine,
            endLine: entry.endLine,
            digest: entry.digest,
            chunkHash: entry.chunkHash,
            index: entry.index,
          },
        });
      }
      await this.localIndex.endUpdate();

      // Determine dimension from first vector if not provided
      const firstVec = this.entries.values().next().value?.vector;
      const detectedDimensions: number = dimensions ?? (firstVec?.length ?? 384);

      // Write metadata
      this.metadata = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        version: CURRENT_SCHEMA_VERSION,
        provider: provider || (embeddingModelId.split(':')[0] || 'local'),
        model: embeddingModelId.split(':').slice(1).join(':') || embeddingModelId,
        embeddingModelId,
        dimensions: detectedDimensions,
        createdAt: this.metadata?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entryCount: this.entries.size,
        fileCount: this.getIndexedFiles().size,
      };

      const metadataPath = path.join(this.indexDir, METADATA_FILE);
      await fs.writeFile(metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');

      this.dirty = false;
      logger.info(`Saved ${this.entries.size} vectors to Vectra index (${detectedDimensions}d)`);
    } catch (error) {
      logger.error('Failed to save Vectra vector store', error);
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
      const chunkHash = chunk.chunkHash || this.computeHash(chunk.content);
      const vector = vectors[i];

      this.entries.set(chunk.id, {
        id: chunk.id,
        filepath: chunk.filepath,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        digest: chunk.digest,
        chunkHash,
        index: chunk.index,
        vector,
      });

      this.chunkHashMap.set(chunkHash, vector);
    }
    this.dirty = true;
  }

  /**
   * Look up cached vector by individual chunk content hash.
   * Enables zero-overhead vector reuse for unchanged chunks and moved files.
   */
  getVectorByChunkHash(chunkHash: string): number[] | undefined {
    return this.chunkHashMap.get(chunkHash);
  }

  /**
   * Look up chunk entry and vector by chunk hash.
   */
  getChunkByHash(chunkHash: string): { chunk: Chunk; vector: number[] } | undefined {
    for (const entry of this.entries.values()) {
      if (entry.chunkHash === chunkHash) {
        return {
          chunk: {
            id: entry.id,
            filepath: entry.filepath,
            content: entry.content,
            startLine: entry.startLine,
            endLine: entry.endLine,
            digest: entry.digest,
            chunkHash: entry.chunkHash,
            index: entry.index,
          },
          vector: entry.vector,
        };
      }
    }
    return undefined;
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
   * Search for the most similar chunks to a query vector using cosine similarity.
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
            chunkHash: entry.chunkHash,
            index: entry.index,
          },
          score,
        });
      }
    }

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
   * Get the file digest (content hash) for a file, if indexed.
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
   * Current number of indexed chunks.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get index metadata if loaded.
   */
  getMetadata(): IndexMetadata | null {
    return this.metadata;
  }

  /**
   * Clear the entire index and all disk files.
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.chunkHashMap.clear();
    this.metadata = null;
    this.dirty = false;

    try {
      if (this.localIndex) {
        await this.localIndex.deleteIndex().catch(() => {});
        this.localIndex = null;
      }
      const metadataPath = path.join(this.indexDir, METADATA_FILE);
      const legacyVectorsPath = path.join(this.indexDir, 'vectors.json');
      await fs.unlink(metadataPath).catch(() => {});
      await fs.unlink(legacyVectorsPath).catch(() => {});
      if (fsSync.existsSync(this.vectraDir)) {
        await fs.rm(this.vectraDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch {
      // Best-effort cleanup
    }
  }

  dispose(): void {
    this.entries.clear();
    this.chunkHashMap.clear();
    this.localIndex = null;
  }

  private computeHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
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
