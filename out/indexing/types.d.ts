/**
 * Indexing type definitions for KODRA.
 * Adapted from codebase indexing architecture.
 */
/** Metadata for a chunk of indexed content. */
export interface Chunk {
    /** Unique identifier for this chunk */
    id: string;
    /** Source file URI or path */
    filepath: string;
    /** Chunk content text */
    content: string;
    /** Start line number in the source file (0-based) */
    startLine: number;
    /** End line number in the source file (0-based) */
    endLine: number;
    /** Content hash of the source file at indexing time */
    digest: string;
    /** Content hash of this individual chunk for content-addressable reuse */
    chunkHash?: string;
    /** Chunk index within the file */
    index: number;
}
/** A chunk without its ID and file context assigned yet. */
export type ChunkWithoutID = Omit<Chunk, 'id' | 'digest' | 'chunkHash' | 'index' | 'filepath'>;
/** File stats for change detection. */
export interface FileStats {
    /** File modification time (epoch ms) */
    lastModified: number;
    /** File size in bytes */
    size: number;
}
/** Map of file paths to their stats. */
export type FileStatsMap = Record<string, FileStats>;
/** Indexing operation result types. */
export declare enum IndexResultType {
    Add = "add",
    Remove = "remove",
    Update = "update"
}
/** A path paired with its content hash for change detection. */
export interface PathAndCacheKey {
    path: string;
    cacheKey: string;
}
/** Result of comparing current files against indexed state. */
export interface RefreshIndexResults {
    /** New files to index */
    toAdd: PathAndCacheKey[];
    /** Files to remove from index */
    toRemove: PathAndCacheKey[];
    /** Files whose content changed — re-index */
    toUpdate: PathAndCacheKey[];
}
/** Real runtime indexing lifecycle states. */
export type IndexingStatus = 'idle' | 'initializing' | 'loading_model' | 'downloading_model' | 'discovering_files' | 'chunking' | 'embedding' | 'persisting' | 'completed' | 'partial_failure' | 'failed' | 'cancelled' | 'starting' | 'walking' | 'storing' | 'complete' | 'error';
/** Progress update emitted during indexing. */
export interface IndexingProgress {
    status: IndexingStatus;
    /** Progress 0.0 - 1.0 */
    progress: number;
    /** Human-readable description */
    description: string;
    /** Number of files processed so far */
    filesProcessed?: number;
    /** Total number of files to process */
    totalFiles?: number;
    /** Number of chunks processed so far */
    chunksProcessed?: number;
    /** Total number of chunks to process */
    totalChunks?: number;
    /** Model download progress if currently acquiring model */
    downloadProgress?: {
        loaded: number;
        total: number;
        percent: number;
    };
    /** Sub-stage information */
    stage?: string;
}
/** Vector search result. */
export interface SearchResult {
    /** The matched chunk */
    chunk: Chunk;
    /** Similarity score (higher is better, typically 0-1 for cosine) */
    score: number;
}
/** Metadata stored alongside vector index to verify compatibility. */
export interface IndexMetadata {
    /** Schema version of the index */
    schemaVersion: number;
    /** Legacy version field for backward compatibility */
    version: number;
    /** Embedding provider ID ('local', 'ollama', etc.) */
    provider: string;
    /** Model name or ID */
    model: string;
    /** Full composite model identifier */
    embeddingModelId: string;
    /** Vector dimension produced by this model */
    dimensions: number;
    /** Creation timestamp */
    createdAt: string;
    /** Last update timestamp */
    updatedAt: string;
    /** Total number of vector entries in the store */
    entryCount: number;
    /** Total number of indexed files */
    fileCount?: number;
}
/** Configuration for embedding provider. */
export interface EmbeddingConfig {
    provider: 'local' | 'ollama' | 'openai' | string;
    model: string;
    endpoint?: string;
    apiKey?: string;
    cacheDir?: string;
}
//# sourceMappingURL=types.d.ts.map