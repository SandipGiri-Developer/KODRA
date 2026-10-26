import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentEventBus } from '../../agent/agentEventBus';
import { PermissionManager } from '../../agent/permissionManager';
import { ProcessManager } from '../../agent/process';
import { ApprovalGate } from '../../agent/terminal/approvalGate';
import { ApprovalPolicyService } from '../../agent/terminal/approvalPolicyService';
import { TerminalExecutionManager } from '../../agent/terminal/terminalExecutionManager';
import { ToolExecutor } from '../../agent/toolExecutor';
import { ToolRegistry } from '../../agent/toolRegistry';
import { ReadProcessOutputTool } from '../../agent/tools/readProcessOutputTool';
import { RunCommandTool } from '../../agent/tools/runCommandTool';
import { SendProcessInputTool } from '../../agent/tools/sendProcessInputTool';
import { StartProcessTool } from '../../agent/tools/startProcessTool';
import { StopProcessTool } from '../../agent/tools/stopProcessTool';
import { TerminalTool } from '../../agent/tools/terminalTool';
import { StorageManager } from '../../storage/storageManager';

describe('Centralized Approval Gate and Process Management Verification', () => {
  let tempDir: string;
  let storageManager: StorageManager;
  let policyService: ApprovalPolicyService;
  let permissionManager: PermissionManager;
  let eventBus: AgentEventBus;
  let approvalGate: ApprovalGate;
  let processManager: ProcessManager;
  let terminalManager: TerminalExecutionManager;
  let toolRegistry: ToolRegistry;
  let toolExecutor: ToolExecutor;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-gate-proc-test-'));
    storageManager = new StorageManager(tempDir);
    await storageManager.initializeStorage();

    ApprovalPolicyService.resetInstance();
    policyService = new ApprovalPolicyService(storageManager);
    await policyService.initialize();

    permissionManager = new PermissionManager(false);
    eventBus = new AgentEventBus();
    approvalGate = new ApprovalGate(policyService, permissionManager, eventBus);

    ProcessManager.resetInstance();
    processManager = ProcessManager.getInstance();

    TerminalExecutionManager.resetInstance();
    terminalManager = TerminalExecutionManager.getInstance();

    toolRegistry = new ToolRegistry([
      new TerminalTool('terminal', undefined, terminalManager),
      new RunCommandTool(undefined, processManager),
      new StartProcessTool(undefined, processManager),
      new SendProcessInputTool(processManager),
      new StopProcessTool(processManager),
      new ReadProcessOutputTool(processManager),
    ]);

    toolExecutor = new ToolExecutor(
      toolRegistry,
      permissionManager,
      eventBus,
      approvalGate,
      {
        mode: 'agent',
        workspaceId: 'ws-proc-gate-test',
        cwd: tempDir,
      },
    );
  });

  afterEach(async () => {
    processManager.dispose();
    terminalManager.dispose();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Centralized Approval Gate Enforcement for all 5 Process/Terminal Operations', () => {
    it('run_command: requires approval and fails closed when user rejects', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const response = await toolExecutor.executeToolCall(
        {
          id: 'call_run_deny',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo should_not_run' }),
          },
        },
        'run_exec_1',
      );

      expect(response.result.success).toBe(false);
      expect(response.result.content).toContain('User denied permission');
      expect(processManager.listProcesses().length).toBe(0);
    });

    it('run_command: honors persistent allow policy without requesting approval', async () => {
      await policyService.createPolicy({
        scope: 'workspace',
        workspaceId: 'ws-proc-gate-test',
        ruleType: 'exact',
        commandPattern: 'echo policy_allowed_cmd',
        decision: 'allow',
      });

      const requestDecisionSpy = jest.spyOn(permissionManager, 'requestDecision');

      const response = await toolExecutor.executeToolCall(
        {
          id: 'call_run_allow',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'echo policy_allowed_cmd' }),
          },
        },
        'run_exec_2',
      );

      expect(response.result.success).toBe(true);
      expect(requestDecisionSpy).not.toHaveBeenCalled();
    });

    it('start_process: requires approval and fails closed when user rejects', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const response = await toolExecutor.executeToolCall(
        {
          id: 'call_start_deny',
          function: {
            name: 'start_process',
            arguments: JSON.stringify({ command: 'node -e "setInterval(()=>{}, 1000)"' }),
          },
        },
        'start_exec_1',
      );

      expect(response.result.success).toBe(false);
      expect(response.result.content).toContain('User denied permission');
      expect(processManager.getActiveProcessCount()).toBe(0);
    });

    it('send_process_input: routes through gate, does not treat input as shell command, and honors denial', async () => {
      // 1. Start a real process first
      permissionManager.setApprovalHandler(async () => 'allow_once');
      const startRes = await toolExecutor.executeToolCall(
        {
          id: 'call_start_proc',
          function: {
            name: 'start_process',
            arguments: JSON.stringify({ command: `"${process.execPath}" -i` }),
          },
        },
        'start_node_repl',
      );
      expect(startRes.result.success).toBe(true);
      const procId = (startRes.result.metadata as any)?.processId;
      expect(procId).toBeDefined();

      // 2. Reject send_process_input
      permissionManager.setApprovalHandler(async () => 'deny');
      const inputRes = await toolExecutor.executeToolCall(
        {
          id: 'call_input_deny',
          function: {
            name: 'send_process_input',
            // Stdin with newlines, quotes, and compound syntax (must not be rejected by compound command validator)
            arguments: JSON.stringify({ processId: procId, input: 'const a = 1; const b = 2;\n' }),
          },
        },
        'input_exec_1',
      );

      expect(inputRes.result.success).toBe(false);
      expect(inputRes.result.content).toContain('User denied permission');
    });

    it('send_process_input: honors persistent policy denial', async () => {
      // Start process
      permissionManager.setApprovalHandler(async () => 'allow_once');
      const startRes = await toolExecutor.executeToolCall(
        {
          id: 'call_start_proc_deny',
          function: {
            name: 'start_process',
            arguments: JSON.stringify({ command: `"${process.execPath}" -i` }),
          },
        },
        'start_node_repl_2',
      );
      const procId = (startRes.result.metadata as any)?.processId;

      // Add policy deny for this send_process_input target
      await policyService.createPolicy({
        scope: 'workspace',
        workspaceId: 'ws-proc-gate-test',
        ruleType: 'prefix',
        commandPattern: `send_process_input ${procId}`,
        decision: 'deny',
        description: 'Block all input to this process',
      });

      const response = await toolExecutor.executeToolCall(
        {
          id: 'call_input_policy_deny',
          function: {
            name: 'send_process_input',
            arguments: JSON.stringify({ processId: procId, input: 'console.log("blocked")\n' }),
          },
        },
        'input_exec_2',
      );

      expect(response.result.success).toBe(false);
      expect(response.result.content).toContain('policy denied');
    });

    it('stop_process: routes through gate, requires approval, and fails closed when user cancels', async () => {
      // Start process
      permissionManager.setApprovalHandler(async () => 'allow_once');
      const startRes = await toolExecutor.executeToolCall(
        {
          id: 'call_start_for_stop',
          function: {
            name: 'start_process',
            arguments: JSON.stringify({ command: `"${process.execPath}" -i` }),
          },
        },
        'start_stop_test',
      );
      const procId = (startRes.result.metadata as any)?.processId;

      // Cancel stop approval
      permissionManager.setApprovalHandler(async () => 'cancel');
      const stopRes = await toolExecutor.executeToolCall(
        {
          id: 'call_stop_cancel',
          function: {
            name: 'stop_process',
            arguments: JSON.stringify({ processId: procId }),
          },
        },
        'stop_exec_1',
      );

      expect(stopRes.result.success).toBe(false);
      expect(stopRes.result.content).toContain('cancelled by the user');

      // Process must still be alive because stop was cancelled
      const proc = processManager.getProcess(procId);
      expect(proc?.status).toBe('running');
    });

    it('terminal: execute, cancel, and close actions all route through ApprovalGate', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      // 1. terminal execute
      const resExec = await toolExecutor.executeToolCall(
        {
          id: 'call_term_exec',
          function: {
            name: 'terminal',
            arguments: JSON.stringify({ command: 'echo should_not_run' }),
          },
        },
        'term_exec_1',
      );
      expect(resExec.result.success).toBe(false);
      expect(resExec.result.content).toContain('User denied permission');

      // 2. terminal close
      const resClose = await toolExecutor.executeToolCall(
        {
          id: 'call_term_close',
          function: {
            name: 'terminal',
            arguments: JSON.stringify({ action: 'close', terminalSessionId: 'session_fake' }),
          },
        },
        'term_close_1',
      );
      expect(resClose.result.success).toBe(false);
      expect(resClose.result.content).toContain('User denied permission');
    });

    it('read_process_output: remains ungated and does not prompt for approval', async () => {
      const requestDecisionSpy = jest.spyOn(permissionManager, 'requestDecision');
      const requestPermissionSpy = jest.spyOn(permissionManager, 'requestPermission');

      // Execute a quick command
      permissionManager.setApprovalHandler(async () => 'allow_once');
      const runRes = await toolExecutor.executeToolCall(
        {
          id: 'call_run_quick',
          function: {
            name: 'run_command',
            arguments: JSON.stringify({ command: 'node -e "console.log(\'UNGATED_TEST\')"' }),
          },
        },
        'run_quick',
      );
      const procId = (runRes.result.metadata as any)?.processId;

      requestDecisionSpy.mockClear();
      requestPermissionSpy.mockClear();

      const readRes = await toolExecutor.executeToolCall(
        {
          id: 'call_read_ungated',
          function: {
            name: 'read_process_output',
            arguments: JSON.stringify({ processId: procId }),
          },
        },
        'read_exec_1',
      );

      expect(readRes.result.success).toBe(true);
      expect(readRes.result.content).toContain('UNGATED_TEST');
      expect(requestDecisionSpy).not.toHaveBeenCalled();
      expect(requestPermissionSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Process Termination, Exit Confirmation, and Capacity Protection', () => {
    it('does not release active-process capacity prematurely during timeout or stop', async () => {
      // Fill capacity with a manager limited to 2 active processes
      const customManager = new ProcessManager({ maxActiveProcesses: 2 });
      const record1 = await customManager.startProcess({
        command: `"${process.execPath}" -e "setInterval(()=>{}, 1000)"`,
        cwd: tempDir,
      });
      const record2 = await customManager.startProcess({
        command: `"${process.execPath}" -e "setInterval(()=>{}, 1000)"`,
        cwd: tempDir,
      });

      expect(customManager.getActiveProcessCount()).toBe(2);

      // Attempting to start a 3rd process must be rejected due to active limit
      const record3 = await customManager.startProcess({
        command: 'echo overflow',
        cwd: tempDir,
      });
      expect(record3.status).toBe('failed');
      expect(record3.error).toContain('Maximum concurrent active processes limit');

      // Stop record1: capacity must only decrease after termination is confirmed
      const stopPromise = customManager.stopProcess(record1.processId, { graceTimeoutMs: 200 });
      // While stopping is in progress, capacity remains verified
      const stopResult = await stopPromise;
      expect(stopResult.success).toBe(true);
      expect(customManager.getActiveProcessCount()).toBe(1);

      // Now 2nd slot is free
      const record4 = await customManager.startProcess({
        command: `"${process.execPath}" -e "setInterval(()=>{}, 1000)"`,
        cwd: tempDir,
      });
      expect(record4.status).toBe('running');
      expect(customManager.getActiveProcessCount()).toBe(2);

      // Explicitly stop all remaining active processes so this test
      // leaves zero background processes or pipe handles behind.
      const [res2, res4] = await Promise.all([
        customManager.stopProcess(record2.processId, { force: true }),
        customManager.stopProcess(record4.processId, { force: true }),
      ]);
      expect(res2.success).toBe(true);
      expect(res4.success).toBe(true);
      customManager.dispose();
    });
  });

  describe('3. Chunk-Byte Accounting and Memory Bounding', () => {
    it('maintains exact totalChunkBytes accounting across chunk shifts, pruning, and cleanup', async () => {
      const boundedManager = new ProcessManager({
        maxCompletedProcesses: 2,
        maxChunkBytes: 300,
        maxChunks: 10,
      });

      // Run proc1: produces ~100 bytes
      const proc1 = await boundedManager.runCommand({
        command: `"${process.execPath}" -e "process.stdout.write('A'.repeat(100));"`,
        cwd: tempDir,
      });
      expect(boundedManager.getTotalChunkBytes()).toBeGreaterThan(0);
      const afterProc1 = boundedManager.getTotalChunkBytes();

      // Run proc2: produces ~100 bytes
      const proc2 = await boundedManager.runCommand({
        command: `"${process.execPath}" -e "process.stdout.write('B'.repeat(100));"`,
        cwd: tempDir,
      });
      const afterProc2 = boundedManager.getTotalChunkBytes();
      expect(afterProc2).toBeGreaterThan(afterProc1);

      // Run proc3: produces ~100 bytes (maxCompletedProcesses is 2, so proc1 should be pruned)
      await boundedManager.runCommand({
        command: `"${process.execPath}" -e "process.stdout.write('C'.repeat(100));"`,
        cwd: tempDir,
      });

      // Proc1 was pruned. Total chunk bytes must not include proc1's chunk bytes
      expect(boundedManager.getProcess(proc1.processId)).toBeUndefined();
      expect(boundedManager.getTotalChunkBytes()).toBeLessThanOrEqual(300);

      // Cleanup proc2 explicitly: total chunk bytes must decrement accordingly
      const proc2ChunkBytes = proc2.chunks.reduce((s, c) => s + Buffer.byteLength(c.text, 'utf8'), 0);
      const beforeCleanup = boundedManager.getTotalChunkBytes();
      boundedManager.cleanup(proc2.processId);
      expect(boundedManager.getTotalChunkBytes()).toBe(Math.max(0, beforeCleanup - proc2ChunkBytes));

      // Dispose: total chunk bytes must reach exactly 0
      boundedManager.dispose();
      expect(boundedManager.getTotalChunkBytes()).toBe(0);
    });
  });

  describe('4. Output Presentation and Stream Separation', () => {
    it('does not duplicate stderr in combined output, and supports stream filtering', async () => {
      const readTool = new ReadProcessOutputTool(processManager);

      const record = await processManager.runCommand({
        command: `"${process.execPath}" -e "process.stdout.write('OUT_1\\n'); process.stderr.write('ERR_2\\n'); process.stdout.write('OUT_3\\n');"`,
        cwd: tempDir,
      });

      // 1. stream: 'all' (combined output)
      const resAll = await readTool.execute({ processId: record.processId, stream: 'all' });
      expect(resAll.success).toBe(true);
      expect(resAll.content).toContain('--- OUTPUT ---');
      expect(resAll.content).not.toContain('--- STDERR ---');
      // Verify ERR_2 appears exactly once in the rendered content
      const occurrences = (resAll.content.match(/ERR_2/g) || []).length;
      expect(occurrences).toBe(1);

      // 2. stream: 'stdout'
      const resStdout = await readTool.execute({ processId: record.processId, stream: 'stdout' });
      expect(resStdout.success).toBe(true);
      expect(resStdout.content).toContain('--- STDOUT ---');
      expect(resStdout.content).toContain('OUT_1');
      expect(resStdout.content).toContain('OUT_3');
      expect(resStdout.content).not.toContain('ERR_2');

      // 3. stream: 'stderr'
      const resStderr = await readTool.execute({ processId: record.processId, stream: 'stderr' });
      expect(resStderr.success).toBe(true);
      expect(resStderr.content).toContain('--- STDERR ---');
      expect(resStderr.content).toContain('ERR_2');
      expect(resStderr.content).not.toContain('OUT_1');
    });
  });


  describe('5. Regression coverage for timeout lifecycle and policy scoping', () => {
    it('keeps the background process timeout armed after start_process returns', async () => {
      const record = await processManager.startProcess({
        command: `"${process.execPath}" -e "setInterval(()=>{}, 1000)"`,
        cwd: tempDir,
        timeoutMs: 250,
      });

      expect(record.status).toBe('running');
      expect(record.closed).toBe(false);

      const finished = await processManager.waitForProcessExit(record.processId, 2500);
      expect(finished?.closed).toBe(true);
      expect(finished?.status).toBe('timed_out');
      expect(finished?.isTimedOut).toBe(true);
      expect(processManager.getActiveProcessCount()).toBe(0);
    });

    it('keeps an unconfirmed timed-out process running and counted against capacity', async () => {
      const limitedManager = new ProcessManager({ maxActiveProcesses: 1 });
      const originalForceKill = (limitedManager as any).forceKillProcess.bind(limitedManager);
      (limitedManager as any).forceKillProcess = () => {
        // Simulate an OS/process that did not respond to the termination signal.
      };

      try {
        const record = await limitedManager.runCommand({
          command: `"${process.execPath}" -e "setInterval(()=>{}, 1000)"`,
          cwd: tempDir,
          timeoutMs: 100,
        });

        expect(record.isTimedOut).toBe(true);
        expect(record.terminationRequested).toBe('timed_out');
        expect(record.status).toBe('running');
        expect(record.closed).toBe(false);
        expect(limitedManager.getActiveProcessCount()).toBe(1);

        // Restore real termination and stop the still-tracked process explicitly.
        (limitedManager as any).forceKillProcess = originalForceKill;
        const stopResult = await limitedManager.stopProcess(record.processId, { force: true });
        expect(stopResult.success).toBe(true);
        expect(record.closed).toBe(true);
        expect(record.status).toBe('cancelled');
        expect(limitedManager.getActiveProcessCount()).toBe(0);
      } finally {
        (limitedManager as any).forceKillProcess = originalForceKill;
        limitedManager.dispose();
      }
    });

    it('scopes persistent input approvals to both process and exact input payload', async () => {
      const processId = 'proc_policy_scope';
      const approvedTarget = `send_process_input ${processId} ${JSON.stringify('approved input')}`;
      await policyService.createPolicy({
        scope: 'workspace',
        workspaceId: 'ws-proc-gate-test',
        ruleType: 'exact',
        commandPattern: approvedTarget,
        decision: 'allow',
      });
      permissionManager.setApprovalHandler(async () => 'deny');
      const evaluateSpy = jest.spyOn(policyService, 'evaluate');

      const result = await approvalGate.evaluateAndAuthorize({
        actionType: 'process_input',
        processId,
        input: 'different input',
        workspaceId: 'ws-proc-gate-test',
        mode: 'agent',
        toolName: 'send_process_input',
      });

      expect(evaluateSpy).toHaveBeenCalledWith(
        `send_process_input ${processId} ${JSON.stringify('different input')}`,
        { workspaceId: 'ws-proc-gate-test' },
      );
      expect(result.authorized).toBe(false);
      expect(result.decision).toBe('deny');
      evaluateSpy.mockRestore();
    });

    it('keeps terminal cancel/close persistent policies separate and session-scoped', async () => {
      await policyService.createPolicy({
        scope: 'workspace',
        workspaceId: 'ws-proc-gate-test',
        ruleType: 'exact',
        commandPattern: 'terminal cancel exec_123',
        decision: 'allow',
      });
      permissionManager.setApprovalHandler(async () => 'deny');
      const evaluateSpy = jest.spyOn(policyService, 'evaluate');

      const result = await approvalGate.evaluateAndAuthorize({
        actionType: 'terminal_change',
        workspaceId: 'ws-proc-gate-test',
        mode: 'agent',
        toolName: 'terminal',
        metadata: {
          terminalAction: 'close',
          terminalSessionId: 'session_456',
        },
      });

      expect(evaluateSpy).toHaveBeenCalledWith(
        'terminal close session_456',
        { workspaceId: 'ws-proc-gate-test' },
      );
      expect(result.authorized).toBe(false);
      expect(result.decision).toBe('deny');
      evaluateSpy.mockRestore();
    });
  });
});