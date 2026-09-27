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
import { Chunk, SearchResult } from './types';
export declare class VectorStore {
    private readonly workspaceRoot;
    private entries;
    private indexDir;
    private dirty;
    private metadata;
    constructor(workspaceRoot: string);
    /**
     * Load the index from disk.
     * Returns true if an existing index was loaded, false if starting fresh.
     */
    load(expectedModelId: string): Promise<boolean>;
    /**
     * Save the index to disk (if dirty).
     */
    save(embeddingModelId: string): Promise<void>;
    /**
     * Add or update entries in the store.
     */
    addEntries(chunks: Chunk[], vectors: number[][]): void;
    /**
     * Remove all entries for a given file path.
     */
    removeByFilepath(filepath: string): number;
    /**
     * Remove entries by their IDs.
     */
    removeByIds(ids: string[]): void;
    /**
     * Search for the most similar chunks to a query vector.
     * Uses cosine similarity.
     */
    search(queryVector: number[], topK?: number, minScore?: number): SearchResult[];
    /**
     * Get all indexed file paths.
     */
    getIndexedFiles(): Set<string>;
    /**
     * Get the digest (content hash) for a file, if indexed.
     */
    getFileDigest(filepath: string): string | undefined;
    /**
     * Get the total number of entries.
     */
    get size(): number;
    /**
     * Clear the entire index.
     */
    clear(): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=vectorStore.d.ts.map