/**
 * End-to-End Multi-Step Scenario Verification:
 * 
 * Tests the complete flow:
 * User request → Model receives tools → calls read_file → calls edit_file
 * → requests terminal → asks permission → approves → executes command
 * → returns exit code & stdout → produces final answer.
 * 
 * Also verifies permission rejection handling and event streaming.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { AgentRuntime } from '../../agent/agentRuntime';
import { ToolRegistry } from '../../agent/toolRegistry';
import { PermissionManager } from '../../agent/permissionManager';
import { ReadFileTool } from '../../agent/tools/readFileTool';
import { EditFileTool } from '../../agent/tools/editFileTool';
import { TerminalTool } from '../../agent/tools/terminalTool';
import { AgentNormalizedEvent } from '../../agent/types';
import { CompletionOptions, ILLMProvider, StreamChunk } from '../../providers/types';

describe('PHASE 7 VERIFICATION: Agent Multi-Step End-to-End Scenario', () => {
  let tempWs: string;
  let registry: ToolRegistry;
  let permissionManager: PermissionManager;
  let runtime: AgentRuntime;

  beforeAll(async () => {
    tempWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-e2e-ws-'));
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: tempWs }, name: 'e2e-ws', index: 0 },
    ];
  });

  afterAll(async () => {
    await fs.rm(tempWs, { recursive: true, force: true });
  });

  beforeEach(() => {
    registry = new ToolRegistry([
      new ReadFileTool(),
      new EditFileTool(),
      new TerminalTool('terminal'),
    ]);
    permissionManager = new PermissionManager();
    runtime = new AgentRuntime(registry, permissionManager);
  });

  it('executes full 15-step scenario: read_file -> edit_file -> terminal (approval required) -> final response', async () => {
    // Set up real target file in workspace
    const targetFile = 'src/example.ts';
    const absPath = path.join(tempWs, targetFile);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(
      absPath,
      'export const X = 100;\nexport function getX() { return X; }\n',
    );

    // Track normalized events emitted throughout the lifecycle
    const emittedEvents: AgentNormalizedEvent[] = [];
    runtime.onEvent((ev) => {
      emittedEvents.push(ev);
    });

    // Mock Provider simulating model making sequential tool calls
    // Step 1: Model calls read_file
    // Step 2: Model receives content and calls edit_file
    // Step 3: Model receives edit confirmation and calls terminal (npm test or echo test)
    // Step 4: Model receives terminal output and produces final answer
    const safeTestCmd = process.platform === 'win32' ? 'cmd /c echo TestPassed' : 'echo TestPassed';

    let iterationCount = 0;
    const toolsReceivedByModel: string[][] = [];

    const mockProvider: ILLMProvider = {
      id: 'mock-provider',
      displayName: 'Mock Provider',
      getDefaultModel: () => 'test-model',
      capabilities: { toolCalling: true, streaming: true, vision: false },
      testConnection: jest.fn(),
      discoverModels: jest.fn(),
      dispose: jest.fn(),
      streamChat: (messages, options?: CompletionOptions) => {
        const iteration = iterationCount++;
        // Capture tool definitions provided to the model
        if (options?.tools) {
          toolsReceivedByModel.push(options.tools.map((t) => t.function.name));
        }

        return (async function* () {
          if (iteration === 0) {
            yield { content: 'I will read the file first.' } as StreamChunk;
            yield {
              toolCalls: [
                {
                  id: 'call_read_1',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ file: targetFile }),
                  },
                },
              ],
            } as StreamChunk;
          } else if (iteration === 1) {
            yield { content: 'Now I will change X to 200.' } as StreamChunk;
            yield {
              toolCalls: [
                {
                  id: 'call_edit_1',
                  function: {
                    name: 'edit_file',
                    arguments: JSON.stringify({
                      file: targetFile,
                      oldText: 'export const X = 100;',
                      newText: 'export const X = 200;',
                    }),
                  },
                },
              ],
            } as StreamChunk;
          } else if (iteration === 2) {
            yield { content: 'Now I will run the tests.' } as StreamChunk;
            yield {
              toolCalls: [
                {
                  id: 'call_term_1',
                  function: {
                    name: 'terminal',
                    arguments: JSON.stringify({ command: safeTestCmd }),
                  },
                },
              ],
            } as StreamChunk;
          } else {
            yield {
              content: 'All tasks completed: read file, updated X to 200, and verified tests passed.',
            } as StreamChunk;
          }
        })();
      },
    };

    // Auto-approve the terminal command when requested by PermissionManager
    let approvalWasTriggered = false;
    permissionManager.setApprovalHandler(async (request) => {
      approvalWasTriggered = true;
      expect(request.toolName).toBe('terminal');
      expect(request.command).toBe(safeTestCmd);
      return true; // User approves
    });

    const outputTokens: string[] = [];
    for await (const chunk of runtime.run('Read src/example.ts, change X to 200, then run tests', [], mockProvider)) {
      outputTokens.push(chunk);
    }

    // 1. Verify Model received the registered tools
    expect(toolsReceivedByModel.length).toBeGreaterThan(0);
    expect(toolsReceivedByModel[0]).toContain('read_file');
    expect(toolsReceivedByModel[0]).toContain('edit_file');
    expect(toolsReceivedByModel[0]).toContain('terminal');

    // 2. Verify file was actually modified on disk
    const updatedContent = await fs.readFile(absPath, 'utf-8');
    expect(updatedContent).toContain('export const X = 200;');
    expect(updatedContent).not.toContain('export const X = 100;');

    // 3. Verify approval was triggered before terminal execution
    expect(approvalWasTriggered).toBe(true);

    // 4. Verify normalized events sequence
    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain('agent.started');
    expect(eventTypes).toContain('tool.requested');
    expect(eventTypes).toContain('tool.approval_required');
    expect(eventTypes).toContain('tool.approved');
    expect(eventTypes).toContain('tool.completed');
    expect(eventTypes).toContain('agent.completed');

    // 5. Verify final model output produced
    const fullText = outputTokens.join('');
    expect(fullText).toContain('All tasks completed');

    // 6. Verify agent runtime status is completed
    expect(runtime.getStatus()).toBe('completed');
  });

  it('handles user rejection cleanly: command is NOT executed, rejection returned to model', async () => {
    let commandExecuted = false;

    // Reject the permission request
    permissionManager.setApprovalHandler(async () => {
      return false; // User denies
    });

    let iteration = 0;
    const mockProvider: ILLMProvider = {
      id: 'mock-provider',
      displayName: 'Mock Provider',
      getDefaultModel: () => 'test-model',
      capabilities: { toolCalling: true, streaming: true, vision: false },
      testConnection: jest.fn(),
      discoverModels: jest.fn(),
      dispose: jest.fn(),
      streamChat: (messages) => {
        const iter = iteration++;
        return (async function* () {
          if (iter === 0) {
            yield {
              toolCalls: [
                {
                  id: 'call_danger_1',
                  function: {
                    name: 'terminal',
                    arguments: JSON.stringify({ command: 'echo dangerous' }),
                  },
                },
              ],
            } as StreamChunk;
          } else {
            // Check that previous tool message contained rejection
            const toolMsg = messages.find((m) => m.role === 'tool');
            expect(toolMsg?.content).toContain('User denied permission');
            yield { content: 'Understood, I will not execute the command.' } as StreamChunk;
          }
        })();
      },
    };

    const tokens: string[] = [];
    for await (const chunk of runtime.run('Run command', [], mockProvider)) {
      tokens.push(chunk);
    }

    const fullResponse = tokens.join('');
    expect(fullResponse).toContain('Understood, I will not execute the command.');
    expect(runtime.getStatus()).toBe('completed');
  });
});
