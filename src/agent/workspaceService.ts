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
  isRegex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface ActiveEditorInfo {
  filePath?: string;
  language?: string;
  selectedText?: string;
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

export class VSCodeWorkspaceService implements IWorkspaceService {
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
    const ws = this.getActiveWorkspaceFolder();
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
    } else {
      // Check if raw path starts with leading slash
      const relativePart = cleanedRaw.replace(/^[/\\]+/, '');
      candidate = normalizePath(path.join(rootPath, relativePart));
    }

    const rel = path.relative(rootPath, candidate);
    const inWorkspace = !rel.startsWith('..') && !path.isAbsolute(rel);

    return {
      resolvedPath: candidate,
      relativePath: inWorkspace ? rel.replace(/\\/g, '/') : candidate.replace(/\\/g, '/'),
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
      return;
    }

    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, bytes);
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
    const ws = this.getActiveWorkspaceFolder();
    if (!ws) {
      return [];
    }

    const rootPath = normalizePath(ws.fsPath);
    const maxResults = options.maxResults ?? 50;
    const isRegex = options.isRegex ?? false;
    const caseSensitive = options.caseSensitive ?? false;

    let regex: RegExp;
    try {
      regex = isRegex
        ? new RegExp(query, caseSensitive ? 'g' : 'gi')
        : new RegExp(escapeRegex(query), caseSensitive ? 'g' : 'gi');
    } catch (e: any) {
      throw new Error(`Invalid search query pattern: ${e.message}`);
    }

    const matches: SearchMatch[] = [];

    // Helper to test if a file or directory should be ignored
    const isIgnored = (name: string): boolean => DEFAULT_IGNORED_DIRS.has(name) || name.startsWith('.');

    // Collect candidate files
    const fileQueue: string[] = [];
    const dirQueue: string[] = [rootPath];

    while (dirQueue.length > 0 && matches.length < maxResults) {
      const currentDir = dirQueue.shift()!;
      let entryNames: string[];
      try {
        entryNames = await fs.readdir(currentDir);
      } catch {
        continue;
      }

      for (const entryName of entryNames) {
        if (isIgnored(entryName)) {
          continue;
        }

        const fullPath = path.join(currentDir, entryName);
        try {
          const st = await fs.stat(fullPath);
          if (st.isDirectory()) {
            dirQueue.push(fullPath);
          } else if (st.isFile()) {
            if (options.filePattern && !matchesPattern(entryName, options.filePattern)) {
              continue;
            }
            fileQueue.push(fullPath);
          }
        } catch {
          // Skip un-statable entries
        }
      }
    }

    // Search inside candidate files
    for (const filePath of fileQueue) {
      if (matches.length >= maxResults) {
        break;
      }

      const relPath = path.relative(rootPath, filePath).replace(/\\/g, '/');

      let content: string;
      try {
        const stat = await fs.stat(filePath);
        // Skip files > 500KB to avoid memory/perf issues
        if (stat.size > 512_000 || stat.size === 0) {
          continue;
        }
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      // Check if file is likely binary
      if (isBinaryString(content)) {
        continue;
      }

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

    return matches;
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

function matchesPattern(filename: string, pattern: string): boolean {
  // Simple glob-to-regex for patterns like *.ts, *.json, src/*
  const clean = pattern.replace(/^\*\./, '');
  if (pattern.startsWith('*.')) {
    return filename.endsWith(`.${clean}`);
  }
  if (pattern.includes('*')) {
    const rx = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return rx.test(filename);
  }
  return filename.includes(pattern);
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
