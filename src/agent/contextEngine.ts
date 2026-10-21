/**
 * Context Engine for KODRA.
 *
 * Lightweight, architecture-aware workspace memory that prevents agents from
 * repeatedly exploring directories and re-reading unchanged files across tasks
 * when verified knowledge is already available.
 *
 * Phase 1 Capabilities:
 * 1. Distinguishes between discovered directories, inspected files, and evidence-backed findings.
 * 2. Deterministic, zero-LLM metadata extraction for key project files (package.json, README, configs, code exports).
 * 3. Robust file freshness validation: modified files stay stale until reread; deleted files safely invalidated.
 * 4. Bounded context: strict total character limit, deduplication, and task-driven relevance selection.
 * 5. Redundant exploration prevention without blocking necessary missing/stale investigation.
 * 6. Workspace-scoped persistence using Kodra's StorageManager with failure isolation and sanitized logging.
 */

import * as path from 'path';
import { StorageManager } from '../storage/storageManager';
import { WorkspaceRegistry } from '../storage/workspaceRegistry';
import { Logger } from '../utils/logger';
import { IWorkspaceService, VSCodeWorkspaceService } from './workspaceService';

export type FileStatus = 'fresh' | 'stale' | 'deleted';

export interface FileObservation {
  filePath: string;
  mtime: number;
  size: number;
  lastInspected: number;
  totalLines?: number;
  summary?: string;
  status: FileStatus;
}

export interface DirectoryObservation {
  path: string;
  entries: string[];
  lastDiscovered: number;
}

export interface SearchObservation {
  query: string;
  matchCount: number;
  lastExecuted: number;
}

export interface ContextFinding {
  id: string;
  category: 'manifest' | 'config' | 'documentation' | 'symbols' | 'file_summary';
  sourceFile: string;
  sourceMtime: number;
  text: string;
  timestamp: number;
  lineRange?: string;
  symbols?: string[];
}

export interface ContextEngineState {
  workspaceId: string;
  workspacePath: string;
  version: number;
  lastSaved: number;
  directories: Record<string, DirectoryObservation>;
  files: Record<string, FileObservation>;
  findings: ContextFinding[];
  searches?: Record<string, SearchObservation>;
}

export interface VerifiedContextOptions {
  maxCharacters?: number;
  maxFindings?: number;
  maxDirectories?: number;
}

export interface IContextEngine {
  /** Record directory contents discovered via list_directory or workspace exploration */
  recordDirectoryListing(dirPath: string, entries: string[]): void;

  /** Record code search observation */
  recordSearch(query: string, matchCount: number): void;

  /** Record a file read and extract deterministic lightweight findings */
  recordFileRead(filePath: string, content: string, stat?: { mtime: number; size: number }): Promise<void>;

  /** Record that a file was modified or created (e.g. via edit_file / create_file) */
  recordFileModified(filePath: string): Promise<void>;

  /** Handle tool completion event */
  recordToolCompletion(
    toolName: string,
    args: Record<string, unknown>,
    result: { content: string; success: boolean; filepath?: string; metadata?: Record<string, unknown> },
  ): Promise<void>;

  /** Check freshness of tracked files against current workspace state */
  checkFreshness(): Promise<void>;

  /** Get verified context formatted for inclusion in system instructions */
  getVerifiedContext(userTask?: string, options?: VerifiedContextOptions): Promise<string>;

  /** Check if any verified context exists */
  hasContext(): boolean;

  /** Check if a specific file is tracked and currently verified fresh */
  isFresh(filePath: string): boolean;

  /** Check if a directory has already been explored */
  hasDirectory(dirPath: string): boolean;

  /** Save persistent state to storage */
  save(): Promise<void>;

  /** Load persistent state from storage */
  load(): Promise<void>;

  /** Clear all in-memory and persistent context */
  clear(): Promise<void>;

  /** Inspect internal state (for testing and verification) */
  getState(): Readonly<ContextEngineState>;
}

export class ContextEngine implements IContextEngine {
  private readonly logger = Logger.getInstance();
  private state: ContextEngineState;
  private readonly customStoragePath?: string;

