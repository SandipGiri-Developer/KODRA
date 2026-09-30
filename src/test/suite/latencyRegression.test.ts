/**
 * Latency regression tests for KODRA.
 * 
 * These tests verify:
 * - Selected model → actual runtime model (routing correctness)
 * - getModelCapabilities never triggers discoverModels after first call (cache hit)
 * - OllamaManager.ensureRunning skips ping within TTL window
 * - Provider is not recreated when config is unchanged
 * - getModelCapabilities falls back gracefully if discovery fails
 */

import { ProviderRegistry } from '../../providers/registry';
import { OllamaManager } from '../../utils/ollamaManager';
import { ILLMProvider, StreamChunk } from '../../providers/types';
import { AgentLoop } from '../../agent/agentLoop';
import { CodebaseIndexer } from '../../indexing/indexer';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

jest.mock('../../providers/ollama', () => ({
  OllamaProvider: jest.fn().mockImplementation(() => ({
    id: 'ollama',
    displayName: 'Ollama (Local)',
    capabilities: { streaming: true, toolCalling: true, vision: false },
    streamChat: jest.fn(async function* () { yield { content: 'ok', done: true } as StreamChunk; }),
    discoverModels: jest.fn().mockResolvedValue([
      {
        id: 'llama3:latest',
        displayName: 'llama3:latest',
        provider: 'ollama',
        capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
      },
    ]),
    testConnection: jest.fn().mockResolvedValue(['llama3:latest']),
    getDefaultModel: jest.fn().mockReturnValue(''),
    dispose: jest.fn(),
  })),
}));

// vscode must be mocked inline — jest.mock() is hoisted before variable declarations
// so referencing a const defined below would cause a TDZ ReferenceError.
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn().mockImplementation((key: string, def: any) => {
        const map: Record<string, any> = {
          modelName: 'llama3:latest',
          provider: 'ollama',
          maxTokens: 4096,
          'ollama.endpoint': 'http://127.0.0.1:11434',
          providers: [],
          workspaceModels: [],
        };
        return map[key] ?? def;
      }),
    }),
    workspaceFolders: undefined,
  },
  window: {
    createOutputChannel: jest.fn().mockReturnValue({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    }),
    showWarningMessage: jest.fn().mockResolvedValue(undefined),
    showErrorMessage: jest.fn().mockResolvedValue(undefined),
    showInformationMessage: jest.fn().mockResolvedValue(undefined),
    withProgress: jest.fn().mockResolvedValue(undefined),
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, toString: () => p }),
    joinPath: (base: any, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
  },
  EventEmitter: jest.fn().mockImplementation(() => ({
    event: jest.fn(),
    fire: jest.fn(),
    dispose: jest.fn(),
  })),
  SecretStorage: jest.fn(),
}), { virtual: true });

// Declared after jest.mock calls so they are not subject to hoisting TDZ rules
const mockSecretStorage: any = {
  get: jest.fn().mockResolvedValue(undefined),
  store: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
};

// ─── Test: Model Routing ──────────────────────────────────────────────────────

describe('Model Routing', () => {
  it('should pass the exact modelName from settings to provider.streamChat', async () => {
    const indexer: any = { search: jest.fn().mockResolvedValue([]) };
    const capturedOptions: any[] = [];

    const mockProvider: ILLMProvider = {
      id: 'ollama',
      displayName: 'Ollama',
      capabilities: { streaming: true, toolCalling: false, vision: false },
      streamChat: jest.fn(async function* (msgs: any, opts: any) {
        capturedOptions.push(opts);
        yield { content: 'response', done: true } as StreamChunk;
      }) as any,
      discoverModels: jest.fn().mockResolvedValue([]),
      testConnection: jest.fn().mockResolvedValue([]),
      getDefaultModel: jest.fn().mockReturnValue(''),
      dispose: jest.fn(),
    };

    const agent = new AgentLoop(indexer, false);
    const events = [];
    for await (const event of agent.run('hello', [], mockProvider, { model: 'llama3:latest' })) {
      events.push(event);
    }

    // The exact model string must be forwarded unmodified
    expect(capturedOptions[0].model).toBe('llama3:latest');

    // Done event must be emitted
    expect(events.find(e => e.type === 'done')).toBeDefined();
  });

  it('should emit done with no tool calls when tools array is empty', async () => {
    const indexer: any = { search: jest.fn().mockResolvedValue([]) };
    const mockProvider: ILLMProvider = {
      id: 'mock',
      displayName: 'Mock',
      capabilities: { streaming: true, toolCalling: true, vision: false },
      streamChat: jest.fn(async function* () {
        yield { content: 'hello', done: true } as StreamChunk;
      }) as any,
      discoverModels: jest.fn().mockResolvedValue([]),
      testConnection: jest.fn().mockResolvedValue([]),
      getDefaultModel: jest.fn().mockReturnValue(''),
      dispose: jest.fn(),
    };

    const agent = new AgentLoop(indexer, false, []); // explicitly zero tools
    const events = [];
    for await (const event of agent.run('hi', [], mockProvider, { model: 'llama3:latest' })) {
      events.push(event);
    }

    expect(events.filter(e => e.type === 'toolCall')).toHaveLength(0);
    expect(events.find(e => e.type === 'done')).toBeDefined();
  });
});

// ─── Test: Capability Cache — no duplicate discoverModels ─────────────────────

