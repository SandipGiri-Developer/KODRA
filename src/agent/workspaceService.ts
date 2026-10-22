  /**
 * Workspace Service Adapter for KODRA.
 * 
 * Cleanly isolates VS Code workspace APIs behind an interface so the
 * Agent Runtime, ContextManager, and Tools remain independent of VS Code globals
 * and can be unit tested without a live extension host.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

/** Maximum number of search results to hold in the in-process cache. */
const SEARCH_CACHE_MAX_ENTRIES = 20;
/** Cache entries older than this (ms) are unconditionally expired. */
const SEARCH_CACHE_TTL_MS = 5_000;

interface SearchCacheEntry {
  /** The cache key (serialised options + query). */
  key: string;
  /** Cached results. */
  results: SearchMatch[];
  /** Epoch ms when this entry was created. */
  createdAt: number;
  /** Normalized absolute paths of every file that contributed a match, used for mtime checks. */
  sourceFiles: string[];
  /** mtime (ms) of each sourceFile at the time the entry was created. */
  sourceMtimes: number[];
  /** Normalized absolute paths of directories scanned during the search. */
  scannedDirs: string[];
  /** mtime (ms) of each scanned directory when the search was executed. */
  dirMtimes: number[];
}

/**
 * Bounded search cache with TTL expiry and file-mtime invalidation.
 *
 * Invalidation policy:
 *  1. TTL: entries older than SEARCH_CACHE_TTL_MS are always considered stale.
 *  2. mtime: if any source file's mtime has changed since the entry was
 *     created the entry is dropped (file edited, deleted, or recreated).
 *  3. Directory mtime: if any scanned directory's mtime has changed, a file was
 *     added, deleted, or renamed in that directory, so the entry is invalidated.
 *  4. Explicit: call invalidate() when the workspace structure or
 *     configuration changes (e.g. folder added/removed, .gitignore updated).
 *
 * Memory: capped at SEARCH_CACHE_MAX_ENTRIES via LRU eviction (oldest first).
 */
export class SearchCache {
  private readonly entries: Map<string, SearchCacheEntry> = new Map();

