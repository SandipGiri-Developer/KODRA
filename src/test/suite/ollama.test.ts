import { OllamaProvider } from '../../providers/ollama';

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new OllamaProvider('http://localhost:11434');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from Ollama /api/tags', async () => {
    // Mock the fetch call
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3:latest', details: { family: 'llama' }, capabilities: ['tools', 'completion'] },
          { name: 'qwen2.5-coder:7b', details: { family: 'qwen2' }, capabilities: ['tools', 'completion'] },
          { name: 'llava:latest', details: { family: 'llava' }, capabilities: ['vision', 'completion'] }
        ]
      })
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
    expect(models).toHaveLength(3);
    
    // Verify capabilities
    const llama = models.find(m => m.id === 'llama3:latest');
    expect(llama?.capabilities.toolCalling).toBe(true);

    const qwen = models.find(m => m.id === 'qwen2.5-coder:7b');
    expect(qwen?.capabilities.toolCalling).toBe(true);
    expect(qwen?.capabilities.vision).toBe(false);

    const llava = models.find(m => m.id === 'llava:latest');
    expect(llava?.capabilities.vision).toBe(true);
  });

  it('should handle unavailable Ollama gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused')) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Cannot reach Ollama at http://localhost:11434. Is Ollama running?');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'test-model' }] })
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('test-model');
  });
});
