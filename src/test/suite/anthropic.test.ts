import { AnthropicProvider } from '../../providers/anthropic';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new AnthropicProvider('test-api-key');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from Anthropic /v1/models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-3-5-sonnet-20240620', display_name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' }
        ]
      })
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', expect.objectContaining({
      headers: expect.objectContaining({
        'x-api-key': 'test-api-key',
        'anthropic-version': '2023-06-01'
      })
    }));
    
    expect(models).toHaveLength(2);
    
    // Check capabilities
    const sonnet = models.find(m => m.id === 'claude-3-5-sonnet-20240620');
    expect(sonnet?.capabilities.toolCalling).toBe(true);
    expect(sonnet?.capabilities.vision).toBe(true);
  });

  it('should handle API failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden'
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Invalid Anthropic API key.');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'claude-3-opus-20240229' }] })
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('claude-3-opus-20240229');
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

    const stream = provider.streamChat(messages, { model: 'claude-3' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* empty */ }

    expect(capturedBody).toBeDefined();
    expect(capturedBody.messages).toHaveLength(3);
    
    // User message
    expect(capturedBody.messages[0].role).toBe('user');
    // Assistant message with tool calls
    expect(capturedBody.messages[1].role).toBe('assistant');
    // Combined Tool results message
    expect(capturedBody.messages[2].role).toBe('user');
    expect(capturedBody.messages[2].content).toHaveLength(2);
    expect(capturedBody.messages[2].content[0].type).toBe('tool_result');
    expect(capturedBody.messages[2].content[0].tool_use_id).toBe('t1');
    expect(capturedBody.messages[2].content[1].type).toBe('tool_result');
    expect(capturedBody.messages[2].content[1].tool_use_id).toBe('t2');
  });
});
