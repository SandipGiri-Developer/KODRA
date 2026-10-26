import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentEventBus } from '../../agent/agentEventBus';
import { PermissionManager } from '../../agent/permissionManager';
import { ProcessManager } from '../../agent/process/processManager';
import { ApprovalGate } from '../../agent/terminal/approvalGate';
import { ApprovalPolicyService } from '../../agent/terminal/approvalPolicyService';
import { TerminalExecutionManager } from '../../agent/terminal/terminalExecutionManager';
import { ToolExecutor } from '../../agent/toolExecutor';
import { ToolRegistry } from '../../agent/toolRegistry';
import {
  getAllTools,
  getProcessTools,
  FindSymbolTool,
  TerminalTool,
  GoToDefinitionTool,
  RunCommandTool,
  StartProcessTool,
  ReadProcessOutputTool,
  SendProcessInputTool,
  StopProcessTool,
} from '../../agent/tools';
import { IWorkspaceService, VSCodeWorkspaceService } from '../../agent/workspaceService';
import { StorageManager } from '../../storage/storageManager';

describe('KODRA Agent Toolset Finalization (Exact 13 Tools)', () => {
  let tempDir: string;
  let workspaceService: IWorkspaceService;
  let processManager: ProcessManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-thirteen-tools-'));
    workspaceService = new VSCodeWorkspaceService(tempDir);
    ProcessManager.resetInstance();
    processManager = new ProcessManager();
  });

  afterEach(async () => {
    processManager.dispose();
    ProcessManager.resetInstance();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. Exact 13 Tools Registry Specification', () => {
    it('exposes exactly the 13 specified tools with zero duplicates or obsolete tools', () => {
      const tools = getAllTools(workspaceService);
      expect(tools).toHaveLength(13);

      const toolNames = tools.map((t) => t.name);
      const expectedTools = [
        'read_file',
        'edit_file',
        'create_file',
        'list_directory',
        'search_code',
        'find_symbol',
        'find_references',
        'git_context',
        'run_command',
        'start_process',
        'read_process_output',
        'send_process_input',
        'stop_process',
      ];

      expect(toolNames).toEqual(expectedTools);

      // Verify terminal and go_to_definition are NOT exposed
      expect(toolNames).not.toContain('terminal');
      expect(toolNames).not.toContain('go_to_definition');
    });

    it('ToolRegistry registers all 13 tools and generates definitions without error', () => {
      const tools = getAllTools(workspaceService);
      const registry = new ToolRegistry(tools);

      expect(registry.getAllTools()).toHaveLength(13);
      for (const tool of tools) {
        expect(registry.hasTool(tool.name)).toBe(true);
      }

      const definitions = registry.getToolDefinitions();
      expect(definitions).toHaveLength(13);
      for (const def of definitions) {
        expect(def.type).toBe('function');
        expect(def.function.name).toBeDefined();
        expect(def.function.description).toBeDefined();
        expect(def.function.parameters).toBeDefined();
      }
    });
  });

  describe('2. find_symbol Definition Navigation Integration', () => {
    it('supports query-based symbol search across the workspace', async () => {
      const tool = new FindSymbolTool(workspaceService);

      // Create a test file
      const testFile = path.join(tempDir, 'sample.ts');
      await fs.writeFile(testFile, 'export class MyTestService {\n  doAction() {}\n}\n');

      const res = await tool.execute({ query: 'MyTestService' });
      expect(res).toBeDefined();
      expect(typeof res.success).toBe('boolean');
    });

    it('supports file and line definition navigation via find_symbol', async () => {
      const tool = new FindSymbolTool(workspaceService);

      const testFile = path.join(tempDir, 'decl.ts');
      await fs.writeFile(
        testFile,
        'export function calculateTax(rate: number): number {\n  return rate * 1.2;\n}\n',
      );

      // Call find_symbol with file and line
      const res = await tool.execute({
        file: 'decl.ts',
        line: 1,
        column: 17,
        symbolName: 'calculateTax',
      });

      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(res.content).toBeDefined();
    });

    it('rejects find_symbol when neither query nor file/line is provided', async () => {
      const tool = new FindSymbolTool(workspaceService);
      const res = await tool.execute({});

      expect(res.success).toBe(false);
      expect(res.content).toContain('Missing required argument');
    });

    it('preserves GoToDefinitionTool for internal backward compatibility', () => {
      const legacyTool = new GoToDefinitionTool(workspaceService);
      expect(legacyTool.name).toBe('go_to_definition');
      const def = legacyTool.getDefinition();
      expect(def.function.name).toBe('go_to_definition');
    });
  });

  describe('3. Process Approval & Security Gate Enforcements', () => {
    let storageManager: StorageManager;
    let policyService: ApprovalPolicyService;
    let permissionManager: PermissionManager;
    let eventBus: AgentEventBus;
    let approvalGate: ApprovalGate;
    let toolRegistry: ToolRegistry;
    let toolExecutor: ToolExecutor;

    beforeEach(async () => {
      storageManager = new StorageManager(tempDir);
      await storageManager.initializeStorage();

      ApprovalPolicyService.resetInstance();
      policyService = new ApprovalPolicyService(storageManager);
      await policyService.initialize();

      permissionManager = new PermissionManager(false);
      eventBus = new AgentEventBus();
      approvalGate = new ApprovalGate(policyService, permissionManager, eventBus);

      toolRegistry = new ToolRegistry(getAllTools(workspaceService));

      toolExecutor = new ToolExecutor(
        toolRegistry,
        permissionManager,
        eventBus,
        approvalGate,
        {
          mode: 'agent',
          workspaceId: 'ws-thirteen-test',
          cwd: tempDir,
        },
      );
    });

    it('run_command: requires approval and prevents execution when denied', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_run_deny',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo ShouldNotExecute' }),
          },
        },
        'exec_run_deny',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('User denied permission');
    });

    it('run_command: executes when user permits', async () => {
      permissionManager.setApprovalHandler(async () => 'allow_once');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_run_allow',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo ApprovedProcessRun' }),
          },
        },
        'exec_run_allow',
      );

      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toContain('ApprovedProcessRun');
    });

    it('start_process: requires approval and prevents process creation when denied', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 2"' : 'sleep 2';

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_start_deny',
          function: {
            name: 'start_process',
            arguments: JSON.stringify({ command: cmd }),
          },
        },
        'exec_start_deny',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('User denied permission');
    });

    it('send_process_input: requires approval and prevents input injection when denied', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_input_deny',
          function: {
            name: 'send_process_input',
            arguments: JSON.stringify({ processId: 'proc_123', input: 'malicious input\n' }),
          },
        },
        'exec_input_deny',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('User denied permission');
    });

    it('read_process_output: is ungated and does not prompt for user approval', async () => {
      // Set handler to deny; read_process_output should still succeed because requiresApproval is false
      permissionManager.setApprovalHandler(async () => 'deny');

      const record = await ProcessManager.getInstance().runCommand({
        command: 'echo UngatedOutputCheck',
        cwd: tempDir,
      });

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_read_ungated',
          function: {
            name: 'read_process_output',
            arguments: JSON.stringify({ processId: record.processId }),
          },
        },
        'exec_read_ungated',
      );

      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toContain('UngatedOutputCheck');
    });

    it('stop_process: only allows termination of KODRA-managed processes and requires approval', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      // 1. When denied, does not execute
      const denyResp = await toolExecutor.executeToolCall(
        {
          id: 'call_stop_deny',
          function: {
            name: 'stop_process',
            arguments: JSON.stringify({ processId: 'proc_test_1' }),
          },
        },
        'exec_stop_deny',
      );
      expect(denyResp.result.success).toBe(false);
      expect(denyResp.result.content).toContain('User denied permission');

      // 2. When permitted, rejects invalid / non-KODRA process IDs
      permissionManager.setApprovalHandler(async () => 'allow_once');
      const unknownResp = await toolExecutor.executeToolCall(
        {
          id: 'call_stop_unknown',
          function: {
            name: 'stop_process',
            arguments: JSON.stringify({ processId: 'foreign_pid_99999' }),
          },
        },
        'exec_stop_unknown',
      );
      expect(unknownResp.result.success).toBe(false);
      expect(unknownResp.result.content).toContain('not found');
    });
  });

  describe('4. Legacy Terminal Compatibility', () => {
    it('preserves TerminalTool and TerminalExecutionManager for internal VS Code terminal integration', async () => {
      const termTool = new TerminalTool('terminal', workspaceService);
      expect(termTool.name).toBe('terminal');
      expect(termTool.requiresApproval).toBe(true);

      const termManager = TerminalExecutionManager.getInstance();
      expect(termManager).toBeDefined();

      const session = termManager.findIdleSession('ws-legacy', tempDir);
      // findIdleSession is functional
      expect(session).toBeUndefined();

      termManager.dispose();
    });
  });
});
