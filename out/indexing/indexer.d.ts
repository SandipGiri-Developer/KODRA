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
import * as vscode from 'vscode';
import { IEmbeddingProvider } from './embeddings';
import { IndexingProgress, SearchResult } from './types';
import { IVectorStore } from './vectorStore';
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
export declare const DEFAULT_CONFIG: IndexerConfig;
export declare class CodebaseIndexer {
    private config;
    private storagePath?;
    private vectorStore;
    private embeddingProvider;
    private abortController;
    private indexingInProgress;
    private readonly pauseGate;
    private partialFailuresCount;
    private readonly _onProgress;
    readonly onProgress: vscode.Event<IndexingProgress>;
    constructor(config?: IndexerConfig, storagePath?: string | undefined, customProvider?: IEmbeddingProvider, customStore?: IVectorStore);
    /**
     * Update indexer configuration.
     */
    updateConfig(config: Partial<IndexerConfig>): void;
    /**
     * Get current indexing configuration from VS Code settings.
     */
    static readConfig(): IndexerConfig;
    /**
     * Set explicit embedding provider (useful for tests or runtime injection).
     */
    setEmbeddingProvider(provider: IEmbeddingProvider): void;
    /**
     * Get the active embedding provider.
     */
    getEmbeddingProvider(): IEmbeddingProvider | null;
    /**
     * Set explicit vector store (useful for tests or custom backends).
     */
    setVectorStore(store: IVectorStore): void;
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
    indexWorkspace(fullReindex?: boolean): Promise<void>;
    /**
     * Search the index for chunks semantically relevant to a query.
     */
    search(query: string, topK?: number): Promise<SearchResult[]>;
    /**
     * Cancel the current indexing operation.
     */
    cancelIndexing(): void;
    /**
     * Pause/resume indexing.
     */
    set paused(value: boolean);
    get paused(): boolean;
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
    };
    /**
     * Ensure the index and provider are loaded for the current workspace.
     */
    ensureLoaded(): Promise<void>;
    dispose(): void;
    private resolveEmbeddingProvider;
    private computeHash;
    private emitProgress;
}
//# sourceMappingURL=indexer.d.ts.map