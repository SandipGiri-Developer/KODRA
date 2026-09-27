/**
 * Indexing type definitions for KODRA.
 * Adapted from KODRA's indexing/types.ts architecture.
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
    /** Chunk index within the file */
    index: number;
}
/** A chunk without its ID and file context assigned yet. */
export type ChunkWithoutID = Omit<Chunk, 'id' | 'digest' | 'index' | 'filepath'>;
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
/** Progress update emitted during indexing. */
export interface IndexingProgress {
    status: 'starting' | 'walking' | 'chunking' | 'embedding' | 'storing' | 'complete' | 'error' | 'cancelled' | 'idle';
    /** Progress 0.0 - 1.0 */
    progress: number;
    /** Human-readable description */
    description: string;
    /** Number of files processed so far */
    filesProcessed?: number;
    /** Total number of files to process */
    totalFiles?: number;
}
/** Vector search result. */
export interface SearchResult {
    /** The matched chunk */
    chunk: Chunk;
    /** Similarity score (higher is better, typically 0-1 for cosine) */
    score: number;
}
//# sourceMappingURL=types.d.ts.map