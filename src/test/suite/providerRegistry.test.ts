import { ProviderRegistry } from '../../providers/registry';
import { OllamaProvider } from '../../providers/ollama';
import { OpenAIProvider } from '../../providers/openai';
import { AnthropicProvider } from '../../providers/anthropic';
import { GeminiProvider } from '../../providers/gemini';
import { GroqProvider } from '../../providers/groq';
import { DeepSeekProvider } from '../../providers/deepseek';
import { NvidiaProvider } from '../../providers/nvidia';
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
      expect(provider.id).toBe('ollama');
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
      expect(provider.id).toBe('openai');
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
      expect(provider.id).toBe('anthropic');
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
      expect(provider.id).toBe('gemini');
    });

    it('should return GroqProvider when configured', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'groq';
          return undefined;
        },
      });
      (registry as any).secretStorage = { get: jest.fn().mockResolvedValue('fake-key') };

      const provider = await registry.getProvider();
      expect(provider.id).toBe('groq');
    });

    it('should return DeepSeekProvider when configured', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'deepseek';
          return undefined;
        },
      });
      (registry as any).secretStorage = { get: jest.fn().mockResolvedValue('fake-key') };

      const provider = await registry.getProvider();
      expect(provider.id).toBe('deepseek');
    });

    it('should return NvidiaProvider when configured', async () => {
      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'nvidia';
          return undefined;
        },
      });
      (registry as any).secretStorage = { get: jest.fn().mockResolvedValue('fake-key') };

      const provider = await registry.getProvider();
      expect(provider.id).toBe('nvidia');
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

    it('should discover models for groq with provided key', async () => {
      const mockDiscoverModels = jest.spyOn(GroqProvider.prototype, 'discoverModels').mockResolvedValue([
        { id: 'llama3-8b-8192', displayName: 'llama3-8b-8192', provider: 'groq', capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false } }
      ]);

      const models = await registry.discoverModels('groq', 'temp-key');
      expect(models).toHaveLength(1);
      expect(mockDiscoverModels).toHaveBeenCalled();
    });

    it('should discover models for deepseek with provided key', async () => {
      const mockDiscoverModels = jest.spyOn(DeepSeekProvider.prototype, 'discoverModels').mockResolvedValue([
        { id: 'deepseek-chat', displayName: 'DeepSeek-V3 (Chat)', provider: 'deepseek', capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false } }
      ]);

      const models = await registry.discoverModels('deepseek', 'temp-key');
      expect(models).toHaveLength(1);
      expect(mockDiscoverModels).toHaveBeenCalled();
    });

    it('should discover models for nvidia with provided key', async () => {
      const mockDiscoverModels = jest.spyOn(NvidiaProvider.prototype, 'discoverModels').mockResolvedValue([
        { id: 'meta/llama-3.3-70b-instruct', displayName: 'meta/llama-3.3-70b-instruct', provider: 'nvidia', capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false } }
      ]);

      const models = await registry.discoverModels('nvidia', 'temp-key');
      expect(models).toHaveLength(1);
      expect(mockDiscoverModels).toHaveBeenCalled();
    });
  });

  describe('Extensibility & Provider Factory Registration', () => {
    it('should allow registering and using custom provider factory', async () => {
      const mockCustomProvider: any = {
        id: 'custom-ai',
        displayName: 'Custom AI Provider',
        capabilities: { streaming: true, toolCalling: true, vision: false },
        dispose: jest.fn(),
      };

      registry.registerProvider('custom-ai', (config) => mockCustomProvider);
      expect(registry.hasProvider('custom-ai')).toBe(true);
      expect(registry.getSupportedProviders()).toContain('custom-ai');

      mockGetConfiguration.mockReturnValue({
        get: (key: string) => {
          if (key === 'provider') return 'custom-ai';
          return undefined;
        },
      });

      const provider = await registry.getProvider();
      expect(provider.id).toBe('custom-ai');

      registry.unregisterProvider('custom-ai');
      expect(registry.hasProvider('custom-ai')).toBe(false);
      expect(registry.getSupportedProviders()).not.toContain('custom-ai');
    });
  });

  describe('Multi-provider Model Disambiguation', () => {
    it('resolves the correct provider and endpoint when multiple providers share the same model ID', async () => {
      const mockManager = SettingsManager.getInstance();
      (mockManager.getWorkspaceModels as jest.Mock).mockResolvedValueOnce([
        {
          id: 'gpt-20b',
          displayName: 'GPT 20B',
          provider: 'groq',
          providerConfigId: 'groq-1',
        },
        {
          id: 'gpt-20b',
          displayName: 'GPT 20B',
          provider: 'nvidia',
          providerConfigId: 'nvidia-1',
        },
      ]);

      (mockManager.getProviders as jest.Mock).mockResolvedValueOnce([
        {
          id: 'groq-1',
          name: 'Groq Cloud',
          provider: 'groq',
          endpoint: 'https://api.groq.com/openai/v1',
          apiKeySecret: true,
        },
        {
          id: 'nvidia-1',
          name: 'NVIDIA NIM',
          provider: 'nvidia',
          endpoint: 'https://integrate.api.nvidia.com/v1',
          apiKeySecret: true,
        },
      ]);

      (mockManager.getApiKey as jest.Mock).mockImplementation((providerId: string) => {
        if (providerId === 'nvidia-1') return Promise.resolve('nvapi-test-key');
        if (providerId === 'groq-1') return Promise.resolve('gsk-test-key');
        return Promise.resolve(undefined);
      });

      mockGetConfiguration.mockReturnValue({
        get: (key: string, defaultValue?: any) => {
          if (key === 'provider') return 'nvidia';
          if (key === 'modelName') return 'gpt-20b';
          if (key === 'activeProviderConfigId') return 'nvidia-1';
          return defaultValue;
        },
      });

      const config = await registry.readConfig();
      expect(config.provider).toBe('nvidia');
      expect(config.endpoint).toBe('https://integrate.api.nvidia.com/v1');
      expect(config.apiKey).toBe('nvapi-test-key');
      expect(config.modelName).toBe('gpt-20b');
    });
  });
});
