/**
 * Document chunking for KODRA indexing.
 *
 * Adapted from KODRA's chunking strategies:
 * - basicChunker (core/indexing/chunk/basic.ts): Line-based chunking with token counting
 * - chunkDocument (core/indexing/chunk/chunk.ts): Dispatcher that routes by file type
 *
 * For v1.0, we use an enhanced line-based chunker that:
 * - Respects line boundaries (never splits mid-line)
 * - Preserves start/end line metadata for source location
 * - Uses approximate token counting for speed
 * - Applies overlap for context continuity at chunk boundaries
 * - Filters empty/trivial chunks
 *
 * Tree-sitter AST-based code chunking (KODRA's code.ts) is deferred to v1.1
 * due to WASM binary bundling complexity.
 */
import { ChunkWithoutID } from './types';
/** Default maximum chunk size in tokens. */
export declare const DEFAULT_MAX_CHUNK_SIZE = 512;
/** Default overlap in lines between adjacent chunks. */
export declare const DEFAULT_OVERLAP_LINES = 3;
/**
 * Approximate token count for a string.
 * Uses the ~4 chars per token heuristic for English text/code.
 * This is faster than loading a full tokenizer and sufficient for chunk sizing.
 */
export declare function approximateTokenCount(text: string): number;
/**
 * Enhanced line-based chunker.
 *
 * Algorithm adapted from KODRA's basic.ts chunker:
 * - Iterates lines, accumulating into chunks
 * - When adding a line would exceed maxChunkSize tokens, yields current chunk
 * - Preserves startLine/endLine for source location
 * - Applies overlap: the last N lines of one chunk become the first N lines of the next
 */
export declare function chunkText(contents: string, maxChunkSize?: number, overlapLines?: number): Generator<ChunkWithoutID>;
/**
 * Check if a file should be chunked based on its name and content.
 * Adapted from KODRA's shouldChunk().
 */
export declare function shouldChunkFile(filepath: string, content: string): boolean;
/**
 * Chunk a document with full metadata.
 */
export declare function chunkDocument(filepath: string, contents: string, digest: string, maxChunkSize?: number): Array<{
    content: string;
    startLine: number;
    endLine: number;
    filepath: string;
    digest: string;
    chunkHash: string;
    index: number;
}>;
//# sourceMappingURL=chunker.d.ts.map