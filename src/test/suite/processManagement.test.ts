import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentEventBus } from '../../agent/agentEventBus';
import { PermissionManager } from '../../agent/permissionManager';
import { ProcessManager } from '../../agent/process/processManager';
import { ApprovalGate } from '../../agent/terminal/approvalGate';
import { ApprovalPolicyService } from '../../agent/terminal/approvalPolicyService';
import { ToolExecutor } from '../../agent/toolExecutor';
import { ToolRegistry } from '../../agent/toolRegistry';
import { RunCommandTool } from '../../agent/tools/runCommandTool';
import { StartProcessTool } from '../../agent/tools/startProcessTool';
import { ReadProcessOutputTool } from '../../agent/tools/readProcessOutputTool';
import { SendProcessInputTool } from '../../agent/tools/sendProcessInputTool';
import { StopProcessTool } from '../../agent/tools/stopProcessTool';
import { getAllTools, getProcessTools } from '../../agent/tools';
import { StorageManager } from '../../storage/storageManager';

describe('Phase 1: Process Management & Process Tools', () => {
  let tempDir: string;
  let processManager: ProcessManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-proc-test-'));
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

  describe('ProcessManager Core Lifecycle', () => {
    it('executes a finite command successfully and captures stdout', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'echo HelloProcessManager' : 'echo HelloProcessManager';
      const record = await processManager.runCommand({
        command: cmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');
      expect(record.exitCode).toBe(0);
      expect(record.output).toContain('HelloProcessManager');
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
      expect(record.isTimedOut).toBe(false);
      expect(record.isTruncated).toBe(false);
    });

    it('handles failed commands with non-zero exit code and stderr', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'cmd /c exit 42' : 'sh -c "exit 42"';
      const record = await processManager.runCommand({
        command: cmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('failed');
      expect(record.exitCode).toBe(42);
      expect(record.error).toContain('42');
    });

    it('enforces command timeout', async () => {
      const isWin = process.platform === 'win32';
      // Sleep for 3 seconds but timeout after 100ms
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 3"' : 'sleep 3';
      const record = await processManager.runCommand({
        command: cmd,
        cwd: tempDir,
        timeoutMs: 100,
      });

      expect(record.status).toBe('timed_out');
      expect(record.isTimedOut).toBe(true);
      expect(record.output).toContain('timed out');
    }, 10000);

    it('supports cancellation via AbortSignal', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 3"' : 'sleep 3';
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 100);

      const record = await processManager.runCommand({
        command: cmd,
        cwd: tempDir,
        signal: controller.signal,
      });

      expect(record.status).toBe('cancelled');
      expect(record.output).toContain('cancelled');
    }, 10000);

    it('starts background process and continues tracking it', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? 'powershell -Command "Start-Sleep -Seconds 2; echo DoneBackground"'
        : 'sleep 2 && echo DoneBackground';

      const record = await processManager.startProcess({
        command: cmd,
        cwd: tempDir,
      });

      expect(record.processId).toBeDefined();
      expect(record.status).toBe('running');
      expect(record.pid).toBeDefined();

      const tracked = processManager.getProcess(record.processId);
      expect(tracked).toBeDefined();
      expect(tracked?.processId).toBe(record.processId);

      // Clean up process
      await processManager.stopProcess(record.processId);
      expect(processManager.getProcess(record.processId)?.status).toBe('cancelled');
    });

    it('bounds output buffer to prevent unbounded memory growth', async () => {
      const manager = new ProcessManager({ maxOutputBytes: 100 });
      const isWin = process.platform === 'win32';
      // Output lots of lines
      const cmd = isWin
        ? 'powershell -Command "1..50 | ForEach-Object { Write-Output \'ABCDEFGHIJ 1234567890\' }"'
        : 'seq 1 50 | while read i; do echo "ABCDEFGHIJ 1234567890"; done';

      const record = await manager.runCommand({
        command: cmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');
      expect(record.output.length).toBeLessThanOrEqual(100);
      expect(record.isTruncated).toBe(true);
      expect(record.totalBytes).toBeGreaterThan(100);
      manager.dispose();
    });

    it('supports incremental output retrieval via getOutput', async () => {
      const record = await processManager.runCommand({
        command: 'echo 0123456789',
        cwd: tempDir,
      });

      const chunk1 = processManager.getOutput(record.processId, { fromIndex: 0, maxBytes: 4 });
      expect(chunk1).toBeDefined();
      expect(chunk1?.output).toBe('0123');
      expect(chunk1?.nextIndex).toBe(4);

      const chunk2 = processManager.getOutput(record.processId, { fromIndex: chunk1!.nextIndex, maxBytes: 4 });
      expect(chunk2?.output).toBe('4567');
      expect(chunk2?.nextIndex).toBe(8);
    });

    it('terminates all processes on dispose', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 5"' : 'sleep 5';

      const record = await processManager.startProcess({
        command: cmd,
        cwd: tempDir,
      });
      expect(record.status).toBe('running');

      processManager.dispose();
      expect(processManager.listProcesses()).toHaveLength(0);
    });
  });

  describe('RunCommandTool', () => {
    let tool: RunCommandTool;

    beforeEach(() => {
      tool = new RunCommandTool(undefined, processManager);
    });

    it('has valid tool metadata and definition schema', () => {
      expect(tool.name).toBe('run_command');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.isDestructive).toBe(true);

      const def = tool.getDefinition();
      expect(def.type).toBe('function');
      expect(def.function.name).toBe('run_command');
      expect(def.function.parameters.required).toContain('command');
    });

    it('rejects missing or empty command', async () => {
      const res = await tool.execute({ command: '' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('Missing required argument');
    });

    it('rejects compound or chained commands for safety', async () => {
      const res1 = await tool.execute({ command: 'echo hello && echo world' });
      expect(res1.success).toBe(false);
      expect(res1.content).toContain('Chained or compound commands');

      const res2 = await tool.execute({ command: 'echo hello; ls' });
      expect(res2.success).toBe(false);
      expect(res2.content).toContain('Chained or compound commands');

      const res3 = await tool.execute({ command: 'cat file | grep test' });
      expect(res3.success).toBe(false);
      expect(res3.content).toContain('Chained or compound commands');
    });

    it('rejects commands with unbalanced quotes', async () => {
      const res = await tool.execute({ command: 'echo "hello world' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('unbalanced quotes');
    });

    it('executes a valid discrete command successfully', async () => {
      const res = await tool.execute({ command: 'echo DiscreteCommandRun', cwd: tempDir });
      expect(res.success).toBe(true);
      expect(res.content).toContain('Command executed successfully');
      expect(res.content).toContain('DiscreteCommandRun');
      expect(res.metadata?.exitCode).toBe(0);
      expect(res.metadata?.processId).toBeDefined();
    });
  });

  describe('StartProcessTool', () => {
    let tool: StartProcessTool;

    beforeEach(() => {
      tool = new StartProcessTool(undefined, processManager);
    });

    it('has valid tool metadata and definition schema', () => {
      expect(tool.name).toBe('start_process');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.isDestructive).toBe(true);

      const def = tool.getDefinition();
      expect(def.type).toBe('function');
      expect(def.function.name).toBe('start_process');
      expect(def.function.parameters.required).toContain('command');
    });

    it('rejects missing or empty command', async () => {
      const res = await tool.execute({ command: '   ' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('Missing required argument');
    });

    it('rejects chained or compound commands', async () => {
      const res = await tool.execute({ command: 'echo a || echo b' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('Chained or compound commands');
    });

    it('starts background process and returns processId immediately', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 3"' : 'sleep 3';

      const res = await tool.execute({ command: cmd, cwd: tempDir });
      expect(res.success).toBe(true);
      expect(res.content).toContain('Background process started successfully');
      expect(res.metadata?.processId).toBeDefined();
      expect(res.metadata?.status).toBe('running');

      const processId = res.metadata?.processId as string;
      await processManager.stopProcess(processId);
    });
  });

  describe('Security and Approval Gate Integration', () => {
    let storageManager: StorageManager;
    let policyService: ApprovalPolicyService;
    let permissionManager: PermissionManager;
    let eventBus: AgentEventBus;
    let approvalGate: ApprovalGate;
    let toolRegistry: ToolRegistry;
    let toolExecutor: ToolExecutor;
    let runCommandTool: RunCommandTool;
    let startProcessTool: StartProcessTool;

    beforeEach(async () => {
      storageManager = new StorageManager(tempDir);
      await storageManager.initializeStorage();

      ApprovalPolicyService.resetInstance();
      policyService = new ApprovalPolicyService(storageManager);
      await policyService.initialize();

      permissionManager = new PermissionManager(false);
      eventBus = new AgentEventBus();
      approvalGate = new ApprovalGate(policyService, permissionManager, eventBus);

      runCommandTool = new RunCommandTool(undefined, processManager);
      startProcessTool = new StartProcessTool(undefined, processManager);

      toolRegistry = new ToolRegistry([runCommandTool, startProcessTool]);

      toolExecutor = new ToolExecutor(toolRegistry, permissionManager, eventBus, approvalGate, {
        mode: 'agent',
        workspaceId: 'ws-proc-test',
        cwd: tempDir,
      });
    });

    it('enforces approval gate: denies run_command when user rejects', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_run_1',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo UnapprovedCommand' }),
          },
        },
        'exec_proc_1',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('User denied permission');
    });

    it('enforces approval gate: executes run_command when user permits', async () => {
      permissionManager.setApprovalHandler(async () => 'allow_once');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_run_2',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo ApprovedCommandOutput' }),
          },
        },
        'exec_proc_2',
      );

      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toContain('ApprovedCommandOutput');
    });

    it('enforces approval gate: executes start_process when user permits', async () => {
      permissionManager.setApprovalHandler(async () => 'allow_once');
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 2"' : 'sleep 2';

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_start_1',
          function: {
            name: 'start_process',
            arguments: JSON.stringify({ command: cmd }),
          },
        },
        'exec_proc_3',
      );

      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toContain('Background process started');
      const processId = (resp.result.metadata as any)?.processId;
      if (processId) {
        await processManager.stopProcess(processId);
      }
    });

    it('auto-permits command when matching persistent policy allows it', async () => {
      await policyService.createPolicy({
        scope: 'workspace',
        workspaceId: 'ws-proc-test',
        commandPattern: 'echo AutoAllowed',
        decision: 'allow',
      });

      const requestPermissionSpy = jest.spyOn(permissionManager, 'requestPermission');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_run_3',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo AutoAllowed' }),
          },
        },
        'exec_proc_4',
      );

      expect(requestPermissionSpy).not.toHaveBeenCalled();
      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toContain('AutoAllowed');
    });

    it('denies command in Plan mode (read-only restriction)', async () => {
      toolExecutor.setExecutionContext({ mode: 'plan' });

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_run_plan',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo ShouldNotRun' }),
          },
        },
        'exec_proc_plan',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('Plan mode is restricted to read-only');
    });
  });

  describe('Phase 2: ReadProcessOutputTool', () => {
    let tool: ReadProcessOutputTool;

    beforeEach(() => {
      tool = new ReadProcessOutputTool(processManager);
    });

    it('has valid tool metadata and schema', () => {
      expect(tool.name).toBe('read_process_output');
      expect(tool.requiresApproval).toBe(false);
      expect(tool.isDestructive).toBe(false);
      const def = tool.getDefinition();
      expect(def.function.name).toBe('read_process_output');
      expect(def.function.parameters.required).toContain('processId');
    });

    it('rejects missing or empty processId', async () => {
      const res = await tool.execute({});
      expect(res.success).toBe(false);
      expect(res.content).toContain('Missing required argument "processId"');
    });

    it('rejects unknown processId with helpful message', async () => {
      const res = await tool.execute({ processId: 'non_existent_proc' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('Process "non_existent_proc" not found');
    });

    it('retrieves output and metadata for a completed command', async () => {
      const record = await processManager.runCommand({
        command: 'echo Step2OutputCheck',
        cwd: tempDir,
      });

      const res = await tool.execute({ processId: record.processId });
      expect(res.success).toBe(true);
      expect(res.content).toContain('Step2OutputCheck');
      expect(res.metadata?.processId).toBe(record.processId);
      expect(res.metadata?.status).toBe('completed');
      expect(res.metadata?.exitCode).toBe(0);
      expect(res.metadata?.cursor).toBeGreaterThan(0);
    });

    it('supports incremental output reading with cursor to avoid repeating history', async () => {
      const record = await processManager.runCommand({
        command: 'echo Line1Alpha; echo Line2Beta',
        cwd: tempDir,
      });

      // First read: first 8 chars
      const read1 = await tool.execute({ processId: record.processId, cursor: 0, maxBytes: 8 });
      expect(read1.success).toBe(true);
      const cursor1 = read1.metadata?.cursor;
      expect(cursor1).toBe(8);
      expect(read1.metadata?.output).toBe(record.output.slice(0, 8));

      // Second read: next chunk starting from cursor1
      const read2 = await tool.execute({ processId: record.processId, cursor: cursor1 });
      expect(read2.success).toBe(true);
      expect(read2.metadata?.output).toBe(record.output.slice(8));
      expect(read2.metadata?.cursor).toBeGreaterThan(Number(cursor1));
    });

    it('reports truncation notice when process output exceeded buffer limit', async () => {
      const smallManager = new ProcessManager({ maxOutputBytes: 40 });
      const record = await smallManager.runCommand({
        command: 'echo 12345678901234567890123456789012345678901234567890',
        cwd: tempDir,
      });

      const smallTool = new ReadProcessOutputTool(smallManager);
      const res = await smallTool.execute({ processId: record.processId, cursor: 0 });
      expect(res.success).toBe(true);
      expect(res.metadata?.isTruncated).toBe(true);
      expect(res.content).toContain('Earlier output was truncated');
      smallManager.dispose();
    });
  });

  describe('Phase 2: SendProcessInputTool', () => {
    let tool: SendProcessInputTool;

    beforeEach(() => {
      tool = new SendProcessInputTool(processManager);
    });

    it('has valid tool metadata and schema', () => {
      expect(tool.name).toBe('send_process_input');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.isDestructive).toBe(true);
      const def = tool.getDefinition();
      expect(def.function.name).toBe('send_process_input');
      expect(def.function.parameters.required).toContain('processId');
      expect(def.function.parameters.required).toContain('input');
    });

    it('rejects missing processId or input', async () => {
      const res1 = await tool.execute({ input: 'hello' });
      expect(res1.success).toBe(false);
      expect(res1.content).toContain('Missing required argument "processId"');

      const res2 = await tool.execute({ processId: 'some_proc' });
      expect(res2.success).toBe(false);
      expect(res2.content).toContain('Missing required argument "input"');
    });

    it('rejects unknown processId', async () => {
      const res = await tool.execute({ processId: 'unknown_proc', input: 'test' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('not found');
    });

    it('rejects completed process whose stdin is no longer running', async () => {
      const record = await processManager.runCommand({
        command: 'echo AlreadyDone',
        cwd: tempDir,
      });

      const res = await tool.execute({ processId: record.processId, input: 'test' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('is not running');
    });

    it('writes to stdin of an active process successfully', async () => {
      const nodeCmd = `"${process.execPath}" -e "process.stdin.on('data', d => { process.stdout.write('ECHO:' + d.toString().trim()); });"`;
      const record = await processManager.startProcess({
        command: nodeCmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('running');

      const sendRes = await tool.execute({
        processId: record.processId,
        input: 'PingFromKodra',
      });

      expect(sendRes.success).toBe(true);
      expect(sendRes.metadata?.bytesWritten).toBeGreaterThan(0);

      // Wait for node to process stdin and write to stdout
      let outputRes = processManager.getOutput(record.processId);
      for (let i = 0; i < 30 && !outputRes?.output.includes('ECHO:PingFromKodra'); i++) {
        await new Promise((r) => setTimeout(r, 50));
        outputRes = processManager.getOutput(record.processId);
      }
      expect(outputRes?.output).toContain('ECHO:PingFromKodra');

      await processManager.stopProcess(record.processId);
    });
  });

  describe('Phase 2: StopProcessTool', () => {
    let tool: StopProcessTool;

    beforeEach(() => {
      tool = new StopProcessTool(processManager);
    });

    it('has valid tool metadata and schema', () => {
      expect(tool.name).toBe('stop_process');
      expect(tool.requiresApproval).toBe(true);
      expect(tool.isDestructive).toBe(true);
      const def = tool.getDefinition();
      expect(def.function.name).toBe('stop_process');
      expect(def.function.parameters.required).toContain('processId');
    });

    it('rejects missing processId', async () => {
      const res = await tool.execute({});
      expect(res.success).toBe(false);
      expect(res.content).toContain('Missing required argument "processId"');
    });

    it('rejects unknown processId', async () => {
      const res = await tool.execute({ processId: 'proc_nonexistent' });
      expect(res.success).toBe(false);
      expect(res.content).toContain('not found');
    });

    it('gracefully stops a running background process', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 5"' : 'sleep 5';
      const record = await processManager.startProcess({
        command: cmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('running');

      const res = await tool.execute({ processId: record.processId });
      expect(res.success).toBe(true);
      expect(res.metadata?.status).toBe('cancelled');
      expect(res.metadata?.alreadyExited).toBe(false);

      expect(processManager.getProcess(record.processId)?.status).toBe('cancelled');
    });

    it('force-kills a process when force is set to true', async () => {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 5"' : 'sleep 5';
      const record = await processManager.startProcess({
        command: cmd,
        cwd: tempDir,
      });

      const res = await tool.execute({ processId: record.processId, force: true });
      expect(res.success).toBe(true);
      expect(res.content).toContain('forcefully');
      expect(res.metadata?.status).toBe('cancelled');
    });

    it('handles already-exited processes and repeated stop requests safely', async () => {
      const record = await processManager.runCommand({
        command: 'echo FastExit',
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');

      // First stop on already-exited process
      const res1 = await tool.execute({ processId: record.processId });
      expect(res1.success).toBe(true);
      expect(res1.metadata?.alreadyExited).toBe(true);
      expect(res1.content).toContain('already exited');

      // Second repeated stop request
      const res2 = await tool.execute({ processId: record.processId });
      expect(res2.success).toBe(true);
      expect(res2.metadata?.alreadyExited).toBe(true);
    });
  });

  describe('Phase 2: Unified Tool Registration & Model Tool Flow', () => {
    it('registers all 5 process tools through getProcessTools()', () => {
      const processTools = getProcessTools();
      expect(processTools).toHaveLength(5);
      const names = processTools.map((t) => t.name);
      expect(names).toEqual([
        'run_command',
        'start_process',
        'read_process_output',
        'send_process_input',
        'stop_process',
      ]);
    });

    it('includes all 5 process tools in getAllTools', () => {
      const tools = getAllTools();
      expect(tools.length).toBe(13);
      const names = tools.map((t) => t.name);
      expect(names).toContain('run_command');
      expect(names).toContain('start_process');
      expect(names).toContain('read_process_output');
      expect(names).toContain('send_process_input');
      expect(names).toContain('stop_process');
    });

    it('registers and exposes all 5 process tools in ToolRegistry', () => {
      const registry = new ToolRegistry();
      const processTools = getProcessTools();
      for (const t of processTools) {
        registry.register(t);
      }

      expect(registry.getTool('run_command')).toBeDefined();
      expect(registry.getTool('start_process')).toBeDefined();
      expect(registry.getTool('read_process_output')).toBeDefined();
      expect(registry.getTool('send_process_input')).toBeDefined();
      expect(registry.getTool('stop_process')).toBeDefined();

      const defs = registry.getToolDefinitions();
      expect(defs).toHaveLength(5);
    });

    it('shares process state across all tools via the same ProcessManager', async () => {
      const runCmd = new RunCommandTool(undefined, processManager);
      const readOut = new ReadProcessOutputTool(processManager);
      const sendIn = new SendProcessInputTool(processManager);
      const stopProc = new StopProcessTool(processManager);

      const nodeCmd = `"${process.execPath}" -e "process.stdin.on('data', d => { process.stdout.write('UNIFIED:' + d.toString().trim()); });"`;
      const startRes = await processManager.startProcess({
        command: nodeCmd,
        cwd: tempDir,
      });

      const pid = startRes.processId;

      // 1. send input using sendIn tool
      const sendRes = await sendIn.execute({ processId: pid, input: 'HelloUnified' });
      expect(sendRes.success).toBe(true);

      // 2. read output using readOut tool
      let readRes = await readOut.execute({ processId: pid });
      for (let i = 0; i < 30 && !readRes.content.includes('UNIFIED:HelloUnified'); i++) {
        await new Promise((r) => setTimeout(r, 50));
        readRes = await readOut.execute({ processId: pid });
      }
      expect(readRes.success).toBe(true);
      expect(readRes.content).toContain('UNIFIED:HelloUnified');

      // 3. stop using stopProc tool
      const stopRes = await stopProc.execute({ processId: pid });
      expect(stopRes.success).toBe(true);

      // 4. confirm final status
      const finalRead = await readOut.execute({ processId: pid });
      expect(finalRead.metadata?.status).toBe('cancelled');
    });
  });

  describe('Phase 2: Security & Approval Gate Integration', () => {
    let toolRegistry: ToolRegistry;
    let toolExecutor: ToolExecutor;
    let eventBus: AgentEventBus;
    let permissionManager: PermissionManager;
    let policyService: ApprovalPolicyService;
    let approvalGate: ApprovalGate;

    beforeEach(() => {
      eventBus = new AgentEventBus();
      permissionManager = new PermissionManager();
      policyService = new ApprovalPolicyService(new StorageManager(tempDir));
      approvalGate = new ApprovalGate(policyService, permissionManager, eventBus);
      toolRegistry = new ToolRegistry();

      for (const t of getProcessTools()) {
        toolRegistry.register(t);
      }

      toolExecutor = new ToolExecutor(
        toolRegistry,
        permissionManager,
        eventBus,
        approvalGate,
        {
          cwd: tempDir,
          workspaceId: 'ws-proc-phase2-test',
          mode: 'agent',
        },
      );
    });

    it('requires approval for send_process_input and denies when rejected', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_send_deny',
          function: {
            name: 'send_process_input',
            arguments: JSON.stringify({ processId: 'fake_proc', input: 'echo secret' }),
          },
        },
        'exec_phase2_1',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('User denied permission');
    });

    it('requires approval for stop_process and denies when rejected', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_stop_deny',
          function: {
            name: 'stop_process',
            arguments: JSON.stringify({ processId: 'fake_proc' }),
          },
        },
        'exec_phase2_2',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('User denied permission');
    });

    it('blocks send_process_input in Plan mode', async () => {
      toolExecutor.setExecutionContext({ mode: 'plan' });

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_send_plan',
          function: {
            name: 'send_process_input',
            arguments: JSON.stringify({ processId: 'proc_123', input: 'test' }),
          },
        },
        'exec_phase2_plan',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('Plan mode is restricted to read-only');
    });

    it('blocks stop_process in Plan mode', async () => {
      toolExecutor.setExecutionContext({ mode: 'plan' });

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_stop_plan',
          function: {
            name: 'stop_process',
            arguments: JSON.stringify({ processId: 'proc_123' }),
          },
        },
        'exec_phase2_stop_plan',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('Plan mode is restricted to read-only');
    });

    it('allows read_process_output in Plan mode without approval', async () => {
      toolExecutor.setExecutionContext({ mode: 'plan' });
      const record = await ProcessManager.getInstance().runCommand({
        command: 'echo PlanReadTest',
        cwd: tempDir,
      });

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_read_plan',
          function: {
            name: 'read_process_output',
            arguments: JSON.stringify({ processId: record.processId }),
          },
        },
        'exec_phase2_read_plan',
      );

      expect(resp.result.success).toBe(true);
      expect(resp.result.content).toContain('PlanReadTest');
    });

    it('rejects working directory outside workspace boundaries with structured security error', async () => {
      const outsideDir = path.resolve(tempDir, '../outside_dir_exists_' + Date.now());
      await fs.mkdir(outsideDir, { recursive: true });

      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_outside_cwd',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({
              command: 'echo Unsafe',
              cwd: outsideDir,
            }),
          },
        },
        'exec_outside_cwd',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('outside authorized workspace boundaries');

      await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
    });

    it('rejects non-existent working directory with structured error', async () => {
      const nonExistent = path.join(tempDir, 'does_not_exist_xyz_123');
      const resp = await toolExecutor.executeToolCall(
        {
          id: 'call_non_existent_cwd',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({
              command: 'echo NonExistent',
              cwd: nonExistent,
            }),
          },
        },
        'exec_non_existent_cwd',
      );

      expect(resp.result.success).toBe(false);
      expect(resp.result.content).toContain('Working directory does not exist');
    });
  });

  describe('Audit Fixes: findIdleSession, Working Directory Security & Process Bounding', () => {
    it('findIdleSession enforces workspace identity and cwd compatibility before reuse', async () => {
      const { TerminalExecutionManager } = require('../../agent/terminal/terminalExecutionManager');
      const termManager = TerminalExecutionManager.getInstance();

      const dirA = path.join(tempDir, 'sub_dir_a');
      const dirB = path.join(tempDir, 'sub_dir_b');
      await fs.mkdir(dirA, { recursive: true });
      await fs.mkdir(dirB, { recursive: true });

      // Create a session in dirA
      await termManager.executeCommand({
        command: 'echo TestA',
        workspaceId: 'ws_audit',
        cwd: dirA,
      });

      // Session in dirA should NOT be reused for dirB
      const idleForB = termManager.findIdleSession('ws_audit', dirB);
      expect(idleForB).toBeUndefined();

      // Session in dirA SHOULD be reused for dirA
      const idleForA = termManager.findIdleSession('ws_audit', dirA);
      expect(idleForA).toBeDefined();
      expect(path.resolve(idleForA!.cwd).toLowerCase()).toBe(path.resolve(dirA).toLowerCase());

      termManager.dispose();
    });

    it('bounds completed-process history to MAX_COMPLETED_PROCESSES without deleting running processes', async () => {
      const boundedManager = new ProcessManager({ maxCompletedProcesses: 3 });

      // Start 1 running process
      const isWin = process.platform === 'win32';
      const sleepCmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 5"' : 'sleep 5';
      const running = await boundedManager.startProcess({
        command: sleepCmd,
        cwd: tempDir,
      });

      // Complete 5 processes
      const completedIds: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const rec = await boundedManager.runCommand({
          command: `echo Completed_${i}`,
          cwd: tempDir,
        });
        completedIds.push(rec.processId);
      }

      // The running process must still be present
      expect(boundedManager.getProcess(running.processId)).toBeDefined();
      expect(boundedManager.getProcess(running.processId)?.status).toBe('running');

      // Only the last 3 completed processes should remain
      const remainingCompleted = completedIds.filter((id) => boundedManager.getProcess(id) !== undefined);
      expect(remainingCompleted.length).toBe(3);
      expect(boundedManager.getProcess(completedIds[0])).toBeUndefined();
      expect(boundedManager.getProcess(completedIds[1])).toBeUndefined();

      boundedManager.dispose();
    });

    it('TerminalExecutionManager executions are visible and accessible to ProcessManager tools', async () => {
      const { TerminalExecutionManager } = require('../../agent/terminal/terminalExecutionManager');
      const termManager = TerminalExecutionManager.getInstance();

      const execRecord = await termManager.executeCommand({
        command: 'echo UnifiedManagerWorks',
        cwd: tempDir,
      });

      expect(execRecord.status).toBe('completed');

      // The execution must be visible in ProcessManager
      const pmRecord = ProcessManager.getInstance().getProcess(execRecord.executionId);
      expect(pmRecord).toBeDefined();
      expect(pmRecord?.output).toContain('UnifiedManagerWorks');

      // read_process_output tool can retrieve output for that terminal command
      const readTool = new ReadProcessOutputTool(ProcessManager.getInstance());
      const readResult = await readTool.execute({ processId: execRecord.executionId });
      expect(readResult.success).toBe(true);
      expect(readResult.content).toContain('UnifiedManagerWorks');

      termManager.dispose();
    });
  });

  describe('Deep Process Management Audits & Fixes', () => {
    it('waitForExit does not treat child.killed as proof of process termination', async () => {
      const isWin = process.platform === 'win32';
      const sleepCmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 3"' : 'sleep 3';
      const record = await processManager.startProcess({
        command: sleepCmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('running');
      expect(record.child).toBeDefined();

      // Simulate a termination signal having been sent (child.killed = true in Node.js)
      // but the operating system process is still actively running
      (record.child as any).killed = true;

      // In the buggy implementation, waitForExit immediately returned true because child.killed was true!
      // In our fixed implementation, waitForExit verifies actual termination:
      const exited = await (processManager as any).waitForExit(record, 100);
      expect(exited).toBe(false);
      expect(record.status).toBe('running');

      // Now actually stop it
      const stopRes = await processManager.stopProcess(record.processId, { force: true });
      expect(stopRes.success).toBe(true);
      expect(processManager.getProcess(record.processId)?.status).toBe('cancelled');
    });

    it('safely handles repeated stop requests and already-exited processes', async () => {
      const record = await processManager.runCommand({
        command: 'echo ImmediateFinished',
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');

      const stop1 = await processManager.stopProcess(record.processId);
      expect(stop1.success).toBe(true);
      expect(stop1.alreadyExited).toBe(true);
      expect(stop1.status).toBe('completed');

      const stop2 = await processManager.stopProcess(record.processId);
      expect(stop2.success).toBe(true);
      expect(stop2.alreadyExited).toBe(true);
    });

    it('enforces output limits by UTF-8 byte size without corrupting multibyte Unicode code points', async () => {
      const smallManager = new ProcessManager({ maxOutputBytes: 16 });
      // 🚀 is 4 UTF-8 bytes (F0 9F 98 80)
      // 🌟 is 4 UTF-8 bytes (F0 9F 8C 9F)
      // 🎉 is 4 UTF-8 bytes (F0 9F 8E 89)
      // 你 is 3 UTF-8 bytes (E4 BD A0)
      // 好 is 3 UTF-8 bytes (E5 A5 BD)
      // Total = 4 + 4 + 4 + 3 + 3 = 18 bytes
      const nodeCmd = `"${process.execPath}" -e "process.stdout.write('🚀🌟🎉你好');"`;

      const record = await smallManager.runCommand({
        command: nodeCmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');
      expect(record.isTruncated).toBe(true);
      expect(Buffer.byteLength(record.output, 'utf8')).toBeLessThanOrEqual(16);
      // Trimming must NEVER produce the unicode replacement character '\uFFFD'
      expect(record.output).not.toContain('\uFFFD');
      // The output must end cleanly with the last characters emitted
      expect(record.output).toContain('你好');

      smallManager.dispose();
    });

    it('incremental reading with UTF-8 byte cursor never skips or duplicates characters', async () => {
      // String with ASCII and multibyte characters: 'ABC🚀DEF'
      // 'ABC' = 3 bytes [0..3)
      // '🚀' = 4 bytes [3..7)
      // 'DEF' = 3 bytes [7..10)
      // Total = 10 bytes
      const nodeCmd = `"${process.execPath}" -e "process.stdout.write('ABC🚀DEF');"`;
      const record = await processManager.runCommand({
        command: nodeCmd,
        cwd: tempDir,
      });

      // Read chunk 1 with maxBytes: 4.
      // Can fit 'ABC' (3 bytes), but adding '🚀' (4 bytes) would make 7 > 4 bytes.
      // Slicing must not split '🚀', so it returns 'ABC' (3 bytes) with nextIndex = 3.
      const read1 = processManager.getOutput(record.processId, { fromIndex: 0, maxBytes: 4 });
      expect(read1).toBeDefined();
      expect(read1?.output).toBe('ABC');
      expect(read1?.nextIndex).toBe(3);

      // Read chunk 2 from index 3 with maxBytes: 4.
      // Takes '🚀' (4 bytes), nextIndex = 7.
      const read2 = processManager.getOutput(record.processId, { fromIndex: read1!.nextIndex, maxBytes: 4 });
      expect(read2).toBeDefined();
      expect(read2?.output).toBe('🚀');
      expect(read2?.nextIndex).toBe(7);

      // Read chunk 3 from index 7 with maxBytes: 4.
      // Takes 'DEF' (3 bytes) with nextIndex = 10.
      const read3 = processManager.getOutput(record.processId, { fromIndex: read2!.nextIndex, maxBytes: 4 });
      expect(read3).toBeDefined();
      expect(read3?.output).toBe('DEF');
      expect(read3?.nextIndex).toBe(10);

      // Total reconstructed string must exactly equal 'ABC🚀DEF'
      const reconstructed = `${read1!.output}${read2!.output}${read3!.output}`;
      expect(reconstructed).toBe('ABC🚀DEF');
    });

    it('preserves separate stdout and stderr information in ProcessManager and ReadProcessOutputTool', async () => {
      const nodeCmd = `"${process.execPath}" -e "process.stdout.write('STDOUT_LINE_1\\n'); process.stderr.write('STDERR_LINE_2\\n'); process.stdout.write('STDOUT_LINE_3\\n');"`;
      const record = await processManager.runCommand({
        command: nodeCmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');
      expect(record.stdout).toContain('STDOUT_LINE_1');
      expect(record.stdout).toContain('STDOUT_LINE_3');
      expect(record.stdout).not.toContain('STDERR_LINE_2');

      expect(record.stderr).toContain('STDERR_LINE_2');
      expect(record.stderr).not.toContain('STDOUT_LINE_1');

      // Verify chunks have correct stream tags
      const stdoutChunks = record.chunks.filter((c) => c.stream === 'stdout');
      const stderrChunks = record.chunks.filter((c) => c.stream === 'stderr');
      expect(stdoutChunks.length).toBeGreaterThan(0);
      expect(stderrChunks.length).toBeGreaterThan(0);

      // Read via ReadProcessOutputTool
      const readTool = new ReadProcessOutputTool(processManager);

      // 1. Read all streams (combined output without duplicating stderr)
      const resAll = await readTool.execute({ processId: record.processId });
      expect(resAll.success).toBe(true);
      expect(resAll.metadata?.stdout).toContain('STDOUT_LINE_1');
      expect(resAll.metadata?.stderr).toContain('STDERR_LINE_2');
      expect(resAll.content).toContain('--- OUTPUT ---');
      // Verify combined output does not duplicate stderr
      const stderrCount = (resAll.content.match(/STDERR_LINE_2/g) || []).length;
      expect(stderrCount).toBe(1);

      // 2. Read filtered to stderr only
      const resStderr = await readTool.execute({ processId: record.processId, stream: 'stderr' });
      expect(resStderr.success).toBe(true);
      expect(resStderr.content).toContain('--- STDERR ---');
      expect(resStderr.metadata?.output).toContain('STDERR_LINE_2');
      expect(resStderr.metadata?.output).not.toContain('STDOUT_LINE_1');
    });

    it('bounds chunk memory by both chunk count and total chunk byte size', async () => {
      const chunkBoundedManager = new ProcessManager({
        maxChunkBytes: 200,
        maxChunks: 4,
      });

      // Emit 10 chunks of 40 bytes each
      const nodeCmd = `"${process.execPath}" -e "for(let i=1; i<=10; i++) { process.stdout.write('CHUNK_' + i.toString().padStart(30, 'x') + '\\n'); }"`;
      const record = await chunkBoundedManager.runCommand({
        command: nodeCmd,
        cwd: tempDir,
      });

      expect(record.status).toBe('completed');
      expect(record.chunks.length).toBeLessThanOrEqual(4);

      let totalRetainedBytes = 0;
      for (const chunk of record.chunks) {
        totalRetainedBytes += Buffer.byteLength(chunk.text, 'utf8');
      }
      expect(totalRetainedBytes).toBeLessThanOrEqual(200);

      chunkBoundedManager.dispose();
    });

    it('enforces maximum concurrent active processes and releases capacity upon exit', async () => {
      const activeLimitedManager = new ProcessManager({ maxActiveProcesses: 2 });
      const isWin = process.platform === 'win32';
      const sleepCmd = isWin ? 'powershell -Command "Start-Sleep -Seconds 5"' : 'sleep 5';

      // Start 2 active processes
      const p1 = await activeLimitedManager.startProcess({ command: sleepCmd, cwd: tempDir });
      const p2 = await activeLimitedManager.startProcess({ command: sleepCmd, cwd: tempDir });

      expect(p1.status).toBe('running');
      expect(p2.status).toBe('running');
      expect(activeLimitedManager.getActiveProcessCount()).toBe(2);

      // 3rd startProcess must be rejected with active limit error
      const p3 = await activeLimitedManager.startProcess({ command: sleepCmd, cwd: tempDir });
      expect(p3.status).toBe('failed');
      expect(p3.error).toContain('Maximum concurrent active processes limit (2) reached');

      // runCommand must also be rejected
      const pRun = await activeLimitedManager.runCommand({ command: 'echo shouldNotRun', cwd: tempDir });
      expect(pRun.status).toBe('failed');
      expect(pRun.error).toContain('Maximum concurrent active processes limit (2) reached');

      // Stop p1 to release capacity
      const stopRes = await activeLimitedManager.stopProcess(p1.processId);
      expect(stopRes.success).toBe(true);
      expect(activeLimitedManager.getActiveProcessCount()).toBe(1);

      // Now a new process can start successfully
      const p4 = await activeLimitedManager.startProcess({ command: sleepCmd, cwd: tempDir });
      expect(p4.status).toBe('running');
      expect(activeLimitedManager.getActiveProcessCount()).toBe(2);

      activeLimitedManager.dispose();
    });
  });
});
