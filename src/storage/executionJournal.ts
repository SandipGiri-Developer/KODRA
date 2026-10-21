/**
 * Execution Journal for KODRA.
 * 
 * Records incremental agent lifecycle events into per-conversation JSONL journals.
 * Provides serialized appending, detection of interrupted runs, and robust audit logs.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/logger';
import { StorageManager } from './storageManager';
import { ExecutionJournalEvent } from './types';

export class ExecutionJournal {
  private readonly logger = Logger.getInstance();
  private readonly appendLocks = new Map<string, Promise<void>>();

  constructor(private readonly storageManager: StorageManager) {}

  private getJournalPath(conversationId: string, executionId: string): string {
    return path.join(this.storageManager.executionDir, conversationId, `${executionId}.jsonl`);
  }

  /**
   * Serialize journal appends per execution ID to maintain strict event ordering.
   */
  private async withAppendLock<T>(executionId: string, fn: () => Promise<T>): Promise<T> {
    const prevLock = this.appendLocks.get(executionId) || Promise.resolve();

    let resolveNext: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    this.appendLocks.set(executionId, nextLock);

    try {
      await prevLock;
      return await fn();
    } finally {
      resolveNext();
      if (this.appendLocks.get(executionId) === nextLock) {
        this.appendLocks.delete(executionId);
      }
    }
  }

  /**
   * Append an event to the execution journal.
   * Serialized per execution; propagates write errors to callers.
   */
  public async appendEvent(
    conversationId: string,
    executionId: string,
    event: Partial<ExecutionJournalEvent> & { type: string },
    workspaceId: string = 'global'
  ): Promise<ExecutionJournalEvent> {
    this.storageManager.validateSafeId(conversationId, 'conversationId');
    this.storageManager.validateSafeId(executionId, 'executionId');

    const journalPath = this.getJournalPath(conversationId, executionId);
    if (!this.storageManager.isPathSafe(this.storageManager.executionDir, journalPath)) {
      throw new Error(`Path traversal detected in journal path: ${journalPath}`);
    }

    return this.withAppendLock(executionId, async () => {
      await fs.mkdir(path.dirname(journalPath), { recursive: true });

      const fullEvent: ExecutionJournalEvent = {
        eventId: event.eventId || uuidv4(),
        executionId,
        conversationId,
        workspaceId: event.workspaceId || workspaceId,
        timestamp: event.timestamp || Date.now(),
        type: event.type,
        data: event.data ? this.storageManager.sanitizeData(event.data) : undefined,
      };

      const line = JSON.stringify(fullEvent) + '\n';
      try {
        await fs.appendFile(journalPath, line, 'utf-8');
        return fullEvent;
      } catch (err) {
        this.logger.error(`Failed to append execution event ${event.type} to ${journalPath}`, err);
        throw err;
      }
    });
  }

  /**
   * Record the start of an agent execution run.
   */
  public async startRun(
    conversationId: string,
    executionId: string,
    workspaceId: string,
    initialData?: Record<string, unknown>
  ): Promise<ExecutionJournalEvent> {
    return this.appendEvent(
      conversationId,
      executionId,
      {
        type: 'run.started',
        data: initialData,
      },
      workspaceId
    );
  }

  /**
   * Record successful completion of a run.
   */
  public async completeRun(
    conversationId: string,
    executionId: string,
    usage?: Record<string, unknown>
  ): Promise<ExecutionJournalEvent> {
    return this.appendEvent(conversationId, executionId, {
      type: 'run.completed',
      data: usage ? { usage } : undefined,
    });
  }

  /**
   * Record failure of a run.
   */
  public async failRun(
    conversationId: string,
    executionId: string,
    error: string
  ): Promise<ExecutionJournalEvent> {
    return this.appendEvent(conversationId, executionId, {
      type: 'run.failed',
      data: { error },
    });
  }

  /**
   * Record cancellation of a run.
   */
  public async cancelRun(
    conversationId: string,
    executionId: string
  ): Promise<ExecutionJournalEvent> {
    return this.appendEvent(conversationId, executionId, {
      type: 'run.cancelled',
    });
  }

  /**
   * Read all recorded events for a given execution run.
   * Validates records and recovers valid entries even if some lines are malformed.
   */
  public async getEvents(conversationId: string, executionId: string): Promise<ExecutionJournalEvent[]> {
    this.storageManager.validateSafeId(conversationId, 'conversationId');
    this.storageManager.validateSafeId(executionId, 'executionId');

    const journalPath = this.getJournalPath(conversationId, executionId);
    try {
      const content = await fs.readFile(journalPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      const events: ExecutionJournalEvent[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && parsed.type && parsed.eventId) {
            events.push(parsed as ExecutionJournalEvent);
          } else {
            this.logger.warn(`Skipping malformed journal record in ${journalPath}: "${line}"`);
          }
        } catch {
          this.logger.warn(`Skipping unparseable JSON line in ${journalPath}: "${line}"`);
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  /**
   * Determine if an execution run was interrupted unexpectedly (e.g. VS Code crashed or reloaded).
   */
  public async isRunInterrupted(conversationId: string, executionId: string): Promise<boolean> {
    const events = await this.getEvents(conversationId, executionId);
    if (events.length === 0) {
      return false;
    }

    const hasStarted = events.some((e) => e.type === 'run.started' || e.type === 'agent.started');
    const hasTerminated = events.some(
      (e) =>
        e.type === 'run.completed' ||
        e.type === 'run.failed' ||
        e.type === 'run.cancelled' ||
        e.type === 'agent.completed' ||
        e.type === 'agent.failed' ||
        e.type === 'agent.cancelled'
    );

    return hasStarted && !hasTerminated;
  }

  /**
   * Delete execution records for a conversation.
   */
  public async deleteConversationJournal(conversationId: string): Promise<void> {
    this.storageManager.validateSafeId(conversationId, 'conversationId');
    const dir = path.join(this.storageManager.executionDir, conversationId);
    if (!this.storageManager.isPathSafe(this.storageManager.executionDir, dir)) {
      throw new Error(`Path traversal detected in journal directory: ${dir}`);
    }

    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err: any) {
      if (err && err.code !== 'ENOENT') {
        this.logger.warn(`Could not delete execution journal dir: ${dir}`, err);
        throw err;
      }
    }
  }
}
