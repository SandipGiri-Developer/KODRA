import { AgentLoop } from '../../agent/agentLoop';
import { CodebaseIndexer } from '../../indexing/indexer';
import { ILLMProvider, StreamChunk } from '../../providers/types';
import { ITool } from '../../agent/types';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('AgentExecution', () => {
  let indexer: CodebaseIndexer;
  let mockProvider: jest.Mocked<ILLMProvider>;
  let agent: AgentLoop;

  beforeEach(() => {
    indexer = {
      search: jest.fn().mockResolvedValue([])
    } as any;
    
    agent = new AgentLoop(indexer, false); // requireApproval = false

    mockProvider = {
      streamChat: jest.fn(),
      discoverModels: jest.fn(),
      testConnection: jest.fn(),
      capabilities: { toolCalling: true, streaming: true, vision: false },
      model: 'mock-model'
    } as any;
  });

  it('should run smoothly with zero tools registered by default', async () => {
    const defaultAgent = new AgentLoop(indexer, false);
    mockProvider.streamChat.mockImplementation(async function* () {
      yield { content: 'Hello without tools!' } as StreamChunk;
    });

    const events = [];
    for await (const event of defaultAgent.run('Hello', [], mockProvider)) {
      events.push(event);
    }

    expect(events.filter(e => e.type === 'content')).toHaveLength(1);
    expect(events.filter(e => e.type === 'toolCall')).toHaveLength(0);
    expect(events.find(e => e.type === 'done')).toBeDefined();
  });

  it('should execute full agent loop with tool call when tool is provided', async () => {
    const mockTool: ITool = {
      name: 'mock_tool',
      description: 'A mock tool for testing',
      isDestructive: false,
      getDefinition: () => ({
        type: 'function',
        function: {
          name: 'mock_tool',
          description: 'A mock tool',
          parameters: { type: 'object', properties: {} },
        },
      }),
      execute: jest.fn().mockResolvedValue({
        content: 'test content',
        success: true,
      }),
    };

    agent = new AgentLoop(indexer, false, [mockTool]);

    // Mock the provider to yield a tool call, then a final response
    const mockResponses = [
      // First iteration: tool call
      (async function* () {
        yield { content: 'Let me check the time.' } as StreamChunk;
        yield { toolCalls: [{ id: 'call_1', function: { name: 'mock_tool', arguments: JSON.stringify({ filepath: 'test.txt' }) } }] } as StreamChunk;
      })(),
      // Second iteration: final response after tool result
      (async function* () {
        yield { content: 'The file contains test content.' } as StreamChunk;
      })()
    ];

    let callCount = 0;
    mockProvider.streamChat.mockImplementation(() => {
      return mockResponses[callCount++];
    });

    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: process.cwd() } }];

    const events = [];
    try {
      for await (const event of agent.run('Read my file', [], mockProvider)) {
        events.push(event);
      }
    } catch (e) {
      console.error('Error in agent loop:', e);
    }

    // Verify the sequence of events
    expect(events.filter(e => e.type === 'content')).toHaveLength(2); // 'Let me check the time.', 'The file contains test content.'
    expect(events.filter(e => e.type === 'toolCall')).toHaveLength(1);
    expect(events.filter(e => e.type === 'toolResult')).toHaveLength(1);
    expect(events.find(e => e.type === 'done')).toBeDefined();

    expect(mockTool.execute).toHaveBeenCalled();
    
    // Verify that the LLM was given the tool result
    expect(mockProvider.streamChat).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockProvider.streamChat.mock.calls[1][0];
    const toolResultMessage = secondCallMessages.find((m: any) => m.role === 'tool');
    expect(toolResultMessage).toBeDefined();
    expect(toolResultMessage!.content).toContain('test content');
  });

  it('should respect max iterations limit', async () => {
    const mockTool: ITool = {
      name: 'mock_tool',
      description: 'A mock tool for testing',
      isDestructive: false,
      getDefinition: () => ({
        type: 'function',
        function: {
          name: 'mock_tool',
          description: 'A mock tool',
          parameters: { type: 'object', properties: {} },
        },
      }),
      execute: jest.fn().mockResolvedValue({
        content: 'result',
        success: true,
      }),
    };

    agent = new AgentLoop(indexer, false, [mockTool]);

    // LLM just keeps returning a tool call infinitely
    mockProvider.streamChat.mockImplementation(async function* () {
      yield { toolCalls: [{ id: 'call_infinite', function: { name: 'mock_tool', arguments: JSON.stringify({ query: 'loop' }) } }] } as StreamChunk;
    });

    const mockFindFiles = jest.fn().mockResolvedValue([]);
    (vscode.workspace as any).findFiles = mockFindFiles;

    const events = [];
    try {
      for await (const event of agent.run('Search forever', [], mockProvider, { maxIterations: 3 })) {
        events.push(event);
      }
    } catch (e) {
      console.error('Error in loop 2:', e);
    }

    const toolCalls = events.filter(e => e.type === 'toolCall');
    expect(toolCalls.length).toBe(3); // Hit the limit
    
    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error).toContain('maximum of 3 iterations');
  });
});