  /**
   * Returns a cached SearchMatch[] if the entry is still fresh, or undefined.
   */
  async get(key: string): Promise<SearchMatch[] | undefined> {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    const now = Date.now();
    if (now - entry.createdAt > SEARCH_CACHE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    // Mtime validation: any changed source file invalidates the entry
    for (let i = 0; i < entry.sourceFiles.length; i++) {
      try {
        const st = await fs.stat(entry.sourceFiles[i]);
        if (st.mtimeMs !== entry.sourceMtimes[i]) {
          this.entries.delete(key);
          return undefined;
        }
      } catch {
        // File deleted or unreadable — entry is stale
        this.entries.delete(key);
        return undefined;
      }
    }
    // Directory mtime validation: any file added/deleted/renamed in scanned dirs invalidates the entry
    for (let i = 0; i < entry.scannedDirs.length; i++) {
      try {
        const st = await fs.stat(entry.scannedDirs[i]);
        if (st.mtimeMs !== entry.dirMtimes[i]) {
          this.entries.delete(key);
          return undefined;
        }
      } catch {
        this.entries.delete(key);
        return undefined;
      }
    }
    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.results;
  }

  /** Stores a result set. Evicts the oldest entry if the cap is exceeded. */
  set(
    key: string,
    results: SearchMatch[],
    sourceFiles: string[],
    sourceMtimes: number[],
    scannedDirs: string[] = [],
    dirMtimes: number[] = [],
  ): void {
    // Evict oldest when at capacity
    if (this.entries.size >= SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, {
      key,
      results,
      createdAt: Date.now(),
      sourceFiles,
      sourceMtimes,
      scannedDirs,
      dirMtimes,
    });
  }

  /** Clears all cache entries. Call when workspace structure or config changes. */
  invalidate(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}


export interface WorkspaceFolderInfo {
  name: string;
  fsPath: string;
  uri?: vscode.Uri;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchOptions {
  filePattern?: string;
  // Glob pattern of relative paths to exclude (e.g. "**/*.spec.ts", "dist/**")
  exclude?: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface ActiveEditorInfo {
  filePath?: string;
  language?: string;
  selectedText?: string;
}

export interface FindFilesOptions {
  excludePattern?: string;
  maxResults?: number;
}

export interface IWorkspaceService {
  getWorkspaceFolders(): WorkspaceFolderInfo[];
  getActiveWorkspaceFolder(): WorkspaceFolderInfo | undefined;
  resolvePath(rawPath: string): { resolvedPath: string; relativePath: string; inWorkspace: boolean };
  readFile(rawPath: string): Promise<string>;
  writeFile(rawPath: string, content: string | Uint8Array): Promise<void>;
  createFile(rawPath: string, content: string, overwrite?: boolean): Promise<{ path: string; bytesWritten: number }>;
  readDirectory(rawPath?: string): Promise<DirectoryEntry[]>;
  stat(rawPath: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number; mtime: number }>;
  searchFiles(query: string, options?: SearchOptions): Promise<SearchMatch[]>;
  findFiles(includePattern: string, options?: FindFilesOptions): Promise<string[]>;
  getActiveEditorInfo(): ActiveEditorInfo | undefined;
}

/**
 * Standard directories and files ignored during directory listing and search
 * unless explicitly requested.
 */
export const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.KODRA',
  '.continue',
  'dist',
  'out',
  'build',
  '.next',
  '.cache',
  'coverage',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
]);

/**
 * Helper to normalize Windows paths (drive letter casing and backslashes).
 */
export function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  if (process.platform === 'win32' && resolved.length >= 2 && resolved[1] === ':') {
    return resolved[0].toLowerCase() + resolved.slice(1);
  }
  return resolved;
}

/**
 * Resolves the real canonical filesystem path, following any symlinks or junctions.
 * If the path or a subsegment does not exist, climbs up to the nearest existing
 * ancestor, resolves its realpath, and joins the remaining segments.
 */
export function toRealPath(p: string): string {
  try {
    return fsSync.realpathSync.native ? fsSync.realpathSync.native(p) : fsSync.realpathSync(p);
  } catch {
    let current = path.resolve(p);
    const segments: string[] = [];
    while (current && current !== path.dirname(current)) {
      segments.unshift(path.basename(current));
      current = path.dirname(current);
      try {
        const real = fsSync.realpathSync.native ? fsSync.realpathSync.native(current) : fsSync.realpathSync(current);
        return path.join(real, ...segments);
      } catch {
        // continue climbing up
      }
    }
    return path.resolve(p);
  }
}

/**
 * Checks whether a given filesystem path lies within any of the workspace folders.
 * Uses path.relative(), toRealPath, and normalizePath for cross-platform reliability,
 * symlink/junction containment, and Windows casing normalization.
 */
export function isPathInWorkspace(targetFsPath: string, workspaceFolders: WorkspaceFolderInfo[]): boolean {
  if (!targetFsPath || workspaceFolders.length === 0) {
    return false;
  }
  const normTarget = normalizePath(targetFsPath);
  const realTarget = normalizePath(toRealPath(targetFsPath));

  for (const ws of workspaceFolders) {
    const normRoot = normalizePath(ws.fsPath);
    const realRoot = normalizePath(toRealPath(ws.fsPath));

    const relLexical = path.relative(normRoot, normTarget);
    const isLexicalInside = !relLexical.startsWith('..') && !path.isAbsolute(relLexical);

    const relReal = path.relative(realRoot, realTarget);
    const isRealInside = !relReal.startsWith('..') && !path.isAbsolute(relReal);

    if (isLexicalInside && isRealInside) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a vscode.Uri belongs to the current workspace.
 * First queries VS Code's getWorkspaceFolder (if available), then falls back
 * to isPathInWorkspace.
 */
export function isUriInWorkspace(uri: vscode.Uri, workspaceFolders: WorkspaceFolderInfo[]): boolean {
  if (!uri || !uri.fsPath) {
    return false;
  }
  return isPathInWorkspace(uri.fsPath, workspaceFolders);
}

export class VSCodeWorkspaceService implements IWorkspaceService {
  /** Bounded in-process cache for search results. Public for testing. */
  readonly searchCache: SearchCache = new SearchCache();

  constructor(private readonly customRoot?: string) {}

  getWorkspaceFolders(): WorkspaceFolderInfo[] {
    const folders = vscode.workspace?.workspaceFolders;

    if (this.customRoot) {
      const normalizedCustom = normalizePath(this.customRoot);
      const match = folders?.find((f) => normalizePath(f.uri.fsPath) === normalizedCustom);
      return [{
        name: match?.name ?? path.basename(this.customRoot),
        fsPath: normalizedCustom,
        uri: vscode.Uri ? vscode.Uri.file(this.customRoot) : undefined,
      }];
    }

    if (!folders || folders.length === 0) {
      return [];
    }

    return folders.map((f) => ({
      name: f.name,
      fsPath: normalizePath(f.uri.fsPath),
      uri: f.uri,
    }));
  }

  getActiveWorkspaceFolder(): WorkspaceFolderInfo | undefined {
    const folders = this.getWorkspaceFolders();
    return folders.length > 0 ? folders[0] : undefined;
  }

  resolvePath(rawPath: string): { resolvedPath: string; relativePath: string; inWorkspace: boolean } {
    const folders = this.getWorkspaceFolders();
    const ws = folders[0];
    if (!ws) {
      const resolved = normalizePath(rawPath);
      return { resolvedPath: resolved, relativePath: rawPath, inWorkspace: false };
    }

    const rootPath = normalizePath(ws.fsPath);
    const cleanedRaw = rawPath.trim();

    // If path is empty or "." or root indicators, return root
    if (!cleanedRaw || cleanedRaw === '.' || cleanedRaw === './' || cleanedRaw === '.\\') {
      return { resolvedPath: rootPath, relativePath: '', inWorkspace: true };
    }

    let candidate: string;
    if (path.isAbsolute(cleanedRaw)) {
      candidate = normalizePath(cleanedRaw);
      // Check multi-root workspace folders
      for (const f of folders) {
        const fRoot = normalizePath(f.fsPath);
        const rel = path.relative(fRoot, candidate);
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          const inWs = isPathInWorkspace(candidate, folders);
          return {
            resolvedPath: candidate,
            relativePath: rel.replace(/\\/g, '/'),
            inWorkspace: inWs,
          };
        }
      }
    } else {
      // Relative path resolution in single- and multi-root workspaces:
      const relativePart = cleanedRaw.replace(/^[/\\]+/, '');

      // Check multi-root: if relative path is prefixed with folder name (e.g. "root2/src/index.ts")
      if (folders.length > 1) {
        for (const f of folders) {
          const fRoot = normalizePath(f.fsPath);
          if (relativePart.startsWith(f.name + '/') || relativePart.startsWith(f.name + '\\')) {
            const subPart = relativePart.slice(f.name.length + 1);
            const subCandidate = normalizePath(path.join(fRoot, subPart));
            const subRel = path.relative(fRoot, subCandidate);
            if (!subRel.startsWith('..') && !path.isAbsolute(subRel)) {
              const inWs = isPathInWorkspace(subCandidate, folders);
              return {
                resolvedPath: subCandidate,
                relativePath: subRel.replace(/\\/g, '/'),
                inWorkspace: inWs,
              };
            }
          }
        }
      }

      // Default resolution against primary workspace folder
      candidate = normalizePath(path.join(rootPath, relativePart));
      const rel = path.relative(rootPath, candidate);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        const inWs = isPathInWorkspace(candidate, folders);
        return {
          resolvedPath: candidate,
          relativePath: rel.replace(/\\/g, '/'),
          inWorkspace: inWs,
        };
      }

      // If not in rootPath, check if it resolves inside any other folder
      if (folders.length > 1) {
        for (let i = 1; i < folders.length; i++) {
          const fRoot = normalizePath(folders[i].fsPath);
          const otherCandidate = normalizePath(path.join(fRoot, relativePart));
          const otherRel = path.relative(fRoot, otherCandidate);
          if (!otherRel.startsWith('..') && !path.isAbsolute(otherRel)) {
            const inWs = isPathInWorkspace(otherCandidate, folders);
            return {
              resolvedPath: otherCandidate,
              relativePath: otherRel.replace(/\\/g, '/'),
              inWorkspace: inWs,
            };
          }
        }
      }
    }

    const inWorkspace = isPathInWorkspace(candidate, folders);

    return {
      resolvedPath: candidate,
      relativePath: inWorkspace ? path.relative(rootPath, candidate).replace(/\\/g, '/') : candidate.replace(/\\/g, '/'),
      inWorkspace,
    };
  }

  async readFile(rawPath: string): Promise<string> {
    const { resolvedPath, inWorkspace } = this.resolvePath(rawPath);
    if (!inWorkspace && this.getActiveWorkspaceFolder()) {
      throw new Error(`Access denied: path "${rawPath}" is outside the active workspace.`);
    }

    // Try vscode.workspace.fs first if available
    if (vscode.workspace?.fs) {
      const uri = vscode.Uri.file(resolvedPath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }

    return await fs.readFile(resolvedPath, 'utf-8');
  }

  async writeFile(rawPath: string, content: string | Uint8Array): Promise<void> {
    const { resolvedPath, inWorkspace } = this.resolvePath(rawPath);
    if (!inWorkspace && this.getActiveWorkspaceFolder()) {
      throw new Error(`Access denied: path "${rawPath}" is outside the active workspace.`);
    }

    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;

    if (vscode.workspace?.fs) {
      const uri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.writeFile(uri, bytes);
      this.searchCache.invalidate();
      return;
    }

    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, bytes);
    this.searchCache.invalidate();
  }

  async createFile(
    rawPath: string,
    content: string,
    overwrite: boolean = false,
  ): Promise<{ path: string; bytesWritten: number }> {
    const { resolvedPath, relativePath, inWorkspace } = this.resolvePath(rawPath);
    if (!inWorkspace && this.getActiveWorkspaceFolder()) {
      throw new Error(`Access denied: path "${rawPath}" is outside the active workspace.`);
    }

    // Check if file already exists
    let exists = false;
    try {
      const st = await this.stat(rawPath);
      if (st.isDirectory) {
        throw new Error(`Cannot create file: "${rawPath}" is already an existing directory.`);
      }
      exists = true;
    } catch {
      exists = false;
    }

    if (exists && !overwrite) {
      throw new Error(
        `File already exists: "${relativePath}". Use edit_file to modify it, or set overwrite: true to overwrite.`,
      );
    }

    // Ensure parent directory exists
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });

