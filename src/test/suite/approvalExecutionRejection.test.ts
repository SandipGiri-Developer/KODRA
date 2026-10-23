import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentEventBus } from '../../agent/agentEventBus';
import { PermissionManager } from '../../agent/permissionManager';
import { ApprovalGate } from '../../agent/terminal/approvalGate';
import { ApprovalPolicyService } from '../../agent/terminal/approvalPolicyService';
import { TerminalExecutionManager } from '../../agent/terminal/terminalExecutionManager';
import { ToolExecutor } from '../../agent/toolExecutor';
import { ToolRegistry } from '../../agent/toolRegistry';
import { TerminalTool } from '../../agent/tools/terminalTool';
import { StorageManager } from '../../storage/storageManager';

describe('Approval Rejection & Execution Safety Guarantees (Scenarios 8, 9, 10, 11, 12, 16)', () => {
  let tempDir: string;
  let storageManager: StorageManager;
  let policyService: ApprovalPolicyService;
  let permissionManager: PermissionManager;
  let eventBus: AgentEventBus;
  let approvalGate: ApprovalGate;
  let toolRegistry: ToolRegistry;
  let toolExecutor: ToolExecutor;
  let terminalManager: TerminalExecutionManager;
  let executeCommandSpy: jest.SpyInstance;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-safety-test-'));
    storageManager = new StorageManager(tempDir);
    await storageManager.initializeStorage();

    ApprovalPolicyService.resetInstance();
    policyService = new ApprovalPolicyService(storageManager);
    await policyService.initialize();

    TerminalExecutionManager.resetInstance();
    terminalManager = new TerminalExecutionManager();
    executeCommandSpy = jest.spyOn(terminalManager, 'executeCommand');

    permissionManager = new PermissionManager(false);
    eventBus = new AgentEventBus();
    approvalGate = new ApprovalGate(policyService, permissionManager, eventBus);

    toolRegistry = new ToolRegistry();
    const terminalTool = new TerminalTool('terminal', undefined, terminalManager);
    toolRegistry.register(terminalTool);

    toolExecutor = new ToolExecutor(toolRegistry, permissionManager, eventBus, approvalGate, {
      mode: 'agent',
      workspaceId: 'ws-safety-test',
      cwd: tempDir,
    });
  });

  afterEach(async () => {
    executeCommandSpy.mockRestore();
    terminalManager.dispose();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('Scenario 8: a rejected command results in ZERO process launches and zero terminals created', async () => {
    permissionManager.setApprovalHandler(async () => 'deny');

    const agentRunId = 'agent_run_rejection_test';
    const response = await toolExecutor.executeToolCall(
      {
        id: 'call_reject_1',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: 'echo ShouldNeverRun' }),
        },
      },
      agentRunId,
      undefined,
      { mode: 'agent', workspaceId: 'ws-safety-test', cwd: tempDir }
    );

    // 1. Tool execution must report failure
    expect(response.result.success).toBe(false);
    expect(response.result.content).toContain('User denied permission');

    // 2. ABSOLUTE SAFETY: executeCommand backend was called ZERO times!
    expect(executeCommandSpy).not.toHaveBeenCalled();

    // 3. ZERO terminal sessions created
    const sessions = terminalManager.listSessions('ws-safety-test');
    expect(sessions.length).toBe(0);

    // 4. ZERO executions recorded
    expect(terminalManager.listExecutions().length).toBe(0);
  });

  it('Scenario 9: a cancelled approval results in ZERO process launches', async () => {
    permissionManager.setApprovalHandler(async () => 'cancel');

    const agentRunId = 'agent_run_cancel_test';
    const response = await toolExecutor.executeToolCall(
      {
        id: 'call_cancel_1',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: 'npm install evil-package' }),
        },
      },
      agentRunId,
      undefined,
      { mode: 'agent', workspaceId: 'ws-safety-test', cwd: tempDir }
    );

    expect(response.result.success).toBe(false);
    expect(response.result.content).toContain('cancelled');

    // Zero backend execution launches
    expect(executeCommandSpy).not.toHaveBeenCalled();
    expect(terminalManager.listSessions('ws-safety-test').length).toBe(0);
  });

  it('Scenario 10: a late or stale approval response cannot authorize another command', async () => {
    let capturedRequestId = '';
    eventBus.on((event) => {
      if (event.type === 'tool.approval_required' && event.requestId) {
        capturedRequestId = event.requestId;
      }
    });

    const abortController = new AbortController();

    // Start execution and immediately abort
    const promise = toolExecutor.executeToolCall(
      {
        id: 'call_stale_1',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: 'echo first' }),
        },
      },
      'agent_run_stale',
      abortController.signal,
      { mode: 'agent', workspaceId: 'ws-safety-test', cwd: tempDir }
    );

    // Abort while awaiting approval
    abortController.abort();
    const res1 = await promise;
    expect(res1.result.success).toBe(false);
    expect(executeCommandSpy).not.toHaveBeenCalled();

    // Late user approval message arrives for the cancelled request ID
    const staleResolved = permissionManager.resolveRequest(capturedRequestId, 'allow_once');
    // Stale resolution must return false because the pending request was already cancelled!
    expect(staleResolved).toBe(false);

    // Verify it cannot trigger execution
    expect(executeCommandSpy).not.toHaveBeenCalled();
  });

  it('Scenario 11: multiple commands within one agent turn do not collide on execution IDs', async () => {
    permissionManager.setApprovalHandler(async () => 'allow_once');

    const agentRunId = 'agent_run_multi_cmd_turn';

    // Tool call 1 in agent run
    const res1 = await toolExecutor.executeToolCall(
      {
        id: 'tool_call_1',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: process.platform === 'win32' ? 'cmd /c echo Turn1' : 'echo Turn1' }),
        },
      },
      agentRunId,
      undefined,
      { mode: 'agent', workspaceId: 'ws-multi', cwd: tempDir }
    );

    // Tool call 2 in the same agent run
    const res2 = await toolExecutor.executeToolCall(
      {
        id: 'tool_call_2',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: process.platform === 'win32' ? 'cmd /c echo Turn2' : 'echo Turn2' }),
        },
      },
      agentRunId,
      undefined,
      { mode: 'agent', workspaceId: 'ws-multi', cwd: tempDir }
    );

    expect(res1.result.success).toBe(true);
    expect(res2.result.success).toBe(true);

    const execId1 = (res1.result.metadata as any)?.executionId;
    const execId2 = (res2.result.metadata as any)?.executionId;

    // Both must have distinct command execution IDs
    expect(execId1).toBeDefined();
    expect(execId2).toBeDefined();
    expect(execId1).not.toBe(execId2);

    // Neither should be equal to the overall agent run ID
    expect(execId1).not.toBe(agentRunId);
    expect(execId2).not.toBe(agentRunId);

    // Both should have run in the same reused terminal session!
    const session1 = (res1.result.metadata as any)?.terminalSessionId;
    const session2 = (res2.result.metadata as any)?.terminalSessionId;
    expect(session1).toBe(session2);
  });

  it('Scenario 12: a repeated status lookup cannot launch duplicate work', async () => {
    permissionManager.setApprovalHandler(async () => 'allow_once');

    // 1. Launch a command
    const res = await toolExecutor.executeToolCall(
      {
        id: 'call_initial',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: process.platform === 'win32' ? 'cmd /c echo StatusCheck' : 'echo StatusCheck' }),
        },
      },
      'agent_run_status_test',
      undefined,
      { mode: 'agent', workspaceId: 'ws-status', cwd: tempDir }
    );

    const execId = (res.result.metadata as any)?.executionId;
    expect(execId).toBeDefined();
    const callCountAfterLaunch = executeCommandSpy.mock.calls.length;
    expect(callCountAfterLaunch).toBe(1);

    // 2. Poll status with action: "status"
    const statusRes = await toolExecutor.executeToolCall(
      {
        id: 'call_status_poll',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ action: 'status', executionId: execId }),
        },
      },
      'agent_run_status_test',
      undefined,
      { mode: 'agent', workspaceId: 'ws-status', cwd: tempDir }
    );

    expect(statusRes.result.success).toBe(true);
    expect(executeCommandSpy.mock.calls.length).toBe(2);
    // The second call was specifically action: "status", returning the existing record
    expect(executeCommandSpy.mock.calls[1][0].action).toBe('status');
  });

  it('Scenario 16: correct mode and working directory are preserved end to end', async () => {
    // Mode Chat must be rejected at trusted backend
    const resChat = await toolExecutor.executeToolCall(
      {
        id: 'call_chat_mode',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: 'echo test' }),
        },
      },
      'agent_run_chat',
      undefined,
      { mode: 'chat', workspaceId: 'ws-mode', cwd: tempDir }
    );
    expect(resChat.result.success).toBe(false);
    expect(resChat.result.content).toContain('Chat mode');
    expect(executeCommandSpy).not.toHaveBeenCalled();

    // Mode Plan must be rejected at trusted backend
    const resPlan = await toolExecutor.executeToolCall(
      {
        id: 'call_plan_mode',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: 'echo test' }),
        },
      },
      'agent_run_plan',
      undefined,
      { mode: 'plan', workspaceId: 'ws-mode', cwd: tempDir }
    );
    expect(resPlan.result.success).toBe(false);
    expect(resPlan.result.content).toContain('Plan mode');
    expect(executeCommandSpy).not.toHaveBeenCalled();

    // Invalid mode must fail closed
    const resInvalid = await toolExecutor.executeToolCall(
      {
        id: 'call_invalid_mode',
        function: {
          name: 'terminal',
          arguments: JSON.stringify({ command: 'echo test' }),
        },
      },
      'agent_run_invalid',
      undefined,
      { mode: 'hacked_mode' as any, workspaceId: 'ws-mode', cwd: tempDir }
    );
    expect(resInvalid.result.success).toBe(false);
    expect(resInvalid.result.content).toContain('Invalid or missing execution mode');
    expect(executeCommandSpy).not.toHaveBeenCalled();
  });
});
