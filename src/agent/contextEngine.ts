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
import { SearchResult } from '../indexing/types';
import { StorageManager } from '../storage/storageManager';
import { WorkspaceRegistry } from '../storage/workspaceRegistry';
import { Logger } from '../utils/logger';
import { IWorkspaceService, VSCodeWorkspaceService, SearchMatch } from './workspaceService';

export type FileStatus = 'fresh' | 'stale' | 'deleted';

export type EvidenceProvenance =
  | 'verified_finding'    // Verified against current fresh source
  | 'inspected_excerpt'   // Inspected from source file in current or recent turn
  | 'search_candidate'    // Matched by exact or semantic search, not yet inspected
  | 'stale_finding';      // Previously verified, but underlying source modified

export type TaskIntent =
  | 'explain'
  | 'bugfix'
  | 'interface_change'
  | 'refactor'
  | 'doc_change'
  | 'general';

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

export interface RetrievalCandidate {
  id: string;
  source: 'memory' | 'exact_search' | 'vector_index';
  provenance: EvidenceProvenance;
  filePath: string;
  startLine?: number;
  endLine?: number;
  symbols?: string[];
  content: string;
  matchQuality: number; // 0-100
  freshness: FileStatus; // 'fresh' | 'stale' | 'deleted'
  relevanceScore: number;
  conflictNotice?: string;
}

export interface HybridRetrievalOptions {
  taskIntent?: TaskIntent;
  maxCandidates?: number;
  maxExactMatches?: number;
  maxSemanticMatches?: number;
  indexer?: { search(query: string, topK?: number): Promise<SearchResult[]> };
  forceRefresh?: boolean;
}

export interface HybridRetrievalResult {
  candidates: RetrievalCandidate[];
  taskIntent: TaskIntent;
  query: string;
  exactMatchCount: number;
  semanticMatchCount: number;
  memoryHitCount: number;
  conflicts: string[];
}

export interface DependencyDiscoveryResult {
  targetPath: string;
  targetSymbol?: string;
  imports: string[];
  callers: { filePath: string; line: number; snippet: string }[];
  implementations: { filePath: string; line: number; snippet: string }[];
  tests: string[];
}

export interface CombinedContextOptions {
  maxCombinedCharacters?: number;
  maxFindings?: number;
  maxSemanticChunks?: number;
  maxAttachedFiles?: number;
  indexer?: { search(query: string, topK?: number): Promise<SearchResult[]> };
  contextFiles?: string[];
  contextFilesContent?: { filePath: string; content: string }[];
  customInstructions?: string;
}

export interface FormattedCombinedContext {
  contextText: string;
  totalCharacters: number;
  omittedItemsCount: number;
  sectionsIncluded: string[];
}

export interface ContextEngineMetrics {
  exactSearchCount: number;
  semanticRetrievalCount: number;
  repeatedSearchesAvoided: number;
  repeatedReadsAvoided: number;
  directoryListingsCount: number;
  memoryReuseCount: number;
  retrievalLatencyMs: number;
  contextSizeBeforeDeduplication: number;
  contextSizeAfterDeduplication: number;
  filesDiscovered: number;
  filesInspected: number;
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

  /** Detect task intent based on query or user prompt */
  detectTaskIntent(userTask?: string): TaskIntent;

  /** Perform hybrid retrieval combining exact search, vector search, and memory */
  performHybridRetrieval(query: string, options?: HybridRetrievalOptions): Promise<HybridRetrievalResult>;

  /** Discover dependencies, callers, implementations, and tests for a file or symbol */
  discoverDependencies(filePath: string, symbol?: string): Promise<DependencyDiscoveryResult>;

  /** Format predictable combined context across attached files, verified findings, and search candidates */
  getCombinedContext(userTask?: string, options?: CombinedContextOptions): Promise<FormattedCombinedContext>;

  /** Get recorded exploration and retrieval metrics */
  getMetrics(): ContextEngineMetrics;

  /** Reset exploration and retrieval metrics */
  resetMetrics(): void;

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

  /** Ensure persistent state is loaded before operations */
  ensureLoaded(): Promise<void>;

  /** Clear all in-memory and persistent context */
  clear(): Promise<void>;

