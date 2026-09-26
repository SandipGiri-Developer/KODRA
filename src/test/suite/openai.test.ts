import { OpenAIProvider } from '../../providers/openai';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new OpenAIProvider('test-api-key', 'https://api.openai.com/v1');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from OpenAI /v1/models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4-turbo' },
          { id: 'gpt-3.5-turbo' },
          { id: 'o1-preview' },
          { id: 'text-embedding-3-small' } // Should be filtered out
        ]
      })
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' })
    }));
    
    // Only chat models should be kept
    expect(models).toHaveLength(4);
    
    // Check capabilities
    const gpt4o = models.find(m => m.id === 'gpt-4o');
    expect(gpt4o?.capabilities.toolCalling).toBe(true);
    expect(gpt4o?.capabilities.vision).toBe(true);
    expect(gpt4o?.capabilities.reasoning).toBe(false);

    const o1 = models.find(m => m.id === 'o1-preview');
    expect(o1?.capabilities.reasoning).toBe(true);
  });

  it('should handle API failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Invalid OpenAI API key.');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o' }] })
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('gpt-4o');
  });
});
