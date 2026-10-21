/**
 * Artifact Manager for KODRA.
 * 
 * Automatically persists agent-generated artifacts (diffs, patches, file modifications, plans, reports).
 * Preserves relationships with conversations and execution runs with collision-safe deduplication.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger';
import { StorageManager } from './storageManager';
import { StoredArtifact, StoredArtifactRef } from './types';

export class ArtifactManager {
  private readonly logger = Logger.getInstance();

  constructor(private readonly storageManager: StorageManager) {}

  private getArtifactDir(conversationId: string, artifactId: string): string {
    return path.join(this.storageManager.artifactsDir, conversationId, artifactId);
  }

  /**
   * Derive a deterministic artifact ID when executionId and toolCallId/filepath are present.
   * Prevents creating duplicate artifacts on event replays or re-runs.
   */
  private deriveArtifactId(artifact: {
    id?: string;
    conversationId: string;
    executionId?: string;
    type: string;
    filepath?: string;
    filename?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }): string {
    if (artifact.id) {
      return artifact.id;
    }

    const toolCallId = artifact.metadata?.toolCallId as string | undefined;
    const discriminator = toolCallId || artifact.filepath || artifact.filename || artifact.title;

    if (artifact.executionId && discriminator) {
      const seed = `${artifact.conversationId}:${artifact.executionId}:${artifact.type}:${discriminator}`;
      return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
    }

    return uuidv4();
  }

  /**
   * Persist a generated artifact.
   * Handles deduplication safely and ensures atomic disk writes.
   */
  public async saveArtifact(
    artifact: Omit<StoredArtifact, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
  ): Promise<StoredArtifact> {
    this.storageManager.validateSafeId(artifact.conversationId, 'conversationId');
    const id = this.deriveArtifactId(artifact);
    this.storageManager.validateSafeId(id, 'artifactId');

    const artifactDir = this.getArtifactDir(artifact.conversationId, id);
    if (!this.storageManager.isPathSafe(this.storageManager.artifactsDir, artifactDir)) {
      throw new Error(`Path traversal detected in artifact path: ${artifactDir}`);
    }

    await fs.mkdir(artifactDir, { recursive: true });

    // Check if existing artifact exists to preserve original createdAt
    let createdAt = artifact.createdAt;
    if (!createdAt) {
      const existing = await this.getArtifact(artifact.conversationId, id);
      createdAt = existing?.createdAt || new Date().toISOString();
    }

    const fullArtifact: StoredArtifact = {
      ...artifact,
      id,
      createdAt,
    };

    // Store metadata
    const metaPath = path.join(artifactDir, 'metadata.json');
    const { content, diff, ...metadata } = fullArtifact;
    await this.storageManager.writeAtomicJson(metaPath, metadata);

    // Store raw content
    if (content !== undefined) {
      const contentPath = path.join(artifactDir, 'content.txt');
      await this.storageManager.writeAtomic(contentPath, content);
    }

    // Store diff if present
    if (diff !== undefined) {
      const diffPath = path.join(artifactDir, 'patch.diff');
      await this.storageManager.writeAtomic(diffPath, diff);
    }

    this.logger.info(`Persisted artifact ${id} (${artifact.type}) for conversation ${artifact.conversationId}`);
    return fullArtifact;
  }

  /**
   * Retrieve an artifact by ID.
   */
  public async getArtifact(conversationId: string, artifactId: string): Promise<StoredArtifact | null> {
    this.storageManager.validateSafeId(conversationId, 'conversationId');
    this.storageManager.validateSafeId(artifactId, 'artifactId');

    const artifactDir = this.getArtifactDir(conversationId, artifactId);
    if (!this.storageManager.isPathSafe(this.storageManager.artifactsDir, artifactDir)) {
      throw new Error(`Path traversal detected in artifact path: ${artifactDir}`);
    }

    const metaPath = path.join(artifactDir, 'metadata.json');

    try {
      const meta = await this.storageManager.readJson<any>(metaPath, null);
      if (!meta) {
        return null;
      }

      let content = '';
      try {
        content = await fs.readFile(path.join(artifactDir, 'content.txt'), 'utf-8');
      } catch {
        // no content.txt
      }

      let diff: string | undefined;
      try {
        diff = await fs.readFile(path.join(artifactDir, 'patch.diff'), 'utf-8');
      } catch {
        // no patch.diff
      }

      return {
        ...meta,
        content,
        diff,
      };
    } catch {
      return null;
    }
  }

  /**
   * List all artifacts for a conversation.
   */
  public async listArtifacts(conversationId: string): Promise<StoredArtifactRef[]> {
    this.storageManager.validateSafeId(conversationId, 'conversationId');
    const convDir = path.join(this.storageManager.artifactsDir, conversationId);
    if (!this.storageManager.isPathSafe(this.storageManager.artifactsDir, convDir)) {
      throw new Error(`Path traversal detected in artifact directory: ${convDir}`);
    }

    try {
      const entries = await fs.readdir(convDir, { withFileTypes: true });
      const refs: StoredArtifactRef[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(convDir, entry.name, 'metadata.json');
          const meta = await this.storageManager.readJson<any>(metaPath, null);
          if (meta && meta.id) {
            refs.push({
              id: meta.id,
              type: meta.type,
              title: meta.title,
              filename: meta.filename,
              createdAt: meta.createdAt,
            });
          }
        }
      }

      return refs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Delete all artifacts associated with a conversation.
   */
  public async deleteConversationArtifacts(conversationId: string): Promise<void> {
    this.storageManager.validateSafeId(conversationId, 'conversationId');
    const dir = path.join(this.storageManager.artifactsDir, conversationId);
    if (!this.storageManager.isPathSafe(this.storageManager.artifactsDir, dir)) {
      throw new Error(`Path traversal detected in artifact directory: ${dir}`);
    }

    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err: any) {
      if (err && err.code !== 'ENOENT') {
        this.logger.warn(`Could not delete artifacts dir: ${dir}`, err);
        throw err;
      }
    }
  }
}
