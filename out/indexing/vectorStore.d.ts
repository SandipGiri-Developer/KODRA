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
    getChunkByHash(chunkHash: string): {
        chunk: Chunk;
        vector: number[];
    } | undefined;
    getMetadata(): IndexMetadata | null;
    clear(): Promise<void>;
    dispose(): void;
}
export declare class VectorStore implements IVectorStore {
    private readonly workspaceRoot;
    private entries;
    /** Mapping from sha256(chunkContent) -> vector for instantaneous reuse */
    private chunkHashMap;
    private indexDir;
    private vectraDir;
    private dirty;
    private metadata;
    private localIndex;
    constructor(workspaceRoot: string);
    /**
     * Load the index from disk.
     * Automatically validates embedding model and dimension compatibility.
     * Returns true if existing compatible index was loaded, false if starting fresh.
     */
    load(expectedModelId: string, expectedDimensions?: number): Promise<boolean>;
    /**
     * Save the index and metadata to disk.
     */
    save(embeddingModelId: string, dimensions?: number, provider?: string): Promise<void>;
    /**
     * Add or update entries in the store.
     */
    addEntries(chunks: Chunk[], vectors: number[][]): void;
    /**
     * Look up cached vector by individual chunk content hash.
     * Enables zero-overhead vector reuse for unchanged chunks and moved files.
     */
    getVectorByChunkHash(chunkHash: string): number[] | undefined;
    /**
     * Look up chunk entry and vector by chunk hash.
     */
    getChunkByHash(chunkHash: string): {
        chunk: Chunk;
        vector: number[];
    } | undefined;
    /**
     * Remove all entries for a given file path.
     */
    removeByFilepath(filepath: string): number;
    /**
     * Remove entries by their IDs.
     */
    removeByIds(ids: string[]): void;
    /**
     * Search for the most similar chunks to a query vector using cosine similarity.
     */
    search(queryVector: number[], topK?: number, minScore?: number): SearchResult[];
    /**
     * Get all indexed file paths.
     */
    getIndexedFiles(): Set<string>;
    /**
     * Get the file digest (content hash) for a file, if indexed.
     */
    getFileDigest(filepath: string): string | undefined;
    /**
     * Current number of indexed chunks.
     */
    get size(): number;
    /**
     * Get index metadata if loaded.
     */
    getMetadata(): IndexMetadata | null;
    /**
     * Clear the entire index and all disk files.
     */
    clear(): Promise<void>;
    dispose(): void;
    private computeHash;
}
//# sourceMappingURL=vectorStore.d.ts.map