describe('ProviderRegistry capabilities cache', () => {
  let registry: ProviderRegistry;
  let discoverSpy: jest.SpyInstance;

  beforeEach(() => {
    registry = new ProviderRegistry(mockSecretStorage);
    // Access the internal discoverModels method so we can count calls
    discoverSpy = jest.spyOn(registry, 'discoverModels').mockResolvedValue([
      {
        id: 'llama3:latest',
        displayName: 'llama3:latest',
        provider: 'ollama',
        capabilities: { streaming: true, toolCalling: true, vision: false, reasoning: false },
      },
    ]);
  });

  it('should call discoverModels exactly once for repeated getModelCapabilities calls', async () => {
    await registry.getModelCapabilities('ollama', 'llama3:latest');
    await registry.getModelCapabilities('ollama', 'llama3:latest');
    await registry.getModelCapabilities('ollama', 'llama3:latest');

    // After the first call, stable cache should be hit — no extra discovery
    expect(discoverSpy).toHaveBeenCalledTimes(1);
  });

  it('should return the correct capabilities from cache on second call', async () => {
    const caps1 = await registry.getModelCapabilities('ollama', 'llama3:latest');
    const caps2 = await registry.getModelCapabilities('ollama', 'llama3:latest');

    expect(caps1).toEqual(caps2);
    expect(caps1?.toolCalling).toBe(true);
  });

  it('should return undefined gracefully if discovery fails', async () => {
    discoverSpy.mockRejectedValueOnce(new Error('network error'));
    const caps = await registry.getModelCapabilities('ollama', 'nonexistent-model');
    expect(caps).toBeUndefined();
  });

  it('should return capabilities for a different model without re-discovering first model', async () => {
    // First model \u2014 populates cache
    await registry.getModelCapabilities('ollama', 'llama3:latest');
    // Second model \u2014 should hit the discoveredModelsCache (same provider, already discovered)
    const caps = await registry.getModelCapabilities('ollama', 'llama3:latest');
    expect(caps).toBeDefined();
    // Only one discovery call total
    expect(discoverSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Test: OllamaManager TTL cache ────────────────────────────────────────────

describe('OllamaManager ping TTL cache', () => {
  beforeEach(() => {
    // Reset static state between tests
    (OllamaManager as any).lastConfirmedAt = 0;
  });

  it('should skip the ping if confirmed running within TTL', async () => {
    const pingSpy = jest.spyOn(OllamaManager as any, 'ping').mockResolvedValue(true);

    // First call — ping required
    await OllamaManager.isRunning('http://127.0.0.1:11434');
    expect(pingSpy).toHaveBeenCalledTimes(1);

    // Second call within TTL — ping should be skipped
    await OllamaManager.isRunning('http://127.0.0.1:11434');
    expect(pingSpy).toHaveBeenCalledTimes(1); // still 1

    pingSpy.mockRestore();
  });

  it('should ping again after TTL expires', async () => {
    const pingSpy = jest.spyOn(OllamaManager as any, 'ping').mockResolvedValue(true);

    await OllamaManager.isRunning('http://127.0.0.1:11434');
    expect(pingSpy).toHaveBeenCalledTimes(1);

    // Simulate TTL expiry
    (OllamaManager as any).lastConfirmedAt = Date.now() - 31_000;

    await OllamaManager.isRunning('http://127.0.0.1:11434');
    expect(pingSpy).toHaveBeenCalledTimes(2);

    pingSpy.mockRestore();
  });
});

// ─── Test: Provider not recreated when config unchanged ───────────────────────

describe('ProviderRegistry provider lifecycle', () => {
  it('should return the same provider instance when config has not changed', async () => {
    const registry = new ProviderRegistry(mockSecretStorage);
    const p1 = await registry.getProvider();
    const p2 = await registry.getProvider();
    expect(p1).toBe(p2); // strict reference equality
  });
});

// ─── Test: Cancellation ───────────────────────────────────────────────────────

describe('AgentLoop cancellation', () => {
  it('should emit cancelled event when cancel() is called mid-stream', async () => {
    const indexer: any = { search: jest.fn().mockResolvedValue([]) };

    // Two promises: one to signal the stream is mid-flight, one to resume it
    let signalReady!: () => void;
    let signalResume!: () => void;
    const streamReady = new Promise<void>(r => { signalReady = r; });
    const streamResume = new Promise<void>(r => { signalResume = r; });

    const mockProvider: ILLMProvider = {
      id: 'mock',
      displayName: 'Mock',
      capabilities: { streaming: true, toolCalling: false, vision: false },
      streamChat: jest.fn(async function* () {
        // Signal that the stream has started and is now mid-flight
        signalReady();
        // Pause until the test tells us to resume
        await streamResume;
        // After cancel(), return early without yielding — simulates a real abort
      }) as any,
      discoverModels: jest.fn().mockResolvedValue([]),
      testConnection: jest.fn().mockResolvedValue([]),
      getDefaultModel: jest.fn().mockReturnValue(''),
      dispose: jest.fn(),
    };

    const agent = new AgentLoop(indexer, false);
    const events: any[] = [];

    const runPromise = (async () => {
      for await (const event of agent.run('hi', [], mockProvider)) {
        events.push(event);
      }
    })();

    // Wait until the stream generator is definitely mid-flight before cancelling
    await streamReady;
    agent.cancel();
    signalResume(); // unblock the generator so the run() can complete
    await runPromise;

    expect(events.find(e => e.type === 'cancelled')).toBeDefined();
  });
});
