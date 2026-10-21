/**
 * Integration tests for KodraViewProvider History & Storage IPC protocol.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { KodraViewProvider } from '../../webview/viewProvider';
import { ProviderRegistry } from '../../providers/registry';
import { CodebaseIndexer } from '../../indexing/indexer';
import {
  ArtifactManager,
  ConversationRepository,
  ExecutionJournal,
  StorageManager,
  WorkspaceRegistry,
} from '../../storage';
import { SettingsManager } from '../../utils/settingsManager';

describe('KodraViewProvider History & Storage IPC Protocol', () => {
  let tempStorageRoot: string;
  let storageManager: StorageManager;
  let workspaceRegistry: WorkspaceRegistry;
  let executionJournal: ExecutionJournal;
  let artifactManager: ArtifactManager;
  let repository: ConversationRepository;
  let viewProvider: KodraViewProvider;
  let postedMessages: any[] = [];
  let mockWebview: any;

  beforeEach(async () => {
    tempStorageRoot = path.join(os.tmpdir(), `kodra-view-test-${uuidv4()}`);
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

    const mockExtensionUri = vscode.Uri.file(tempStorageRoot);
    const mockSecrets: any = {
      get: jest.fn().mockResolvedValue(undefined),
      store: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      onDidChange: jest.fn(),
    };

    (SettingsManager as any).instance = undefined;
    SettingsManager.initialize({
      secrets: mockSecrets,
      subscriptions: [],
    } as any);

    const providerRegistry = new ProviderRegistry(mockSecrets);
    const indexer = new CodebaseIndexer();

    viewProvider = new KodraViewProvider(
      mockExtensionUri,
      providerRegistry,
      indexer,
      undefined,
      repository,
      executionJournal,
      artifactManager,
      workspaceRegistry
    );

    postedMessages = [];
    mockWebview = {
      options: {},
      html: '',
      asWebviewUri: jest.fn((uri) => uri),
      onDidReceiveMessage: jest.fn((handler) => {
        mockWebview._handler = handler;
        return { dispose: jest.fn() };
      }),
      postMessage: jest.fn((msg) => {
        postedMessages.push(msg);
        return Promise.resolve(true);
      }),
    };

    const mockWebviewView: any = {
      webview: mockWebview,
      show: jest.fn(),
      onDidChangeVisibility: jest.fn(),
    };

    viewProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempStorageRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('handles history/save and history/list via IdeMessenger protocol', async () => {
    const sessionId = uuidv4();
    const saveReq = {
      messageType: 'history/save',
      messageId: 'req-save-1',
      data: {
        sessionId,
        title: 'IPC Saved Conversation',
        workspaceDirectory: tempStorageRoot,
        history: [{ message: { role: 'user', content: 'Testing IPC' } }],
      },
    };

    await mockWebview._handler(saveReq);

    const saveResp = postedMessages.find((m) => m.messageId === 'req-save-1');
    expect(saveResp).toBeDefined();
    expect(saveResp.data.status).toBe('success');

    // Now request history/list
    const listReq = {
      messageType: 'history/list',
      messageId: 'req-list-1',
      data: {},
    };

    await mockWebview._handler(listReq);

    const listResp = postedMessages.find((m) => m.messageId === 'req-list-1');
    expect(listResp).toBeDefined();
    expect(listResp.data.status).toBe('success');
    expect(listResp.data.content).toBeInstanceOf(Array);
    expect(listResp.data.content.some((c: any) => c.sessionId === sessionId)).toBe(true);
  });

  it('handles history/load via IdeMessenger protocol', async () => {
    const sessionId = uuidv4();
    await repository.saveConversation({
      sessionId,
      title: 'To Load',
      history: [{ message: { role: 'user', content: 'Loaded msg' } }],
    });

    const loadReq = {
      messageType: 'history/load',
      messageId: 'req-load-1',
      data: { id: sessionId },
    };

    await mockWebview._handler(loadReq);

    const loadResp = postedMessages.find((m) => m.messageId === 'req-load-1');
    expect(loadResp).toBeDefined();
    expect(loadResp.data.status).toBe('success');
    expect(loadResp.data.content.title).toBe('To Load');
    expect(loadResp.data.content.history[0].message.content).toBe('Loaded msg');
  });

  it('handles history/delete via IdeMessenger protocol', async () => {
    const sessionId = uuidv4();
    await repository.saveConversation({
      sessionId,
      title: 'To Delete',
      history: [],
    });

    const deleteReq = {
      messageType: 'history/delete',
      messageId: 'req-del-1',
      data: { id: sessionId },
    };

    await mockWebview._handler(deleteReq);

    const delResp = postedMessages.find((m) => m.messageId === 'req-del-1');
    expect(delResp).toBeDefined();
    expect(delResp.data.status).toBe('success');

    // Confirm deleted from repository
    const check = await repository.getConversation(sessionId);
    expect(check).toBeNull();
  });

  it('handles history/clear via IdeMessenger protocol', async () => {
    const s1 = uuidv4();
    const s2 = uuidv4();
    await repository.saveConversation({ sessionId: s1, title: 'S1', history: [] });
    await repository.saveConversation({ sessionId: s2, title: 'S2', history: [] });

    const clearReq = {
      messageType: 'history/clear',
      messageId: 'req-clear-1',
      data: undefined,
    };

    await mockWebview._handler(clearReq);

    const clearResp = postedMessages.find((m) => m.messageId === 'req-clear-1');
    expect(clearResp).toBeDefined();
    expect(clearResp.data.status).toBe('success');

    const remaining = await repository.listConversations();
    expect(remaining).toHaveLength(0);
  });

  it('generates chat title with chatDescriber/describe', async () => {
    const descReq = {
      messageType: 'chatDescriber/describe',
      messageId: 'req-desc-1',
      data: { text: 'Fix navigation bar overflow in mobile view\nDetails below...' },
    };

    await mockWebview._handler(descReq);

    const descResp = postedMessages.find((m) => m.messageId === 'req-desc-1');
    expect(descResp).toBeDefined();
    expect(descResp.data.status).toBe('success');
    expect(descResp.data.content).toBe('Fix navigation bar overflow in mobile view');
  });

  it('handles history/interrupted and history/recover', async () => {
    const sessionId = uuidv4();
    await repository.saveConversation({
      sessionId,
      title: 'Interrupted task',
      status: 'interrupted',
      history: [],
    });

    const interruptedReq = {
      messageType: 'history/interrupted',
      messageId: 'req-interrupted-1',
      data: {},
    };

    await mockWebview._handler(interruptedReq);

    const intResp = postedMessages.find((m) => m.messageId === 'req-interrupted-1');
    expect(intResp).toBeDefined();
    expect(intResp.data.status).toBe('success');
    expect(intResp.data.content.some((c: any) => c.sessionId === sessionId)).toBe(true);

    // Now recover
    const recoverReq = {
      messageType: 'history/recover',
      messageId: 'req-rec-1',
      data: { sessionId },
    };

    await mockWebview._handler(recoverReq);

    const recResp = postedMessages.find((m) => m.messageId === 'req-rec-1');
    expect(recResp).toBeDefined();
    expect(recResp.data.status).toBe('success');

    const updated = await repository.getConversation(sessionId);
    expect(updated?.status).toBe('completed');
  });

  it('does not duplicate conversation when user chats and subsequently saves/views history', async () => {
    const sessionId = uuidv4();

    // 1. User sends message with the session ID
    await (viewProvider as any).handleUserMessage('Hello Kodra!', undefined, sessionId);

    // Verify exactly 1 conversation exists in repository
    let list = await repository.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe(sessionId);
    expect(list[0].title).toBe('Hello Kodra!');

    // 2. Frontend saves the same session (e.g. user navigates to History view or switches tabs)
    const saveReq = {
      messageType: 'history/save',
      messageId: 'save-check-1',
      data: {
        sessionId,
        title: 'Hello Kodra!',
        history: [
          { message: { role: 'user', content: 'Hello Kodra!' } },
          { message: { role: 'assistant', content: 'Hi! How can I help you?' } },
        ],
      },
    };
    await mockWebview._handler(saveReq);

    // 3. Request history/list
    const listReq = {
      messageType: 'history/list',
      messageId: 'list-check-1',
      data: {},
    };
    await mockWebview._handler(listReq);

    const listResp = postedMessages.find((m) => m.messageId === 'list-check-1');
    expect(listResp).toBeDefined();
    expect(listResp.data.status).toBe('success');

    // CRITICAL: There must be EXACTLY 1 conversation, NOT 2!
    expect(listResp.data.content).toHaveLength(1);
    expect(listResp.data.content[0].sessionId).toBe(sessionId);
    expect(listResp.data.content[0].messageCount).toBe(2);
  });
});
