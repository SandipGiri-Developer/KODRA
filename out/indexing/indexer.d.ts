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
import * as vscode from 'vscode';
import { IndexingProgress, SearchResult } from './types';
export interface IndexerConfig {
    maxFileSize: number;
    additionalIgnorePatterns: string[];
    ollamaEndpoint: string;
    embeddingModel: string;
    maxChunkSize: number;
    batchSize: number;
}
export declare class CodebaseIndexer {
    private config;
    private storagePath?;
    private vectorStore;
    private embeddingProvider;
    private abortController;
    private indexingInProgress;
    private _paused;
    private readonly _onProgress;
    readonly onProgress: vscode.Event<IndexingProgress>;
    constructor(config?: IndexerConfig, storagePath?: string | undefined);
    /**
     * Update indexer configuration.
     */
    updateConfig(config: Partial<IndexerConfig>): void;
    /**
     * Get current indexing configuration from VS Code settings.
     */
    static readConfig(): IndexerConfig;
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
    indexWorkspace(fullReindex?: boolean): Promise<void>;
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
     * Search the index for chunks relevant to a query.
     */
    search(query: string, topK?: number): Promise<SearchResult[]>;
    /**
     * Get the current index status.
     */
    getStatus(): {
        indexed: boolean;
        entryCount: number;
        fileCount: number;
        inProgress: boolean;
    };
    /**
     * Ensure the index is loaded for the current workspace.
     */
    ensureLoaded(): Promise<void>;
    dispose(): void;
    private processBatch;
    private createEmbeddingProvider;
    private computeHash;
    private emitProgress;
}
//# sourceMappingURL=indexer.d.ts.map