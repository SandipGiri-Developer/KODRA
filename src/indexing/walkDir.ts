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

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createDefaultIgnore, parseIgnoreFile } from './ignore';
import { FileStats, FileStatsMap } from './types';
import { Logger } from '../utils/logger';
import ignore, { Ignore } from 'ignore';

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
export async function walkWorkspace(
  rootDir: string,
  options: WalkOptions = {},
): Promise<WalkResult> {
  const logger = Logger.getInstance();
  const maxFileSize = options.maxFileSize ?? 1_048_576; // 1MB default
  const files: string[] = [];
  const stats: FileStatsMap = {};

  // Build the base ignore context from defaults + user patterns
  const defaultIgnore = createDefaultIgnore(options.additionalIgnorePatterns);

  // Normalize the root directory path
  const normalizedRoot = path.resolve(rootDir);

  // DFS stack: each entry is [absolutePath, relativePathFromRoot, parentIgnoreContext]
  type StackEntry = {
    absPath: string;
    relPath: string;
    ignoreCtx: Ignore;
  };

  const stack: StackEntry[] = [{
    absPath: normalizedRoot,
    relPath: '',
    ignoreCtx: defaultIgnore,
  }];

  while (stack.length > 0) {
    // Check for cancellation
    if (options.signal?.aborted) {
      logger.info('walkWorkspace cancelled');
      break;
    }

    const current = stack.pop()!;

    let entries: string[];
    try {
      entries = await fs.readdir(current.absPath);
    } catch (error) {
      // Permission denied or inaccessible — skip silently
      logger.debug(`Cannot read directory: ${current.absPath}`);
      continue;
    }

    // Check for local ignore files in this directory
    let localIgnore = current.ignoreCtx;
    const hasGitIgnore = entries.includes('.gitignore');
    const hasKodraIgnore = entries.includes('.KODRAignore');

    if (hasGitIgnore || hasKodraIgnore) {
      // Build a new ignore context layered on top of parent
      // Precedence: .gitignore → defaults → .KODRAignore (highest)
      localIgnore = ignore();

      // Read .gitignore
      if (hasGitIgnore) {
        try {
          const gitIgnoreContent = await fs.readFile(
            path.join(current.absPath, '.gitignore'), 'utf-8',
          );
          const patterns = parseIgnoreFile(gitIgnoreContent);
          if (patterns.length > 0) {
            localIgnore.add(patterns);
          }
        } catch { /* Skip unreadable ignore files */ }
      }

      // Add default patterns
      localIgnore.add(current.ignoreCtx);

      // Read .KODRAignore (highest precedence, can un-ignore things)
      if (hasKodraIgnore) {
        try {
          const KODRAIgnoreContent = await fs.readFile(
            path.join(current.absPath, '.KODRAignore'), 'utf-8',
          );
          const patterns = parseIgnoreFile(KODRAIgnoreContent);
          if (patterns.length > 0) {
            localIgnore.add(patterns);
          }
        } catch { /* Skip unreadable ignore files */ }
      }
    }

    // Process all entries in parallel for better performance
    await Promise.all(entries.map(async (entryName) => {
      const absEntryPath = path.join(current.absPath, entryName);
      const relEntryPath = current.relPath
        ? `${current.relPath}/${entryName}`
        : entryName;

      // Stat the entry
      let entryStat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        entryStat = await fs.lstat(absEntryPath);
      } catch {
        return; // Skip entries we can't stat
      }

      // Skip symlinks (same as KODRA — avoid duplicate indexing)
      if (entryStat.isSymbolicLink()) {
        return;
      }

      const isDir = entryStat.isDirectory();

      // Check against ignore rules
      const testPath = isDir ? `${relEntryPath}/` : relEntryPath;
      try {
        if (localIgnore.ignores(testPath)) {
          return;
        }
      } catch {
        return; // Skip on ignore-checking errors
      }

      if (isDir) {
        // Push directory onto stack for DFS
        stack.push({
          absPath: absEntryPath,
          relPath: relEntryPath,
          ignoreCtx: localIgnore,
        });
      } else if (entryStat.isFile()) {
        // Skip oversized files
        if (entryStat.size > maxFileSize) {
          return;
        }

        // Skip empty files
        if (entryStat.size === 0) {
          return;
        }

        files.push(absEntryPath);

        if (options.collectStats) {
          stats[absEntryPath] = {
            lastModified: entryStat.mtimeMs,
            size: entryStat.size,
          };
        }
      }
    }));
  }

  logger.info(`walkWorkspace complete: ${files.length} files in ${normalizedRoot}`);
  return { files, stats };
}

/**
 * Walk all workspace folders.
 */
export async function walkAllWorkspaces(
  options: WalkOptions = {},
): Promise<WalkResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { files: [], stats: {} };
  }

  const allFiles: string[] = [];
  const allStats: FileStatsMap = {};

  for (const folder of folders) {
    const result = await walkWorkspace(folder.uri.fsPath, options);
    allFiles.push(...result.files);
    Object.assign(allStats, result.stats);
  }

  return { files: allFiles, stats: allStats };
}

/**
 * Check if a path is within any workspace folder.
 * Used for security boundary enforcement.
 */
export function isWithinWorkspace(filePath: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return false; }

  const normalizedPath = path.resolve(filePath);
  return folders.some(folder => {
    const normalizedFolder = path.resolve(folder.uri.fsPath);
    return normalizedPath.startsWith(normalizedFolder + path.sep) ||
           normalizedPath === normalizedFolder;
  });
}
