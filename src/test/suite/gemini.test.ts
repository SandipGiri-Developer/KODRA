import { GeminiProvider } from '../../providers/gemini';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new GeminiProvider('test-api-key');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from Gemini /v1beta/models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] } // Should be filtered out
        ]
      })
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models', expect.any(Object));
    
    // Only models with generateContent should be kept
    expect(models).toHaveLength(2);
    
    // Check capabilities
    const pro = models.find(m => m.id === 'gemini-1.5-pro');
    expect(pro?.capabilities.toolCalling).toBe(true);
    expect(pro?.capabilities.vision).toBe(true);
  });

  it('should handle API failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request'
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Invalid Google Gemini API key.');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] }] })
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('gemini-1.5-pro');
  });

  it('should combine consecutive tool results in streamChat', async () => {
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation(async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: () => {}
          })
        }
      };
    }) as any;

    const messages: any[] = [
      { role: 'user', content: 'Do things' },
      { role: 'assistant', content: 'Thinking', toolCalls: [{ id: 't1', function: { name: 'f1', arguments: '{}' } }, { id: 't2', function: { name: 'f2', arguments: '{}' } }] },
      { role: 'tool', content: 'Result 1', toolCallId: 't1' },
      { role: 'tool', content: 'Result 2', toolCallId: 't2' }
    ];

    const stream = provider.streamChat(messages, { model: 'gemini-1.5-pro' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* empty */ }

    expect(capturedBody).toBeDefined();
    expect(capturedBody.contents).toHaveLength(3);
    
    // User message
    expect(capturedBody.contents[0].role).toBe('user');
    // Assistant message with tool calls
    expect(capturedBody.contents[1].role).toBe('model');
    // Combined Tool results message
    expect(capturedBody.contents[2].role).toBe('user');
    expect(capturedBody.contents[2].parts).toHaveLength(2);
    expect(capturedBody.contents[2].parts[0].functionResponse.name).toBe('t1');
    expect(capturedBody.contents[2].parts[1].functionResponse.name).toBe('t2');
  });
});
