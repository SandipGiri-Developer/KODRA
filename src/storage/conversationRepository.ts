/**
 * Conversation Repository for KODRA.
 * 
 * Provides persistent storage for conversation history, messages, metadata,
 * indexing, and workspace-aware listing.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger';
import { ArtifactManager } from './artifactManager';
import { ExecutionJournal } from './executionJournal';
import { StorageManager } from './storageManager';
import {
  ConversationIndexEntry,
  ConversationStatus,
  STORAGE_SCHEMA_VERSION,
  StoredConversation,
} from './types';
import { WorkspaceRegistry } from './workspaceRegistry';

export class ConversationRepository {
  private readonly logger = Logger.getInstance();
  private readonly indexPath: string;
  private isIndexLoaded = false;
  private indexCache: Map<string, ConversationIndexEntry> = new Map();
  private indexLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageManager: StorageManager,
    private readonly workspaceRegistry: WorkspaceRegistry,
    private readonly executionJournal: ExecutionJournal,
    private readonly artifactManager: ArtifactManager
  ) {
    this.indexPath = path.join(storageManager.conversationsDir, 'index.json');
  }

  private getConversationDir(sessionId: string): string {
    this.storageManager.validateSafeId(sessionId, 'sessionId');
    const dir = path.join(this.storageManager.conversationsDir, sessionId);
    if (!this.storageManager.isPathSafe(this.storageManager.conversationsDir, dir)) {
      throw new Error(`Path traversal detected in conversation dir: ${dir}`);
    }
    return dir;
  }

  private getConversationFilePath(sessionId: string): string {
    return path.join(this.getConversationDir(sessionId), 'conversation.json');
  }

  /**
   * Sequential lock to prevent concurrent index writes from stomping each other.
   */
  private async withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const nextLock = this.indexLock.then(async () => {
      return await fn();
    });
    this.indexLock = nextLock.then(
      () => {},
      () => {}
    );
    return nextLock;
  }

  /**
   * Load index into memory or rebuild if missing/invalid.
   */
  public async loadIndex(): Promise<void> {
    if (this.isIndexLoaded) {
      return;
    }

    try {
      const data = await this.storageManager.readJson<ConversationIndexEntry[] | null>(
        this.indexPath,
        null
      );
      if (Array.isArray(data)) {
        this.indexCache.clear();
        for (const item of data) {
          this.indexCache.set(item.sessionId, item);
        }
        this.isIndexLoaded = true;
        return;
      }
    } catch {
      // Failed to read index, will rebuild
    }

    await this.rebuildIndex();
    this.isIndexLoaded = true;
  }

  /**
   * Rebuild the conversation index by scanning all conversation.json files.
   */
  public async rebuildIndex(): Promise<void> {
    this.logger.info('Rebuilding conversation index from disk...');
    this.indexCache.clear();

    try {
      await fs.mkdir(this.storageManager.conversationsDir, { recursive: true });
      const entries = await fs.readdir(this.storageManager.conversationsDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const filePath = path.join(
            this.storageManager.conversationsDir,
            entry.name,
            'conversation.json'
          );
          try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const conv: StoredConversation = JSON.parse(raw);
            const indexEntry: ConversationIndexEntry = {
              sessionId: conv.sessionId,
              title: conv.title,
              dateCreated: conv.dateCreated,
              lastModified: conv.lastModified,
              workspaceDirectory: conv.workspaceDirectory,
              workspaceId: conv.workspaceId,
              workspaceName: conv.workspaceName,
              messageCount: Array.isArray(conv.history) ? conv.history.length : 0,
              status: conv.status,
            };
            this.indexCache.set(conv.sessionId, indexEntry);
          } catch {
            // skip corrupted directory
          }
        }
      }

      await this.persistIndex();
    } catch (err) {
      this.logger.error('Failed to rebuild conversation index', err);
    }
  }

  private async persistIndex(): Promise<void> {
    const list = Array.from(this.indexCache.values()).sort(
      (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );
    await this.storageManager.writeAtomicJson(this.indexPath, list);
  }

  /**
   * Save or update a conversation.
   */
  public async saveConversation(data: {
    sessionId: string;
    title?: string;
    workspaceDirectory?: string;
    workspaceId?: string;
    workspaceName?: string;
    history: any[];
    mode?: string;
    chatModelTitle?: string | null;
    status?: ConversationStatus;
    artifacts?: StoredConversation['artifacts'];
    executionIds?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<StoredConversation> {
    await this.loadIndex();

    return this.withIndexLock(async () => {
      const existing = await this.getConversation(data.sessionId);
      const now = new Date().toISOString();

      let wsDir = data.workspaceDirectory ?? existing?.workspaceDirectory;
      let wsInfo = WorkspaceRegistry.getWorkspaceInfo(wsDir);

      const title = data.title || existing?.title || 'New Session';
      const status: ConversationStatus = data.status || existing?.status || 'active';

      const conversation: StoredConversation = {
        sessionId: data.sessionId,
        title,
        dateCreated: existing?.dateCreated || now,
        lastModified: now,
        workspaceDirectory: wsInfo.path,
        workspaceId: data.workspaceId || wsInfo.id,
        workspaceName: data.workspaceName || wsInfo.name,
        status,
        mode: data.mode ?? existing?.mode,
        chatModelTitle: data.chatModelTitle ?? existing?.chatModelTitle,
        history: data.history || [],
        artifacts: data.artifacts ?? existing?.artifacts ?? [],
        executionIds: data.executionIds ?? existing?.executionIds ?? [],
        schemaVersion: STORAGE_SCHEMA_VERSION,
        metadata: {
          ...existing?.metadata,
          ...data.metadata,
        },
      };

      // Write conversation.json atomically
      const convFilePath = this.getConversationFilePath(data.sessionId);
      await this.storageManager.writeAtomicJson(convFilePath, conversation);

      // Update index entry
      const indexEntry: ConversationIndexEntry = {
        sessionId: conversation.sessionId,
        title: conversation.title,
        dateCreated: conversation.dateCreated,
        lastModified: conversation.lastModified,
        workspaceDirectory: conversation.workspaceDirectory,
        workspaceId: conversation.workspaceId,
        workspaceName: conversation.workspaceName,
        messageCount: conversation.history.length,
        status: conversation.status,
      };

      this.indexCache.set(conversation.sessionId, indexEntry);
      await this.persistIndex();

      return conversation;
    });
  }

  /**
   * Retrieve a full conversation by sessionId.
   */
  public async getConversation(sessionId: string): Promise<StoredConversation | null> {
    if (!sessionId) {
      return null;
    }

    const filePath = this.getConversationFilePath(sessionId);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const conv: StoredConversation = JSON.parse(raw);
      return conv;
    } catch {
      return null;
    }
  }

  /**
   * List conversations, optionally filtered by workspace, search term, limit, and offset.
   */
  public async listConversations(options?: {
    workspaceId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<ConversationIndexEntry[]> {
    await this.loadIndex();

    let list = Array.from(this.indexCache.values());

    // Filter by workspace if specified
    if (options?.workspaceId && options.workspaceId !== 'all') {
      list = list.filter((c) => c.workspaceId === options.workspaceId);
    }

    // Filter by search query (case-insensitive title and workspaceName)
    if (options?.search && options.search.trim()) {
      const q = options.search.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.workspaceName.toLowerCase().includes(q) ||
          c.workspaceDirectory.toLowerCase().includes(q)
      );
    }

    // Sort descending by lastModified (or dateCreated fallback)
    list.sort((a, b) => {
      const timeA = new Date(a.lastModified || a.dateCreated).getTime();
      const timeB = new Date(b.lastModified || b.dateCreated).getTime();
      return timeB - timeA;
    });

    // Pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? list.length;
    return list.slice(offset, offset + limit);
  }

  /**
   * Rename a conversation.
   */
  public async updateTitle(sessionId: string, newTitle: string): Promise<boolean> {
    const conv = await this.getConversation(sessionId);
    if (!conv) {
      return false;
    }

    conv.title = newTitle;
    await this.saveConversation(conv);
    return true;
  }

  /**
   * Delete a single conversation and all its owned data (journals, artifacts).
   * Safe: will not delete workspace files, vector stores, or other records.
   */
  public async deleteConversation(sessionId: string): Promise<boolean> {
    this.storageManager.validateSafeId(sessionId, 'sessionId');

    await this.loadIndex();

    return this.withIndexLock(async () => {
      const convDir = this.getConversationDir(sessionId);

      // 1. Delete conversation directory
      try {
        await fs.rm(convDir, { recursive: true, force: true });
      } catch (err: any) {
        if (err && err.code !== 'ENOENT') {
          this.logger.error(`Failed to delete conversation dir ${convDir}`, err);
          throw err;
        }
      }

      // 2. Delete execution journals for this conversation
      await this.executionJournal.deleteConversationJournal(sessionId);

      // 3. Delete artifacts for this conversation
      await this.artifactManager.deleteConversationArtifacts(sessionId);

      // 4. Update index
      this.indexCache.delete(sessionId);
      await this.persistIndex();

      this.logger.info(`Permanently deleted conversation ${sessionId} and owned data.`);
      return true;
    });
  }

  /**
   * Clear all conversations and their owned data.
   */
  public async clearAllConversations(): Promise<void> {
    await this.loadIndex();

    return this.withIndexLock(async () => {
      const allIds = Array.from(this.indexCache.keys());
      for (const id of allIds) {
        const convDir = this.getConversationDir(id);
        try {
          await fs.rm(convDir, { recursive: true, force: true });
        } catch (err: any) {
          if (err && err.code !== 'ENOENT') {
            this.logger.error(`Failed to delete conversation dir ${convDir} during clearAll`, err);
            throw err;
          }
        }
        await this.executionJournal.deleteConversationJournal(id);
        await this.artifactManager.deleteConversationArtifacts(id);
      }

      this.indexCache.clear();
      await this.persistIndex();
      this.logger.info('Cleared all conversations and associated journals and artifacts.');
    });
  }

  /**
   * Link an artifact reference to the conversation.
   */
  public async addArtifactRef(sessionId: string, ref: { id: string; type: string; title: string; filename?: string; createdAt: string }): Promise<void> {
    const conv = await this.getConversation(sessionId);
    if (!conv) {
      return;
    }
    if (!conv.artifacts) {
      conv.artifacts = [];
    }
    const idx = conv.artifacts.findIndex((a) => a.id === ref.id);
    if (idx >= 0) {
      conv.artifacts[idx] = ref;
    } else {
      conv.artifacts.push(ref);
    }
    await this.saveConversation(conv);
  }

  /**
   * Mark the status of a conversation (e.g. 'interrupted', 'completed', 'active').
   */
  public async markStatus(sessionId: string, status: ConversationStatus): Promise<void> {
    const conv = await this.getConversation(sessionId);
    if (conv) {
      conv.status = status;
      await this.saveConversation(conv);
    }
  }

  /**
   * Find any conversations with interrupted runs.
   */
  public async getInterruptedConversations(): Promise<ConversationIndexEntry[]> {
    await this.loadIndex();
    const list = Array.from(this.indexCache.values());
    const interrupted: ConversationIndexEntry[] = [];

    for (const item of list) {
      if (item.status === 'interrupted') {
        interrupted.push(item);
      } else {
        // Also check if latest execution run was left incomplete
        const conv = await this.getConversation(item.sessionId);
        if (conv && conv.executionIds && conv.executionIds.length > 0) {
          const latestExecutionId = conv.executionIds[conv.executionIds.length - 1];
          const isInterrupted = await this.executionJournal.isRunInterrupted(
            item.sessionId,
            latestExecutionId
          );
          if (isInterrupted) {
            item.hasInterruptedRun = true;
            interrupted.push(item);
          }
        }
      }
    }

    return interrupted;
  }
}
