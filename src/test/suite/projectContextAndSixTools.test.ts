/**
 * Comprehensive Verification Tests for Kodra Agent:
 * - Six Tools Registration and Execution:
 *     1. read_file
 *     2. search_code
 *     3. list_directory
 *     4. edit_file
 *     5. create_file
 *     6. terminal
 * - WorkspaceService & Path Resolution
 * - ContextManager & Autonomous Project Exploration Instructions
 * - ToolExecutor & AgentEventBus
 * - 5 Autonomous Project-Understanding Scenarios:
 *     1. "Tell me something about the project."
 *     2. "What files are in this project?"
 *     3. "Find where the main application starts."
 *     4. "Explain how this project is structured."
 *     5. "Read the package/configuration file and summarize it."
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { AgentLoop } from '../../agent/agentLoop';
import { AgentRuntime } from '../../agent/agentRuntime';
import { AgentEventBus } from '../../agent/agentEventBus';
import { ContextManager } from '../../agent/contextManager';
import { PermissionManager } from '../../agent/permissionManager';
import { ToolExecutor } from '../../agent/toolExecutor';
import { ToolRegistry } from '../../agent/toolRegistry';
import { getAllTools, ReadFileTool, ListDirectoryTool, SearchCodeTool, EditFileTool, CreateFileTool, TerminalTool } from '../../agent/tools';
import { VSCodeWorkspaceService, IWorkspaceService } from '../../agent/workspaceService';
import { CompletionOptions, ILLMProvider, StreamChunk } from '../../providers/types';

describe('Project Context & Six Tools Verification', () => {
  let tempWs: string;
  let workspaceService: IWorkspaceService;

  beforeAll(async () => {
    tempWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-tools-verify-'));
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: tempWs }, name: 'sample-project', index: 0 },
    ];
    workspaceService = new VSCodeWorkspaceService(tempWs);

    // Create realistic repository structure in temp workspace
    await fs.mkdir(path.join(tempWs, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempWs, 'docs'), { recursive: true });
    await fs.mkdir(path.join(tempWs, 'node_modules', 'fake-pkg'), { recursive: true });

    // package.json
    await fs.writeFile(
      path.join(tempWs, 'package.json'),
      JSON.stringify(
        {
          name: 'sample-app',
          version: '1.0.0',
          description: 'A sample full-stack TypeScript application for Kodra testing',
          main: 'src/main.ts',
          scripts: { start: 'ts-node src/main.ts', test: 'jest' },
          dependencies: { express: '^4.19.0' },
        },
        null,
        2,
      ),
    );

    // README.md
    await fs.writeFile(
      path.join(tempWs, 'README.md'),
      '# Sample Application\n\nThis application demonstrates the Kodra autonomous agent.\nIt includes an HTTP API and a data ingestion engine.\n',
    );

    // src/main.ts (entry point)
    await fs.writeFile(
      path.join(tempWs, 'src', 'main.ts'),
      'import { createServer } from "./server";\n\nexport function startApp() {\n  const server = createServer();\n  server.listen(3000, () => console.log("Application started on port 3000"));\n}\n\nstartApp();\n',
    );

    // src/server.ts
    await fs.writeFile(
      path.join(tempWs, 'src', 'server.ts'),
      'export function createServer() {\n  return {\n    listen: (port: number, cb: () => void) => cb(),\n  };\n}\n',
    );

    // noise in node_modules (should be ignored by tools)
    await fs.writeFile(
      path.join(tempWs, 'node_modules', 'fake-pkg', 'index.js'),
      'module.exports = {};',
    );
  });

  afterAll(async () => {
    await fs.rm(tempWs, { recursive: true, force: true });
  });

  describe('1. Six Tools Registration & Registry', () => {
    it('registers all six foundational tools by default', () => {
      const tools = getAllTools(workspaceService);
      const names = tools.map((t) => t.name);

      expect(names).toContain('read_file');
      expect(names).toContain('search_code');
      expect(names).toContain('list_directory');
      expect(names).toContain('edit_file');
      expect(names).toContain('create_file');
      expect(names).toContain('terminal');

      const registry = new ToolRegistry(tools);
      expect(registry.hasTool('read_file')).toBe(true);
      expect(registry.hasTool('search_code')).toBe(true);
      expect(registry.hasTool('list_directory')).toBe(true);
      expect(registry.hasTool('edit_file')).toBe(true);
      expect(registry.hasTool('create_file')).toBe(true);
      expect(registry.hasTool('terminal')).toBe(true);

      const definitions = registry.getToolDefinitions();
      expect(definitions.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('2. Individual Tool Unit Behaviors', () => {
    it('list_directory: inspects root and filters ignored directories', async () => {
      const listTool = new ListDirectoryTool(workspaceService);
      const res = await listTool.execute({});

      expect(res.success).toBe(true);
      expect(res.content).toContain('package.json');
      expect(res.content).toContain('README.md');
      expect(res.content).toContain('[DIR]  src/');
      expect(res.content).toContain('[DIR]  docs/');
      // node_modules should be ignored
      expect(res.content).not.toContain('node_modules');
    });

    it('list_directory: inspects subdirectory correctly', async () => {
      const listTool = new ListDirectoryTool(workspaceService);
      const res = await listTool.execute({ path: 'src' });

      expect(res.success).toBe(true);
      expect(res.content).toContain('main.ts');
      expect(res.content).toContain('server.ts');
    });

    it('search_code: finds text across files and returns line numbers', async () => {
      const searchTool = new SearchCodeTool(workspaceService);
      const res = await searchTool.execute({ query: 'startApp' });

      expect(res.success).toBe(true);
      expect(res.content).toContain('src/main.ts');
      expect(res.content).toContain('startApp');
      expect(res.metadata?.matchCount).toBeGreaterThan(0);
    });

    it('create_file: creates a new file safely and rejects overwriting without flag', async () => {
      const createTool = new CreateFileTool(workspaceService);
      const newPath = 'src/config.ts';

      const res = await createTool.execute({
        file: newPath,
        content: 'export const CONFIG = { port: 3000 };\n',
      });
      expect(res.success).toBe(true);

      const onDisk = await fs.readFile(path.join(tempWs, newPath), 'utf-8');
      expect(onDisk).toContain('CONFIG = { port: 3000 }');

      // Attempt duplicate creation without overwrite -> must fail
      const dup = await createTool.execute({
        file: newPath,
        content: 'export const OVERWRITE = true;\n',
      });
      expect(dup.success).toBe(false);
      expect(dup.content).toContain('already exists');

      // Attempt duplicate creation WITH overwrite -> must succeed
      const ov = await createTool.execute({
        file: newPath,
        content: 'export const OVERWRITE = true;\n',
        overwrite: true,
      });
      expect(ov.success).toBe(true);
    });

    it('read_file: supports line range slicing', async () => {
      const readTool = new ReadFileTool(workspaceService);
      const res = await readTool.execute({
        file: 'src/main.ts',
        startLine: 3,
        endLine: 6,
      });

      expect(res.success).toBe(true);
      expect(res.content).toContain('3 | export function startApp()');
      expect(res.metadata?.startLine).toBe(3);
      expect(res.metadata?.endLine).toBe(6);
    });

    it('edit_file: replaces exact unique text', async () => {
      const editTool = new EditFileTool(workspaceService);
      const res = await editTool.execute({
        file: 'src/server.ts',
        oldText: 'listen: (port: number, cb: () => void) => cb(),',
        newText: 'listen: (port: number, cb: () => void) => { console.log(port); cb(); },',
      });

      expect(res.success).toBe(true);
      const content = await fs.readFile(path.join(tempWs, 'src/server.ts'), 'utf-8');
      expect(content).toContain('console.log(port);');
    });

    it('terminal: runs safe command with workspace cwd', async () => {
      const termTool = new TerminalTool('terminal', workspaceService);
      const safeCmd = process.platform === 'win32' ? 'cmd /c echo VerificationPassed' : 'echo VerificationPassed';
      const res = await termTool.execute({ command: safeCmd });

      expect(res.success).toBe(true);
      expect(res.content).toContain('VerificationPassed');
    });
  });

  describe('3. ContextManager Workspace Awareness', () => {
    it('injects active workspace details and autonomous tool instructions into system prompt', () => {
      const cm = new ContextManager(workspaceService);
      const prompt = cm.buildSystemPrompt();

      expect(prompt).toContain('sample-project');
      expect(prompt).toContain('list_directory');
      expect(prompt).toContain('search_code');
      expect(prompt).toContain('read_file');
      expect(prompt).toContain('CRITICAL INSTRUCTION FOR AUTONOMOUS PROJECT UNDERSTANDING');
      expect(prompt).toContain('NEVER state that you lack information about the project');
    });
  });

  describe('4. Autonomous Project Understanding Scenarios', () => {
    let loop: AgentLoop;

    beforeEach(() => {
      loop = new AgentLoop(undefined, false, undefined, workspaceService);
    });

    // SCENARIO 1: "Tell me something about the project."
    it('Scenario 1: autonomously inspects workspace and answers "Tell me something about the project"', async () => {
      let iteration = 0;
      const toolsCalled: string[] = [];

      const mockProvider: ILLMProvider = {
        id: 'mock',
        displayName: 'Mock',
        getDefaultModel: () => 'mock-model',
        capabilities: { toolCalling: true, streaming: true, vision: false },
        testConnection: jest.fn(),
        discoverModels: jest.fn(),
        dispose: jest.fn(),
        streamChat: (messages) => {
          const iter = iteration++;
          return (async function* () {
            if (iter === 0) {
              // Iteration 1: Model calls list_directory to see what files exist
              yield {
                toolCalls: [
                  {
                    id: 'call_list_1',
                    function: { name: 'list_directory', arguments: JSON.stringify({ path: '' }) },
                  },
                ],
              } as StreamChunk;
            } else if (iter === 1) {
              // Iteration 2: Model sees package.json and README.md, reads package.json
              yield {
                toolCalls: [
                  {
                    id: 'call_read_1',
                    function: { name: 'read_file', arguments: JSON.stringify({ file: 'package.json' }) },
                  },
                ],
              } as StreamChunk;
            } else {
              // Iteration 3: Model produces final informed answer based on actual files
              yield {
                content:
                  'This project is "sample-app", a full-stack TypeScript application with Express and Jest tests.',
              } as StreamChunk;
            }
          })();
        },
      };

      const emittedContent: string[] = [];
      for await (const event of loop.run('Tell me something about the project.', [], mockProvider)) {
        if (event.type === 'toolCall') {
          toolsCalled.push(event.toolName);
        }
        if (event.type === 'content') {
          emittedContent.push(event.content);
        }
      }

      // Verifications:
      expect(toolsCalled).toEqual(['list_directory', 'read_file']);
      const finalAnswer = emittedContent.join('');
      expect(finalAnswer).toContain('sample-app');
      expect(finalAnswer).not.toContain("I don't have information");
    });

    // SCENARIO 2: "What files are in this project?"
    it('Scenario 2: autonomously calls list_directory for "What files are in this project?"', async () => {
      let iteration = 0;
      const toolsCalled: string[] = [];

      const mockProvider: ILLMProvider = {
        id: 'mock',
        displayName: 'Mock',
        getDefaultModel: () => 'mock-model',
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
                    id: 'call_list_files',
                    function: { name: 'list_directory', arguments: JSON.stringify({ path: '' }) },
                  },
                ],
              } as StreamChunk;
            } else {
              yield {
                content: 'The project contains package.json, README.md, src/, and docs/.',
              } as StreamChunk;
            }
          })();
        },
      };

      const emittedContent: string[] = [];
      for await (const event of loop.run('What files are in this project?', [], mockProvider)) {
        if (event.type === 'toolCall') {
          toolsCalled.push(event.toolName);
        }
        if (event.type === 'content') {
          emittedContent.push(event.content);
        }
      }

      expect(toolsCalled).toContain('list_directory');
      expect(emittedContent.join('')).toContain('package.json');
    });

    // SCENARIO 3: "Find where the main application starts."
    it('Scenario 3: autonomously locates entry point for "Find where the main application starts."', async () => {
      let iteration = 0;
      const toolsCalled: string[] = [];

      const mockProvider: ILLMProvider = {
        id: 'mock',
        displayName: 'Mock',
        getDefaultModel: () => 'mock-model',
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
                    id: 'call_search_start',
                    function: {
                      name: 'search_code',
                      arguments: JSON.stringify({ query: 'startApp' }),
                    },
                  },
                ],
              } as StreamChunk;
            } else {
              yield {
                content: 'The main application starts in src/main.ts via the startApp() function.',
              } as StreamChunk;
            }
          })();
        },
      };

      const emittedContent: string[] = [];
      for await (const event of loop.run('Find where the main application starts.', [], mockProvider)) {
        if (event.type === 'toolCall') {
          toolsCalled.push(event.toolName);
        }
        if (event.type === 'content') {
          emittedContent.push(event.content);
        }
      }

      expect(toolsCalled).toContain('search_code');
      expect(emittedContent.join('')).toContain('src/main.ts');
    });

    // SCENARIO 4: "Explain how this project is structured."
    it('Scenario 4: autonomously explains structure for "Explain how this project is structured."', async () => {
      let iteration = 0;
      const toolsCalled: string[] = [];

      const mockProvider: ILLMProvider = {
        id: 'mock',
        displayName: 'Mock',
        getDefaultModel: () => 'mock-model',
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
                    id: 'call_list_struct',
                    function: {
                      name: 'list_directory',
                      arguments: JSON.stringify({ recursive: true }),
                    },
                  },
                ],
              } as StreamChunk;
            } else {
              yield {
                content:
                  'The project has src/ containing main.ts and server.ts, docs/ for documentation, and package.json.',
              } as StreamChunk;
            }
          })();
        },
      };

      const emittedContent: string[] = [];
      for await (const event of loop.run('Explain how this project is structured.', [], mockProvider)) {
        if (event.type === 'toolCall') {
          toolsCalled.push(event.toolName);
        }
        if (event.type === 'content') {
          emittedContent.push(event.content);
        }
      }

      expect(toolsCalled).toContain('list_directory');
      expect(emittedContent.join('')).toContain('main.ts');
    });

    // SCENARIO 5: "Read the package/configuration file and summarize it."
    it('Scenario 5: autonomously reads and summarizes configuration file', async () => {
      let iteration = 0;
      const toolsCalled: string[] = [];

      const mockProvider: ILLMProvider = {
        id: 'mock',
        displayName: 'Mock',
        getDefaultModel: () => 'mock-model',
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
                    id: 'call_read_pkg',
                    function: {
                      name: 'read_file',
                      arguments: JSON.stringify({ file: 'package.json' }),
                    },
                  },
                ],
              } as StreamChunk;
            } else {
              yield {
                content: 'package.json configures "sample-app" v1.0.0 with express and start/test scripts.',
              } as StreamChunk;
            }
          })();
        },
      };

      const emittedContent: string[] = [];
      for await (const event of loop.run('Read the package/configuration file and summarize it.', [], mockProvider)) {
        if (event.type === 'toolCall') {
          toolsCalled.push(event.toolName);
        }
        if (event.type === 'content') {
          emittedContent.push(event.content);
        }
      }

      expect(toolsCalled).toContain('read_file');
      expect(emittedContent.join('')).toContain('sample-app');
    });
  });
});
