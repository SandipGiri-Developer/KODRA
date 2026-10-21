import { formatDuration } from '../../utils/time';
import { AgentLoop } from '../../agent/agentLoop';
import { CodebaseIndexer } from '../../indexing/indexer';
import { ILLMProvider, StreamChunk } from '../../providers/types';
import { PermissionManager } from '../../agent/permissionManager';
import { withStreamTimeout } from '../../agent/agentRuntime';

describe('Stream Lifecycle & Elapsed Time Regression Tests', () => {
  describe('formatDuration unit tests', () => {
    it('formats exact specified intervals correctly', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(1)).toBe('1s');
      expect(formatDuration(59)).toBe('59s');
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(61)).toBe('1m 1s');
      expect(formatDuration(83)).toBe('1m 23s');
      expect(formatDuration(439)).toBe('7m 19s');
      expect(formatDuration(3599)).toBe('59m 59s');
      expect(formatDuration(3600)).toBe('1h 0m 0s');
      expect(formatDuration(3661)).toBe('1h 1m 1s');
    });

    it('handles negative or invalid inputs gracefully', () => {
      expect(formatDuration(-5)).toBe('0s');
      expect(formatDuration(NaN)).toBe('0s');
    });
  });

  describe('Agent execution and provider lifecycle', () => {
    let indexer: CodebaseIndexer;
    let mockProvider: jest.Mocked<ILLMProvider>;
    let agent: AgentLoop;

    beforeEach(() => {
      indexer = {
        search: jest.fn().mockResolvedValue([])
      } as any;

      agent = new AgentLoop(indexer, false);

      mockProvider = {
        streamChat: jest.fn(),
        discoverModels: jest.fn(),
        testConnection: jest.fn(),
        capabilities: { toolCalling: true, streaming: true, vision: false },
        model: 'test-model'
      } as any;
    });

    it('1. A request completes normally and reaches terminal done state', async () => {
      mockProvider.streamChat.mockImplementation(async function* () {
        yield { content: 'Hello, ' } as StreamChunk;
        yield { content: 'world!' } as StreamChunk;
      });

      const events = [];
      for await (const event of agent.run('test prompt', [], mockProvider)) {
        events.push(event);
      }

      const contentEvents = events.filter(e => e.type === 'content');
      expect(contentEvents.map(e => (e as any).content).join('')).toBe('Hello, world!');
      const doneEvent = events.find(e => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });

    it('2. A provider throws before returning its first chunk and reaches error state', async () => {
      mockProvider.streamChat.mockImplementation(async function* () {
        throw new Error('Connection refused before first token');
      });

      const events = [];
      for await (const event of agent.run('test prompt', [], mockProvider)) {
        events.push(event);
      }

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent as any).error).toContain('Connection refused');
    });

    it('3. A stream throws after producing partial output and preserves partial content', async () => {
      mockProvider.streamChat.mockImplementation(async function* () {
        yield { content: 'Partial answer before failure. ' } as StreamChunk;
        throw new Error('Mid-stream network drop');
      });

      const events = [];
      for await (const event of agent.run('test prompt', [], mockProvider)) {
        events.push(event);
      }

      // Check partial content was yielded before failure
      const contentEvents = events.filter(e => e.type === 'content');
      expect(contentEvents.length).toBeGreaterThan(0);
      expect((contentEvents[0] as any).content).toBe('Partial answer before failure. ');

      // Error event is delivered
      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent as any).error).toContain('Mid-stream network drop');
    });

    it('4 & 7. withStreamTimeout aborts when stream stalls before first token', async () => {
      async function* hangingStream(): AsyncGenerator<StreamChunk> {
        // Simulates a hung connection that never yields
        await new Promise(() => {}); // never resolves
        yield { content: 'never' };
      }

      const timedStream = withStreamTimeout(hangingStream(), {
        firstTokenTimeoutMs: 100, // short timeout for test
        idleChunkTimeoutMs: 100
      });

      const events: StreamChunk[] = [];
      let caughtError: any = null;
      try {
        for await (const chunk of timedStream) {
          events.push(chunk);
        }
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.message).toContain('timed out waiting for model to respond');
      expect(events).toHaveLength(0);
    });

    it('4b. withStreamTimeout aborts when stream stalls between chunks', async () => {
      async function* stallBetweenChunks(): AsyncGenerator<StreamChunk> {
        yield { content: 'chunk 1' };
        // Now stall indefinitely
        await new Promise(() => {});
        yield { content: 'chunk 2' };
      }

      const timedStream = withStreamTimeout(stallBetweenChunks(), {
        firstTokenTimeoutMs: 500,
        idleChunkTimeoutMs: 100
      });

      const events: StreamChunk[] = [];
      let caughtError: any = null;
      try {
        for await (const chunk of timedStream) {
          events.push(chunk);
        }
      } catch (err) {
        caughtError = err;
      }

      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('chunk 1');
      expect(caughtError).toBeDefined();
      expect(caughtError.message).toContain('stream stalled');
    });

    it('5. User cancellation immediately aborts withStreamTimeout', async () => {
      const abortController = new AbortController();

      async function* slowStream(): AsyncGenerator<StreamChunk> {
        yield { content: 'chunk 1' };
        await new Promise(r => setTimeout(r, 2000));
        yield { content: 'chunk 2' };
      }

      const timedStream = withStreamTimeout(slowStream(), {
        firstTokenTimeoutMs: 5000,
        idleChunkTimeoutMs: 5000,
        signal: abortController.signal
      });

      const events: StreamChunk[] = [];
      let caughtError: any = null;

      const iteratePromise = (async () => {
        try {
          for await (const chunk of timedStream) {
            events.push(chunk);
            // Cancel after first chunk
            abortController.abort();
          }
        } catch (err) {
          caughtError = err;
        }
      })();

      await iteratePromise;
      expect(events).toHaveLength(1);
      expect(caughtError).toBeDefined();
      expect(caughtError.message).toContain('cancelled');
    });

    it('6. PermissionManager cancels pending requests when AbortSignal fires', async () => {
      const pm = new PermissionManager();
      const abortController = new AbortController();

      const permissionPromise = pm.requestPermission(
        {
          requestId: 'req-perm-1',
          executionId: 'exec-1',
          toolCallId: 'call-1',
          toolName: 'edit_file',
          description: 'Modify file'
        },
        abortController.signal
      );

      expect(pm.hasPendingRequests()).toBe(true);

      // Abort the signal
      abortController.abort();

      const approved = await permissionPromise;
      expect(approved).toBe(false);
      expect(pm.hasPendingRequests()).toBe(false);
    });

    it('8. Two consecutive requests are isolated and cannot corrupt each other', async () => {
      let run = 1;
      mockProvider.streamChat.mockImplementation(async function* () {
        if (run === 1) {
          yield { content: 'Response from request 1' } as StreamChunk;
          run = 2;
        } else {
          yield { content: 'Response from request 2' } as StreamChunk;
        }
      });

      const events1 = [];
      for await (const event of agent.run('Request 1', [], mockProvider)) {
        events1.push(event);
      }
      expect(events1.filter(e => e.type === 'content').map((e: any) => e.content).join('')).toBe('Response from request 1');
      expect(events1.find(e => e.type === 'done')).toBeDefined();

      const events2 = [];
      for await (const event of agent.run('Request 2', [], mockProvider)) {
        events2.push(event);
      }
      expect(events2.filter(e => e.type === 'content').map((e: any) => e.content).join('')).toBe('Response from request 2');
      expect(events2.find(e => e.type === 'done')).toBeDefined();
    });
  });
});
