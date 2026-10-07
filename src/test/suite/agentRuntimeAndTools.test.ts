/**
 * Tests for ToolRegistry, PermissionManager, and the 3 initial tools:
 * - read_file
 * - edit_file
 * - terminal
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { ToolRegistry } from '../../agent/toolRegistry';
import { PermissionManager } from '../../agent/permissionManager';
import { ReadFileTool } from '../../agent/tools/readFileTool';
import { EditFileTool } from '../../agent/tools/editFileTool';
import { TerminalTool } from '../../agent/tools/terminalTool';
import { ITool } from '../../agent/types';

describe('ToolRegistry', () => {
  it('registers, retrieves, unregisters, and generates schemas dynamically', () => {
    const registry = new ToolRegistry();
    expect(registry.getAllTools()).toHaveLength(0);

    const mockTool: ITool = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      getDefinition: () => ({
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      }),
      execute: async () => ({ content: 'result', success: true }),
    };

    registry.register(mockTool);
    expect(registry.hasTool('test_tool')).toBe(true);
    expect(registry.getTool('test_tool')?.name).toBe('test_tool');

    const definitions = registry.getToolDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0].function.name).toBe('test_tool');

    const removed = registry.unregister('test_tool');
    expect(removed).toBe(true);
    expect(registry.hasTool('test_tool')).toBe(false);
  });
});

describe('PermissionManager', () => {
  it('requests and resolves approval cleanly', async () => {
    const pm = new PermissionManager();
    const req = {
      requestId: 'req_1',
      executionId: 'exec_1',
      toolCallId: 'call_1',
      toolName: 'terminal',
      description: 'Run test command',
      command: 'echo hello',
    };

    const promise = pm.requestPermission(req);
    expect(pm.hasPendingRequests()).toBe(true);

    const resolved = pm.resolveRequest('req_1', true);
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result).toBe(true);
    expect(pm.hasPendingRequests()).toBe(false);
  });

  it('handles rejection cleanly', async () => {
    const pm = new PermissionManager();
    const req = {
      requestId: 'req_2',
      executionId: 'exec_2',
      toolCallId: 'call_2',
      toolName: 'terminal',
      description: 'Run test command',
    };

    const promise = pm.requestPermission(req);
    pm.resolveRequest('req_2', false);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('cancels all pending requests upon cancellation', async () => {
    const pm = new PermissionManager();
    const promise1 = pm.requestPermission({
      requestId: 'req_a',
      executionId: 'exec_1',
      toolCallId: 'call_1',
      toolName: 'terminal',
      description: 'Command A',
    });
    const promise2 = pm.requestPermission({
      requestId: 'req_b',
      executionId: 'exec_1',
      toolCallId: 'call_2',
      toolName: 'terminal',
      description: 'Command B',
    });

    pm.cancelAll();
    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toBe(false);
    expect(res2).toBe(false);
    expect(pm.hasPendingRequests()).toBe(false);
  });
});

describe('Initial Tools', () => {
  let tempWs: string;

  beforeAll(async () => {
    tempWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-tools-test-'));
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: tempWs }, name: 'test-ws', index: 0 },
    ];
  });

  afterAll(async () => {
    await fs.rm(tempWs, { recursive: true, force: true });
  });

  describe('ReadFileTool', () => {
    const readTool = new ReadFileTool();

    it('reads a valid file and formats line numbers', async () => {
      await fs.writeFile(path.join(tempWs, 'sample.txt'), 'line one\nline two\nline three');

      const result = await readTool.execute({ file: 'sample.txt' });
      expect(result.success).toBe(true);
      expect(result.content).toContain('1 | line one');
      expect(result.content).toContain('2 | line two');
      expect(result.content).toContain('3 | line three');
      expect(result.metadata?.totalLines).toBe(3);
    });

    it('returns clear error for missing file', async () => {
      const result = await readTool.execute({ file: 'non_existent.txt' });
      expect(result.success).toBe(false);
      expect(result.content).toContain('File not found');
    });

    it('returns error when target is a directory', async () => {
      const subDir = path.join(tempWs, 'subfolder');
      await fs.mkdir(subDir, { recursive: true });

      const result = await readTool.execute({ file: 'subfolder' });
      expect(result.success).toBe(false);
      expect(result.content).toContain('is a directory');
    });

    it('prevents reading outside workspace boundaries', async () => {
      const result = await readTool.execute({ file: '../../outside.txt' });
      expect(result.success).toBe(false);
      expect(result.content).toContain('Access denied');
    });
  });

  describe('EditFileTool', () => {
    const editTool = new EditFileTool();

    it('successfully replaces unique oldText in an existing file', async () => {
      await fs.writeFile(path.join(tempWs, 'config.ts'), 'export const port = 3000;\nexport const host = "localhost";\n');

      const result = await editTool.execute({
        file: 'config.ts',
        oldText: 'export const port = 3000;',
        newText: 'export const port = 8080;',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Successfully modified');

      const updated = await fs.readFile(path.join(tempWs, 'config.ts'), 'utf-8');
      expect(updated).toContain('export const port = 8080;');
      expect(updated).not.toContain('3000');
    });

    it('fails when oldText does not exist in the file', async () => {
      const result = await editTool.execute({
        file: 'config.ts',
        oldText: 'const missing = true;',
        newText: 'const missing = false;',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('oldText was not found');
    });

    it('rejects ambiguous edits when oldText appears multiple times', async () => {
      await fs.writeFile(path.join(tempWs, 'duplicate.ts'), 'const x = 1;\nconst x = 1;\n');

      const result = await editTool.execute({
        file: 'duplicate.ts',
        oldText: 'const x = 1;',
        newText: 'const x = 2;',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Found 2 occurrences of oldText');
    });

    it('fails when editing a non-existent file', async () => {
      const result = await editTool.execute({
        file: 'ghost.ts',
        oldText: 'a',
        newText: 'b',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('File not found');
    });
  });

  describe('TerminalTool', () => {
    const termTool = new TerminalTool('terminal');

    it('has requiresApproval set to true', () => {
      expect(termTool.requiresApproval).toBe(true);
    });

    it('executes a safe command and captures stdout and exit code', async () => {
      // Platform-independent safe echo command
      const cmd = process.platform === 'win32' ? 'cmd /c echo KodraRocks' : 'echo KodraRocks';
      const result = await termTool.execute({ command: cmd });

      expect(result.success).toBe(true);
      expect(result.content).toContain('KodraRocks');
      expect(result.metadata?.exitCode).toBe(0);
    });

    it('rejects chained commands with &&, ;, or || for security', async () => {
      const chained1 = await termTool.execute({ command: 'echo hello && echo world' });
      expect(chained1.success).toBe(false);
      expect(chained1.content).toContain('Chained or compound commands');

      const chained2 = await termTool.execute({ command: 'echo 1 ; echo 2' });
      expect(chained2.success).toBe(false);
      expect(chained2.content).toContain('Chained or compound commands');

      const chained3 = await termTool.execute({ command: 'echo 1 || echo 2' });
      expect(chained3.success).toBe(false);
      expect(chained3.content).toContain('Chained or compound commands');
    });

    it('returns non-zero exit code on command failure without crashing', async () => {
      // Command that exits with code 1
      const failCmd = process.platform === 'win32' ? 'cmd /c exit 1' : 'sh -c "exit 1"';
      const result = await termTool.execute({ command: failCmd });

      expect(result.success).toBe(false);
      expect(result.content).toContain('exit code: 1');
      expect(result.metadata?.exitCode).toBe(1);
    });
  });
});
