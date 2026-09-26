import * as assert from 'assert';
import * as vscode from 'vscode';
import { ProviderRegistry } from '../../providers/registry';
import { DiscoveredModel } from '../../providers/types';

// Mock dependencies
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn().mockReturnValue(''),
      update: jest.fn()
    })),
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn()
    }))
  }
}), { virtual: true });

describe('Model Discovery and Capability Filtering', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    const mockSecretStorage = {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn()
    };
    registry = new ProviderRegistry(mockSecretStorage as any);
    
    // Setup fetch mock for Ollama
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('filters out known embedding and non-chat models from Ollama', async () => {
    const mockOllamaResponse = {
      models: [
        { name: 'llama3:latest', details: { family: 'llama' } },
        { name: 'nomic-embed-text:latest', details: { family: 'nomic-bert' } },
        { name: 'qwen2.5:7b', details: { family: 'qwen' } },
        { name: 'qwen3-embedding:latest', details: { family: 'qwen2' } }, // name-based filtering fallback
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOllamaResponse)
    });

    const discovered = await registry.discoverModels('ollama', 'http://127.0.0.1:11434');
    
    assert.strictEqual(discovered.length, 2);
    assert.strictEqual(discovered.find((m: DiscoveredModel) => m.id === 'nomic-embed-text:latest'), undefined);
    assert.strictEqual(discovered.find((m: DiscoveredModel) => m.id === 'qwen3-embedding:latest'), undefined);
    assert.ok(discovered.find((m: DiscoveredModel) => m.id === 'llama3:latest'));
    assert.ok(discovered.find((m: DiscoveredModel) => m.id === 'qwen2.5:7b'));
  });

  it('detects capabilities like toolCalling and vision for Ollama models', async () => {
    const mockOllamaResponse = {
      models: [
        { name: 'llama3.1:latest', details: { family: 'llama' } }, // known to support tools
        { name: 'llava:latest', details: { family: 'llama' } }, // known to support vision
        { name: 'deepseek-r1:latest', details: { family: 'llama' } }, // known to support reasoning
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOllamaResponse)
    });

    const discovered = await registry.discoverModels('ollama', 'http://127.0.0.1:11434');
    
    const llama31 = discovered.find((m: DiscoveredModel) => m.id === 'llama3.1:latest');
    assert.ok(llama31?.capabilities.toolCalling);
    
    const llava = discovered.find((m: DiscoveredModel) => m.id === 'llava:latest');
    assert.ok(llava?.capabilities.vision);

    const deepseek = discovered.find((m: DiscoveredModel) => m.id === 'deepseek-r1:latest');
    assert.ok(deepseek?.capabilities.reasoning);
  });

  it('handles OpenAI discovery and assigns tools/vision based on model name', async () => {
    const mockOpenAIResponse = {
      data: [
        { id: 'gpt-4o' },
        { id: 'gpt-3.5-turbo' },
        { id: 'text-embedding-3-small' }, // Should be filtered out
        { id: 'dall-e-3' } // Should be filtered out
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOpenAIResponse)
    });

    const discovered = await registry.discoverModels('openai', 'https://api.openai.com/v1', 'fake-key');
    
    assert.strictEqual(discovered.length, 2);
    
    const gpt4o = discovered.find((m: DiscoveredModel) => m.id === 'gpt-4o');
    assert.ok(gpt4o?.capabilities.toolCalling);
    assert.ok(gpt4o?.capabilities.vision);

    const gpt35 = discovered.find((m: DiscoveredModel) => m.id === 'gpt-3.5-turbo');
    assert.ok(gpt35?.capabilities.toolCalling);
    assert.strictEqual(gpt35?.capabilities.vision, false);
  });

  it('handles Anthropic discovery correctly', async () => {
    const mockAnthropicResponse = {
      data: [
        { id: 'claude-3-opus-20240229', type: 'model' },
        { id: 'claude-2.1', type: 'model' }
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAnthropicResponse)
    });

    const discovered = await registry.discoverModels('anthropic', 'https://api.anthropic.com/v1', 'fake-key');
    
    assert.strictEqual(discovered.length, 2);
    
    const opus = discovered.find((m: DiscoveredModel) => m.id === 'claude-3-opus-20240229');
    assert.ok(opus?.capabilities.toolCalling);
    assert.ok(opus?.capabilities.vision);
  });

  it('handles Gemini discovery correctly and filters non-chat models', async () => {
    const mockGeminiResponse = {
      models: [
        { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }, // Filtered
        { name: 'models/gemini-1.0-pro-vision', supportedGenerationMethods: ['generateContent'] }
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGeminiResponse)
    });

    const discovered = await registry.discoverModels('gemini', 'https://generativelanguage.googleapis.com/v1beta', 'fake-key');
    
    assert.strictEqual(discovered.length, 2);
    assert.ok(discovered.find((m: DiscoveredModel) => m.id === 'gemini-1.5-pro'));
    assert.strictEqual(discovered.find((m: DiscoveredModel) => m.id === 'text-embedding-004'), undefined);
    
    const pro = discovered.find((m: DiscoveredModel) => m.id === 'gemini-1.5-pro');
    assert.ok(pro?.capabilities.toolCalling);
    assert.ok(pro?.capabilities.vision);
  });

  it('throws an error when discovery fails (API error)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));
    
    await assert.rejects(
      registry.discoverModels('openai', 'https://api.openai.com/v1', 'fake-key')
    );
  });
});
