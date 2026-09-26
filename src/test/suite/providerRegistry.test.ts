import { ProviderRegistry } from '../../providers/registry';
import { OllamaProvider } from '../../providers/ollama';
import { OpenAIProvider } from '../../providers/openai';
import { AnthropicProvider } from '../../providers/anthropic';
import { GeminiProvider } from '../../providers/gemini';
import * as vscode from 'vscode';

// Remove local override so we use __mocks__/vscode.js
import { SettingsManager } from '../../utils/settingsManager';

jest.mock('../../utils/settingsManager', () => {
  return {
    SettingsManager: {
      getInstance: jest.fn().mockReturnValue({
        getWorkspaceModels: jest.fn().mockResolvedValue([]),
        getProviders: jest.fn().mockResolvedValue([]),
        getApiKey: jest.fn().mockResolvedValue('fake-key'),
      })
    }
  };
});

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;
  let mockGetConfiguration: jest.Mock;

  beforeEach(() => {
    const mockSecretStorage = {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
    };
    registry = new ProviderRegistry(mockSecretStorage as any);
    mockGetConfiguration = vscode.workspace.getConfiguration as jest.Mock;
  });

  describe('Provider Instantiation', () => {
    it('should return OllamaProvider by default', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string, defaultValue?: any) => defaultValue,
      });

      const provider = await registry.getProvider();
      expect(provider).toBeInstanceOf(OllamaProvider);
    });

    it('should return OpenAIProvider when configured', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'openai';
          return undefined;
        },
      });
      // Mock secrets retrieval
      (registry as any).secretStorage = { get: jest.fn().mockResolvedValue('fake-key') };

      const provider = await registry.getProvider();
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should return AnthropicProvider when configured', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'anthropic';
          return undefined;
        },
      });
      (registry as any).secretStorage = { get: jest.fn().mockResolvedValue('fake-key') };

      const provider = await registry.getProvider();
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it('should return GeminiProvider when configured', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'gemini';
          return undefined;
        },
      });
      (registry as any).secretStorage = { get: jest.fn().mockResolvedValue('fake-key') };

      const provider = await registry.getProvider();
      expect(provider).toBeInstanceOf(GeminiProvider);
    });
  });

  describe('Dynamic Discovery', () => {
    it('should discover models for ollama without api key', async () => {
      const mockDiscoverModels = jest.spyOn(OllamaProvider.prototype, 'discoverModels').mockResolvedValue([
        { id: 'llama3:8b', displayName: 'Llama 3 8B', provider: 'ollama', capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false } }
      ]);

      const models = await registry.discoverModels('ollama');
      expect(models).toHaveLength(1);
      expect(mockDiscoverModels).toHaveBeenCalled();
    });

    it('should discover models for openai with provided key', async () => {
      const mockDiscoverModels = jest.spyOn(OpenAIProvider.prototype, 'discoverModels').mockResolvedValue([
        { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', capabilities: { streaming: true, toolCalling: true, vision: true, reasoning: false } }
      ]);

      const models = await registry.discoverModels('openai', 'temp-key');
      expect(models).toHaveLength(1);
      expect(mockDiscoverModels).toHaveBeenCalled();
    });
  });
});
