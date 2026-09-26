import * as vscode from 'vscode';
import { SettingsPanel, SettingsPanelSerializer } from '../../webview/settingsPanel';
import { Arc1610ViewProvider } from '../../webview/viewProvider';
import { ProviderRegistry } from '../../providers/registry';
import { SettingsManager } from '../../utils/settingsManager';

describe('SettingsPanel and Dedicated Settings Surface Architecture', () => {
  let mockExtensionUri: vscode.Uri;
  let mockRegistry: any;
  let mockSecrets: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSecrets = {
      get: jest.fn(),
      store: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockContext = {
      secrets: mockSecrets,
      subscriptions: [],
    };

    (SettingsManager as any).instance = undefined;
    SettingsManager.initialize(mockContext as any);

    mockExtensionUri = vscode.Uri.file('/mock/extension/path');

    mockRegistry = {
      readConfig: jest.fn().mockResolvedValue({
        provider: 'ollama',
        modelName: 'llama3:latest',
        apiKey: '',
      }),
      getSupportedProviders: jest.fn().mockReturnValue(['ollama', 'openai', 'anthropic']),
      getProvider: jest.fn(),
      discoverModels: jest.fn(),
      setApiKey: jest.fn().mockResolvedValue(undefined),
    };

    // Ensure clean state before each test
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.dispose();
    }
  });

  afterEach(() => {
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.dispose();
    }
  });

  it('1. Settings opens in a dedicated separate surface (WebviewPanel with retainContextWhenHidden)', () => {
    const panelInstance = SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);

    expect(panelInstance).toBeDefined();
    expect(SettingsPanel.currentPanel).toBe(panelInstance);

    // Verify vscode.window.createWebviewPanel was called with correct parameters
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      SettingsPanel.viewType,
      'Kodra Settings',
      expect.anything(),
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mockExtensionUri],
      })
    );

    // Verify initial HTML configures initialRoute to '/config' and isSettingsWindow: true
    const createdPanel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0].value;
    expect(createdPanel.webview.html).toContain('window.initialRoute = "/config";');
    expect(createdPanel.webview.html).toContain('window.isSettingsWindow = true;');
  });

  it('2. Chat remains intact when Settings is opened', () => {
    // Setup chat viewProvider
    const mockIndexer: any = {
      getStatus: jest.fn().mockReturnValue({ indexed: true, entryCount: 10, fileCount: 5, inProgress: false }),
      onProgress: jest.fn(),
    };
    const chatProvider = new Arc1610ViewProvider(mockExtensionUri, mockRegistry as any, mockIndexer);
    const mockWebviewView: any = {
      webview: {
        options: {},
        html: '',
        onDidReceiveMessage: jest.fn(),
        postMessage: jest.fn(),
        asWebviewUri: jest.fn((u) => u),
      },
      show: jest.fn(),
      onDidChangeVisibility: jest.fn(),
    };

    chatProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    const navigateToSpy = jest.spyOn(chatProvider, 'navigateTo');

    // Simulate opening Settings
    SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);

    // Chat viewProvider.navigateTo must NOT be called
    expect(navigateToSpy).not.toHaveBeenCalled();

    // Chat webview was NOT redirected or replaced
    expect(mockWebviewView.webview.html).not.toContain('window.initialRoute = "/config"');
  });

  it('3. Reopening Settings reuses and reveals the existing instance without creating duplicates', () => {
    // First open
    const firstInstance = SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

    const createdPanel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0].value;
    const revealSpy = createdPanel.reveal;

    // Second open attempt
    const secondInstance = SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);

    // Must be the identical instance
    expect(secondInstance).toBe(firstInstance);
    // Must NOT have created a second panel
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    // Must have revealed the existing panel
    expect(revealSpy).toHaveBeenCalledTimes(1);
  });

  it('4. Settings close/back returns to Chat and focuses Chat view', async () => {
    SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);
    const createdPanel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0].value;
    const panelDisposeSpy = createdPanel.dispose;

    // Simulate webview posting returnToChat
    await createdPanel.webview._triggerMessage({ type: 'returnToChat' });

    // Focuses chat view
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('arc1610.chatView.focus');
    // Disposes settings panel
    expect(panelDisposeSpy).toHaveBeenCalled();
    // Clears currentPanel
    expect(SettingsPanel.currentPanel).toBeUndefined();
  });

  it('5. Closing Settings panel via closeSettings message returns to Chat', async () => {
    SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);
    const createdPanel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0].value;

    await createdPanel.webview._triggerMessage({ type: 'closeSettings' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('arc1610.chatView.focus');
    expect(SettingsPanel.currentPanel).toBeUndefined();
  });

  it('6. Proper disposal: closing panel cleans up and allows fresh reopening', () => {
    const instance = SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);
    expect(SettingsPanel.currentPanel).toBe(instance);

    // Simulate user closing tab (triggering dispose)
    instance.dispose();

    expect(SettingsPanel.currentPanel).toBeUndefined();

    // Reopen Settings after disposal: creates a new clean instance
    const freshInstance = SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);
    expect(freshInstance).toBeDefined();
    expect(SettingsPanel.currentPanel).toBe(freshInstance);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('7. SettingsPanelSerializer revives panel on VS Code reload', async () => {
    const serializer = new SettingsPanelSerializer(mockExtensionUri, mockRegistry as any);
    const mockWebviewPanel: any = {
      viewType: SettingsPanel.viewType,
      title: 'Kodra Settings',
      webview: {
        html: '',
        onDidReceiveMessage: jest.fn(),
        postMessage: jest.fn(),
        asWebviewUri: jest.fn((u) => u),
      },
      onDidDispose: jest.fn(),
      dispose: jest.fn(),
    };

    await serializer.deserializeWebviewPanel(mockWebviewPanel, {});

    expect(SettingsPanel.currentPanel).toBeDefined();
    expect(mockWebviewPanel.webview.html).toContain('window.initialRoute = "/config";');
  });

  it('8. Settings state survives and updates are synchronized via SettingsManager events', async () => {
    const mockConfig = {
      get: jest.fn((key: string, def: any) => {
        if (key === 'providers') return [{ id: 'p1', name: 'OpenAI Test', provider: 'openai' }];
        if (key === 'workspaceModels') return [{ id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai' }];
        return def;
      }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

    SettingsPanel.createOrShow(mockExtensionUri, mockRegistry as any);
    const createdPanel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0].value;

    // Save providers via SettingsManager
    const manager = SettingsManager.getInstance();
    await manager.saveProviders([{ id: 'p1', name: 'OpenAI Test', provider: 'openai' }]);

    // Verify settingsData was posted to webview
    expect(createdPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settingsData',
        providers: [{ id: 'p1', name: 'OpenAI Test', provider: 'openai' }],
      })
    );
  });
});
