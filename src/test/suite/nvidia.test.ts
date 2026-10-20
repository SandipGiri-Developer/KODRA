import { NvidiaProvider } from '../../providers/nvidia';

describe('NvidiaProvider', () => {
  let provider: NvidiaProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    provider = new NvidiaProvider('nvapi-test-key', 'https://integrate.api.nvidia.com/v1');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should discover models from NVIDIA NIM /models', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'meta/llama-3.3-70b-instruct' },
          { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
          { id: 'deepseek-ai/deepseek-r1' },
          { id: 'meta/llama-3.2-11b-vision-instruct' },
          { id: 'nvidia/embed-qa-4' }, // Should be filtered out
        ],
      }),
    }) as any;

    const models = await provider.discoverModels();

    expect(global.fetch).toHaveBeenCalledWith('https://integrate.api.nvidia.com/v1/models', expect.objectContaining({
      headers: expect.objectContaining({ 'Authorization': 'Bearer nvapi-test-key' }),
    }));

    // embed-qa-4 is filtered out
    expect(models).toHaveLength(4);

    const nemotron = models.find(m => m.id === 'nvidia/llama-3.1-nemotron-70b-instruct');
    expect(nemotron?.capabilities.toolCalling).toBe(true);
    expect(nemotron?.capabilities.streaming).toBe(true);
    expect(nemotron?.capabilities.reasoning).toBe(false);

    const r1 = models.find(m => m.id === 'deepseek-ai/deepseek-r1');
    expect(r1?.capabilities.reasoning).toBe(true);
    expect(r1?.capabilities.toolCalling).toBe(false);

    const visionModel = models.find(m => m.id === 'meta/llama-3.2-11b-vision-instruct');
    expect(visionModel?.capabilities.vision).toBe(true);
  });

  it('should support custom NIM self-hosted endpoint seamlessly', async () => {
    const customProvider = new NvidiaProvider('custom-key', 'http://localhost:8000/v1');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'my-custom-model' }],
      }),
    }) as any;

    const models = await customProvider.discoverModels();
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:8000/v1/models', expect.anything());
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('my-custom-model');
  });

  it('should fallback to default models if models endpoint returns empty', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    }) as any;

    const models = await provider.discoverModels();
    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(models.some(m => m.id === 'nvidia/llama-3.1-nemotron-70b-instruct')).toBe(true);
    expect(models.some(m => m.id === 'meta/llama-3.3-70b-instruct')).toBe(true);
  });

  it('should handle 401 invalid API key error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"error": {"message": "Invalid API Key"}}',
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('Invalid NVIDIA API key');
  });

  it('should handle 402/403 credit depletion error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      text: async () => '{"detail": "Credits exhausted"}',
    }) as any;

    await expect(provider.discoverModels()).rejects.toThrow('NVIDIA API credits depleted or insufficient permissions.');
  });

  it('should test connection successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'meta/llama-3.3-70b-instruct' }] }),
    }) as any;

    const models = await provider.testConnection();
    expect(models).toContain('meta/llama-3.3-70b-instruct');
  });

  it('should return default model', () => {
    expect(provider.getDefaultModel()).toBe('nvidia/llama-3.1-nemotron-70b-instruct');
  });

  it('should stream chat completion and accumulate tool calls', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"search_code","arguments":"{\\"query\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}\n\n',
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
      [{ role: 'user', content: 'Search for test' }],
      { model: 'nvidia/llama-3.1-nemotron-70b-instruct' },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.done).toBe(true);
    expect(lastChunk.toolCalls).toBeDefined();
    expect(lastChunk.toolCalls?.[0].function?.name).toBe('search_code');
    expect(lastChunk.toolCalls?.[0].function?.arguments).toBe('{"query":"test"}');
  });

  it('should exclude reasoning_content and only yield the actual content output', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"reasoning_content":"User just says \\"hi\\". Probably a greeting. We\'ll respond politely."}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning":" Extra thought."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello! 👋 How can I help you today?"}}]}\n\n',
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
      { model: 'openai/gpt-oss-20b' },
    )) {
      if (chunk.content) {
        fullOutput += chunk.content;
      }
    }

    expect(fullOutput).toBe('Hello! 👋 How can I help you today?');
    expect(fullOutput).not.toContain('User just says');
    expect(fullOutput).not.toContain('Probably a greeting');
    expect(fullOutput).not.toContain('Extra thought');
  });

  it('should strip <think>...</think> tags and only output the exact response', async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"<think>The user said hi. Let us greet back."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" Planning step 2.</think>Hello! Welcome!"}}]}\n\n',
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
      { model: 'nvidia/llama-3.1-nemotron-70b-instruct' },
    )) {
      if (chunk.content) {
        fullOutput += chunk.content;
      }
    }

    expect(fullOutput).toBe('Hello! Welcome!');
    expect(fullOutput).not.toContain('<think>');
    expect(fullOutput).not.toContain('</think>');
    expect(fullOutput).not.toContain('The user said hi');
  });
});
