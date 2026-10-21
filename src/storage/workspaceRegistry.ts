/**
 * Workspace Registry for KODRA.
 * 
 * Manages canonical workspace identities, path normalization, and workspace metadata.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { WorkspaceRecord } from './types';

export class WorkspaceRegistry {
  private readonly workspacesFile: string;
  private readonly logger = Logger.getInstance();
  private cache: Map<string, WorkspaceRecord> = new Map();
  private loaded = false;

  constructor(private readonly storageRoot: string) {
    this.workspacesFile = path.join(storageRoot, 'workspaces', 'workspaces.json');
  }

  /**
   * Derive a canonical, cross-platform workspace ID from a directory path.
   */
  public static canonicalizeWorkspacePath(workspacePath: string): string {
    if (!workspacePath) {
      return '';
    }
    // Normalize slashes and resolve path
    let normalized = path.resolve(workspacePath).replace(/\\/g, '/');
    // On Windows, drive letters can vary in case (C: vs c:)
    if (process.platform === 'win32') {
      normalized = normalized.toLowerCase();
    }
    // Strip trailing slashes
    while (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  /**
   * Generate a stable, collision-safe hash for a canonical workspace path.
   */
  public static getWorkspaceId(workspacePath: string): string {
    const canonical = WorkspaceRegistry.canonicalizeWorkspacePath(workspacePath);
    if (!canonical) {
      return 'global';
    }
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  }

  /**
   * Get workspace info for a given folder path or the currently active VS Code workspace.
   */
  public static getWorkspaceInfo(folderUri?: vscode.Uri | string): {
    id: string;
    path: string;
    name: string;
  } {
    let rawPath = '';
    let name = 'Global';

    if (folderUri) {
      rawPath = typeof folderUri === 'string' ? folderUri : folderUri.fsPath;
      name = path.basename(rawPath) || 'Workspace';
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      rawPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      name = vscode.workspace.workspaceFolders[0].name || path.basename(rawPath) || 'Workspace';
    }

    const canonicalPath = WorkspaceRegistry.canonicalizeWorkspacePath(rawPath);
    const id = WorkspaceRegistry.getWorkspaceId(canonicalPath);

    return {
      id,
      path: canonicalPath,
      name: canonicalPath ? name : 'Global',
    };
  }

  /**
   * Initialize workspace registry and load existing records.
   */
  public async initialize(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      await fs.mkdir(path.dirname(this.workspacesFile), { recursive: true });
      const content = await fs.readFile(this.workspacesFile, 'utf-8');
      const records: WorkspaceRecord[] = JSON.parse(content);
      this.cache.clear();
      for (const rec of records) {
        this.cache.set(rec.id, rec);
      }
    } catch {
      // Missing or invalid workspaces.json — start with empty cache
      this.cache.clear();
    }

    this.loaded = true;

    // Register current workspace if one is open
    const current = WorkspaceRegistry.getWorkspaceInfo();
    if (current.path) {
      await this.registerWorkspace(current.path, current.name);
    }
  }

  /**
   * Register or update a workspace in the registry.
   */
  public async registerWorkspace(workspacePath: string, workspaceName?: string): Promise<WorkspaceRecord> {
    await this.initialize();

    const canonical = WorkspaceRegistry.canonicalizeWorkspacePath(workspacePath);
    const id = WorkspaceRegistry.getWorkspaceId(canonical);
    const name = workspaceName || path.basename(canonical) || 'Workspace';
    const now = new Date().toISOString();

    const existing = this.cache.get(id);
    const record: WorkspaceRecord = {
      id,
      path: canonical,
      name,
      firstSeen: existing?.firstSeen || now,
      lastSeen: now,
    };

    this.cache.set(id, record);
    await this.persist();
    return record;
  }

  /**
   * Get all registered workspaces.
   */
  public async getAllWorkspaces(): Promise<WorkspaceRecord[]> {
    await this.initialize();
    return Array.from(this.cache.values());
  }

  /**
   * Get a workspace record by ID.
   */
  public async getWorkspaceById(id: string): Promise<WorkspaceRecord | undefined> {
    await this.initialize();
    return this.cache.get(id);
  }

  private async persist(): Promise<void> {
    try {
      const records = Array.from(this.cache.values());
      const tempFile = `${this.workspacesFile}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(records, null, 2), 'utf-8');
      await fs.rename(tempFile, this.workspacesFile);
    } catch (err) {
      this.logger.error('Failed to persist workspaces.json', err);
    }
  }
}
