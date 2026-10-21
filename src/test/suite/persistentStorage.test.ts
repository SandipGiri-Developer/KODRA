/**
 * Comprehensive test suite for KODRA Persistent Storage, Conversation History,
 * Execution Journaling, Artifact Persistence, and Deletion Safety.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ArtifactManager,
  ConversationRepository,
  ExecutionJournal,
  STORAGE_SCHEMA_VERSION,
  StorageManager,
  StoredConversation,
  WorkspaceRegistry,
} from '../../storage';

describe('KODRA Persistent Storage System', () => {
  let tempStorageRoot: string;
  let storageManager: StorageManager;
  let workspaceRegistry: WorkspaceRegistry;
  let executionJournal: ExecutionJournal;
  let artifactManager: ArtifactManager;
  let repository: ConversationRepository;

  beforeEach(async () => {
    tempStorageRoot = path.join(os.tmpdir(), `kodra-storage-test-${uuidv4()}`);
    await fs.mkdir(tempStorageRoot, { recursive: true });

    storageManager = new StorageManager(tempStorageRoot);
    await storageManager.initializeStorage();

    workspaceRegistry = new WorkspaceRegistry(tempStorageRoot);
    await workspaceRegistry.initialize();

    executionJournal = new ExecutionJournal(storageManager);
    artifactManager = new ArtifactManager(storageManager);
    repository = new ConversationRepository(
      storageManager,
      workspaceRegistry,
      executionJournal,
      artifactManager
    );
    await repository.loadIndex();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempStorageRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Phase 1: Storage Initialization & Layout', () => {
    it('creates all required directories and schema metadata', async () => {
      const dirs = [
        storageManager.configDir,
        storageManager.conversationsDir,
        storageManager.executionDir,
        storageManager.artifactsDir,
        storageManager.workspacesDir,
        storageManager.modelsDir,
        storageManager.backupsDir,
      ];

      for (const dir of dirs) {
        const stat = await fs.stat(dir);
        expect(stat.isDirectory()).toBe(true);
      }

      const meta = await storageManager.readJson<any>(storageManager.metadataFile, null);
      expect(meta).not.toBeNull();
      expect(meta.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
      expect(meta.kodraVersion).toBe('0.1.3');
    });

    it('initialization is idempotent and does not overwrite existing data', async () => {
      // Create a test file
      const markerPath = path.join(storageManager.conversationsDir, 'marker.txt');
      await fs.writeFile(markerPath, 'preserved', 'utf-8');

      // Re-initialize
      await storageManager.initializeStorage();

      const markerContent = await fs.readFile(markerPath, 'utf-8');
      expect(markerContent).toBe('preserved');
    });

    it('performs atomic writes safely without leaving temporary files', async () => {
      const targetFile = path.join(storageManager.configDir, 'test-atomic.json');
      await storageManager.writeAtomicJson(targetFile, { test: 'atomic_content' });

      const readBack = await storageManager.readJson<any>(targetFile, null);
      expect(readBack).toEqual({ test: 'atomic_content' });

      // Verify no leftover .tmp files
      const files = await fs.readdir(storageManager.configDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp'));
      expect(tmpFiles.length).toBe(0);
    });

    it('sanitizes sensitive data from records', () => {
      const input = {
        apiKey: 'sk-abcdef1234567890abcdef1234567890',
        token: 'Bearer sensitive-token-here-123456789',
        normalText: 'Hello world with key sk-openai12345678901234567890',
      };

      const sanitized = storageManager.sanitizeData(input);
      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.normalText).toContain('[REDACTED_API_KEY]');
    });

    it('enforces path safety to prevent path traversal', () => {
      const safeTarget = path.join(storageManager.conversationsDir, 'conv-1');
      const unsafeTarget = path.join(storageManager.conversationsDir, '..', '..', 'etc', 'passwd');

      expect(storageManager.isPathSafe(storageManager.conversationsDir, safeTarget)).toBe(true);
      expect(storageManager.isPathSafe(storageManager.conversationsDir, unsafeTarget)).toBe(false);
    });
  });

  describe('Phase 2: Workspace Registry & Normalization', () => {
    it('canonicalizes paths and derives deterministic workspace IDs', () => {
      const path1 = 'C:\\Users\\Developer\\Project';
      const path2 = 'c:/users/developer/project/';

      const id1 = WorkspaceRegistry.getWorkspaceId(path1);
      const id2 = WorkspaceRegistry.getWorkspaceId(path2);

      if (process.platform === 'win32') {
        expect(id1).toBe(id2);
      }
      expect(id1).toHaveLength(16);
    });

    it('registers and retrieves workspaces', async () => {
      const wsPath = path.join(tempStorageRoot, 'mock-project');
      const rec = await workspaceRegistry.registerWorkspace(wsPath, 'MockProject');

      expect(rec.name).toBe('MockProject');
      expect(rec.id).toBe(WorkspaceRegistry.getWorkspaceId(wsPath));

      const retrieved = await workspaceRegistry.getWorkspaceById(rec.id);
      expect(retrieved?.path).toBe(rec.path);
    });
  });

  describe('Phase 3: Conversation Persistence & Indexing', () => {
    it('saves, loads, and preserves messages and metadata', async () => {
      const sessionId = uuidv4();
      const sessionData = {
        sessionId,
        title: 'Refactor Agent Loop',
        workspaceDirectory: path.join(tempStorageRoot, 'my-project'),
        history: [
          { message: { role: 'user', content: 'Please refactor agentLoop.ts' }, contextItems: [] },
          { message: { role: 'assistant', content: 'I will refactor it step by step.' }, contextItems: [] },
        ],
        mode: 'chat',
        status: 'active' as const,
      };

      const saved = await repository.saveConversation(sessionData);
      expect(saved.sessionId).toBe(sessionId);
      expect(saved.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);

      const loaded = await repository.getConversation(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded?.title).toBe('Refactor Agent Loop');
      expect(loaded?.history).toHaveLength(2);
      expect(loaded?.history[0].message.content).toBe('Please refactor agentLoop.ts');
    });

    it('lists conversations globally and sorts descending by time', async () => {
      const id1 = uuidv4();
      const id2 = uuidv4();

      await repository.saveConversation({
        sessionId: id1,
        title: 'Older Session',
        history: [{ message: { role: 'user', content: '1' } }],
      });

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 20));

      await repository.saveConversation({
        sessionId: id2,
        title: 'Newer Session',
        history: [{ message: { role: 'user', content: '2' } }],
      });

      const list = await repository.listConversations();
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0].sessionId).toBe(id2);
      expect(list[1].sessionId).toBe(id1);
    });

    it('filters conversations by workspace identity', async () => {
      const wsA = path.join(tempStorageRoot, 'ws-A');
      const wsB = path.join(tempStorageRoot, 'ws-B');

      const idA = uuidv4();
      const idB = uuidv4();

      await repository.saveConversation({
        sessionId: idA,
        title: 'Session in Project A',
        workspaceDirectory: wsA,
        history: [],
      });

      await repository.saveConversation({
        sessionId: idB,
        title: 'Session in Project B',
        workspaceDirectory: wsB,
        history: [],
      });

      const idWsA = WorkspaceRegistry.getWorkspaceId(wsA);
      const filteredA = await repository.listConversations({ workspaceId: idWsA });
      expect(filteredA).toHaveLength(1);
      expect(filteredA[0].sessionId).toBe(idA);

      const all = await repository.listConversations();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('searches conversations by title or workspace name', async () => {
      const id = uuidv4();
      await repository.saveConversation({
        sessionId: id,
        title: 'UniqueSearchTermKernel',
        history: [],
      });

      const results = await repository.listConversations({ search: 'UniqueSearch' });
      expect(results).toHaveLength(1);
      expect(results[0].sessionId).toBe(id);
    });

    it('automatically rebuilds the index if index.json is deleted or corrupted', async () => {
      const id = uuidv4();
      await repository.saveConversation({
        sessionId: id,
        title: 'Persistent across index deletion',
        history: [{ message: { role: 'user', content: 'Hi' } }],
      });

      // Corrupt or delete index.json
      const indexPath = path.join(storageManager.conversationsDir, 'index.json');
      await fs.writeFile(indexPath, 'INVALID_JSON_CORRUPTED', 'utf-8');

      // Create a new repository instance pointing to the same storage
      const newRepo = new ConversationRepository(
        storageManager,
        workspaceRegistry,
        executionJournal,
        artifactManager
      );
      await newRepo.loadIndex();

      const list = await newRepo.listConversations();
      expect(list.some((c) => c.sessionId === id)).toBe(true);
    });

    it('renames conversations properly', async () => {
      const id = uuidv4();
      await repository.saveConversation({
        sessionId: id,
        title: 'Initial Title',
        history: [],
      });

      const success = await repository.updateTitle(id, 'Updated Title');
      expect(success).toBe(true);

      const loaded = await repository.getConversation(id);
      expect(loaded?.title).toBe('Updated Title');
    });
  });

  describe('Phase 4: Detailed Agent Execution History & Interrupted Run Detection', () => {
    it('appends execution events incrementally into JSONL journal', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      await executionJournal.startRun(convId, execId, 'ws-123', { prompt: 'Run tests' });
      await executionJournal.appendEvent(convId, execId, {
        type: 'tool.started',
        data: { toolName: 'read_file', args: { filepath: 'src/index.ts' } },
      });
      await executionJournal.appendEvent(convId, execId, {
        type: 'tool.completed',
        data: { toolName: 'read_file', success: true },
      });
      await executionJournal.completeRun(convId, execId, { promptTokens: 100 });

      const events = await executionJournal.getEvents(convId, execId);
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe('run.started');
      expect(events[1].type).toBe('tool.started');
      expect(events[2].type).toBe('tool.completed');
      expect(events[3].type).toBe('run.completed');
    });

    it('accurately identifies interrupted runs', async () => {
      const convId = uuidv4();
      const completedExecId = uuidv4();
      const interruptedExecId = uuidv4();

      // 1. Completed run
      await executionJournal.startRun(convId, completedExecId, 'ws-1');
      await executionJournal.completeRun(convId, completedExecId);
      expect(await executionJournal.isRunInterrupted(convId, completedExecId)).toBe(false);

      // 2. Interrupted run (started and tools called, but extension crashed before completion)
      await executionJournal.startRun(convId, interruptedExecId, 'ws-1');
      await executionJournal.appendEvent(convId, interruptedExecId, {
        type: 'tool.started',
        data: { toolName: 'terminal', args: { command: 'long-build' } },
      });

      expect(await executionJournal.isRunInterrupted(convId, interruptedExecId)).toBe(true);
    });

    it('repository reports interrupted conversations for recovery', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      await repository.saveConversation({
        sessionId: convId,
        title: 'Interrupted Session',
        history: [],
      });

      // Add execution ID to conversation
      const conv = await repository.getConversation(convId);
      if (conv) {
        conv.executionIds = [execId];
        await repository.saveConversation(conv);
      }

      await executionJournal.startRun(convId, execId, 'ws-1');

      const interruptedList = await repository.getInterruptedConversations();
      expect(interruptedList.some((c) => c.sessionId === convId)).toBe(true);

      // Once marked completed/recovered
      await repository.markStatus(convId, 'completed');
      await executionJournal.completeRun(convId, execId);

      const afterList = await repository.getInterruptedConversations();
      expect(afterList.some((c) => c.sessionId === convId)).toBe(false);
    });
  });

  describe('Phase 5: Automatic Artifact Persistence', () => {
    it('persists diffs, patches, and created files', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      const patchArtifact = await artifactManager.saveArtifact({
        conversationId: convId,
        executionId: execId,
        title: 'edit_file: src/extension.ts',
        type: 'patch',
        filepath: 'src/extension.ts',
        filename: 'extension.ts',
        content: 'Modified content',
        diff: '--- old\n+++ new\n@@ -1 +1 @@\n-old\n+new',
      });

      expect(patchArtifact.id).toBeDefined();

      const retrieved = await artifactManager.getArtifact(convId, patchArtifact.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.type).toBe('patch');
      expect(retrieved?.diff).toContain('+new');
      expect(retrieved?.content).toBe('Modified content');

      const list = await artifactManager.listArtifacts(convId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(patchArtifact.id);
    });

    it('handles distinct artifacts sharing the same filename collision-safely', async () => {
      const convId = uuidv4();

      const a1 = await artifactManager.saveArtifact({
        conversationId: convId,
        title: 'Patch 1 for index.ts',
        type: 'patch',
        filename: 'index.ts',
        content: 'content 1',
      });

      const a2 = await artifactManager.saveArtifact({
        conversationId: convId,
        title: 'Patch 2 for index.ts',
        type: 'patch',
        filename: 'index.ts',
        content: 'content 2',
      });

      expect(a1.id).not.toBe(a2.id);

      const r1 = await artifactManager.getArtifact(convId, a1.id);
      const r2 = await artifactManager.getArtifact(convId, a2.id);

      expect(r1?.content).toBe('content 1');
      expect(r2?.content).toBe('content 2');
    });
  });

  describe('Phase 6: Deletion Safety & Ownership Isolation', () => {
    it('permanently deletes conversation and owned records without touching workspace files', async () => {
      // Create a mock user workspace file
      const userWorkspaceDir = path.join(tempStorageRoot, 'user-workspace');
      await fs.mkdir(userWorkspaceDir, { recursive: true });
      const userSourceFile = path.join(userWorkspaceDir, 'App.tsx');
      await fs.writeFile(userSourceFile, 'export const App = () => null;', 'utf-8');

      const convId = uuidv4();
      const execId = uuidv4();

      await repository.saveConversation({
        sessionId: convId,
        title: 'Session to Delete',
        workspaceDirectory: userWorkspaceDir,
        history: [{ message: { role: 'user', content: 'delete me' } }],
      });

      await executionJournal.startRun(convId, execId, 'ws-1');
      await artifactManager.saveArtifact({
        conversationId: convId,
        title: 'Patch',
        type: 'patch',
        content: 'diff',
      });

      // Verify records exist before deletion
      expect(await repository.getConversation(convId)).not.toBeNull();
      expect((await executionJournal.getEvents(convId, execId)).length).toBeGreaterThan(0);
      expect((await artifactManager.listArtifacts(convId)).length).toBe(1);

      // Perform deletion
      await repository.deleteConversation(convId);

      // Verify conversation and owned records are deleted
      expect(await repository.getConversation(convId)).toBeNull();
      expect(await executionJournal.getEvents(convId, execId)).toEqual([]);
      expect(await artifactManager.listArtifacts(convId)).toEqual([]);

      // Verify user's actual workspace file was NEVER touched
      const userFileExists = await fs.readFile(userSourceFile, 'utf-8');
      expect(userFileExists).toBe('export const App = () => null;');
    });

    it('rejects invalid or traversal session IDs during deletion', async () => {
      await expect(repository.deleteConversation('../root')).rejects.toThrow();
      await expect(repository.deleteConversation('conv/sub')).rejects.toThrow();
      await expect(repository.deleteConversation('')).rejects.toThrow();
    });

    it('clearAllConversations removes all conversations but preserves root layout', async () => {
      const c1 = uuidv4();
      const c2 = uuidv4();

      await repository.saveConversation({ sessionId: c1, title: 'C1', history: [] });
      await repository.saveConversation({ sessionId: c2, title: 'C2', history: [] });

      await repository.clearAllConversations();

      const remaining = await repository.listConversations();
      expect(remaining).toHaveLength(0);

      // Storage directories remain intact
      const stat = await fs.stat(storageManager.conversationsDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('Phase 7: Advanced Reliability, Rollback & Concurrency', () => {
    it('serializes concurrent writes to the same file without data corruption', async () => {
      const targetFile = path.join(storageManager.configDir, 'concurrent-test.json');

      // Launch 5 concurrent writes to the same destination
      const promises = [1, 2, 3, 4, 5].map((num) =>
        storageManager.writeAtomicJson(targetFile, { iteration: num, payload: 'x'.repeat(1000) })
      );

      await Promise.all(promises);

      const result = await storageManager.readJson<any>(targetFile, null);
      expect(result).not.toBeNull();
      expect(typeof result.iteration).toBe('number');
      expect(result.payload).toBe('x'.repeat(1000));
    });

    it('cleans up temporary files when writing fails', async () => {
      // Creating a target directory so that renaming a file over it fails
      const dirAsTarget = path.join(storageManager.storageRoot, 'existing-dir-target');
      await fs.mkdir(dirAsTarget, { recursive: true });

      // Attempt atomic write where target is a directory; replacement will fail
      await expect(storageManager.writeAtomic(dirAsTarget, 'content')).rejects.toThrow();

      // Verify no orphaned .tmp files in storageRoot
      const entries = await fs.readdir(storageManager.storageRoot);
      const tmpFiles = entries.filter((e) => e.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);

      // Verify target directory still exists undamaged
      const stat = await fs.stat(dirAsTarget);
      expect(stat.isDirectory()).toBe(true);
    });

    it('rejects unsupported future schema versions to prevent corrupting newer data', async () => {
      const futureMeta = {
        schemaVersion: 999,
        initializedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        kodraVersion: '9.9.9',
      };
      await fs.writeFile(storageManager.metadataFile, JSON.stringify(futureMeta, null, 2), 'utf-8');

      const freshManager = new StorageManager(tempStorageRoot);
      await expect(freshManager.initializeStorage()).rejects.toThrow(/Unsupported storage schema version/);
    });

    it('backs up corrupted storage.json metadata without wiping existing data', async () => {
      await fs.writeFile(storageManager.metadataFile, 'MALFORMED_NON_JSON_DATA{{{', 'utf-8');

      const freshManager = new StorageManager(tempStorageRoot);
      await freshManager.initializeStorage();

      // Corrupt backup should exist in backups directory
      const backups = await fs.readdir(freshManager.backupsDir);
      expect(backups.some((b) => b.includes('storage.json.corrupt'))).toBe(true);

      // Metadata should have been re-initialized safely
      const restoredMeta = await freshManager.readJson<any>(freshManager.metadataFile, null);
      expect(restoredMeta.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    });

    it('recovers valid preceding and succeeding journal records when a line is malformed', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      await executionJournal.startRun(convId, execId, 'ws-test', { step: 1 });
      await executionJournal.appendEvent(convId, execId, {
        type: 'tool.completed',
        data: { step: 2 },
      });

      // Inject a malformed line into the JSONL file
      const journalPath = path.join(storageManager.executionDir, convId, `${execId}.jsonl`);
      await fs.appendFile(journalPath, 'INVALID_CORRUPTED_JSON_LINE\n', 'utf-8');

      // Append another valid event
      await executionJournal.appendEvent(convId, execId, {
        type: 'tool.completed',
        data: { step: 3 },
      });

      // Retrieve events: should recover the 3 valid events and skip the bad line
      const events = await executionJournal.getEvents(convId, execId);
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('run.started');
      expect(events[1].data?.step).toBe(2);
      expect(events[2].data?.step).toBe(3);
    });

    it('serializes concurrent journal appends preserving strict order', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      // Append 10 events concurrently
      const appends = Array.from({ length: 10 }, (_, i) =>
        executionJournal.appendEvent(convId, execId, {
          type: 'step',
          data: { index: i },
        })
      );

      await Promise.all(appends);

      const events = await executionJournal.getEvents(convId, execId);
      expect(events).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(events[i].data?.index).toBe(i);
      }
    });

    it('deduplicates artifacts when replaying identical tool executions', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      // Save artifact once
      const art1 = await artifactManager.saveArtifact({
        conversationId: convId,
        executionId: execId,
        title: 'edit_file: src/foo.ts',
        type: 'patch',
        filepath: 'src/foo.ts',
        content: 'content',
        metadata: { toolCallId: 'call-123' },
      });

      // Save identical artifact again (e.g. event replay)
      const art2 = await artifactManager.saveArtifact({
        conversationId: convId,
        executionId: execId,
        title: 'edit_file: src/foo.ts',
        type: 'patch',
        filepath: 'src/foo.ts',
        content: 'content updated',
        metadata: { toolCallId: 'call-123' },
      });

      // IDs must match and list should have only 1 entry
      expect(art1.id).toBe(art2.id);
      const list = await artifactManager.listArtifacts(convId);
      expect(list).toHaveLength(1);
    });

    it('survives complete storage service reinitialization (simulating VS Code restart)', async () => {
      const convId = uuidv4();
      const execId = uuidv4();

      // 1. Create conversation, append events, create artifacts
      await repository.saveConversation({
        sessionId: convId,
        title: 'Conversation to survive restart',
        history: [{ message: { role: 'user', content: 'Survive restart' } }],
      });

      await executionJournal.startRun(convId, execId, 'ws-restart');
      await executionJournal.completeRun(convId, execId);

      const art = await artifactManager.saveArtifact({
        conversationId: convId,
        executionId: execId,
        title: 'Report',
        type: 'report',
        content: 'Test report content',
      });
      await repository.addArtifactRef(convId, {
        id: art.id,
        type: art.type,
        title: art.title,
        createdAt: art.createdAt,
      });

      // 2. Tear down and instantiate fresh services on the SAME storage directory
      const newStorageManager = new StorageManager(tempStorageRoot);
      await newStorageManager.initializeStorage();

      const newWorkspaceRegistry = new WorkspaceRegistry(tempStorageRoot);
      await newWorkspaceRegistry.initialize();

      const newJournal = new ExecutionJournal(newStorageManager);
      const newArtifactManager = new ArtifactManager(newStorageManager);
      const newRepo = new ConversationRepository(
        newStorageManager,
        newWorkspaceRegistry,
        newJournal,
        newArtifactManager
      );
      await newRepo.loadIndex();

      // 3. Verify complete state was persisted and retrieved
      const loadedConv = await newRepo.getConversation(convId);
      expect(loadedConv).not.toBeNull();
      expect(loadedConv?.title).toBe('Conversation to survive restart');
      expect(loadedConv?.history).toHaveLength(1);
      expect(loadedConv?.artifacts).toHaveLength(1);
      expect(loadedConv?.artifacts?.[0].id).toBe(art.id);

      const loadedEvents = await newJournal.getEvents(convId, execId);
      expect(loadedEvents).toHaveLength(2);

      const loadedArt = await newArtifactManager.getArtifact(convId, art.id);
      expect(loadedArt).not.toBeNull();
      expect(loadedArt?.content).toBe('Test report content');
    });
  });
});
