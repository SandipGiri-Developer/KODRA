import * as vscode from 'vscode';
import { MAX_OUTPUT_LENGTH, TerminalExecutionManager } from '../../agent/terminal/terminalExecutionManager';

describe('TerminalExecutionManager (AC1, AC2, AC3, AC14)', () => {
  let manager: TerminalExecutionManager;

  beforeEach(() => {
    TerminalExecutionManager.resetInstance();
    manager = new TerminalExecutionManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('AC1: executes commands with stable execution IDs and terminal associations', async () => {
    const echoCmd = process.platform === 'win32' ? 'cmd /c echo TerminalExecutionWorks' : 'echo TerminalExecutionWorks';
    const executionId = 'stable-exec-101';

    const record = await manager.executeCommand({
      executionId,
      command: echoCmd,
    });

    expect(record.executionId).toBe(executionId);
    expect(record.terminalId).toBeDefined();
    expect(record.terminalName).toContain('Kodra:');
    expect(record.status).toBe('completed');
    expect(record.exitCode).toBe(0);
    expect(record.output).toContain('TerminalExecutionWorks');
  });

  it('AC2: reveals the exact terminal associated with execution ID', async () => {
    const echoCmd = process.platform === 'win32' ? 'cmd /c echo RevealTest' : 'echo RevealTest';
    const executionId = 'reveal-exec-202';

    await manager.executeCommand({
      executionId,
      command: echoCmd,
    });

    // Reveal should succeed for tracked terminal
    const revealed = manager.revealTerminal(executionId);
    // In test environment, reveal returns true if terminal was created in map
    expect(revealed).toBe(true);

    // Reveal returns false for unknown execution ID
    const notRevealed = manager.revealTerminal('non-existent-id');
    expect(notRevealed).toBe(false);
  });

  it('AC3: handles status checks without launching duplicate commands', async () => {
    const executionId = 'idempotent-exec-303';
    // Sleep for a short time
    const sleepCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 2 > nul' : 'sleep 1';

    const firstPromise = manager.executeCommand({
      executionId,
      command: sleepCmd,
    });

    // Second immediate check with same executionId
    const secondCall = await manager.executeCommand({
      executionId,
      command: sleepCmd,
    });

    // Both should refer to the same running execution
    expect(secondCall.executionId).toBe(executionId);
    expect(secondCall.status).toBe('running');

    await firstPromise;
  });

  it('AC3: supports cancellation targeting the specific process', async () => {
    const executionId = 'cancel-exec-404';
    const longCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 10 > nul' : 'sleep 10';

    const ac = new AbortController();
    const promise = manager.executeCommand({
      executionId,
      command: longCmd,
      signal: ac.signal,
    });

    // Abort after a moment
    setTimeout(() => {
      ac.abort();
    }, 50);

    const record = await promise;
    expect(record.status).toBe('cancelled');
    expect(record.output).toContain('Cancelled');
  });

  it('AC3: bounds captured output to MAX_OUTPUT_LENGTH', async () => {
    // Generate a record directly and verify appendOutput bounds
    const record = {
      executionId: 'bound-test',
      terminalId: 'term-bound',
      terminalName: 'Kodra: Test',
      command: 'echo huge',
      cwd: '/test',
      status: 'running' as const,
      startTime: Date.now(),
      output: 'A'.repeat(MAX_OUTPUT_LENGTH + 500),
      isTruncated: false,
    };

    (manager as any).appendOutput(record, 'B'.repeat(100));
    expect(record.output.length).toBe(MAX_OUTPUT_LENGTH);
    expect(record.isTruncated).toBe(true);
  });

  it('AC14: non-zero exit code marks execution as failed without crashing', async () => {
    const failCmd = process.platform === 'win32' ? 'cmd /c exit 42' : 'sh -c "exit 42"';
    const record = await manager.executeCommand({
      command: failCmd,
    });

    expect(record.status).toBe('failed');
    expect(record.exitCode).toBe(42);
    expect(record.error).toContain('42');
  });

  it('Scenario 1 & 2: repeated commands reuse the same compatible idle terminal', async () => {
    const echoCmd1 = process.platform === 'win32' ? 'cmd /c echo First' : 'echo First';
    const echoCmd2 = process.platform === 'win32' ? 'cmd /c echo Second' : 'echo Second';

    const r1 = await manager.executeCommand({
      command: echoCmd1,
      workspaceId: 'ws-reuse-test',
    });

    expect(r1.status).toBe('completed');
    const sessionId1 = r1.terminalSessionId;
    expect(sessionId1).toBeDefined();

    // Verify session is now idle
    const sessionInfo1 = manager.getSession(sessionId1);
    expect(sessionInfo1?.isBusy).toBe(false);

    // Second command in same workspace should reuse session 1
    const r2 = await manager.executeCommand({
      command: echoCmd2,
      workspaceId: 'ws-reuse-test',
    });

    expect(r2.status).toBe('completed');
    expect(r2.terminalSessionId).toBe(sessionId1);
    expect(r2.executionId).not.toBe(r1.executionId);

    // Only 1 session exists
    const sessions = manager.listSessions('ws-reuse-test');
    expect(sessions.length).toBe(1);
    expect(sessions[0].completedExecutionsCount).toBe(2);
  });

  it('Scenario 3: a busy terminal is not given a second command concurrently', async () => {
    const longCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 5 > nul' : 'sleep 5';

    // Start long-running command with waitMs = 50ms so it returns running
    const r1 = await manager.executeCommand({
      command: longCmd,
      workspaceId: 'ws-busy-test',
      waitMs: 50,
    });

    expect(r1.status).toBe('running');
    const sessId = r1.terminalSessionId;

    // Attempting to inject a second command into the same busy terminal must throw
    await expect(
      manager.executeCommand({
        command: 'echo ShouldFail',
        terminalSessionId: sessId,
        workspaceId: 'ws-busy-test',
      })
    ).rejects.toThrow(/currently busy/i);

    // Clean up running process
    manager.cancelExecution(r1.executionId);
  });

  it('Scenario 4: the agent can wait for a running command and retrieve its eventual result', async () => {
    const sleepEcho = `node -e "setTimeout(() => console.log('EventualSuccess'), 400)"`;

    const r1 = await manager.executeCommand({
      command: sleepEcho,
      waitMs: 50, // Non-blocking: returns while running
    });

    expect(r1.status).toBe('running');
    expect(r1.exitCode).toBeUndefined();

    // Agent uses action "wait" to await completion
    const r2 = await manager.executeCommand({
      action: 'wait',
      executionId: r1.executionId,
      waitMs: 5000,
    });

    expect(r2.status).toBe('completed');
    expect(r2.exitCode).toBe(0);
    expect(r2.output).toContain('EventualSuccess');
  }, 15000);

  it('Scenario 5: the agent can stop an obsolete KODRA-owned task and verify its termination', async () => {
    const longCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 15 > nul' : 'sleep 15';

    const r1 = await manager.executeCommand({
      command: longCmd,
      waitMs: 50,
    });
    expect(r1.status).toBe('running');

    // Agent stops obsolete task
    const stopped = await manager.executeCommand({
      action: 'cancel',
      executionId: r1.executionId,
    });

    expect(stopped.status).toBe('cancelled');
    expect(stopped.output).toContain('Cancelled');

    // Terminal session returns to idle
    const sess = manager.getSession(r1.terminalSessionId);
    expect(sess?.isBusy).toBe(false);
  });

  it('Scenario 6: a terminal selected for preservation remains revealable after command completion', async () => {
    const echoCmd = process.platform === 'win32' ? 'cmd /c echo Preserved' : 'echo Preserved';

    const r = await manager.executeCommand({
      command: echoCmd,
      preserveTerminal: true,
    });

    expect(r.status).toBe('completed');
    const revealed = manager.revealTerminal(r.terminalSessionId);
    expect(revealed).toBe(true);

    const revealedByExec = manager.revealTerminal(r.executionId);
    expect(revealedByExec).toBe(true);
  });

  it('Scenario 7: a terminal selected for closure closes without losing the captured command result', async () => {
    const echoCmd = process.platform === 'win32' ? 'cmd /c echo ResultPreserved' : 'echo ResultPreserved';

    const r = await manager.executeCommand({
      command: echoCmd,
      preserveTerminal: false, // Close when finished
    });

    expect(r.status).toBe('completed');
    expect(r.output).toContain('ResultPreserved');

    // Session is marked closed
    const sess = manager.getSession(r.terminalSessionId);
    expect(sess?.isClosed).toBe(true);

    // Record is still fully intact and retrievable
    const record = manager.getExecution(r.executionId);
    expect(record).toBeDefined();
    expect(record?.output).toContain('ResultPreserved');
    expect(record?.status).toBe('completed');
  });

  it('Scenario 13 & 14: running command is not reported as failed or exit code 0, non-zero exits distinguished', async () => {
    const longCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 5 > nul' : 'sleep 5';

    const runningRecord = await manager.executeCommand({
      command: longCmd,
      waitMs: 50,
    });

    // Truthful running state: exitCode is undefined, status is running
    expect(runningRecord.status).toBe('running');
    expect(runningRecord.exitCode).toBeUndefined();

    manager.cancelExecution(runningRecord.executionId);
  });

  it('Scenario 15: terminal reveal targets exact session without fallback to unrelated sessions', async () => {
    const echoCmd1 = process.platform === 'win32' ? 'cmd /c echo Term1' : 'echo Term1';
    const echoCmd2 = process.platform === 'win32' ? 'cmd /c echo Term2' : 'echo Term2';

    // Force 2 separate sessions using isolated: true
    const r1 = await manager.executeCommand({
      command: echoCmd1,
      isolated: true,
    });
    const r2 = await manager.executeCommand({
      command: echoCmd2,
      isolated: true,
    });

    expect(r1.terminalSessionId).not.toBe(r2.terminalSessionId);

    // Reveal terminal 1 specifically
    expect(manager.revealTerminal(r1.executionId)).toBe(true);
    expect(manager.revealTerminal(r1.terminalSessionId)).toBe(true);

    // Reveal terminal 2 specifically
    expect(manager.revealTerminal(r2.executionId)).toBe(true);
    expect(manager.revealTerminal(r2.terminalSessionId)).toBe(true);

    // Non-existent ID returns false without falling back
    expect(manager.revealTerminal('non_existent_exec_xyz')).toBe(false);
  });

  it('Scenario 19: user-closing a terminal externally cleans up owned resources safely', async () => {
    const longCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 10 > nul' : 'sleep 10';

    const r = await manager.executeCommand({
      command: longCmd,
      waitMs: 50,
    });

    expect(r.status).toBe('running');
    const session = manager.getSession(r.terminalSessionId);
    expect(session?.isBusy).toBe(true);

    // Get mock terminal and simulate external close event from VS Code
    const internalSession = (manager as any).sessions.get(r.terminalSessionId);
    const mockTerminal = internalSession.terminal;
    (vscode.window as any)._triggerCloseTerminal(mockTerminal);

    // Session is now closed and not busy
    const afterClose = manager.getSession(r.terminalSessionId);
    expect(afterClose?.isClosed).toBe(true);
    expect(afterClose?.isBusy).toBe(false);

    // Running execution transitioned to unknown
    const execAfter = manager.getExecution(r.executionId);
    expect(execAfter?.status).toBe('unknown');
    expect(execAfter?.error).toContain('closed externally');
  });
});