  /** Inspect internal state (for testing and verification) */
  getState(): Readonly<ContextEngineState>;
}

export class ContextEngine implements IContextEngine {
  private readonly logger = Logger.getInstance();
  private state: ContextEngineState;
  private readonly customStoragePath?: string;
  private isLoaded: boolean = false;
  private metrics: ContextEngineMetrics = {
    exactSearchCount: 0,
    semanticRetrievalCount: 0,
    repeatedSearchesAvoided: 0,
    repeatedReadsAvoided: 0,
    directoryListingsCount: 0,
    memoryReuseCount: 0,
    retrievalLatencyMs: 0,
    contextSizeBeforeDeduplication: 0,
    contextSizeAfterDeduplication: 0,
    filesDiscovered: 0,
    filesInspected: 0,
  };

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
    this.metrics.directoryListingsCount++;
    this.metrics.filesDiscovered = Math.max(
      this.metrics.filesDiscovered,
      Object.keys(this.state.files).length + Object.keys(this.state.directories).length,
    );
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
    this.metrics.filesInspected = Object.values(this.state.files).filter((f) => f.status === 'fresh').length;
    this.metrics.filesDiscovered = Math.max(
      this.metrics.filesDiscovered,
      Object.keys(this.state.files).length + Object.keys(this.state.directories).length,
    );
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
      this.isLoaded = true;
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
    } finally {
      this.isLoaded = true;
    }
  }

  /**
   * Ensure persistent state is loaded before operations.
   */
  public async ensureLoaded(): Promise<void> {
    if (!this.isLoaded) {
      await this.load();
    }
  }

  /**
   * Detect task intent based on query or user prompt.
   */
  public detectTaskIntent(userTask?: string): TaskIntent {
    if (!userTask || !userTask.trim()) {
      return 'general';
    }
    const lower = userTask.toLowerCase();
    if (/\b(bug|fix|issue|error|fail|crash|broken|exception|regression|defect|fault)\b/i.test(lower)) {
      return 'bugfix';
    }
    if (/\b(explain|what does|how does|understand|trace|overview|describe|walkthrough)\b/i.test(lower)) {
      return 'explain';
    }
    if (/\b(interface|contract|caller|callers|signature|export|breaking change|shared|api)\b/i.test(lower)) {
      return 'interface_change';
    }
    if (/\b(refactor|clean up|restructure|extract|rename|simplify|modernize)\b/i.test(lower)) {
      return 'refactor';
    }
    if (/\b(doc|docs|readme|comment|markdown|document|documentation)\b/i.test(lower)) {
      return 'doc_change';
    }
    return 'general';
  }

  /**
   * Perform hybrid retrieval combining exact search, vector search, and memory.
   * Merges, deduplicates, and ranks candidates based on match quality, provenance,
   * freshness, and task intent. Detects conflicting evidence and staleness.
   */
  public async performHybridRetrieval(
    query: string,
    options?: HybridRetrievalOptions,
  ): Promise<HybridRetrievalResult> {
    await this.ensureLoaded();
    const startTime = Date.now();
    const cleanQuery = query.trim();
    const intent = options?.taskIntent || this.detectTaskIntent(cleanQuery);
    const maxCandidates = options?.maxCandidates || 10;
    const maxExactMatches = options?.maxExactMatches || 15;
    const maxSemanticMatches = options?.maxSemanticMatches || 5;
    const forceRefresh = options?.forceRefresh ?? false;

    const rawCandidates: RetrievalCandidate[] = [];
    const conflicts: string[] = [];
    let exactMatchCount = 0;
    let semanticMatchCount = 0;
    let memoryHitCount = 0;

    const queryTokens = cleanQuery
      .toLowerCase()
      .split(/[^a-zA-Z0-9_$]+/)
      .filter((t) => t.length >= 3);

    // 1. Persistent memory search (reuse verified findings before redundant searches)
    if (cleanQuery) {
      for (const finding of this.state.findings) {
        const fileObs = this.state.files[finding.sourceFile];
        const status = fileObs?.status || 'fresh';

        // Check if query matches finding text or symbols
        const textLower = finding.text.toLowerCase();
        const fileLower = finding.sourceFile.toLowerCase();
        const symbolMatch = (finding.symbols || []).some((sym) =>
          sym.toLowerCase().includes(cleanQuery.toLowerCase()) || cleanQuery.toLowerCase().includes(sym.toLowerCase())
        );
        const textMatch = queryTokens.some((t) => textLower.includes(t) || fileLower.includes(t));

        if (symbolMatch || textMatch) {
          memoryHitCount++;
          this.metrics.memoryReuseCount++;

          let provenance: EvidenceProvenance = 'verified_finding';
          let matchQuality = symbolMatch ? 95 : 85;
          if (status === 'stale') {
            provenance = 'stale_finding';
            matchQuality = 65;
          } else if (status === 'deleted') {
            provenance = 'stale_finding';
            matchQuality = 25;
          }

          rawCandidates.push({
            id: `memory_${finding.id}`,
            source: 'memory',
            provenance,
            filePath: finding.sourceFile,
            content: finding.text,
            symbols: finding.symbols,
            matchQuality,
            freshness: status,
            relevanceScore: 0,
          });
        }
      }
    }

    // 2. Exact code search (for identifiers, file paths, function names, error messages)
    const looksLikeIdentifierOrPath =
      cleanQuery.length > 2 &&
      (/[._\-\/\\$]/.test(cleanQuery) || /^[a-zA-Z0-9_$]+$/.test(cleanQuery));

    const stopWords = new Set([
      'fix', 'the', 'and', 'when', 'is', 'for', 'with', 'from', 'what', 'how', 'does',
      'explain', 'update', 'in', 'of', 'to', 'a', 'an', 'on', 'at', 'by',
    ]);
    const rawTokens = (cleanQuery.match(/[a-zA-Z0-9_$]+/g) || [])
      .filter((t) => t.length >= 3 && !stopWords.has(t.toLowerCase()));

    const queriesToSearch: string[] = [];
    if (looksLikeIdentifierOrPath) {
      queriesToSearch.push(cleanQuery);
    } else if (cleanQuery) {
      queriesToSearch.push(cleanQuery);
      for (const tok of rawTokens.slice(0, 3)) {
        if (!queriesToSearch.includes(tok)) {
          queriesToSearch.push(tok);
        }
      }
    }

    if (queriesToSearch.length > 0 && (memoryHitCount === 0 || forceRefresh || looksLikeIdentifierOrPath || intent === 'bugfix')) {
      const seenMatchKeys = new Set<string>();
      for (const q of queriesToSearch) {
        try {
          const matches = await this.workspaceService.searchFiles(q, {
            maxResults: Math.max(20, maxExactMatches),
          });
          if (matches.length > 0) {
            this.metrics.exactSearchCount++;
            exactMatchCount += matches.length;

            for (let i = 0; i < matches.length; i++) {
              const m = matches[i];
              const normFile = this.normalizePath(m.file);
              const matchKey = `${normFile}:${m.line}`;
              if (seenMatchKeys.has(matchKey)) {
                continue;
              }
              seenMatchKeys.add(matchKey);

              const fileObs = this.state.files[normFile];
              const status = fileObs?.status || 'fresh';

              let provenance: EvidenceProvenance = 'search_candidate';
              if (status === 'stale') {
                provenance = 'stale_finding';
              } else if (status === 'fresh' && fileObs?.lastInspected) {
                provenance = 'inspected_excerpt';
              }

              // Extract symbol from line if present
              const symMatch = m.content.match(/(?:export\s+)?(?:class|function|interface|type|const|var|let)\s+([a-zA-Z0-9_$]+)/);
              const symbols = symMatch ? [symMatch[1]] : (/^[a-zA-Z0-9_$]+$/.test(q) ? [q] : undefined);

              rawCandidates.push({
                id: `exact_${normFile}_${m.line}_${i}`,
                source: 'exact_search',
                provenance,
                filePath: normFile,
                startLine: m.line,
                endLine: m.line,
                content: m.content.trim(),
                symbols,
                matchQuality: 92,
                freshness: status,
                relevanceScore: 0,
              });
            }
          }
        } catch (err) {
          this.logger.warn('Exact search failed during hybrid retrieval (non-fatal)', this.sanitizeError(err));
        }
      }
    } else if (memoryHitCount > 0 && !forceRefresh) {
      this.metrics.repeatedSearchesAvoided++;
    }

    // 3. Semantic / Vector Index Retrieval (for conceptual queries)
    if (options?.indexer && cleanQuery) {
      try {
        const results = await options.indexer.search(cleanQuery, maxSemanticMatches);
        semanticMatchCount = results.length;
        this.metrics.semanticRetrievalCount++;

        for (let i = 0; i < results.length; i++) {
          const res = results[i];
          const normFile = this.normalizePath(res.chunk.filepath);
          const fileObs = this.state.files[normFile];
          const status = fileObs?.status || 'fresh';

          const score = res.score ?? 0.75;
          const matchQuality = Math.min(100, Math.max(10, Math.round(score * 100)));

          rawCandidates.push({
            id: `vector_${normFile}_${res.chunk.startLine}_${i}`,
            source: 'vector_index',
            provenance: 'search_candidate',
            filePath: normFile,
            startLine: res.chunk.startLine + 1,
            endLine: res.chunk.endLine + 1,
            content: res.chunk.content.trim(),
            matchQuality,
            freshness: status,
            relevanceScore: 0,
          });
        }
      } catch (err) {
        this.logger.warn('Vector index search failed during hybrid retrieval (non-fatal)', this.sanitizeError(err));
      }
    }

    // 4. Evidence Verification & Conflict Detection
    // Check for conflicting definitions across files or stale vs fresh evidence
    const symbolDefinitions = new Map<string, { file: string; line?: number; isStale: boolean; isDefinition: boolean }[]>();
    for (const cand of rawCandidates) {
      const syms = cand.symbols || (/^[a-zA-Z0-9_$]+$/.test(cleanQuery) ? [cleanQuery] : []);
      for (const sym of syms) {
        const isDef = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:class|function|interface|type|const|var|let)\\s+${sym}\\b`).test(cand.content);
        const list = symbolDefinitions.get(sym) || [];
        list.push({ file: cand.filePath, line: cand.startLine, isStale: cand.freshness === 'stale', isDefinition: isDef });
        symbolDefinitions.set(sym, list);
      }
    }

    for (const [sym, entries] of symbolDefinitions.entries()) {
      const defFiles = Array.from(new Set(entries.filter((e) => e.isDefinition).map((e) => e.file)));
      const staleEntries = entries.filter((e) => e.isStale);

      if (defFiles.length > 1) {
        const notice = `Conflicting definitions found for '${sym}' across multiple files: ${defFiles.join(', ')}. Inspect source with read_file before modifying.`;
        conflicts.push(notice);
        for (const cand of rawCandidates) {
          if (!cand.symbols) {
            cand.symbols = [sym];
          }
          cand.conflictNotice = notice;
        }
      } else if (staleEntries.length > 0) {
        const file = staleEntries[0].file;
        const notice = `Evidence for '${sym}' in ${file} is stale (file modified since inspection). Re-verify with read_file.`;
        conflicts.push(notice);
        for (const cand of rawCandidates) {
          if (!cand.symbols) {
            cand.symbols = [sym];
          }
          cand.conflictNotice = notice;
        }
      }
    }

    // 5. Deduplication: Merge candidates pointing to same file and overlapping content/lines
    const deduplicatedMap = new Map<string, RetrievalCandidate>();
    for (const cand of rawCandidates) {
      const dedupeKey = `${cand.filePath}:${cand.startLine || 0}:${cand.content.slice(0, 60)}`;
      const existing = deduplicatedMap.get(dedupeKey);
      if (!existing) {
        deduplicatedMap.set(dedupeKey, cand);
      } else {
        // Keep candidate with higher evidence quality/provenance
        const provRank: Record<EvidenceProvenance, number> = {
          verified_finding: 4,
          inspected_excerpt: 3,
          search_candidate: 2,
          stale_finding: 1,
        };
        if (provRank[cand.provenance] > provRank[existing.provenance]) {
          deduplicatedMap.set(dedupeKey, cand);
        }
      }
    }

    const deduplicated = Array.from(deduplicatedMap.values());

    // 6. Ranking using match quality, provenance, freshness, definition priority, and task intent
    for (const cand of deduplicated) {
      let score = cand.matchQuality;

      // Provenance weight
      if (cand.provenance === 'verified_finding') {
        score *= 1.25;
      } else if (cand.provenance === 'inspected_excerpt') {
        score *= 1.15;
      } else if (cand.provenance === 'stale_finding') {
        score *= 0.6;
      }

      // Freshness weight
      if (cand.freshness === 'stale') {
        score *= 0.7;
      } else if (cand.freshness === 'deleted') {
        score *= 0.2;
      }

      // Direct definition of queried symbol gets highest priority
      const isDirectDefinition =
        cleanQuery.length > 1 &&
        new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|var|let)\\s+${cleanQuery}\\b`).test(cand.content);

      if (isDirectDefinition) {
        score += 35;
      } else if (/export\s+(?:async\s+)?(?:class|function|interface|type|const)|class\s+|function\s+|interface\s+/.test(cand.content)) {
        score += 10;
      }

      // Task-aware intent adjustment
      const lowerFile = cand.filePath.toLowerCase();
      const lowerContent = cand.content.toLowerCase();

      // Give source files precedence over test files unless bugfix or refactor
      if (intent !== 'bugfix' && intent !== 'refactor') {
        if (!lowerFile.includes('test') && !lowerFile.includes('spec')) {
          score += 10;
        }
      }

      switch (intent) {
        case 'bugfix':
          if (lowerFile.includes('.test.') || lowerFile.includes('.spec.')) {
            score += 25; // Tests are critical for bugfix regression checking
          }
          if (lowerContent.includes('error') || lowerContent.includes('throw') || lowerContent.includes('catch') || lowerContent.includes('fail') || lowerContent.includes('reject')) {
            score += 20;
          }
          break;

        case 'explain':
          if (lowerFile.includes('readme') || lowerFile.includes('doc')) {
            score += 15;
          }
          if (cand.symbols && cand.symbols.length > 0) {
            score += 10;
          }
          break;

        case 'interface_change':
          if (lowerContent.includes('interface ') || lowerContent.includes('export ') || lowerContent.includes('type ')) {
            score += 25;
          }
          if (lowerFile.includes('.test.') || lowerFile.includes('.spec.')) {
            score += 10;
          }
          break;

        case 'refactor':
          if (cand.source === 'exact_search' || cand.symbols) {
            score += 15;
          }
          if (lowerFile.includes('.test.') || lowerFile.includes('.spec.')) {
            score += 15;
          }
          break;

        case 'doc_change':
          if (lowerFile.endsWith('.md') || lowerContent.includes('/**')) {
            score += 30;
          }
          break;

        case 'general':
        default:
          break;
      }

      cand.relevanceScore = Math.round(score);
    }

    // Sort descending by relevance score
    deduplicated.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topCandidates = deduplicated.slice(0, maxCandidates);

    const latency = Date.now() - startTime;
    this.metrics.retrievalLatencyMs += latency;

    return {
      candidates: topCandidates,
      taskIntent: intent,
      query: cleanQuery,
      exactMatchCount,
      semanticMatchCount,
      memoryHitCount,
      conflicts,
    };
  }

  /**
   * Discover dependencies, callers, implementations, and tests for a file or symbol.
   * Uses existing searchFiles and file tools without repository-wide scans.
   */
  public async discoverDependencies(
    filePath: string,
    symbol?: string,
  ): Promise<DependencyDiscoveryResult> {
    await this.ensureLoaded();
    const normPath = this.normalizePath(filePath);
    const imports: string[] = [];
    const callers: { filePath: string; line: number; snippet: string }[] = [];
    const implementations: { filePath: string; line: number; snippet: string }[] = [];
    const tests = new Set<string>();

    // 1. Read target file to extract imports
    let content = '';
    try {
      content = await this.workspaceService.readFile(normPath);
    } catch {
      // If reading fails, return empty structure gracefully
      return {
        targetPath: normPath,
        targetSymbol: symbol,
        imports: [],
        callers: [],
        implementations: [],
        tests: [],
      };
    }

    // Extract imports deterministically: import ... from '...' or require('...')
    const importRegex = /(?:import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const imp = match[1] || match[2];
      if (imp && !imports.includes(imp)) {
        imports.push(imp);
      }
    }

    // 2. Discover callers and implementations if symbol is provided
    let targetSymbol = symbol;
    if (!targetSymbol) {
      // Try to find the primary exported symbol from findings or source
      const exportMatch = content.match(/export\s+(?:default\s+)?(?:class|function|interface|type|const)\s+([a-zA-Z0-9_$]+)/);
      if (exportMatch) {
        targetSymbol = exportMatch[1];
      }
    }

    if (targetSymbol) {
      try {
        const matches = await this.workspaceService.searchFiles(targetSymbol, {
          maxResults: 20,
        });
        this.metrics.exactSearchCount++;

        for (const m of matches) {
          const matchNorm = this.normalizePath(m.file);
          const isTest = matchNorm.includes('.test.') || matchNorm.includes('.spec.');
          if (isTest) {
            tests.add(matchNorm);
          }

          const snippet = m.content.trim();
          const isDefinitionOrImpl =
            snippet.includes(`class ${targetSymbol}`) ||
            snippet.includes(`function ${targetSymbol}`) ||
            snippet.includes(`interface ${targetSymbol}`) ||
            snippet.includes(`type ${targetSymbol}`) ||
            snippet.includes(`implements ${targetSymbol}`) ||
            snippet.includes(`extends ${targetSymbol}`);

          if (isDefinitionOrImpl) {
            implementations.push({
              filePath: matchNorm,
              line: m.line,
              snippet,
            });
          } else if (matchNorm !== normPath) {
            // It's a caller in another file
            callers.push({
              filePath: matchNorm,
              line: m.line,
              snippet,
            });
          }
        }
      } catch (err) {
        this.logger.warn('Dependency search failed (non-fatal)', this.sanitizeError(err));
      }
    }

    // 3. Discover associated regression/unit tests by base name
    const baseName = path.basename(normPath, path.extname(normPath));
    try {
      const testMatches = await this.workspaceService.searchFiles(baseName, {
        maxResults: 10,
      });
      for (const tm of testMatches) {
        const testNorm = this.normalizePath(tm.file);
        if (testNorm.includes('.test.') || testNorm.includes('.spec.')) {
          tests.add(testNorm);
        }
      }
    } catch {
      // non-fatal
    }

    return {
      targetPath: normPath,
      targetSymbol,
      imports,
      callers,
      implementations,
      tests: Array.from(tests),
    };
  }

  /**
   * Format predictable combined context across attached files, verified findings,
   * and search candidates while strictly enforcing a total character budget and deduplicating.
   */
  public async getCombinedContext(
    userTask?: string,
    options?: CombinedContextOptions,
  ): Promise<FormattedCombinedContext> {
    await this.ensureLoaded();
    const maxBudget = options?.maxCombinedCharacters || 8000;
    const maxFindings = options?.maxFindings || 10;
    const sectionsIncluded: string[] = [];
    let omittedItemsCount = 0;

    let totalCharsBeforeDedup = 0;
    let totalCharsAfterDedup = 0;

    const attachedFilePaths = new Set<string>();
    const sections: string[] = [];

    // Priority 1: User-attached context files
    const attachedSections: string[] = [];
    if (options?.contextFilesContent && options.contextFilesContent.length > 0) {
      for (const item of options.contextFilesContent) {
        const norm = this.normalizePath(item.filePath);
        attachedFilePaths.add(norm);
        const section = `Attached File (${norm}):\n${item.content}`;
        totalCharsBeforeDedup += section.length;

        if (totalCharsAfterDedup + section.length < maxBudget) {
          attachedSections.push(section);
          totalCharsAfterDedup += section.length;
        } else {
          omittedItemsCount++;
        }
      }
    } else if (options?.contextFiles && options.contextFiles.length > 0) {
      for (const filePath of options.contextFiles) {
        const norm = this.normalizePath(filePath);
        attachedFilePaths.add(norm);
        try {
          const content = await this.workspaceService.readFile(filePath);
          const section = `Attached File (${norm}):\n${content}`;
          totalCharsBeforeDedup += section.length;

          if (totalCharsAfterDedup + section.length < maxBudget) {
            attachedSections.push(section);
            totalCharsAfterDedup += section.length;
          } else {
            omittedItemsCount++;
          }
        } catch {
          // skip unreadable
        }
      }
    }

    if (attachedSections.length > 0) {
      sections.push(attachedSections.join('\n\n'));
      sectionsIncluded.push('attached_files');
    }

    // Priority 2: Verified workspace findings from persistent memory
    const remainingForVerified = maxBudget - totalCharsAfterDedup;
    if (remainingForVerified > 300) {
      const verified = await this.getVerifiedContext(userTask, {
        maxCharacters: remainingForVerified,
        maxFindings,
      });

      if (verified && verified.trim().length > 0) {
        totalCharsBeforeDedup += verified.length;

        // Deduplicate: If all files mentioned in verified are already attached, we can omit redundant text
        let isRedundant = false;
        if (attachedFilePaths.size > 0) {
          const relevantFindings = this.state.findings.filter((f) =>
            this.state.files[f.sourceFile]?.status === 'fresh'
          );
          if (relevantFindings.length > 0 && relevantFindings.every((f) => attachedFilePaths.has(f.sourceFile))) {
            isRedundant = true;
          }
        }

        if (!isRedundant) {
          if (totalCharsAfterDedup + verified.length < maxBudget) {
            sections.push(verified);
            totalCharsAfterDedup += verified.length;
            sectionsIncluded.push('verified_findings');
          } else {
            const sliceLen = maxBudget - totalCharsAfterDedup - 50;
            if (sliceLen > 150) {
              sections.push(verified.slice(0, sliceLen) + '\n[...truncated to context budget]');
              totalCharsAfterDedup += sliceLen;
              sectionsIncluded.push('verified_findings_partial');
            } else {
              omittedItemsCount++;
            }
          }
        }
      }
    }

    // Priority 3: Vector / Semantic Search excerpts
    const remainingForSearch = maxBudget - totalCharsAfterDedup;
    if (options?.indexer && userTask && remainingForSearch > 300) {
      try {
        const results = await options.indexer.search(userTask, options.maxSemanticChunks || 5);
        if (results && results.length > 0) {
          const searchChunks: string[] = [];
          for (const res of results) {
            const normPath = this.normalizePath(res.chunk.filepath);
            // Deduplicate: skip chunk if this file is already in attached files
            if (attachedFilePaths.has(normPath)) {
              continue;
            }

            const chunkText = `--- ${normPath} (lines ${res.chunk.startLine + 1}-${res.chunk.endLine + 1}) ---\n${res.chunk.content}`;
            totalCharsBeforeDedup += chunkText.length;

            if (totalCharsAfterDedup + chunkText.length < maxBudget) {
              searchChunks.push(chunkText);
              totalCharsAfterDedup += chunkText.length;
            } else {
              omittedItemsCount++;
            }
          }

          if (searchChunks.length > 0) {
            sections.push(`Relevant Codebase Context (from index):\n\n${searchChunks.join('\n\n')}`);
            sectionsIncluded.push('search_excerpts');
          }
        }
      } catch {
        // non-fatal
      }
    }

    this.metrics.contextSizeBeforeDeduplication += totalCharsBeforeDedup;
    this.metrics.contextSizeAfterDeduplication += totalCharsAfterDedup;

    const contextText = sections.join('\n\n');
    return {
      contextText,
      totalCharacters: contextText.length,
      omittedItemsCount,
      sectionsIncluded,
    };
  }

  /**
   * Get recorded exploration and retrieval metrics.
   */
  public getMetrics(): ContextEngineMetrics {
    return {
      ...this.metrics,
      filesDiscovered: Math.max(
        this.metrics.filesDiscovered,
        Object.keys(this.state.files).length + Object.keys(this.state.directories).length,
      ),
      filesInspected: Object.values(this.state.files).filter((f) => f.status === 'fresh').length,
    };
  }

  /**
   * Reset exploration and retrieval metrics.
   */
  public resetMetrics(): void {
    this.metrics = {
      exactSearchCount: 0,
      semanticRetrievalCount: 0,
      repeatedSearchesAvoided: 0,
      repeatedReadsAvoided: 0,
      directoryListingsCount: 0,
      memoryReuseCount: 0,
      retrievalLatencyMs: 0,
      contextSizeBeforeDeduplication: 0,
      contextSizeAfterDeduplication: 0,
      filesDiscovered: 0,
      filesInspected: 0,
    };
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
