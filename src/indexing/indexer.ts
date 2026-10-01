/**
 * Codebase Indexer — Orchestrates the full indexing pipeline.
 * 
 * Pipeline:
 *  walkWorkspace → incremental diffing → chunkDocument → content hash check
 *  → reuse cached vectors / embed new chunks → Vectra storage → save
 * 
 * Key Architecture Highlights:
 * - Provider-agnostic: Depends exclusively on IEmbeddingProvider (Local by default)
 * - Zero-setup: Works out-of-the-box with LocalTransformersProvider (all-MiniLM-L6-v2)
 * - Dynamic dimensions: Never hardcodes 768 or 384
 * - Content-addressed chunk caching: Reuses vectors for unchanged chunks and moved files
 * - True incremental indexing: Unchanged files are not read or re-embedded
 * - Real runtime lifecycle states:
 *    idle | initializing | loading_model | downloading_model | discovering_files
 *    | chunking | embedding | persisting | completed | partial_failure | failed | cancelled
 * - Error resilience: File or batch failures do not wipe or abort the whole index
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { PauseGate } from '../utils/pauseGate';
import { chunkDocument, shouldChunkFile } from './chunker';
import {
  createEmbeddingProvider,
  IEmbeddingProvider,
  LocalTransformersProvider,
} from './embeddings';
import {
  Chunk,
  EmbeddingConfig,
  IndexingProgress,
  IndexingStatus,
  SearchResult,
} from './types';
import { VectorStore, IVectorStore } from './vectorStore';
import { walkWorkspace, WalkOptions } from './walkDir';

export interface IndexerConfig {
  maxFileSize: number;
  additionalIgnorePatterns: string[];
  embeddingProvider: string;
  embeddingModel: string;
  ollamaEndpoint: string;
  maxChunkSize: number;
  batchSize: number;
  cacheDir?: string;
}

export const DEFAULT_CONFIG: IndexerConfig = {
  maxFileSize: 1_048_576,
  additionalIgnorePatterns: [],
  embeddingProvider: 'local',
  embeddingModel: 'all-MiniLM-L6-v2',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  maxChunkSize: 512,
  batchSize: 32,
};

export class CodebaseIndexer {
  private vectorStore: IVectorStore | null = null;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private abortController: AbortController | null = null;
  private indexingInProgress = false;
  private readonly pauseGate = new PauseGate();
  private partialFailuresCount = 0;

  private readonly _onProgress = new vscode.EventEmitter<IndexingProgress>();
  readonly onProgress = this._onProgress.event;

  constructor(
    private config: IndexerConfig = DEFAULT_CONFIG,
    private storagePath?: string,
    customProvider?: IEmbeddingProvider,
    customStore?: IVectorStore,
  ) {
    if (customProvider) {
      this.embeddingProvider = customProvider;
    }
    if (customStore) {
      this.vectorStore = customStore;
    }
  }

  /**
   * Update indexer configuration.
   */
  updateConfig(config: Partial<IndexerConfig>): void {
    this.config = { ...this.config, ...config };
    // If embedding provider configuration changed, re-instantiate on next run
    if (config.embeddingProvider || config.embeddingModel || config.ollamaEndpoint) {
      this.embeddingProvider?.dispose();
      this.embeddingProvider = null;
    }
  }

  /**
   * Get current indexing configuration from VS Code settings.
   */
  static readConfig(): IndexerConfig {
    const settings = vscode.workspace.getConfiguration('KODRA');
    const provider = settings.get<string>('embedding.provider', DEFAULT_CONFIG.embeddingProvider);
    
    // Default model depends on provider
    let defaultModel = DEFAULT_CONFIG.embeddingModel;
    if (provider === 'ollama') {
      defaultModel = 'nomic-embed-text';
    }

    const model = settings.get<string>('embedding.model', defaultModel);
    const ollamaEndpoint = settings.get<string>(
      'embedding.ollamaEndpoint',
      settings.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollamaEndpoint),
    );

    return {
      maxFileSize: settings.get<number>('indexing.maxFileSize', DEFAULT_CONFIG.maxFileSize),
      additionalIgnorePatterns: settings.get<string[]>('indexing.additionalIgnorePatterns', []),
      embeddingProvider: provider,
      embeddingModel: model || defaultModel,
      ollamaEndpoint,
      maxChunkSize: DEFAULT_CONFIG.maxChunkSize,
      batchSize: DEFAULT_CONFIG.batchSize,
    };
  }

  /**
   * Set explicit embedding provider (useful for tests or runtime injection).
   */
  setEmbeddingProvider(provider: IEmbeddingProvider): void {
    this.embeddingProvider?.dispose();
    this.embeddingProvider = provider;
  }

  /**
   * Get the active embedding provider.
   */
  getEmbeddingProvider(): IEmbeddingProvider | null {
    return this.embeddingProvider;
  }

  /**
   * Set explicit vector store (useful for tests or custom backends).
   */
  setVectorStore(store: IVectorStore): void {
    this.vectorStore?.dispose();
    this.vectorStore = store;
  }

  /**
   * Index the workspace — incremental if an index exists, full otherwise.
   * 
   * Flow:
   * 1. Initialize provider (acquire model if needed with real progress)
   * 2. Initialize vector store & verify compatibility
   * 3. Discover workspace files with stats
   * 4. Perform incremental diffing:
   *    - Remove deleted files from store
   *    - Filter out untouched/unchanged files without re-reading
   * 5. For new and modified files:
   *    - Chunk documents
   *    - Compute chunk hashes
   *    - Check content-addressed cache: reuse vectors for identical chunks
   * 6. Batch embed only truly new/modified chunks
   * 7. Save vector index and metadata
   */
  async indexWorkspace(fullReindex: boolean = false): Promise<void> {
    if (this.indexingInProgress) {
      Logger.getInstance().warn('Indexing already in progress');
      return;
    }

    const logger = Logger.getInstance();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.emitProgress('failed', 0, 'No workspace folder open');
      return;
    }

    this.indexingInProgress = true;
    this.partialFailuresCount = 0;
    this.abortController = new AbortController();

    try {
      const workspaceRoot = folders[0].uri.fsPath;
      this.emitProgress('initializing', 0.0, 'Initializing indexer...');

      // ─── Step 1: Initialize Embedding Provider ─────────────────────────
      if (!this.embeddingProvider) {
        this.embeddingProvider = await this.resolveEmbeddingProvider();
      }

      // Initialize provider with real model downloading / loading progress
      await this.embeddingProvider.initialize((downloadProgress) => {
        if (this.abortController?.signal.aborted) { return; }

        if (downloadProgress.stage === 'downloading') {
          this.emitProgress(
            'downloading_model',
            (downloadProgress.percent ?? 0) / 100 * 0.1,
            downloadProgress.message || 'Downloading local embedding model...',
            undefined,
            undefined,
            undefined,
            undefined,
            downloadProgress.loadedBytes !== undefined && downloadProgress.totalBytes !== undefined
              ? {
                  loaded: downloadProgress.loadedBytes,
                  total: downloadProgress.totalBytes,
                  percent: downloadProgress.percent ?? 0,
                }
              : undefined,
          );
        } else {
          this.emitProgress(
            'loading_model',
            0.08,
            downloadProgress.message || 'Loading embedding model into memory...',
          );
        }
      });

      if (this.abortController.signal.aborted) {
        this.emitProgress('cancelled', 0, 'Indexing cancelled');
        return;
      }

      // ─── Step 2: Initialize or Load Vector Store ─────────────────────────
      if (!this.vectorStore) {
        const storeLocation = this.storagePath || workspaceRoot;
        this.vectorStore = new VectorStore(storeLocation);
      }

      if (fullReindex) {
        await this.vectorStore.clear();
        logger.info('Full re-index requested — cleared existing vector index');
      }

      // Automatically checks model ID and vector dimensions for compatibility
      const loaded = await this.vectorStore.load(
        this.embeddingProvider.modelId,
        this.embeddingProvider.dimensions,
      );
      if (!loaded) {
        logger.info(`Starting fresh index for model ${this.embeddingProvider.modelId} (${this.embeddingProvider.dimensions}d)`);
      }

      // ─── Step 3: Discover Files ──────────────────────────────────────────
      this.emitProgress('discovering_files', 0.1, 'Discovering workspace files...');

      const walkOptions: WalkOptions = {
        additionalIgnorePatterns: this.config.additionalIgnorePatterns,
        maxFileSize: this.config.maxFileSize,
        collectStats: true,
        signal: this.abortController.signal,
      };

      const walkResult = await walkWorkspace(workspaceRoot, walkOptions);

      if (this.abortController.signal.aborted) {
        this.emitProgress('cancelled', 0, 'Indexing cancelled');
        return;
      }

      logger.info(`Discovered ${walkResult.files.length} candidate files`);

      // ─── Step 4: Incremental Diffing ────────────────────────────────────
      const indexedFiles = this.vectorStore.getIndexedFiles();
      const currentFiles = new Set(walkResult.files);

      const filesToAdd: string[] = [];
      const filesToUpdate: string[] = [];
      const filesToRemove: string[] = [];

      // Detect deleted files
      for (const indexedFile of indexedFiles) {
        if (!currentFiles.has(indexedFile)) {
          filesToRemove.push(indexedFile);
        }
      }

      // Remove deleted files from store
      if (filesToRemove.length > 0) {
        for (const file of filesToRemove) {
          this.vectorStore.removeByFilepath(file);
        }
        logger.info(`Removed ${filesToRemove.length} deleted files from index`);
      }

      // Check new vs existing files
      for (const file of walkResult.files) {
        if (!indexedFiles.has(file)) {
          filesToAdd.push(file);
        } else {
          // File was previously indexed — inspect stats
          const stats = walkResult.stats[file];
          const existingDigest = this.vectorStore.getFileDigest(file);

          if (!existingDigest) {
            filesToUpdate.push(file);
            continue;
          }

          // Read file content to verify hash
          try {
            const content = await fs.readFile(file, 'utf-8');
            const digest = this.computeHash(content);
            if (digest !== existingDigest) {
              filesToUpdate.push(file);
            }
            // If digest === existingDigest, file is completely unchanged — skip!
          } catch {
            // Unreadable file
            this.partialFailuresCount++;
          }
        }
      }

      const filesToProcess = [...filesToAdd, ...filesToUpdate];
      logger.info(
        `Incremental diff: ${filesToAdd.length} new, ${filesToUpdate.length} modified, ` +
        `${filesToRemove.length} deleted, ${walkResult.files.length - filesToProcess.length} unchanged`,
      );

      // If nothing changed, complete immediately
      if (filesToProcess.length === 0 && filesToRemove.length === 0) {
        this.emitProgress(
          'completed',
          1.0,
          `Index up to date: ${this.vectorStore.size} chunks across ${currentFiles.size} files`,
          currentFiles.size,
          currentFiles.size,
          this.vectorStore.size,
          this.vectorStore.size,
        );
        return;
      }

      // ─── Step 5: Chunking & Content Hash Resolution ───────────────────────
      this.emitProgress('chunking', 0.2, `Chunking ${filesToProcess.length} files...`);

      const chunksToEmbed: Chunk[] = [];
      const chunksReused: { chunk: Chunk; vector: number[] }[] = [];

      for (let i = 0; i < filesToProcess.length; i++) {
        if (this.abortController.signal.aborted) {
          this.emitProgress('cancelled', 0, 'Indexing cancelled');
          return;
        }

        const filepath = filesToProcess[i];
        try {
          const content = await fs.readFile(filepath, 'utf-8');
          const digest = this.computeHash(content);

          // Clear previous chunks for modified file before re-indexing
          this.vectorStore.removeByFilepath(filepath);

          if (!shouldChunkFile(filepath, content)) {
            continue;
          }

          const rawChunks = chunkDocument(filepath, content, digest, this.config.maxChunkSize);

          for (const raw of rawChunks) {
            const chunkId = `${filepath}:${raw.index}:${raw.chunkHash.slice(0, 10)}`;
            const chunk: Chunk = {
              id: chunkId,
              filepath: raw.filepath,
              content: raw.content,
              startLine: raw.startLine,
              endLine: raw.endLine,
              digest: raw.digest,
              chunkHash: raw.chunkHash,
              index: raw.index,
            };

            // Check content-addressable cache: can we reuse an existing vector?
            const existingVector = this.vectorStore.getVectorByChunkHash(raw.chunkHash);
            if (existingVector && existingVector.length === this.embeddingProvider.dimensions) {
              chunksReused.push({ chunk, vector: existingVector });
            } else {
              chunksToEmbed.push(chunk);
            }
          }
        } catch (error) {
          logger.warn(`Failed to read/chunk ${filepath}`, error);
          this.partialFailuresCount++;
        }
      }

      // Add all reused chunks directly to store (no embedding model call needed!)
      if (chunksReused.length > 0) {
        this.vectorStore.addEntries(
          chunksReused.map((r) => r.chunk),
          chunksReused.map((r) => r.vector),
        );
        logger.info(`Reused embeddings for ${chunksReused.length} chunks via content addressing`);
      }

      // ─── Step 6: Embedding New Chunks ────────────────────────────────────
      const totalNewChunks = chunksToEmbed.length;
      let chunksEmbedded = 0;

      if (totalNewChunks > 0) {
        logger.info(`Generating embeddings for ${totalNewChunks} new chunks (batch size: ${this.config.batchSize})...`);

        for (let i = 0; i < totalNewChunks; i += this.config.batchSize) {
          if (this.abortController.signal.aborted) {
            this.emitProgress('cancelled', 0, 'Indexing cancelled');
            break;
          }

          // Handle pause
          await this.pauseGate.wait(this.abortController.signal);
          if (this.abortController.signal.aborted) {
            this.emitProgress('cancelled', 0, 'Indexing cancelled');
            break;
          }

          const batch = chunksToEmbed.slice(i, i + this.config.batchSize);
          const batchTexts = batch.map((c) => c.content);

          try {
            const vectors = await this.embeddingProvider.embed(batchTexts);
            this.vectorStore.addEntries(batch, vectors);
          } catch (batchErr) {
            logger.error(`Failed to embed batch ${i}-${i + batch.length}`, batchErr);
            this.partialFailuresCount += batch.length;
          }

          chunksEmbedded += batch.length;
          const embedProgress = 0.25 + (chunksEmbedded / totalNewChunks) * 0.65;
          this.emitProgress(
            'embedding',
            embedProgress,
            `Embedded ${chunksEmbedded}/${totalNewChunks} chunks`,
            filesToProcess.length,
            walkResult.files.length,
            chunksEmbedded,
            totalNewChunks,
          );
        }
      }

      // ─── Step 7: Persisting ───────────────────────────────────────────────
      if (!this.abortController.signal.aborted) {
        this.emitProgress('persisting', 0.95, 'Saving index to disk...');

        await this.vectorStore.save(
          this.embeddingProvider.modelId,
          this.embeddingProvider.dimensions,
          this.embeddingProvider.providerId,
        );

        const finalStatus: IndexingStatus =
          this.partialFailuresCount > 0 ? 'partial_failure' : 'completed';

        this.emitProgress(
          finalStatus,
          1.0,
          `Index complete: ${this.vectorStore.size} chunks (${totalNewChunks} new, ${chunksReused.length} reused)`,
          walkResult.files.length,
          walkResult.files.length,
          this.vectorStore.size,
          this.vectorStore.size,
        );

        logger.info(
          `Indexing finished with status: ${finalStatus}. Total chunks in index: ${this.vectorStore.size}`,
        );
      }
    } catch (error: unknown) {
      logger.error('Indexing failed with fatal error', error);
      this.emitProgress(
        'failed',
        0,
        `Indexing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.indexingInProgress = false;
      this.abortController = null;
    }
  }

  /**
   * Search the index for chunks semantically relevant to a query.
   */
  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (!this.vectorStore) {
      await this.ensureLoaded();
    }

    if (!this.vectorStore || this.vectorStore.size === 0) {
      return [];
    }

    if (!this.embeddingProvider) {
      this.embeddingProvider = await this.resolveEmbeddingProvider();
    }

    const logger = Logger.getInstance();
    try {
      const tEmbed = Date.now();
      const [queryVector] = await this.embeddingProvider.embed([query]);
      const embedMs = Date.now() - tEmbed;

      if (!queryVector || queryVector.length === 0) {
        return [];
      }

      const tSearch = Date.now();
      const results = this.vectorStore.search(queryVector, topK, 0.1);
      const searchMs = Date.now() - tSearch;

      logger.info(
        `[KODRA Timing] embedding=${embedMs}ms vector_search=${searchMs}ms results=${results.length} (${this.embeddingProvider.modelId})`,
      );
      return results;
    } catch (error) {
      logger.error('Search failed', error);
      return [];
    }
  }

  /**
   * Cancel the current indexing operation.
   */
  cancelIndexing(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.pauseGate.resume();
      Logger.getInstance().info('Indexing cancellation requested');
    }
  }

  /**
   * Pause/resume indexing.
   */
  set paused(value: boolean) {
    this.pauseGate.setPaused(value);
  }

  get paused(): boolean {
    return this.pauseGate.isPaused;
  }

  /**
   * Get the current index status.
   */
  getStatus(): {
    indexed: boolean;
    entryCount: number;
    fileCount: number;
    inProgress: boolean;
    provider: string;
    model: string;
  } {
    const meta = this.vectorStore?.getMetadata();
    return {
      indexed: this.vectorStore !== null && this.vectorStore.size > 0,
      entryCount: this.vectorStore?.size ?? 0,
      fileCount: this.vectorStore?.getIndexedFiles().size ?? 0,
      inProgress: this.indexingInProgress,
      provider: meta?.provider || this.config.embeddingProvider,
      model: meta?.model || this.config.embeddingModel,
    };
  }

  /**
   * Ensure the index and provider are loaded for the current workspace.
   */
  async ensureLoaded(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return;
    }

    const workspaceRoot = folders[0].uri.fsPath;
    const storeLocation = this.storagePath || workspaceRoot;

    if (!this.vectorStore) {
      this.vectorStore = new VectorStore(storeLocation);
    }
    if (!this.embeddingProvider) {
      this.embeddingProvider = await this.resolveEmbeddingProvider();
    }

    await this.vectorStore.load(
      this.embeddingProvider.modelId,
      this.embeddingProvider.dimensions,
    );
  }

  dispose(): void {
    this.cancelIndexing();
    this.embeddingProvider?.dispose();
    this.vectorStore?.dispose();
    this._onProgress.dispose();
  }

  // ─── Private methods ──────────────────────────────────────────────────

  private async resolveEmbeddingProvider(): Promise<IEmbeddingProvider> {
    const embeddingConfig: EmbeddingConfig = {
      provider: this.config.embeddingProvider,
      model: this.config.embeddingModel,
      endpoint: this.config.ollamaEndpoint,
      cacheDir: this.config.cacheDir || this.storagePath,
    };

    return createEmbeddingProvider(embeddingConfig, this.storagePath);
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private emitProgress(
    status: IndexingStatus,
    progress: number,
    description: string,
    filesProcessed?: number,
    totalFiles?: number,
    chunksProcessed?: number,
    totalChunks?: number,
    downloadProgress?: IndexingProgress['downloadProgress'],
  ): void {
    this._onProgress.fire({
      status,
      progress,
      description,
      filesProcessed,
      totalFiles,
      chunksProcessed,
      totalChunks,
      downloadProgress,
    });
  }
}
