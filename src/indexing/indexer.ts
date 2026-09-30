/**
 * Codebase Indexer — Orchestrates the full indexing pipeline.
 * 
 * Adapted from KODRA's CodebaseIndexer.ts pattern:
 *  walkDir → filter → readFile → chunk → embed → store
 * 
 * Key behaviors preserved from KODRA:
 * - Batched processing (configurable batch size)
 * - Incremental indexing via content hashing (add/remove/update detection)
 * - Progress reporting
 * - Cancellation support
 * - Pause/resume
 * - Error resilience (single file failures don't abort the whole index)
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { chunkDocument, shouldChunkFile } from './chunker';
import { FallbackEmbeddingProvider, IEmbeddingProvider, OllamaEmbeddingProvider } from './embeddings';
import { Chunk, IndexingProgress, SearchResult } from './types';
import { VectorStore } from './vectorStore';
import { walkWorkspace, WalkOptions } from './walkDir';
import { OllamaManager } from '../utils/ollamaManager';

export interface IndexerConfig {
  maxFileSize: number;
  additionalIgnorePatterns: string[];
  ollamaEndpoint: string;
  embeddingModel: string;
  maxChunkSize: number;
  batchSize: number;
}

const DEFAULT_CONFIG: IndexerConfig = {
  maxFileSize: 1_048_576,
  additionalIgnorePatterns: [],
  ollamaEndpoint: 'http://127.0.0.1:11434',
  embeddingModel: 'nomic-embed-text',
  maxChunkSize: 512,
  batchSize: 50,
};

export class CodebaseIndexer {
  private vectorStore: VectorStore | null = null;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private abortController: AbortController | null = null;
  private indexingInProgress = false;
  private _paused = false;

  private readonly _onProgress = new vscode.EventEmitter<IndexingProgress>();
  readonly onProgress = this._onProgress.event;

  constructor(
    private config: IndexerConfig = DEFAULT_CONFIG,
    private storagePath?: string
  ) {}

  /**
   * Update indexer configuration.
   */
  updateConfig(config: Partial<IndexerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current indexing configuration from VS Code settings.
   */
  static readConfig(): IndexerConfig {
    const settings = vscode.workspace.getConfiguration('KODRA');
    return {
      maxFileSize: settings.get<number>('indexing.maxFileSize', DEFAULT_CONFIG.maxFileSize),
      additionalIgnorePatterns: settings.get<string[]>('indexing.additionalIgnorePatterns', []),
      ollamaEndpoint: settings.get<string>('ollama.endpoint', DEFAULT_CONFIG.ollamaEndpoint),
      embeddingModel: 'nomic-embed-text',
      maxChunkSize: DEFAULT_CONFIG.maxChunkSize,
      batchSize: DEFAULT_CONFIG.batchSize,
    };
  }

  /**
   * Index the workspace — incremental if an index exists, full otherwise.
   * 
   * Algorithm (adapted from KODRA's refreshIndex.ts):
   * 1. Walk workspace to discover all eligible files + stats
   * 2. Compare against existing index state (by file path + content hash)
   * 3. Classify files as: new (add), changed (update), deleted (remove), unchanged (skip)
   * 4. For new/changed files: read → chunk → embed → store
   * 5. For deleted files: remove from index
   * 6. Save index to disk
   */
  async indexWorkspace(fullReindex: boolean = false): Promise<void> {
    if (this.indexingInProgress) {
      Logger.getInstance().warn('Indexing already in progress');
      return;
    }

    const logger = Logger.getInstance();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.emitProgress('error', 0, 'No workspace folder open');
      return;
    }

    this.indexingInProgress = true;
    this.abortController = new AbortController();

    try {
      // Silently check if Ollama is running for embeddings.
      // If not, we fall back to local n-gram embeddings (see createEmbeddingProvider).
      // We do NOT prompt the user here — prompts only happen on explicit chat messages.
      const ollamaAvailable = await OllamaManager.isRunning(this.config.ollamaEndpoint);
      if (!ollamaAvailable) {
        logger.info('Ollama not available for indexing — using local fallback embeddings.');
      }

      const workspaceRoot = folders[0].uri.fsPath;

      // Initialize embedding provider
      this.embeddingProvider = await this.createEmbeddingProvider();

      // Initialize or load vector store
      if (!this.vectorStore) {
        // Use VS Code extension storage path if provided, otherwise fallback to workspace root
        const storeLocation = this.storagePath || workspaceRoot;
        this.vectorStore = new VectorStore(storeLocation);
      }

      if (fullReindex) {
        await this.vectorStore.clear();
        logger.info('Full re-index requested — cleared existing index');
      }

      const loaded = await this.vectorStore.load(this.embeddingProvider.modelId);
      if (!loaded) {
        logger.info('Starting fresh index');
      }

      // Phase 1: Walk workspace
      this.emitProgress('walking', 0.05, 'Discovering files...');

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

      logger.info(`Discovered ${walkResult.files.length} files`);
      this.emitProgress('chunking', 0.1, `Found ${walkResult.files.length} files`);

      // Phase 2: Compute diff against existing index
      const indexedFiles = this.vectorStore.getIndexedFiles();
      const currentFiles = new Set(walkResult.files);

      const filesToAdd: string[] = [];
      const filesToUpdate: string[] = [];
      const filesToRemove: string[] = [];

      // Find new and changed files
      for (const file of walkResult.files) {
        if (!indexedFiles.has(file)) {
          filesToAdd.push(file);
        } else {
          // Check if content changed by comparing digest
          const existingDigest = this.vectorStore.getFileDigest(file);
          if (existingDigest) {
            // We'll compute the new digest when we read the file
            // For now, use mtime heuristic: if mtime is newer, re-read and check hash
            filesToUpdate.push(file); // Will be filtered by hash comparison during processing
          }
        }
      }

      // Find deleted files
      for (const indexedFile of indexedFiles) {
        if (!currentFiles.has(indexedFile)) {
          filesToRemove.push(indexedFile);
        }
      }

      // Phase 3: Remove deleted files
      for (const file of filesToRemove) {
        this.vectorStore.removeByFilepath(file);
      }
      if (filesToRemove.length > 0) {
        logger.info(`Removed ${filesToRemove.length} deleted files from index`);
      }

      // Phase 4: Process new and changed files in batches
      const allFilesToProcess = [...filesToAdd, ...filesToUpdate];
      const totalToProcess = allFilesToProcess.length;
      let processed = 0;

      for (let i = 0; i < allFilesToProcess.length; i += this.config.batchSize) {
        if (this.abortController.signal.aborted) {
          this.emitProgress('cancelled', 0, 'Indexing cancelled');
          break;
        }

        // Wait if paused
        while (this._paused && !this.abortController.signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        const batch = allFilesToProcess.slice(i, i + this.config.batchSize);
        await this.processBatch(batch);

        processed += batch.length;
        const progress = 0.1 + (processed / totalToProcess) * 0.85;
        this.emitProgress(
          'embedding',
          progress,
          `Indexed ${processed}/${totalToProcess} files`,
          processed,
          totalToProcess,
        );
      }

      // Phase 5: Save
      if (!this.abortController.signal.aborted) {
        this.emitProgress('storing', 0.95, 'Saving index...');
        await this.vectorStore.save(this.embeddingProvider.modelId);
        this.emitProgress('complete', 1.0, `Index complete: ${this.vectorStore.size} chunks from ${currentFiles.size} files`);
        logger.info(`Indexing complete: ${this.vectorStore.size} chunks`);
      }
    } catch (error) {
      logger.error('Indexing failed', error);
      this.emitProgress('error', 0, `Indexing failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.indexingInProgress = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel the current indexing operation.
   */
  cancelIndexing(): void {
    if (this.abortController) {
      this.abortController.abort();
      Logger.getInstance().info('Indexing cancellation requested');
    }
  }

  /**
   * Pause/resume indexing.
   */
  set paused(value: boolean) {
    this._paused = value;
  }

  get paused(): boolean {
    return this._paused;
  }

  /**
   * Search the index for chunks relevant to a query.
   */
  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (!this.vectorStore || this.vectorStore.size === 0) {
      return [];
    }

    if (!this.embeddingProvider) {
      this.embeddingProvider = await this.createEmbeddingProvider();
    }

    const logger = Logger.getInstance();
    try {
      const tEmbed = Date.now();
      const [queryVector] = await this.embeddingProvider.embed([query]);
      const embedMs = Date.now() - tEmbed;

      const tSearch = Date.now();
      const results = this.vectorStore.search(queryVector, topK, 0.1);
      const searchMs = Date.now() - tSearch;

      logger.info(`[KODRA Timing] embedding=${embedMs}ms vector_search=${searchMs}ms results=${results.length}`);
      return results;
    } catch (error) {
      logger.error('Search failed', error);
      return [];
    }
  }

  /**
   * Get the current index status.
   */
  getStatus(): { indexed: boolean; entryCount: number; fileCount: number; inProgress: boolean } {
    return {
      indexed: this.vectorStore !== null && this.vectorStore.size > 0,
      entryCount: this.vectorStore?.size ?? 0,
      fileCount: this.vectorStore?.getIndexedFiles().size ?? 0,
      inProgress: this.indexingInProgress,
    };
  }

  /**
   * Ensure the index is loaded for the current workspace.
   */
  async ensureLoaded(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }

    if (this.vectorStore && this.vectorStore.size > 0) { return; }

    const workspaceRoot = folders[0].uri.fsPath;
    this.vectorStore = new VectorStore(workspaceRoot);
    this.embeddingProvider = await this.createEmbeddingProvider();
    await this.vectorStore.load(this.embeddingProvider.modelId);
  }

  dispose(): void {
    this.cancelIndexing();
    this.embeddingProvider?.dispose();
    this.vectorStore?.dispose();
    this._onProgress.dispose();
  }

  // ─── Private methods ─────────────────────────────────────────────────

  private async processBatch(files: string[]): Promise<void> {
    const logger = Logger.getInstance();
    const allChunks: Chunk[] = [];
    const allTexts: string[] = [];

    for (const filepath of files) {
      try {
        const content = await fs.readFile(filepath, 'utf-8');
        const digest = this.computeHash(content);

        // Skip if content hasn't changed (for update candidates)
        const existingDigest = this.vectorStore?.getFileDigest(filepath);
        if (existingDigest === digest) {
          continue;
        }

        // Remove old entries for this file
        this.vectorStore?.removeByFilepath(filepath);

        // Skip unchunkable files
        if (!shouldChunkFile(filepath, content)) {
          continue;
        }

        // Chunk the document
        const chunks = chunkDocument(filepath, content, digest, this.config.maxChunkSize);
        for (const chunk of chunks) {
          const id = `${filepath}:${chunk.index}:${digest.slice(0, 8)}`;
          allChunks.push({ ...chunk, id });
          allTexts.push(chunk.content);
        }
      } catch (error) {
        // Single file failures don't abort the batch
        logger.debug(`Failed to process ${filepath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (allChunks.length === 0 || !this.embeddingProvider || !this.vectorStore) {
      return;
    }

    // Generate embeddings for all chunks in this batch
    try {
      const vectors = await this.embeddingProvider.embed(allTexts);
      this.vectorStore.addEntries(allChunks, vectors);
    } catch (error) {
      logger.error(`Embedding batch failed: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw — allow indexing to continue with remaining batches
    }
  }

  private async createEmbeddingProvider(): Promise<IEmbeddingProvider> {
    const logger = Logger.getInstance();

    // Try Ollama embedding provider first
    try {
      const provider = new OllamaEmbeddingProvider(
        this.config.ollamaEndpoint,
        this.config.embeddingModel,
      );
      // Test with a small embed to verify the model is available
      await provider.embed(['test']);
      logger.info(`Using Ollama embedding model: ${this.config.embeddingModel}`);
      return provider;
    } catch (error) {
      logger.warn(`Ollama embedding model not available: ${error instanceof Error ? error.message : String(error)}`);
      logger.info('Falling back to local n-gram hash embeddings');
      return new FallbackEmbeddingProvider();
    }
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private emitProgress(
    status: IndexingProgress['status'],
    progress: number,
    description: string,
    filesProcessed?: number,
    totalFiles?: number,
  ): void {
    this._onProgress.fire({ status, progress, description, filesProcessed, totalFiles });
  }
}
