/**
 * Storage Manager for KODRA.
 * 
 * Central coordinator for KODRA's global persistent storage root.
 * Enforces atomic writes, safe Windows replacement with rollback,
 * schema initialization, path safety, and secret sanitization.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { STORAGE_SCHEMA_VERSION, StorageMetadata } from './types';

export class StorageManager {
  private static instance: StorageManager | null = null;
  private readonly logger = Logger.getInstance();
  private initialized = false;
  private readonly fileLocks = new Map<string, Promise<void>>();

  public readonly configDir: string;
  public readonly conversationsDir: string;
  public readonly executionDir: string;
  public readonly artifactsDir: string;
  public readonly workspacesDir: string;
  public readonly modelsDir: string;
  public readonly backupsDir: string;
  public readonly metadataFile: string;

  constructor(public readonly storageRoot: string) {
    this.configDir = path.join(storageRoot, 'config');
    this.conversationsDir = path.join(storageRoot, 'conversations');
    this.executionDir = path.join(storageRoot, 'execution');
    this.artifactsDir = path.join(storageRoot, 'artifacts');
    this.workspacesDir = path.join(storageRoot, 'workspaces');
    this.modelsDir = path.join(storageRoot, 'models');
    this.backupsDir = path.join(storageRoot, 'backups');
    this.metadataFile = path.join(storageRoot, 'storage.json');
  }

  public static initialize(storageRoot: string): StorageManager {
    if (!StorageManager.instance || StorageManager.instance.storageRoot !== storageRoot) {
      StorageManager.instance = new StorageManager(storageRoot);
    }
    return StorageManager.instance;
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      throw new Error('StorageManager has not been initialized with storageRoot yet.');
    }
    return StorageManager.instance;
  }

  /**
   * Sequential lock to serialize concurrent atomic writes to the same destination file.
   */
  private async withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath);
    const prevLock = this.fileLocks.get(key) || Promise.resolve();

    let resolveNext: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    this.fileLocks.set(key, nextLock);

    try {
      await prevLock;
      return await fn();
    } finally {
      resolveNext();
      if (this.fileLocks.get(key) === nextLock) {
        this.fileLocks.delete(key);
      }
    }
  }

  /**
   * Idempotently initialize the storage directory layout and schema metadata.
   */
  public async initializeStorage(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const dirsToEnsure = [
        this.storageRoot,
        this.configDir,
        this.conversationsDir,
        this.executionDir,
        this.artifactsDir,
        this.workspacesDir,
        this.modelsDir,
        this.backupsDir,
      ];

      for (const dir of dirsToEnsure) {
        await fs.mkdir(dir, { recursive: true });
      }

      // Check or create schema metadata
      let meta: StorageMetadata | null = null;
      let rawMeta: string | null = null;
      try {
        rawMeta = await fs.readFile(this.metadataFile, 'utf-8');
        meta = JSON.parse(rawMeta);
      } catch (err: any) {
        if (rawMeta !== null && rawMeta.trim().length > 0) {
          // File exists but JSON is corrupted: preserve corrupt copy for diagnosis
          const corruptBackup = path.join(
            this.backupsDir,
            `storage.json.corrupt.${Date.now()}`
          );
          try {
            await fs.copyFile(this.metadataFile, corruptBackup);
            this.logger.warn(`Corrupted storage.json backed up to: ${corruptBackup}`);
          } catch {
            // ignore backup failure
          }
        }
      }

      const now = new Date().toISOString();
      if (!meta) {
        meta = {
          schemaVersion: STORAGE_SCHEMA_VERSION,
          initializedAt: now,
          lastUpdatedAt: now,
          kodraVersion: '0.1.3',
        };
        await this.writeAtomicJson(this.metadataFile, meta);
      } else {
        // Reject unsupported future schema versions to prevent data corruption
        if (meta.schemaVersion > STORAGE_SCHEMA_VERSION) {
          throw new Error(
            `Unsupported storage schema version: v${meta.schemaVersion}. ` +
            `Current KODRA extension supports up to schema version v${STORAGE_SCHEMA_VERSION}. ` +
            `Please update KODRA to the latest version to access this storage directory.`
          );
        }

        // Migration check if schema version is older
        if (meta.schemaVersion < STORAGE_SCHEMA_VERSION) {
          this.logger.info(`Migrating storage schema from v${meta.schemaVersion} to v${STORAGE_SCHEMA_VERSION}`);
          meta.schemaVersion = STORAGE_SCHEMA_VERSION;
          meta.lastUpdatedAt = now;
          await this.writeAtomicJson(this.metadataFile, meta);
        }
      }

      // Clean up orphaned .tmp and .bak files from previous unexpected halts
      await this.cleanupOrphanedFiles();

      this.initialized = true;
      this.logger.info(`Kodra persistent storage initialized at: ${this.storageRoot}`);
    } catch (err) {
      this.logger.error('Failed to initialize persistent storage layout', err);
      throw err;
    }
  }

  /**
   * Atomic file write utility.
   * Serializes concurrent writes to the same record.
   * Writes to a unique temp file in the target directory, then commits atomically.
   * On Windows where direct rename can fail if destination exists (EPERM/EEXIST/EBUSY),
   * uses a safe backup-and-rollback strategy without a delete-then-rename data-loss window.
   */
  public async writeAtomic(targetPath: string, data: string | Buffer): Promise<void> {
    return this.withFileLock(targetPath, async () => {
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });

      const uniqueSuffix = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      const tempFile = path.join(dir, `.${path.basename(targetPath)}.${uniqueSuffix}.tmp`);
      const backupFile = path.join(dir, `.${path.basename(targetPath)}.${uniqueSuffix}.bak`);

      // 1. Write the new content to unique temporary file
      try {
        await fs.writeFile(tempFile, data, 'utf-8');
      } catch (writeErr) {
        try {
          await fs.unlink(tempFile);
        } catch {
          // ignore
        }
        throw writeErr;
      }

      // 2. Commit the replacement safely
      try {
        await fs.rename(tempFile, targetPath);
      } catch (renameErr: any) {
        // Windows-specific handling: destination may exist and be locked or reject direct replace
        const isWindowsConflict =
          renameErr &&
          (renameErr.code === 'EEXIST' ||
           renameErr.code === 'EPERM' ||
           renameErr.code === 'EBUSY' ||
           renameErr.code === 'EACCES');

        if (isWindowsConflict) {
          let destExists = false;
          let destIsDir = false;
          try {
            const destStat = await fs.stat(targetPath);
            destExists = true;
            destIsDir = destStat.isDirectory();
          } catch {
            destExists = false;
          }

          if (destIsDir) {
            try {
              await fs.unlink(tempFile);
            } catch {
              // ignore
            }
            const isDirErr: any = new Error(`EISDIR: illegal operation on a directory, cannot replace directory with file '${targetPath}'`);
            isDirErr.code = 'EISDIR';
            throw isDirErr;
          }

          if (destExists) {
            // Backup the existing destination before touching it
            try {
              await fs.rename(targetPath, backupFile);
            } catch (backupErr) {
              // Could not create backup: abort without touching targetPath
              try {
                await fs.unlink(tempFile);
              } catch {
                // ignore
              }
              throw renameErr;
            }

            // Now attempt to rename tempFile to targetPath
            try {
              await fs.rename(tempFile, targetPath);
              // Replacement succeeded: remove the backup file
              try {
                await fs.unlink(backupFile);
              } catch {
                // ignore
              }
            } catch (commitErr) {
              // Replacement failed: ROLL BACK original destination from backup!
              try {
                await fs.rename(backupFile, targetPath);
              } catch (rollbackErr) {
                this.logger.error(`Critical rollback failure restoring ${targetPath}`, rollbackErr);
              }
              try {
                await fs.unlink(tempFile);
              } catch {
                // ignore
              }
              throw commitErr;
            }
          } else {
            // Destination did not exist but rename failed
            try {
              await fs.unlink(tempFile);
            } catch {
              // ignore
            }
            throw renameErr;
          }
        } else {
          // Other rename error
          try {
            await fs.unlink(tempFile);
          } catch {
            // ignore
          }
          throw renameErr;
        }
      }
    });
  }

  /**
   * Atomic JSON file write.
   */
  public async writeAtomicJson<T>(targetPath: string, data: T): Promise<void> {
    const jsonStr = JSON.stringify(data, null, 2);
    await this.writeAtomic(targetPath, jsonStr);
  }

  /**
   * Read and parse JSON file safely with fallback.
   */
  public async readJson<T>(targetPath: string, fallback: T): Promise<T> {
    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Verify that a target path is safely contained within an allowed base directory.
   */
  public isPathSafe(baseDir: string, targetPath: string): boolean {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    return (
      resolvedTarget === resolvedBase ||
      resolvedTarget.startsWith(resolvedBase + path.sep)
    );
  }

  /**
   * Validate that an identifier is safe for path construction.
   */
  public validateSafeId(id: string, name: string = 'id'): void {
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_\-\.]{1,128}$/.test(id) || id.includes('..')) {
      throw new Error(`Invalid ${name}: "${id}". Must be alphanumeric, dots, dashes, or underscores (1-128 chars).`);
    }
  }

  /**
   * Clean up any leftover .tmp or .bak files in storage directories.
   */
  public async cleanupOrphanedFiles(): Promise<void> {
    const scanDirs = [
      this.configDir,
      this.conversationsDir,
      this.executionDir,
      this.artifactsDir,
      this.workspacesDir,
    ];

    for (const rootDir of scanDirs) {
      await this.scanAndCleanDir(rootDir);
    }
  }

  private async scanAndCleanDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.scanAndCleanDir(fullPath);
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.tmp') || entry.name.endsWith('.bak')) {
            try {
              await fs.unlink(fullPath);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  /**
   * Scrub sensitive information (e.g. API keys, passwords, bearer tokens) from objects or strings.
   */
  public sanitizeData<T>(input: T): T {
    if (!input) {
      return input;
    }

    if (typeof input === 'string') {
      return this.sanitizeString(input) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.sanitizeData(item)) as unknown as T;
    }

    if (typeof input === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('key') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('password') ||
          lowerKey.includes('auth')
        ) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.sanitizeData(val);
        }
      }
      return result as T;
    }

    return input;
  }

  private sanitizeString(str: string): string {
    return str
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/xai-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/nvapi-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_NVIDIA_KEY]');
  }
}
