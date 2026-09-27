/**
 * Workspace file traversal for KODRA indexing.
 *
 * Adapted from KODRA's core/indexing/walkDir.ts DFS walker.
 * Key behaviors preserved from KODRA:
 *  - DFS traversal with an explicit stack (not recursive)
 *  - Per-directory ignore context stacking (.gitignore + .KODRAignore)
 *  - Symlink skipping
 *  - Maximum file size filtering
 *  - Workspace boundary enforcement
 */
import { FileStatsMap } from './types';
export interface WalkOptions {
    /** Additional ignore patterns from user settings */
    additionalIgnorePatterns?: string[];
    /** Maximum file size to include (bytes) */
    maxFileSize?: number;
    /** Whether to collect file stats (for incremental indexing) */
    collectStats?: boolean;
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
}
export interface WalkResult {
    /** All discovered file paths (absolute) */
    files: string[];
    /** File stats map (only if collectStats was true) */
    stats: FileStatsMap;
}
/**
 * Walk a workspace directory, respecting ignore rules.
 *
 * Design notes (adapted from KODRA's DFSWalker):
 * - Uses an explicit stack to avoid call-stack overflow on deep trees
 * - Builds ignore contexts per-directory by reading .gitignore and .KODRAignore files
 * - Applies default security ignores + user-configured patterns globally
 * - Skips symlinks, binary files, oversized files
 * - Returns absolute paths
 */
export declare function walkWorkspace(rootDir: string, options?: WalkOptions): Promise<WalkResult>;
/**
 * Walk all workspace folders.
 */
export declare function walkAllWorkspaces(options?: WalkOptions): Promise<WalkResult>;
/**
 * Check if a path is within any workspace folder.
 * Used for security boundary enforcement.
 */
export declare function isWithinWorkspace(filePath: string): boolean;
//# sourceMappingURL=walkDir.d.ts.map