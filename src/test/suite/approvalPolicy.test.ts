import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ApprovalPolicyService } from '../../agent/terminal/approvalPolicyService';
import { StorageManager } from '../../storage/storageManager';

describe('ApprovalPolicyService (AC6, AC7, AC9, AC12)', () => {
  let tempDir: string;
  let storageManager: StorageManager;
  let service: ApprovalPolicyService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-policy-test-'));
    storageManager = new StorageManager(tempDir);
    await storageManager.initializeStorage();
    ApprovalPolicyService.resetInstance();
    service = new ApprovalPolicyService(storageManager);
    await service.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates and lists global policies surviving simulated reload (AC6, AC9, AC12)', async () => {
    const created = await service.createPolicy({
      scope: 'global',
      commandPattern: 'git status',
      ruleType: 'prefix',
      decision: 'allow',
      description: 'Global git status',
    });

    expect(created.id).toBeDefined();
    expect(created.scope).toBe('global');
    expect(created.commandPattern).toBe('git status');

    // List policies
    const list = await service.listPolicies({ scope: 'global' });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);

    // Simulate reload by creating a fresh service instance with the same storage
    const reloadedService = new ApprovalPolicyService(storageManager);
    await reloadedService.initialize();

    const reloadedList = await reloadedService.listPolicies({ scope: 'global' });
    expect(reloadedList.length).toBe(1);
    expect(reloadedList[0].commandPattern).toBe('git status');
  });

  it('creates and isolates workspace-specific policies (AC7, AC12)', async () => {
    const ws1 = 'workspace-alpha';
    const ws2 = 'workspace-beta';

    const p1 = await service.createPolicy({
      scope: 'workspace',
      workspaceId: ws1,
      commandPattern: 'npm test',
      ruleType: 'exact',
      decision: 'allow',
    });

    // Query ws1
    const listWs1 = await service.listPolicies({ workspaceId: ws1 });
    expect(listWs1.length).toBe(1);
    expect(listWs1[0].id).toBe(p1.id);

    // Query ws2: must be isolated and empty
    const listWs2 = await service.listPolicies({ workspaceId: ws2 });
    expect(listWs2.length).toBe(0);

    // Evaluate in ws1 vs ws2
    const evalWs1 = await service.evaluate('npm test', { workspaceId: ws1 });
    expect(evalWs1.decision).toBe('allow');

    const evalWs2 = await service.evaluate('npm test', { workspaceId: ws2 });
    expect(evalWs2.decision).toBe('require_approval');
  });

  it('updates, enables, disables, and deletes policies via typed API (AC9)', async () => {
    const p = await service.createPolicy({
      scope: 'global',
      commandPattern: 'git fetch',
      ruleType: 'prefix',
      decision: 'allow',
    });

    // Disable
    const disabled = await service.enablePolicy(p.id, false);
    expect(disabled.enabled).toBe(false);

    // Disabled policy does not authorize command
    const evalDisabled = await service.evaluate('git fetch', { workspaceId: 'any' });
    expect(evalDisabled.decision).toBe('require_approval');

    // Update commandPattern
    const updated = await service.updatePolicy(p.id, {
      commandPattern: 'git pull',
      enabled: true,
    });
    expect(updated.commandPattern).toBe('git pull');
    expect(updated.enabled).toBe(true);

    // Delete
    const deleted = await service.deletePolicy(p.id);
    expect(deleted).toBe(true);

    const afterDelete = await service.getPolicy(p.id);
    expect(afterDelete).toBeNull();
  });

  it('prevents accidental duplicate policies (AC9)', async () => {
    const p1 = await service.createPolicy({
      scope: 'global',
      commandPattern: 'cargo test',
      ruleType: 'prefix',
      decision: 'allow',
    });

    const p2 = await service.createPolicy({
      scope: 'global',
      commandPattern: 'cargo test',
      ruleType: 'prefix',
      decision: 'allow',
    });

    expect(p1.id).toBe(p2.id);
    const list = await service.listPolicies({ scope: 'global' });
    expect(list.length).toBe(1);
  });

  it('gracefully handles missing or corrupted storage files without crashing (AC12, AC14)', async () => {
    // Write invalid JSON into global policy file
    const globalFile = path.join(storageManager.configDir, 'approval_policies.json');
    await fs.writeFile(globalFile, 'MALFORMED_JSON_CONTENT{{{', 'utf-8');

    const freshService = new ApprovalPolicyService(storageManager);
    await freshService.initialize();

    // Should recover with empty policies without throwing
    const list = await freshService.listPolicies({ scope: 'global' });
    expect(list.length).toBe(0);
  });

  it('prevents path traversal through workspace IDs and validates containment', async () => {
    // Attempting path traversal in workspaceId
    await expect(
      service.createPolicy({
        scope: 'workspace',
        workspaceId: '../../etc',
        commandPattern: 'git status',
      })
    ).rejects.toThrow(/path traversal/i);

    await expect(
      service.createPolicy({
        scope: 'workspace',
        workspaceId: 'sub/folder',
        commandPattern: 'git status',
      })
    ).rejects.toThrow(/path traversal/i);

    await expect(
      service.listPolicies({
        scope: 'workspace',
        workspaceId: '../escaped',
      })
    ).rejects.toThrow(/path traversal/i);
  });

  it('re-enables an existing disabled duplicate policy when an allow rule is requested', async () => {
    // 1. Create a policy
    const p1 = await service.createPolicy({
      scope: 'global',
      commandPattern: 'npm test',
      ruleType: 'exact',
      decision: 'allow',
      enabled: true,
    });
    expect(p1.enabled).toBe(true);

    // 2. Disable it
    await service.enablePolicy(p1.id, false);
    const disabled = await service.getPolicy(p1.id);
    expect(disabled?.enabled).toBe(false);

    // 3. User requests "Always Allow" again -> duplicate should be re-enabled!
    const reAllowed = await service.createPolicy({
      scope: 'global',
      commandPattern: 'npm test',
      ruleType: 'exact',
      decision: 'allow',
      enabled: true,
    });
    expect(reAllowed.id).toBe(p1.id);
    expect(reAllowed.enabled).toBe(true);

    const check = await service.getPolicy(p1.id);
    expect(check?.enabled).toBe(true);
  });

  it('prohibits persistent policy creation for compound or chained commands', async () => {
    await expect(
      service.createPolicy({
        scope: 'global',
        commandPattern: 'npm test && rm -rf /',
        ruleType: 'prefix',
        decision: 'allow',
      })
    ).rejects.toThrow(/compound/i);
  });

  it('rejects invalid policy schema objects during creation and update', async () => {
    await expect(
      service.createPolicy({
        scope: 'global',
        commandPattern: '',
      })
    ).rejects.toThrow();

    const p = await service.createPolicy({
      scope: 'global',
      commandPattern: 'pytest',
      ruleType: 'exact',
      decision: 'allow',
    });

    await expect(
      service.updatePolicy(p.id, {
        commandPattern: 'pytest && echo bad',
      })
    ).rejects.toThrow(/compound/i);
  });

  it('supports migrating policy scope between global and workspace', async () => {
    const wsId = 'workspace-gamma';
    const globalPolicy = await service.createPolicy({
      scope: 'global',
      commandPattern: 'eslint .',
      ruleType: 'exact',
      decision: 'allow',
    });

    expect(globalPolicy.scope).toBe('global');

    // Migrate from global to workspace
    const migratedToWs = await service.updatePolicy(globalPolicy.id, {
      scope: 'workspace',
      workspaceId: wsId,
    });
    expect(migratedToWs.scope).toBe('workspace');
    expect(migratedToWs.workspaceId).toBe(wsId);

    // Verify it is no longer in global list
    const globals = await service.listPolicies({ scope: 'global' });
    expect(globals.find((p) => p.id === globalPolicy.id)).toBeUndefined();

    // Verify it is in workspace list
    const wsList = await service.listPolicies({ scope: 'workspace', workspaceId: wsId });
    expect(wsList.find((p) => p.id === globalPolicy.id)).toBeDefined();

    // Migrate back from workspace to global
    const migratedBackToGlobal = await service.updatePolicy(globalPolicy.id, {
      scope: 'global',
    });
    expect(migratedBackToGlobal.scope).toBe('global');
    expect(migratedBackToGlobal.workspaceId).toBeUndefined();

    const globalsAfter = await service.listPolicies({ scope: 'global' });
    expect(globalsAfter.find((p) => p.id === globalPolicy.id)).toBeDefined();
  });
});