    const encoded = new TextEncoder().encode(content);
    if (vscode.workspace?.fs) {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(resolvedPath), encoded);
    } else {
      await fs.writeFile(resolvedPath, encoded);
    }
    this.searchCache.invalidate();

    return {
      path: relativePath,
      bytesWritten: encoded.byteLength,
    };
  }

  async readDirectory(rawPath: string = ''): Promise<DirectoryEntry[]> {
    const { resolvedPath, inWorkspace } = this.resolvePath(rawPath);
    if (!inWorkspace && this.getActiveWorkspaceFolder()) {
      throw new Error(`Access denied: path "${rawPath}" is outside the active workspace.`);
    }

    // Check if target is a file
    const st = await this.stat(rawPath);
    if (!st.isDirectory) {
      throw new Error(`Path "${rawPath}" is a file, not a directory. Use read_file to inspect files.`);
    }

    const results: DirectoryEntry[] = [];

    if (vscode.workspace?.fs?.readDirectory) {
      try {
        const uri = vscode.Uri.file(resolvedPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        for (const [name, fileType] of entries) {
          const isDir = (fileType & vscode.FileType.Directory) !== 0;
          const isFile = (fileType & vscode.FileType.File) !== 0;
          results.push({ name, isDirectory: isDir, isFile });
        }
        return results;
      } catch {
        // Fall back to fs.readdir
      }
    }

    const dirents = await fs.readdir(resolvedPath);
    for (const name of dirents) {
      try {
        const entryStat = await fs.stat(path.join(resolvedPath, name));
        results.push({
          name,
          isDirectory: entryStat.isDirectory(),
          isFile: entryStat.isFile(),
          size: entryStat.size,
        });
      } catch {
        // Skip un-statable entries
      }
    }

    return results;
  }

  async stat(rawPath: string): Promise<{ isDirectory: boolean; isFile: boolean; size: number; mtime: number }> {
    const { resolvedPath, inWorkspace } = this.resolvePath(rawPath);
    if (!inWorkspace && this.getActiveWorkspaceFolder()) {
      throw new Error(`Access denied: path "${rawPath}" is outside the active workspace.`);
    }

    if (vscode.workspace?.fs?.stat) {
      try {
        const uri = vscode.Uri.file(resolvedPath);
        const st = await vscode.workspace.fs.stat(uri);
        const isDir = (st.type & vscode.FileType.Directory) !== 0;
        const isFile = (st.type & vscode.FileType.File) !== 0;
        return {
          isDirectory: isDir,
          isFile,
          size: st.size,
          mtime: st.mtime,
        };
      } catch (err: any) {
        if (err.code === 'FileNotFound' || String(err).includes('FileNotFound')) {
          const notFound = new Error(`File or directory not found: "${rawPath}"`);
          (notFound as any).code = 'ENOENT';
          throw notFound;
        }
      }
    }

    try {
      const st = await fs.stat(resolvedPath);
      return {
        isDirectory: st.isDirectory(),
        isFile: st.isFile(),
        size: st.size,
        mtime: st.mtimeMs,
      };
    } catch (err: any) {
      const notFound = new Error(`File or directory not found: "${rawPath}"`);
      (notFound as any).code = 'ENOENT';
      throw notFound;
    }
  }

  async searchFiles(query: string, options: SearchOptions = {}): Promise<SearchMatch[]> {
    // Gather all workspace roots. Searching only the first root misses files in
    // additional roots of a multi-root workspace.
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) {
      return [];
    }

    const maxResults = options.maxResults ?? 50;
    const isRegex = options.isRegex ?? false;
    const caseSensitive = options.caseSensitive ?? false;

    // Build a deterministic cache key from all options that affect results.
    const cacheKey = JSON.stringify({
      q: query,
      fp: options.filePattern ?? null,
      ex: options.exclude ?? null,
      rx: isRegex,
      cs: caseSensitive,
      mr: maxResults,
      roots: folders.map((f) => f.fsPath),
    });

    // Check cache before walking the filesystem
    const cached = await this.searchCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let regex: RegExp;
    try {
      regex = isRegex
        ? new RegExp(query, caseSensitive ? 'g' : 'gi')
        : new RegExp(escapeRegex(query), caseSensitive ? 'g' : 'gi');
    } catch (e: any) {
      throw new Error(`Invalid search query pattern: ${e.message}`);
    }

    const matches: SearchMatch[] = [];

    // Helper: true when a directory/file entry name should always be skipped.
    const isIgnoredEntry = (name: string): boolean =>
      DEFAULT_IGNORED_DIRS.has(name) || name.startsWith('.');

    // De-duplicate files across roots (normalized absolute path → already visited)
    const visitedFiles = new Set<string>();
    // Track files that actually contributed to results for mtime-based invalidation
    const matchedAbsPaths: string[] = [];
    const matchedMtimes: number[] = [];
    // Track scanned directories and their mtimes for directory-mtime-based invalidation (e.g. file creation/deletion)
    const scannedDirs: string[] = [];
    const dirMtimes: number[] = [];

    for (const folder of folders) {
      if (matches.length >= maxResults) {
        break;
      }

      const rootPath = normalizePath(folder.fsPath);

      // BFS directory walk for this root
      const fileQueue: string[] = [];
      const dirQueue: string[] = [rootPath];

      while (dirQueue.length > 0 && matches.length < maxResults) {
        const currentDir = dirQueue.shift()!;
        try {
          const dirStat = await fs.stat(currentDir);
          scannedDirs.push(normalizePath(currentDir));
          dirMtimes.push(dirStat.mtimeMs);
        } catch {
          // Skip if unable to stat dir
        }
        let entryNames: string[];
        try {
          entryNames = await fs.readdir(currentDir);
        } catch {
          continue;
        }

        for (const entryName of entryNames) {
          if (isIgnoredEntry(entryName)) {
            continue;
          }

          const fullPath = path.join(currentDir, entryName);
          const relFromRoot = path.relative(rootPath, fullPath).replace(/\\/g, '/');
          try {
            const st = await fs.stat(fullPath);
            if (st.isDirectory()) {
              if (options.exclude && matchesPattern(relFromRoot, options.exclude)) {
                continue;
              }
              if (!isPathInWorkspace(fullPath, folders)) {
                continue;
              }
              dirQueue.push(fullPath);
            } else if (st.isFile()) {
              if (!isPathInWorkspace(fullPath, folders)) {
                continue;
              }
              if (options.filePattern && !matchesPattern(relFromRoot, options.filePattern)) {
                continue;
              }
              if (options.exclude && matchesPattern(relFromRoot, options.exclude)) {
                continue;
              }
              const normFull = normalizePath(fullPath);
              if (!visitedFiles.has(normFull)) {
                visitedFiles.add(normFull);
                fileQueue.push(fullPath);
              }
            }
          } catch {
            // Skip un-statable entries (broken symlinks, permission errors, etc.)
          }
        }
      }

      // Search inside candidate files collected from this root
      for (const filePath of fileQueue) {
        if (matches.length >= maxResults) {
          break;
        }

        // Relative path for display: prefer root-relative, prefix with root name in multi-root
        const relPath =
          folders.length > 1
            ? `${folder.name}/${path.relative(rootPath, filePath).replace(/\\/g, '/')}`
            : path.relative(rootPath, filePath).replace(/\\/g, '/');

        let content: string;
        let fileMtime: number;
        try {
          const stat = await fs.stat(filePath);
          // Skip files > 500 KB or empty files to bound memory usage
          if (stat.size > 512_000 || stat.size === 0) {
            continue;
          }
          fileMtime = stat.mtimeMs;
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          continue;
        }

        if (isBinaryString(content)) {
          continue;
        }

        // Track every inspected candidate file for cache mtime invalidation
        matchedAbsPaths.push(normalizePath(filePath));
        matchedMtimes.push(fileMtime);

        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          if (regex.test(line)) {
            matches.push({
              file: relPath,
              line: i + 1,
              content: line.trim(),
            });
            if (matches.length >= maxResults) {
              break;
            }
          }
        }
      }
    }

    // Populate cache (only non-error, complete results)
    this.searchCache.set(cacheKey, matches, matchedAbsPaths, matchedMtimes, scannedDirs, dirMtimes);

    return matches;
  }


  async findFiles(includePattern: string, options: FindFilesOptions = {}): Promise<string[]> {
    const maxResults = options.maxResults ?? 100;
    const excludePattern = options.excludePattern;

    // Use vscode.workspace.findFiles if available
    if (vscode.workspace?.findFiles && !this.customRoot) {
      try {
        const uris = await vscode.workspace.findFiles(
          includePattern,
          excludePattern ? excludePattern : null,
          maxResults,
        );
        const folders = this.getWorkspaceFolders();
        const validUris = uris.filter((u) => isUriInWorkspace(u, folders));
        return validUris.map((u) => vscode.workspace.asRelativePath(u, false));
      } catch {
        // Fall back to manual filesystem walk
      }
    }

    // Fallback: search across all workspace folders
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) {
      return [];
    }

    const matchedFiles: string[] = [];
    const isMultiRoot = folders.length > 1;

    for (const folder of folders) {
      if (matchedFiles.length >= maxResults) {
        break;
      }
      const rootPath = normalizePath(folder.fsPath);
      const dirQueue: string[] = [rootPath];

      while (dirQueue.length > 0 && matchedFiles.length < maxResults) {
        const currentDir = dirQueue.shift()!;
        let entryNames: string[];
        try {
          entryNames = await fs.readdir(currentDir);
        } catch {
          continue;
        }

        for (const entryName of entryNames) {
          if (matchedFiles.length >= maxResults) {
            break;
          }
          if (DEFAULT_IGNORED_DIRS.has(entryName) || entryName.startsWith('.')) {
            continue;
          }

          const fullPath = path.join(currentDir, entryName);
          const relFromRoot = path.relative(rootPath, fullPath).replace(/\\/g, '/');

          try {
            const st = await fs.stat(fullPath);
            if (st.isDirectory()) {
              if (!isPathInWorkspace(fullPath, folders)) {
                continue;
              }
              if (excludePattern && matchesPattern(relFromRoot, excludePattern)) {
                continue;
              }
              dirQueue.push(fullPath);
            } else if (st.isFile()) {
              if (!isPathInWorkspace(fullPath, folders)) {
                continue;
              }
              if (includePattern && !matchesPattern(relFromRoot, includePattern)) {
                continue;
              }
              if (excludePattern && matchesPattern(relFromRoot, excludePattern)) {
                continue;
              }
              const displayPath = isMultiRoot ? `${folder.name}/${relFromRoot}` : relFromRoot;
              matchedFiles.push(displayPath);
            }
          } catch {
            // Ignore stat errors
          }
        }
      }
    }

    return matchedFiles;
  }

  getActiveEditorInfo(): ActiveEditorInfo | undefined {
    const editor = vscode.window?.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const doc = editor.document;
    const ws = this.getActiveWorkspaceFolder();
    let filePath = doc.uri.fsPath;
    if (ws) {
      const rel = path.relative(ws.fsPath, filePath);
      if (!rel.startsWith('..')) {
        filePath = rel.replace(/\\/g, '/');
      }
    }

    const selection = editor.selection;
    const selectedText = selection && !selection.isEmpty
      ? doc.getText(selection)
      : undefined;

    return {
      filePath,
      language: doc.languageId,
      selectedText,
    };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(glob: string): string {
  const norm = glob.replace(/\\/g, '/');
  let regex = '';
  let i = 0;
  while (i < norm.length) {
    const c = norm[i];
    if (c === '*') {
      if (norm[i + 1] === '*') {
        if (norm[i + 2] === '/') {
          regex += '(?:.+/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        regex += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      regex += '[^/]';
      i += 1;
    } else if ('[.+^${}()|\\]'.includes(c)) {
      regex += '\\' + c;
      i += 1;
    } else {
      regex += c;
      i += 1;
    }
  }
  return '^' + regex + '$';
}

/**
 * Matches a relative file path against a glob pattern.
 * `relPath`  — forward-slash relative path from workspace root (e.g. "src/utils.ts")
 * `pattern`  — glob pattern (e.g. "*.ts", "src/**", "**\/*.spec.ts", "dist/**")
 *
 * Supports:
 *   *.ext          — any file with that extension at any depth
 *   dir/**         — anything inside dir (recursive)
 *   **\/*.ext      — any .ext file at any depth
 *   dir/**\/*.ts   — .ts files anywhere under dir
 *   plain text     — substring match fallback
 */
export function matchesPattern(relPath: string, pattern: string): boolean {
  const rel = relPath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');

  try {
    // If pattern contains no slashes, match against either the basename or the full path
    if (!pat.includes('/')) {
      const base = rel.split('/').pop() || rel;
      const rx = new RegExp(globToRegex(pat), 'i');
      return rx.test(base) || rx.test(rel);
    }
    const rx = new RegExp(globToRegex(pat), 'i');
    return rx.test(rel) || rx.test(rel + '/');
  } catch {
    return rel.includes(pat);
  }
}

function isBinaryString(content: string): boolean {
  const checkLen = Math.min(content.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (content.charCodeAt(i) === 0) {
      return true;
    }
  }
  return false;
}
