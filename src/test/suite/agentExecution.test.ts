import { AgentLoop } from '../../agent/agentLoop';
import { CodebaseIndexer } from '../../indexing/indexer';
import { ILLMProvider, StreamChunk } from '../../providers/types';
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

  it('should execute full agent loop with tool call', async () => {
    // Mock the provider to yield a tool call, then a final response
    const mockResponses = [
      // First iteration: tool call
      (async function* () {
        yield { content: 'Let me check the time.' } as StreamChunk;
        yield { toolCalls: [{ id: 'call_1', function: { name: 'read_file', arguments: JSON.stringify({ filepath: 'test.txt' }) } }] } as StreamChunk;
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

    // Mock Node.js fs
    (fs.readFile as jest.Mock).mockResolvedValue('test content');
    
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

    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'utf-8');
    
    // Verify that the LLM was given the tool result
    expect(mockProvider.streamChat).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockProvider.streamChat.mock.calls[1][0];
    const toolResultMessage = secondCallMessages.find((m: any) => m.role === 'tool');
    expect(toolResultMessage).toBeDefined();
    expect(toolResultMessage!.content).toContain('test content');
  });

  it('should respect max iterations limit', async () => {
    // LLM just keeps returning a tool call infinitely
    mockProvider.streamChat.mockImplementation(async function* () {
      yield { toolCalls: [{ id: 'call_infinite', function: { name: 'search_files', arguments: JSON.stringify({ query: 'loop' }) } }] } as StreamChunk;
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
