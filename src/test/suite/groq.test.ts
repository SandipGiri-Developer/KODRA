import { GroqProvider } from '../../providers/groq';

describe('GroqProvider', () => {
  let provider: GroqProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new GroqProvider('test-api-key', 'https://api.groq.com/openai/v1');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from Groq /v1/models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'llama3-8b-8192' },
          { id: 'llama3-70b-8192' },
          { id: 'mixtral-8x7b-32768' },
          { id: 'gemma-7b-it' }
        ]
      })
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('https://api.groq.com/openai/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' })
    }));
    
    expect(models).toHaveLength(4);
    
    const llama = models.find((m: any) => m.id === 'llama3-8b-8192');
    expect(llama?.capabilities.toolCalling).toBe(true);
    expect(llama?.capabilities.vision).toBe(false);
    expect(llama?.capabilities.reasoning).toBe(false);
  });

  it('should handle API failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Invalid Groq API key.');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3-8b-8192' }] })
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('llama3-8b-8192');
  });
});
