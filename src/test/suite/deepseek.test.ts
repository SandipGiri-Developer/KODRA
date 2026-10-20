import { DeepSeekProvider } from '../../providers/deepseek';

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new DeepSeekProvider('test-api-key', 'https://api.deepseek.com');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from DeepSeek /models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'deepseek-chat' },
          { id: 'deepseek-reasoner' },
        ],
      }),
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({
      headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
    }));

    expect(models).toHaveLength(2);

    const chat = models.find(m => m.id === 'deepseek-chat');
    expect(chat?.capabilities.toolCalling).toBe(true);
    expect(chat?.capabilities.streaming).toBe(true);
    expect(chat?.capabilities.reasoning).toBe(false);

    const reasoner = models.find(m => m.id === 'deepseek-reasoner');
    expect(reasoner?.capabilities.reasoning).toBe(true);
    expect(reasoner?.capabilities.streaming).toBe(true);
    expect(reasoner?.capabilities.toolCalling).toBe(false);
  });

  it('should fallback to default models if models endpoint returns empty', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    }) as any;

    const models = await provider.discoverModels();
    expect(models.length).toBeGreaterThanOrEqual(2);
    expect(models.some(m => m.id === 'deepseek-chat')).toBe(true);
    expect(models.some(m => m.id === 'deepseek-reasoner')).toBe(true);
  });

  it('should handle 401 auth failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"error": {"message": "Authentication Fails"}}',
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Invalid DeepSeek API key.');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'deepseek-chat' }] }),
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('deepseek-chat');
  });

  it('should return deepseek-chat as default model', () => {
    expect(provider.getDefaultModel()).toBe('deepseek-chat');
  });

  it('should stream chat completion and parse SSE chunks', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }) as any;

    const chunks = [];
    for await (const chunk of provider.streamChat(
      [{ role: 'user', content: 'Hi' }],
      { model: 'deepseek-chat' },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const content = chunks.map(c => c.content || '').join('');
    expect(content).toBe('Hello world!');
  });

  it('should exclude reasoning_content and only yield the actual content output', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"reasoning_content":"User said hi. Let us greet back."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello! How can I help you?"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }) as any;

    let fullOutput = '';
    for await (const chunk of provider.streamChat(
      [{ role: 'user', content: 'hi' }],
      { model: 'deepseek-reasoner' },
    )) {
      if (chunk.content) {
        fullOutput += chunk.content;
      }
    }

    expect(fullOutput).toBe('Hello! How can I help you?');
    expect(fullOutput).not.toContain('User said hi');
  });
});