  constructor(
    private readonly workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
    options?: { customStoragePath?: string; initialState?: Partial<ContextEngineState> },
  ) {
    this.customStoragePath = options?.customStoragePath;
    const ws = this.workspaceService.getActiveWorkspaceFolder();
    const wsPath = ws?.fsPath || '';
    const wsId = wsPath ? WorkspaceRegistry.getWorkspaceId(wsPath) : 'global';

    this.state = {
      workspaceId: wsId,
      workspacePath: wsPath,
      version: 1,
      lastSaved: 0,
      directories: {},
      files: {},
      findings: [],
      searches: {},
      ...options?.initialState,
    };
  }

  /**
   * Factory method to create a ContextEngine for a given workspace service.
   */
  public static createForWorkspace(
    workspaceService: IWorkspaceService = new VSCodeWorkspaceService(),
    customStoragePath?: string,
  ): ContextEngine {
    return new ContextEngine(workspaceService, { customStoragePath });
  }

  /**
   * Sanitize error message to ensure no secrets or sensitive tokens are logged.
   */
  private sanitizeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return raw
      .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
      .replace(/(?:key|token|secret|password|auth)=([^\s&]+)/gi, '$1=[REDACTED]')
      .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]');
  }

  /**
   * Normalize workspace-relative path for consistent keying.
   */
  private normalizePath(rawPath: string): string {
    if (!rawPath || rawPath === '.' || rawPath === './' || rawPath === '/') {
      return '.';
    }
    const { relativePath } = this.workspaceService.resolvePath(rawPath);
    let normalized = relativePath.replace(/\\/g, '/');
    while (normalized.startsWith('./')) {
      normalized = normalized.slice(2);
    }
    while (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    return normalized || '.';
  }

  /**
   * Determine target storage file path.
   */
  private getStoragePath(): string | null {
    if (this.customStoragePath) {
      return this.customStoragePath;
    }
    try {
      const storageManager = StorageManager.getInstance();
      const ws = this.workspaceService.getActiveWorkspaceFolder();
      const wsPath = ws?.fsPath || this.state.workspacePath;
      const wsId = wsPath ? WorkspaceRegistry.getWorkspaceId(wsPath) : 'global';
      return path.join(storageManager.workspacesDir, wsId, 'context-engine.json');
    } catch {
      // StorageManager not initialized yet (e.g. standalone test environment)
      return null;
    }
  }

  /**
   * Record a directory listing.
   */
  public recordDirectoryListing(dirPath: string, entries: string[]): void {
    const norm = this.normalizePath(dirPath);
    // Sanitize entries: only take names, remove empties, limit to max 50 items
    const cleanEntries = entries
      .map((e) => e.trim())
      .filter(Boolean)
      .slice(0, 50);

    this.state.directories[norm] = {
      path: norm,
      entries: cleanEntries,
      lastDiscovered: Date.now(),
    };
  }

  /**
   * Record a code search observation.
   */
  public recordSearch(query: string, matchCount: number): void {
    if (!this.state.searches) {
      this.state.searches = {};
    }
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return;
    }
    this.state.searches[cleanQuery.toLowerCase()] = {
      query: cleanQuery,
      matchCount,
      lastExecuted: Date.now(),
    };
  }

  /**
   * Record a file read and extract deterministic lightweight findings.
   */
  public async recordFileRead(
    filePath: string,
    content: string,
    stat?: { mtime: number; size: number },
  ): Promise<void> {
    const norm = this.normalizePath(filePath);

    // Resolve stat if not provided
    let fileStat = stat;
    if (!fileStat) {
      try {
        const s = await this.workspaceService.stat(filePath);
        fileStat = { mtime: s.mtime, size: s.size };
      } catch {
        fileStat = { mtime: Date.now(), size: Buffer.byteLength(content, 'utf-8') };
      }
    }

    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    // Extract lightweight deterministic findings with line and symbol references
    const { summary, findings } = this.extractDeterministicFindings(norm, content, lines, fileStat.mtime);

    // Update file observation with verified current content state
    this.state.files[norm] = {
      filePath: norm,
      mtime: fileStat.mtime,
      size: fileStat.size,
      lastInspected: Date.now(),
      totalLines,
      summary,
      status: 'fresh',
    };

    // Replace any previous findings for this file to prevent duplicates
    this.state.findings = this.state.findings.filter((f) => f.sourceFile !== norm);
    this.state.findings.push(...findings);
  }

  /**
   * Deterministic evidence extractors without calling any external model.
   * Preserves source paths and line/symbol references.
   */
  private extractDeterministicFindings(
    filePath: string,
    content: string,
    lines: string[],
    sourceMtime: number,
  ): { summary: string; findings: ContextFinding[] } {
    const findings: ContextFinding[] = [];
    const baseName = path.basename(filePath).toLowerCase();
    const now = Date.now();

    // 1. package.json
    if (baseName === 'package.json') {
      try {
        const pkg = JSON.parse(content);
        const name = pkg.name || 'unnamed';
        const version = pkg.version || '0.0.0';
        const scripts = Object.keys(pkg.scripts || {}).slice(0, 10).join(', ');
        const main = pkg.main || pkg.module || 'index.js';
        const deps = Object.keys(pkg.dependencies || {}).slice(0, 8).join(', ');

        const text = `Package manifest '${name}' (v${version}): main='${main}'${
          scripts ? `, scripts=[${scripts}]` : ''
        }${deps ? `, dependencies=[${deps}]` : ''}`;

        findings.push({
          id: `manifest_${filePath}`,
          category: 'manifest',
          sourceFile: filePath,
          sourceMtime,
          text,
          timestamp: now,
          lineRange: `1-${lines.length}`,
          symbols: [name, main],
        });

        return {
          summary: `Manifest: ${name}@${version}, main: ${main}`,
          findings,
        };
      } catch {
        // malformed package.json
      }
    }

    // 2. tsconfig.json
    if (baseName === 'tsconfig.json' || baseName.startsWith('tsconfig.')) {
      try {
        // Strip comments for relaxed JSON parsing
        const stripped = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
        const tsconfig = JSON.parse(stripped);
        const target = tsconfig.compilerOptions?.target || 'unknown';
        const outDir = tsconfig.compilerOptions?.outDir || 'none';
        const moduleType = tsconfig.compilerOptions?.module || 'unknown';

        const text = `TypeScript config: target='${target}', module='${moduleType}', outDir='${outDir}'`;
        findings.push({
          id: `config_${filePath}`,
          category: 'config',
          sourceFile: filePath,
          sourceMtime,
          text,
          timestamp: now,
          lineRange: `1-${lines.length}`,
          symbols: [target, outDir],
        });

        return {
          summary: `TypeScript config: target=${target}, outDir=${outDir}`,
          findings,
        };
      } catch {
        // ignore JSON parse errors in tsconfig comments
      }
    }

    // 3. README.md
    if (baseName.startsWith('readme')) {
      const headingMatch = content.match(/^#\s+(.+)$/m);
      const heading = headingMatch ? headingMatch[1].trim() : 'Project Documentation';

      // Find first non-empty descriptive paragraph
      const paragraphs = content
        .split(/\r?\n\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith('#') && !p.startsWith('!'));
      const firstPara = paragraphs[0] ? paragraphs[0].replace(/[\r\n]+/g, ' ').slice(0, 200) : '';

      const text = `README (${heading}): ${firstPara}`;
      findings.push({
        id: `doc_${filePath}`,
        category: 'documentation',
        sourceFile: filePath,
        sourceMtime,
        text,
        timestamp: now,
        lineRange: `1-${lines.length}`,
        symbols: [heading],
      });

      return {
        summary: `Overview: ${heading}`,
        findings,
      };
    }

    // 4. Source code files (.ts, .tsx, .js, .jsx, .py, .go, .rs, .java)
    const ext = path.extname(filePath).toLowerCase();
    const codeExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c']);

    if (codeExts.has(ext)) {
      const symbols: string[] = [];
      const exportRegex = /export\s+(?:default\s+)?(?:async\s+)?(class|interface|type|function|const|enum|struct)\s+([a-zA-Z0-9_$]+)/g;
      let match: RegExpExecArray | null;

      while ((match = exportRegex.exec(content)) !== null) {
        symbols.push(`${match[1]} ${match[2]}`);
        if (symbols.length >= 8) {
          break;
        }
      }

      if (symbols.length > 0) {
        const symbolNames = symbols.map((s) => s.split(' ')[1] || s);
        const text = `${filePath} (lines 1-${lines.length}) exports: ${symbols.join(', ')}`;
        findings.push({
          id: `symbols_${filePath}`,
          category: 'symbols',
          sourceFile: filePath,
          sourceMtime,
          text,
          timestamp: now,
          lineRange: `1-${lines.length}`,
          symbols: symbolNames,
        });

        return {
          summary: `${lines.length} lines. Exports: ${symbols.join(', ')}`,
          findings,
        };
      }
    }

    // Default summary
    return {
      summary: `${lines.length} lines`,
      findings,
    };
  }

  /**
   * Record that a file was modified or created (e.g. via edit_file / create_file).
   * Note: The file remains 'stale' until it is reread and verified via recordFileRead.
   */
  public async recordFileModified(filePath: string): Promise<void> {
    const norm = this.normalizePath(filePath);
    const existing = this.state.files[norm];
    if (existing) {
      existing.status = 'stale';
    }
    try {
      const stat = await this.workspaceService.stat(filePath);
      if (!stat || stat.isDirectory) {
        if (existing) {
          existing.status = 'deleted';
        }
      }
    } catch {
      if (existing) {
        existing.status = 'deleted';
      }
    }
  }

  /**
   * Handle tool completion event.
   */
  public async recordToolCompletion(
    toolName: string,
    args: Record<string, unknown>,
    result: { content: string; success: boolean; filepath?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    if (!result.success) {
      return;
    }

    try {
      // 1. Directory listing tool
      if (toolName === 'list_directory') {
        const rawDir =
          typeof args.path === 'string'
            ? args.path
            : typeof args.dir === 'string'
            ? args.dir
            : typeof args.directory === 'string'
            ? args.directory
            : '';

        // Parse entries from result content (lines starting with [DIR] or [FILE])
        const entries: string[] = [];
        const lines = result.content.split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^\[(DIR|FILE)\]\s+(.+)$/);
          if (match) {
            entries.push(match[2].trim());
          }
        }

        if (entries.length > 0) {
          this.recordDirectoryListing(rawDir, entries);
        } else {
          // Fallback to reading directory directly if content format differed
          try {
            const dirEntries = await this.workspaceService.readDirectory(rawDir);
            this.recordDirectoryListing(
              rawDir,
              dirEntries.map((e) => (e.isDirectory ? `${e.name}/` : e.name)),
            );
          } catch {
            // non-fatal
          }
        }
      }

      // 2. Search code tool
      if (toolName === 'search_code') {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (query) {
          const matchCount =
            typeof result.metadata?.matchCount === 'number'
              ? result.metadata.matchCount
              : (result.content.match(/\n/g)?.length || 0);
          this.recordSearch(query, matchCount);
        }
      }

      // 3. Read file tool
      if (toolName === 'read_file') {
        const rawPath =
          result.filepath ||
          (typeof args.file === 'string'
            ? args.file
            : typeof args.filePath === 'string'
            ? args.filePath
            : typeof args.path === 'string'
            ? args.path
            : '');

        if (rawPath) {
          try {
            // Read the full file content from workspace service to record complete observations
            const fullContent = await this.workspaceService.readFile(rawPath);
            await this.recordFileRead(rawPath, fullContent);
          } catch {
            // Non-fatal
          }
        }
      }

      // 4. Edit or Create file tools
      if (toolName === 'edit_file' || toolName === 'create_file') {
        const rawPath =
          result.filepath ||
          (typeof args.file === 'string'
            ? args.file
            : typeof args.filePath === 'string'
            ? args.filePath
            : typeof args.path === 'string'
            ? args.path
            : '');

        if (rawPath) {
          await this.recordFileModified(rawPath);
        }
      }
    } catch (err) {
      this.logger.warn('Error recording tool completion in ContextEngine (non-fatal)', this.sanitizeError(err));
    }
  }

  /**
   * Check freshness of tracked files against current workspace state.
   * Ensures modified/stale files remain stale until reread via recordFileRead.
   */
  public async checkFreshness(): Promise<void> {
    for (const [normPath, obs] of Object.entries(this.state.files)) {
      try {
        const stat = await this.workspaceService.stat(normPath);
        if (!stat || stat.isDirectory) {
          obs.status = 'deleted';
        } else if (obs.status === 'stale') {
          // IMPORTANT: A file marked stale must remain stale until reread and refreshed
          // via recordFileRead, even if current stat happens to match.
        } else if (stat.mtime !== obs.mtime || stat.size !== obs.size) {
          obs.status = 'stale';
        } else {
          obs.status = 'fresh';
        }
      } catch {
        obs.status = 'deleted';
      }
    }
  }

  /**
   * Check if any verified context exists.
   */
  public hasContext(): boolean {
    const hasDirs = Object.keys(this.state.directories).length > 0;
    const hasFiles = Object.values(this.state.files).some((f) => f.status === 'fresh');
    return hasDirs || hasFiles;
  }

  /**
   * Check if a specific file is tracked and currently verified fresh.
   */
  public isFresh(filePath: string): boolean {
    const norm = this.normalizePath(filePath);
    return this.state.files[norm]?.status === 'fresh';
  }

  /**
   * Check if a directory has already been explored.
   */
  public hasDirectory(dirPath: string): boolean {
    const norm = this.normalizePath(dirPath);
    return Boolean(this.state.directories[norm]);
  }

  /**
   * Extract keywords from user task for relevance ranking.
   */
  private extractTaskKeywords(task?: string): string[] {
    if (!task) {
      return [];
    }
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'what', 'how', 'where', 'this', 'that',
      'from', 'into', 'explain', 'tell', 'read', 'find', 'show', 'please',
      'file', 'files', 'project', 'repo', 'codebase', 'some', 'about', 'there',
      'when', 'which', 'will', 'have', 'does', 'check', 'give', 'make', 'code',
    ]);
    const words = task
      .toLowerCase()
      .replace(/[^a-z0-9_.\-\/]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    return Array.from(new Set(words));
  }

  /**
   * Score finding relevance against user task keywords.
   */
  private scoreFindingRelevance(
    finding: ContextFinding,
    taskTokens: string[],
    fileObs?: FileObservation,
  ): number {
    if (taskTokens.length === 0) {
      if (finding.category === 'manifest') {
        return 100;
      }
      if (finding.category === 'config') {
        return 80;
      }
      if (finding.category === 'documentation') {
        return 60;
      }
      return 40;
    }

    let score = 0;
    const textLower = finding.text.toLowerCase();
    const fileLower = finding.sourceFile.toLowerCase();
    const baseName = path.basename(finding.sourceFile).toLowerCase();

    for (const token of taskTokens) {
      if (baseName === token || fileLower.endsWith('/' + token)) {
        score += 60;
      } else if (fileLower.includes(token)) {
        score += 30;
      }

      if (finding.symbols?.some((s) => s.toLowerCase().includes(token))) {
        score += 50;
      }

      if (textLower.includes(token)) {
        score += 20;
      }
    }

    // Base priority for manifests/configs if no specific token matched
    if (finding.category === 'manifest') {
      score += 10;
    } else if (finding.category === 'config') {
      score += 5;
    }

    return score;
  }

  /**
   * Format verified context for prompt injection.
   * Enforces bounded size, task-driven relevance, duplicate removal, and failure isolation.
   */
  public async getVerifiedContext(
    userTask?: string,
    options?: VerifiedContextOptions,
  ): Promise<string> {
    try {
      await this.checkFreshness();
    } catch (err) {
      this.logger.warn('Error during checkFreshness (non-fatal)', this.sanitizeError(err));
    }

    const maxChars = options?.maxCharacters ?? 2500;
    const maxFindings = options?.maxFindings ?? 12;
    const maxDirs = options?.maxDirectories ?? 6;

    const taskTokens = this.extractTaskKeywords(userTask);
    const sections: string[] = [];
    let currentLength = 0;

    // 1. Directory Structure (bounded & deduplicated)
    const dirKeys = Object.keys(this.state.directories);
    if (dirKeys.length > 0) {
      const scoredDirs = dirKeys.map((d) => ({
        dir: d,
        score: d === '.' ? 10 : taskTokens.some((t) => d.toLowerCase().includes(t)) ? 20 : 1,
      }));
      scoredDirs.sort((a, b) => b.score - a.score);

      const dirLines: string[] = ['Known Directory Structure (already explored):'];
      for (const item of scoredDirs.slice(0, maxDirs)) {
        const dirObs = this.state.directories[item.dir];
        const preview = dirObs.entries.slice(0, 10).join(', ');
        const more = dirObs.entries.length > 10 ? ` (+${dirObs.entries.length - 10} more)` : '';
        dirLines.push(`- ${item.dir === '.' ? 'Root (./)' : item.dir}: [${preview}${more}]`);
      }
      const dirSection = dirLines.join('\n');
      sections.push(dirSection);
      currentLength += dirSection.length;
    }

    // 2. Recent Searches (to avoid repeating identical searches)
    const searches = Object.values(this.state.searches || {});
    if (searches.length > 0) {
      searches.sort((a, b) => b.lastExecuted - a.lastExecuted);
      const searchLines: string[] = ['Previous Code Searches (already conducted):'];
      for (const s of searches.slice(0, 4)) {
        searchLines.push(`- "${s.query}": ${s.matchCount} match${s.matchCount === 1 ? '' : 'es'}`);
      }
      const searchSection = searchLines.join('\n');
      if (currentLength + searchSection.length < maxChars) {
        sections.push(searchSection);
        currentLength += searchSection.length;
      }
    }

    // 3. Verified Fresh Files & Evidence-backed Findings
    const freshFiles = Object.values(this.state.files).filter((f) => f.status === 'fresh');
    const freshFilePaths = new Set(freshFiles.map((f) => f.filePath));

    // Filter findings to only those whose source file is verified fresh
    const validFindings = this.state.findings.filter((f) => freshFilePaths.has(f.sourceFile));

    // Deduplicate findings by sourceFile + text
    const uniqueFindings: ContextFinding[] = [];
    const seenFindingKeys = new Set<string>();
    for (const f of validFindings) {
      const key = `${f.sourceFile}::${f.text.trim()}`;
      if (!seenFindingKeys.has(key)) {
        seenFindingKeys.add(key);
        uniqueFindings.push(f);
      }
    }

    // Score and rank findings by relevance to userTask
    const scoredFindings = uniqueFindings.map((f) => {
      const fileObs = this.state.files[f.sourceFile];
      const score = this.scoreFindingRelevance(f, taskTokens, fileObs);
      return { finding: f, score };
    });

    // Sort: highest score first; if equal, newer findings first
    scoredFindings.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.finding.timestamp - a.finding.timestamp;
    });

    if (scoredFindings.length > 0 || freshFiles.length > 0) {
      const fileLines: string[] = ['Verified Inspected Files & Key Findings:'];
      let includedFindingsCount = 0;
      const includedSourcePaths = new Set<string>();

      for (const { finding, score } of scoredFindings) {
        if (includedFindingsCount >= maxFindings) {
          break;
        }

        // Skip completely irrelevant findings if task specified keywords and we already have matches
        if (taskTokens.length > 0 && score === 0 && includedFindingsCount >= 2) {
          continue;
        }

        const line = `- [Evidence] ${finding.text}`;
        if (currentLength + line.length + 150 > maxChars) {
          // Bounded size reached
          break;
        }

        fileLines.push(line);
        currentLength += line.length;
        includedFindingsCount++;
        includedSourcePaths.add(finding.sourceFile);
      }

      // Add compact summaries for other fresh files not already in findings
      for (const f of freshFiles) {
        if (!includedSourcePaths.has(f.filePath)) {
          if (taskTokens.length > 0) {
            const matchesTask =
              taskTokens.some((t) => f.filePath.toLowerCase().includes(t)) ||
              f.filePath === 'package.json' ||
              f.filePath.startsWith('tsconfig');
            if (!matchesTask) {
              continue; // Avoid dumping unrelated files
            }
          }

          const line = `- ${f.filePath} (fresh, ${f.summary || `${f.totalLines || 0} lines`})`;
          if (currentLength + line.length + 50 > maxChars) {
            break;
          }
          fileLines.push(line);
          currentLength += line.length;
        }
      }

      if (fileLines.length > 1) {
        sections.push(fileLines.join('\n'));
      }
    }

    // 4. Changed or Deleted Files (requiring re-verification)
    const staleFiles = Object.values(this.state.files).filter((f) => f.status === 'stale');
    const deletedFiles = Object.values(this.state.files).filter((f) => f.status === 'deleted');
    if (staleFiles.length > 0 || deletedFiles.length > 0) {
      const warnLines: string[] = ['Files Requiring Re-verification (changed or deleted since inspection):'];
      for (const f of staleFiles.slice(0, 5)) {
        warnLines.push(`- ${f.filePath} (modified — re-verify with read_file before assuming previous findings)`);
      }
      for (const f of deletedFiles.slice(0, 5)) {
        warnLines.push(`- ${f.filePath} (deleted or missing)`);
      }
      const warnSection = warnLines.join('\n');
      if (currentLength + warnSection.length < maxChars) {
        sections.push(warnSection);
        currentLength += warnSection.length;
      }
    }

    if (sections.length === 0) {
      return '';
    }

    const header = '### Verified Workspace Knowledge (Previously Discovered — Do NOT Re-explore Unnecessarily)';
    const guidance = [
      'Operational Instructions for Context Reuse:',
      '1. Re-use the verified facts above. Do NOT call `list_directory` on known directories unless checking for newly added files.',
      '2. Do NOT re-read unchanged fresh files unless you need specific line numbers or code blocks not covered by findings.',
      '3. When specific details, files, or symbols are missing or stale, perform targeted discovery using `search_code` or `read_file`.',
      '4. ALWAYS inspect the current source lines of a file with `read_file` before applying modifications with `edit_file`.',
    ].join('\n');

    let result = `${header}\n\n${sections.join('\n\n')}\n\n${guidance}`;
    if (result.length > maxChars) {
      result = result.slice(0, maxChars);
    }
    return result;
  }

  /**
   * Save persistent state to storage.
   */
  public async save(): Promise<void> {
    const targetPath = this.getStoragePath();
    if (!targetPath) {
      return;
    }

    try {
      this.state.lastSaved = Date.now();
      const storageManager = StorageManager.getInstance();
      await storageManager.writeAtomicJson(targetPath, this.state);
      this.logger.info(`ContextEngine saved state to ${targetPath}`);
    } catch (err) {
      // Persistence failures must never break normal agent execution
      this.logger.warn('Failed to save ContextEngine state (non-fatal)', this.sanitizeError(err));
    }
  }

  /**
   * Load persistent state from storage.
   */
  public async load(): Promise<void> {
    const targetPath = this.getStoragePath();
    if (!targetPath) {
      return;
    }

    try {
      const storageManager = StorageManager.getInstance();
      const loaded = await storageManager.readJson<ContextEngineState | null>(targetPath, null);
      if (loaded && loaded.version === 1 && typeof loaded.files === 'object') {
        this.state = {
          ...loaded,
          directories: loaded.directories || {},
          files: loaded.files || {},
          findings: loaded.findings || [],
          searches: loaded.searches || {},
        };
        this.logger.info(`ContextEngine loaded state from ${targetPath} (${Object.keys(this.state.files).length} files tracked)`);
      }
    } catch (err) {
      this.logger.warn('Failed to load ContextEngine state (non-fatal)', this.sanitizeError(err));
    }
  }

  /**
   * Clear all in-memory and persistent context.
   */
  public async clear(): Promise<void> {
    this.state.directories = {};
    this.state.files = {};
    this.state.findings = [];
    this.state.searches = {};
    await this.save();
  }

  /**
   * Inspect internal state (for testing and verification).
   */
  public getState(): Readonly<ContextEngineState> {
    return this.state;
  }
}
