import { WebviewSettingsBridge, IWebviewMessagePoster } from '../../webview/webviewSettingsBridge';
import { ProviderRegistry } from '../../providers/registry';
import { SettingsManager } from '../../utils/settingsManager';
import { ExtensionToWebviewMessage } from '../../webview/messageTypes';
import * as vscode from 'vscode';

describe('WebviewSettingsBridge', () => {
  let bridge: WebviewSettingsBridge;
  let mockRegistry: jest.Mocked<Partial<ProviderRegistry>>;
  let mockSettingsManager: jest.Mocked<Partial<SettingsManager>>;
  let postedMessages: ExtensionToWebviewMessage[];
  let poster: IWebviewMessagePoster;

  beforeEach(() => {
    postedMessages = [];
    poster = {
      postMessage: jest.fn((msg: ExtensionToWebviewMessage) => {
        postedMessages.push(msg);
      }),
    };

    mockRegistry = {
      readConfig: jest.fn().mockResolvedValue({
        provider: 'ollama',
        modelName: 'llama3:8b',
        endpoint: 'http://localhost:11434',
        apiKey: 'test-key',
        maxTokens: 4096,
      }),
      getSupportedProviders: jest.fn().mockReturnValue(['ollama', 'openai', 'gemini', 'anthropic']),
      warmCapabilities: jest.fn().mockResolvedValue(undefined),
      setApiKey: jest.fn().mockResolvedValue(undefined),
      getProvider: jest.fn().mockResolvedValue({
        testConnection: jest.fn().mockResolvedValue(['model-1', 'model-2']),
      } as any),
      discoverModels: jest.fn().mockResolvedValue([
        { id: 'm1', displayName: 'Model 1', provider: 'ollama', capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false } },
      ]),
    };

    mockSettingsManager = {
      getProviders: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'Ollama Local', provider: 'ollama', endpoint: 'http://localhost:11434' },
      ]),
      getWorkspaceModels: jest.fn().mockResolvedValue([]),
      saveProviders: jest.fn().mockResolvedValue(undefined),
      saveWorkspaceModels: jest.fn().mockResolvedValue(undefined),
      saveApiKey: jest.fn().mockResolvedValue(undefined),
      deleteApiKey: jest.fn().mockResolvedValue(undefined),
    };

    bridge = new WebviewSettingsBridge(
      mockRegistry as any,
      mockSettingsManager as any,
      { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as any,
    );
  });

  test('sendConfig broadcasts config to poster', async () => {
    await bridge.sendConfig(poster);
    expect(postedMessages).toHaveLength(1);
    expect(postedMessages[0]).toEqual({
      type: 'config',
      provider: 'ollama',
      model: 'llama3:8b',
      hasApiKey: true,
      availableProviders: ['ollama', 'openai', 'gemini', 'anthropic'],
    });
  });

  test('sendSettingsData broadcasts providers and models to poster', async () => {
    await bridge.sendSettingsData(poster);
    expect(postedMessages).toHaveLength(1);
    expect(postedMessages[0]).toEqual({
      type: 'settingsData',
      providers: [
        { id: 'p1', name: 'Ollama Local', provider: 'ollama', endpoint: 'http://localhost:11434' },
      ],
      workspaceModels: [],
    });
  });

  test('handles testConnection successfully', async () => {
    const handled = await bridge.handleSettingsMessage({ type: 'testConnection' }, poster);
    expect(handled).toBe(true);
    expect(postedMessages).toContainEqual({
      type: 'connectionResult',
      success: true,
      models: ['model-1', 'model-2'],
    });
  });

  test('handles discoverModels successfully', async () => {
    const handled = await bridge.handleSettingsMessage(
      { type: 'discoverModels', provider: 'ollama' },
      poster,
    );
    expect(handled).toBe(true);
    expect(mockRegistry.discoverModels).toHaveBeenCalledWith('ollama', undefined, undefined);
    expect(postedMessages).toContainEqual({
      type: 'modelsDiscovered',
      provider: 'ollama',
      models: [
        { id: 'm1', displayName: 'Model 1', provider: 'ollama', capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false } },
      ],
    });
  });

  test('handles saveProviderSetting and updates API key', async () => {
    const handled = await bridge.handleSettingsMessage(
      {
        type: 'saveProviderSetting',
        setting: { id: 'p2', name: 'OpenAI Cloud', provider: 'openai' },
        apiKey: 'sk-test',
      },
      poster,
    );

    expect(handled).toBe(true);
    expect(mockSettingsManager.saveApiKey).toHaveBeenCalledWith('p2', 'sk-test');
    expect(mockSettingsManager.saveProviders).toHaveBeenCalled();
  });

  test('returns false for non-settings messages', async () => {
    const handled = await bridge.handleSettingsMessage(
      { type: 'sendMessage', text: 'hello' } as any,
      poster,
    );
    expect(handled).toBe(false);
  });

  test('handles policy/list, policy/create, policy/update, policy/enable, and policy/delete', async () => {
    // 1. policy/list on empty
    const listHandled = await bridge.handleSettingsMessage({ type: 'policy/list' }, poster);
    expect(listHandled).toBe(true);
    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: 'policyList' }),
    );

    // 2. policy/create
    postedMessages.length = 0;
    const createHandled = await bridge.handleSettingsMessage(
      {
        type: 'policy/create',
        policy: {
          scope: 'global',
          commandPattern: 'pytest -v',
          ruleType: 'exact',
          decision: 'allow',
          description: 'Pytest suite',
        },
      },
      poster,
    );
    expect(createHandled).toBe(true);
    const updatedMsg = postedMessages.find((m) => m.type === 'policyUpdated') as any;
    expect(updatedMsg).toBeDefined();
    expect(updatedMsg.policy.commandPattern).toBe('pytest -v');
    expect(updatedMsg.policy.scope).toBe('global');
    const createdId = updatedMsg.policy.id;

    // 3. policy/update (modify command pattern)
    postedMessages.length = 0;
    const updateHandled = await bridge.handleSettingsMessage(
      {
        type: 'policy/update',
        id: createdId,
        updates: {
          commandPattern: 'pytest -v -s',
        },
      },
      poster,
    );
    expect(updateHandled).toBe(true);
    const afterUpdateMsg = postedMessages.find((m) => m.type === 'policyUpdated') as any;
    expect(afterUpdateMsg.policy.commandPattern).toBe('pytest -v -s');

    // 4. policy/enable
    postedMessages.length = 0;
    const enableHandled = await bridge.handleSettingsMessage(
      {
        type: 'policy/enable',
        id: createdId,
        enabled: false,
      },
      poster,
    );
    expect(enableHandled).toBe(true);
    const afterDisableMsg = postedMessages.find((m) => m.type === 'policyUpdated') as any;
    expect(afterDisableMsg.policy.enabled).toBe(false);

    // 5. policy/delete
    postedMessages.length = 0;
    const deleteHandled = await bridge.handleSettingsMessage(
      {
        type: 'policy/delete',
        id: createdId,
      },
      poster,
    );
    expect(deleteHandled).toBe(true);
    expect(postedMessages).toContainEqual({
      type: 'policyDeleted',
      id: createdId,
    });
  });
});

