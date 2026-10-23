import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PermissionManager } from '../../agent/permissionManager';
import { ApprovalGate } from '../../agent/terminal/approvalGate';
import { ApprovalPolicyService } from '../../agent/terminal/approvalPolicyService';
import { StorageManager } from '../../storage/storageManager';

describe('ApprovalGate (AC4, AC5, AC8, AC13)', () => {
  let tempDir: string;
  let storageManager: StorageManager;
  let policyService: ApprovalPolicyService;
  let permissionManager: PermissionManager;
  let gate: ApprovalGate;
  const wsId = 'ws-test-gate';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-gate-test-'));
    storageManager = new StorageManager(tempDir);
    await storageManager.initializeStorage();
    ApprovalPolicyService.resetInstance();
    policyService = new ApprovalPolicyService(storageManager);
    await policyService.initialize();
    permissionManager = new PermissionManager(false);
    gate = new ApprovalGate(policyService, permissionManager);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Mode Restrictions (AC13)', () => {
    it('blocks command execution in Chat mode without evaluating or prompting', async () => {
      const res = await gate.evaluateAndAuthorize({
        command: 'echo hello',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'chat',
      });

      expect(res.authorized).toBe(false);
      expect(res.reason).toContain('Chat mode');
      expect(permissionManager.hasPendingRequests()).toBe(false);
    });

    it('blocks command execution in Plan mode without evaluating or prompting', async () => {
      const res = await gate.evaluateAndAuthorize({
        command: 'npm install',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'plan',
      });

      expect(res.authorized).toBe(false);
      expect(res.reason).toContain('Plan mode');
      expect(permissionManager.hasPendingRequests()).toBe(false);
    });

    it('allows Agent and Goal modes to proceed to policy evaluation / approval', async () => {
      await policyService.createPolicy({
        scope: 'global',
        commandPattern: 'echo permitted',
        ruleType: 'exact',
        decision: 'allow',
      });

      const resAgent = await gate.evaluateAndAuthorize({
        command: 'echo permitted',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });
      expect(resAgent.authorized).toBe(true);

      const resGoal = await gate.evaluateAndAuthorize({
        command: 'echo permitted',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'goal',
      });
      expect(resGoal.authorized).toBe(true);
    });
  });

  describe('Approval Decision Resolution (AC4, AC5, AC6, AC7, AC8)', () => {
    it('AC5: allow_once executes without creating persistent policy', async () => {
      permissionManager.setApprovalHandler(async (req) => {
        expect(req.command).toBe('git status');
        return 'allow_once';
      });

      const res = await gate.evaluateAndAuthorize({
        command: 'git status',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });

      expect(res.authorized).toBe(true);
      expect(res.decision).toBe('allow_once');

      // Verify ZERO policies were saved
      const globalPolicies = await policyService.listPolicies({ scope: 'global' });
      const wsPolicies = await policyService.listPolicies({ workspaceId: wsId });
      expect(globalPolicies.length).toBe(0);
      expect(wsPolicies.length).toBe(0);
    });

    it('AC6: always_allow_global executes AND creates persistent global policy', async () => {
      permissionManager.setApprovalHandler(async () => 'always_allow_global');

      const res = await gate.evaluateAndAuthorize({
        command: 'git fetch',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });

      expect(res.authorized).toBe(true);
      expect(res.decision).toBe('always_allow_global');

      // Verify policy was persisted globally
      const globalPolicies = await policyService.listPolicies({ scope: 'global' });
      expect(globalPolicies.length).toBe(1);
      expect(globalPolicies[0].commandPattern).toBe('git fetch');

      // Clear approval handler to prove next execution auto-authorizes via policy
      permissionManager.setApprovalHandler(null);
      const nextRes = await gate.evaluateAndAuthorize({
        command: 'git fetch',
        cwd: '/test',
        workspaceId: 'other-workspace',
        mode: 'agent',
      });
      expect(nextRes.authorized).toBe(true);
      expect(nextRes.decision).toBe('policy_allowed');
    });

    it('AC7: always_allow_workspace executes AND creates persistent workspace policy', async () => {
      permissionManager.setApprovalHandler(async () => 'always_allow_workspace');

      const res = await gate.evaluateAndAuthorize({
        command: 'cargo check',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });

      expect(res.authorized).toBe(true);
      expect(res.decision).toBe('always_allow_workspace');

      // Verify policy was persisted ONLY in wsId
      const wsPolicies = await policyService.listPolicies({ workspaceId: wsId });
      expect(wsPolicies.length).toBe(1);
      expect(wsPolicies[0].commandPattern).toBe('cargo check');

      const otherWsPolicies = await policyService.listPolicies({ workspaceId: 'diff-ws' });
      expect(otherWsPolicies.length).toBe(0);
    });

    it('AC8: deny does not execute command and creates no policy', async () => {
      permissionManager.setApprovalHandler(async () => 'deny');

      const res = await gate.evaluateAndAuthorize({
        command: 'rm -rf node_modules',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });

      expect(res.authorized).toBe(false);
      expect(res.decision).toBe('deny');

      const policies = await policyService.listPolicies();
      expect(policies.length).toBe(0);
    });

    it('AC8: cancel does not execute command and creates no policy', async () => {
      permissionManager.setApprovalHandler(async () => 'cancel');

      const res = await gate.evaluateAndAuthorize({
        command: 'npm publish',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });

      expect(res.authorized).toBe(false);
      expect(res.decision).toBe('cancel');

      const policies = await policyService.listPolicies();
      expect(policies.length).toBe(0);
    });

    it('supports asynchronous resolveLatest via event loop tick', async () => {
      const promise = gate.evaluateAndAuthorize({
        command: 'git pull',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
      });

      // Allow async policy evaluation (disk read) to finish and enter requestDecision
      await new Promise((r) => setTimeout(r, 25));
      expect(permissionManager.hasPendingRequests()).toBe(true);
      permissionManager.resolveLatest('allow_once');

      const res = await promise;
      expect(res.authorized).toBe(true);
      expect(res.decision).toBe('allow_once');
    });

    it('emits tool.approval_required to eventBus when user decision is needed', async () => {
      const { AgentEventBus } = require('../../agent/agentEventBus');
      const eventBus = new AgentEventBus();
      const emittedEvents: any[] = [];
      eventBus.on((event: any) => emittedEvents.push(event));

      const gateWithBus = new ApprovalGate(policyService, permissionManager, eventBus);

      const promise = gateWithBus.evaluateAndAuthorize({
        command: 'echo "Hello"',
        cwd: '/test',
        workspaceId: wsId,
        mode: 'agent',
        executionId: 'exec_test_1',
      });

      await new Promise((r) => setTimeout(r, 25));

      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].type).toBe('tool.approval_required');
      expect(emittedEvents[0].command).toBe('echo "Hello"');
      expect(emittedEvents[0].executionId).toBe('exec_test_1');
      expect(emittedEvents[0].requestId).toBeDefined();

      permissionManager.resolveLatest('allow_once');
      const res = await promise;
      expect(res.authorized).toBe(true);
    });
  });
});
