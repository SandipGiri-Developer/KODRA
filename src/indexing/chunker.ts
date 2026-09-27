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
export const DEFAULT_MAX_CHUNK_SIZE = 512;

/** Default overlap in lines between adjacent chunks. */
export const DEFAULT_OVERLAP_LINES = 3;

/**
 * Approximate token count for a string.
 * Uses the ~4 chars per token heuristic for English text/code.
 * This is faster than loading a full tokenizer and sufficient for chunk sizing.
 */
export function approximateTokenCount(text: string): number {
  // Rule of thumb: ~4 characters per token for English/code
  // This matches GPT-family tokenizers within ~10% for most code
  return Math.ceil(text.length / 4);
}

/**
 * Enhanced line-based chunker.
 * 
 * Algorithm adapted from KODRA's basic.ts chunker:
 * - Iterates lines, accumulating into chunks
 * - When adding a line would exceed maxChunkSize tokens, yields current chunk
 * - Preserves startLine/endLine for source location
 * - Applies overlap: the last N lines of one chunk become the first N lines of the next
 */
export function* chunkText(
  contents: string,
  maxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE,
  overlapLines: number = DEFAULT_OVERLAP_LINES,
): Generator<ChunkWithoutID> {
  if (!contents || contents.trim().length === 0) {
    return;
  }

  const lines = contents.split('\n');

  // Skip files that are too large (>1M chars — same threshold as KODRA)
  if (contents.length > 1_000_000) {
    return;
  }

  let chunkContent = '';
  let chunkTokens = 0;
  let startLine = 0;
  let currentLine = 0;
  const overlapBuffer: string[] = [];

  for (const line of lines) {
    const lineTokens = approximateTokenCount(line);

    // If adding this line would exceed the limit, yield current chunk
    if (chunkTokens + lineTokens + 1 > maxChunkSize && chunkContent.length > 0) {
      yield {
        content: chunkContent.trimEnd(),
        startLine,
        endLine: currentLine - 1,
      };

      // Start new chunk with overlap from the end of the previous chunk
      if (overlapLines > 0 && overlapBuffer.length > 0) {
        const overlap = overlapBuffer.slice(-overlapLines);
        chunkContent = overlap.join('\n') + '\n';
        chunkTokens = approximateTokenCount(chunkContent);
        startLine = currentLine - overlap.length;
      } else {
        chunkContent = '';
        chunkTokens = 0;
        startLine = currentLine;
      }
    }

    // Skip individual lines that are absurdly long (likely minified/generated)
    if (lineTokens > maxChunkSize) {
      currentLine++;
      continue;
    }

    chunkContent += line + '\n';
    chunkTokens += lineTokens + 1;
    overlapBuffer.push(line);

    // Keep the overlap buffer bounded
    if (overlapBuffer.length > overlapLines * 2) {
      overlapBuffer.splice(0, overlapBuffer.length - overlapLines * 2);
    }

    currentLine++;
  }

  // Yield the final chunk if non-empty
  if (chunkContent.trim().length > 0) {
    yield {
      content: chunkContent.trimEnd(),
      startLine,
      endLine: currentLine - 1,
    };
  }
}

/**
 * Check if a file should be chunked based on its name and content.
 * Adapted from KODRA's shouldChunk().
 */
export function shouldChunkFile(filepath: string, content: string): boolean {
  if (content.length === 0) {
    return false;
  }
  if (content.length > 1_000_000) {
    return false;
  }
  // Must have an extension (skip files like LICENSE, Makefile without extensions)
  const basename = filepath.split(/[\\/]/).pop() || '';
  return basename.includes('.');
}

/**
 * Chunk a document with full metadata.
 */
export function chunkDocument(
  filepath: string,
  contents: string,
  digest: string,
  maxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE,
): Array<{ content: string; startLine: number; endLine: number; filepath: string; digest: string; index: number }> {
  const chunks: Array<{ content: string; startLine: number; endLine: number; filepath: string; digest: string; index: number }> = [];
  let index = 0;

  for (const chunk of chunkText(contents, maxChunkSize)) {
    // Skip chunks that are too small to be useful
    if (chunk.content.trim().length < 20) {
      continue;
    }

    chunks.push({
      ...chunk,
      filepath,
      digest,
      index: index++,
    });
  }

  return chunks;
}
