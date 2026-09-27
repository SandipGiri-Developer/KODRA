import { SettingsManager } from '../../utils/settingsManager';
import { WorkspaceModel, ProviderSettings } from '../../providers/types';
import * as vscode from 'vscode';

// Mock VS Code ExtensionContext and SecretStorage
describe('SettingsManager', () => {
  let mockContext: any;
  let mockWorkspaceState: any;
  let mockSecretStorage: any;
  let manager: SettingsManager;

  beforeEach(() => {
    mockWorkspaceState = {
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };

    mockSecretStorage = {
      get: jest.fn(),
      store: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockContext = {
      workspaceState: mockWorkspaceState,
      secrets: mockSecretStorage,
    };

    (SettingsManager as any).instance = undefined;
    SettingsManager.initialize(mockContext as any);
    manager = SettingsManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should get empty providers initially if not set', async () => {
    const mockConfig = { get: jest.fn().mockImplementation((key, def) => def) };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);
    const providers = await manager.getProviders();
    expect(providers).toEqual([]);
  });

  it('should save providers and update config', async () => {
    const mockProviders: ProviderSettings[] = [
      { id: 'prov-1', name: 'My Ollama', provider: 'ollama', endpoint: 'http://localhost:11434' }
    ];

    const mockConfig = { update: jest.fn().mockResolvedValue(undefined) };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

    await manager.saveProviders(mockProviders);

    expect(mockConfig.update).toHaveBeenCalledWith('providers', mockProviders, vscode.ConfigurationTarget.Global);
  });

  it('should get empty workspace models initially if not set', async () => {
    const mockConfig = { get: jest.fn().mockImplementation((key, def) => def) };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

    const models = await manager.getWorkspaceModels();
    expect(models).toEqual([]);
  });

  it('should save workspace models and update config', async () => {
    const mockModels: WorkspaceModel[] = [
      { id: 'model-1', displayName: 'GPT-4', providerConfigId: 'prov-1', provider: 'openai', capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: false } }
    ];

    const mockConfig = { update: jest.fn().mockResolvedValue(undefined) };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

    await manager.saveWorkspaceModels(mockModels);

    expect(mockConfig.update).toHaveBeenCalledWith('workspaceModels', mockModels, vscode.ConfigurationTarget.Global);
  });

  it('should store API key', async () => {
    await manager.saveApiKey('prov-1', 'secret-key');
    expect(mockSecretStorage.store).toHaveBeenCalledWith('KODRA.provider.prov-1.apiKey', 'secret-key');
  });

  it('should get API key', async () => {
    mockSecretStorage.get.mockResolvedValue('secret-key');
    const key = await manager.getApiKey('prov-1');
    expect(key).toBe('secret-key');
    expect(mockSecretStorage.get).toHaveBeenCalledWith('KODRA.provider.prov-1.apiKey');
  });

  it('should delete API key', async () => {
    await manager.deleteApiKey('prov-1');
    expect(mockSecretStorage.delete).toHaveBeenCalledWith('KODRA.provider.prov-1.apiKey');
  });
});
