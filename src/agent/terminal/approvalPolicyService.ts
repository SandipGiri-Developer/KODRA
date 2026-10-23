/**
 * Persistent Approval Policy Service for Kodra.
 * 
 * Reuses Kodra's StorageManager infrastructure to provide atomic,
 * isolated, and validated persistence for global and workspace-scoped approval policies.
 * 
 * Supports typed CRUD operations ready for the future Settings interface.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageManager } from '../../storage/storageManager';
import { Logger } from '../../utils/logger';
import { CommandMatcher } from './commandMatcher';
import {
  ApprovalPolicy,
  CreatePolicyInput,
  IApprovalPolicyService,
  PolicyEvaluationResult,
  PolicyScope,
  UpdatePolicyInput,
} from './types';

const POLICY_SCHEMA_VERSION = 1;

import * as os from 'os';

export class ApprovalPolicyService implements IApprovalPolicyService {
  private static instance: ApprovalPolicyService | null = null;
  private readonly logger = Logger.getInstance();
  private initialized = false;
  private readonly storageManager: StorageManager;

  // In-memory policy caches by scope:
  // globalPolicies: cache for global policies
  private globalPolicies: Map<string, ApprovalPolicy> = new Map();
  // workspacePolicies: Map<workspaceId, Map<policyId, ApprovalPolicy>>
  private workspacePolicies: Map<string, Map<string, ApprovalPolicy>> = new Map();

  constructor(storageManager?: StorageManager) {
    if (storageManager) {
      this.storageManager = storageManager;
    } else {
      try {
        this.storageManager = StorageManager.getInstance();
      } catch {
        const fallbackDir = path.join(os.tmpdir(), 'kodra-policy-storage');
        this.storageManager = StorageManager.initialize(fallbackDir);
      }
    }
  }

  public static getInstance(storageManager?: StorageManager): ApprovalPolicyService {
    if (!ApprovalPolicyService.instance || (storageManager && ApprovalPolicyService.instance.storageManager !== storageManager)) {
      let sm = storageManager;
      if (!sm) {
        try {
          sm = StorageManager.getInstance();
        } catch {
          const fallbackDir = path.join(os.tmpdir(), 'kodra-policy-storage');
          sm = StorageManager.initialize(fallbackDir);
        }
      }
      ApprovalPolicyService.instance = new ApprovalPolicyService(sm);
    }
    return ApprovalPolicyService.instance;
  }

  /**
   * Reset the singleton instance (primarily for isolated test suites).
   */
  public static resetInstance(): void {
    ApprovalPolicyService.instance = null;
  }

  public validateWorkspaceId(workspaceId: string): string {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('Workspace ID must be a non-empty string.');
    }
    const trimmed = workspaceId.trim();
    if (!trimmed || trimmed === '.' || trimmed.includes('..') || /[/\\]/.test(trimmed)) {
      throw new Error(`Invalid workspace ID "${workspaceId}": path traversal characters are prohibited.`);
    }
    const resolved = path.resolve(this.storageManager.workspacesDir, trimmed);
    const rel = path.relative(this.storageManager.workspacesDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Invalid workspace ID "${workspaceId}": traverses outside of workspace storage directory.`);
    }
    return trimmed;
  }

  private getGlobalFilePath(): string {
    return path.join(this.storageManager.configDir, 'approval_policies.json');
  }

  private getWorkspaceFilePath(workspaceId: string): string {
    const safeId = this.validateWorkspaceId(workspaceId);
    return path.join(this.storageManager.workspacesDir, safeId, 'approval_policies.json');
  }

  /**
   * Initialize and load existing policies into memory.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.storageManager.initializeStorage();
    await this.loadGlobalPolicies();
    this.initialized = true;
  }

  /**
   * Load global policies safely from storage.
   */
  private async loadGlobalPolicies(): Promise<void> {
    const file = this.getGlobalFilePath();
    try {
      const records = await this.storageManager.readJson<ApprovalPolicy[]>(file, []);
      this.globalPolicies.clear();
      for (const rec of records) {
        if (this.isValidPolicy(rec)) {
          this.globalPolicies.set(rec.id, rec);
        }
      }
    } catch (err) {
      this.logger.error('Failed to load global approval policies; initializing empty', err);
      this.globalPolicies.clear();
    }
  }

  /**
   * Ensure workspace policies are loaded for a specific workspace.
   */
  private async ensureWorkspaceLoaded(workspaceId: string): Promise<Map<string, ApprovalPolicy>> {
    const safeId = this.validateWorkspaceId(workspaceId);
    if (this.workspacePolicies.has(safeId)) {
      return this.workspacePolicies.get(safeId)!;
    }

    const wsMap = new Map<string, ApprovalPolicy>();
    this.workspacePolicies.set(safeId, wsMap);

    const file = this.getWorkspaceFilePath(safeId);
    try {
      const records = await this.storageManager.readJson<ApprovalPolicy[]>(file, []);
      for (const rec of records) {
        if (this.isValidPolicy(rec) && rec.scope === 'workspace') {
          // Verify workspace policy belongs to the workspace directory from which it is loaded
          if (!rec.workspaceId || rec.workspaceId === safeId) {
            rec.workspaceId = safeId;
            wsMap.set(rec.id, rec);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Failed to load workspace policies for ${safeId}; initializing empty`, err);
    }

    return wsMap;
  }

  /**
   * Validate policy record schema.
   */
  public isValidPolicy(policy: any): policy is ApprovalPolicy {
    if (!policy || typeof policy !== 'object') {
      return false;
    }
    if (typeof policy.id !== 'string' || !policy.id.trim()) {
      return false;
    }
    if (typeof policy.commandPattern !== 'string' || !policy.commandPattern.trim()) {
      return false;
    }
    if (policy.scope !== 'global' && policy.scope !== 'workspace') {
      return false;
    }
    if (policy.scope === 'workspace' && (!policy.workspaceId || typeof policy.workspaceId !== 'string')) {
      return false;
    }
    if (policy.decision !== 'allow' && policy.decision !== 'deny') {
      return false;
    }
    if (policy.ruleType !== 'exact' && policy.ruleType !== 'prefix' && policy.ruleType !== 'pattern') {
      return false;
    }
    if (policy.ruleType === 'pattern') {
      try {
        const regexStr = '^' + policy.commandPattern.trim()
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*') + '$';
        new RegExp(regexStr);
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * List policies with optional filtering by scope, workspaceId, or enabled state.
   */
  public async listPolicies(query?: {
    scope?: PolicyScope;
    workspaceId?: string;
    enabled?: boolean;
  }): Promise<ApprovalPolicy[]> {
    await this.initialize();

    const results: ApprovalPolicy[] = [];

    // Collect global policies if not restricted to workspace-only
    if (!query?.scope || query.scope === 'global') {
      for (const p of this.globalPolicies.values()) {
        if (query?.enabled === undefined || p.enabled === query.enabled) {
          results.push({ ...p });
        }
      }
    }

    // Collect workspace policies
    if (!query?.scope || query.scope === 'workspace') {
      if (query?.workspaceId) {
        const wsMap = await this.ensureWorkspaceLoaded(query.workspaceId);
        for (const p of wsMap.values()) {
          if (query?.enabled === undefined || p.enabled === query.enabled) {
            results.push({ ...p });
          }
        }
      } else {
        // Collect across all loaded workspaces
        for (const wsMap of this.workspacePolicies.values()) {
          for (const p of wsMap.values()) {
            if (query?.enabled === undefined || p.enabled === query.enabled) {
              results.push({ ...p });
            }
          }
        }
      }
    }

    // Return sorted by creation timestamp descending
    return results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  /**
   * Get an individual policy by ID.
   */
  public async getPolicy(id: string): Promise<ApprovalPolicy | null> {
    await this.initialize();

    if (this.globalPolicies.has(id)) {
      return { ...this.globalPolicies.get(id)! };
    }

    for (const wsMap of this.workspacePolicies.values()) {
      if (wsMap.has(id)) {
        return { ...wsMap.get(id)! };
      }
    }

    return null;
  }

  /**
   * Create and persist a new policy. Prevents accidental duplicate policies.
   */
  public async createPolicy(input: CreatePolicyInput): Promise<ApprovalPolicy> {
    await this.initialize();

    const commandPattern = input.commandPattern?.trim();
    if (!commandPattern) {
      throw new Error('Policy commandPattern cannot be empty.');
    }

    // Safety check: Prohibit compound commands from persistent policies
    if (CommandMatcher.isCompoundCommand(commandPattern)) {
      throw new Error('Cannot create persistent approval policy for chained or compound commands.');
    }

    const scope = input.scope;
    let safeWorkspaceId: string | undefined;
    if (scope === 'workspace') {
      if (!input.workspaceId || !input.workspaceId.trim()) {
        throw new Error('Workspace ID is required for workspace-scoped policies.');
      }
      safeWorkspaceId = this.validateWorkspaceId(input.workspaceId);
    }

    const ruleType = input.ruleType || 'prefix';
    const decision = input.decision || 'allow';
    const enabled = input.enabled ?? true;
    const description = input.description?.trim() || `${decision.toUpperCase()} ${commandPattern}`;

    // Check for accidental duplicate
    const existingPolicies = await this.listPolicies({
      scope,
      workspaceId: safeWorkspaceId,
    });

    const duplicate = existingPolicies.find(
      (p) =>
        p.commandPattern === commandPattern &&
        p.ruleType === ruleType &&
        p.decision === decision,
    );

    if (duplicate) {
      // If user requests an enabled policy, but existing duplicate was disabled, re-enable it!
      if (enabled && !duplicate.enabled) {
        const now = new Date().toISOString();
        if (scope === 'global') {
          const actual = this.globalPolicies.get(duplicate.id);
          if (actual) {
            actual.enabled = true;
            actual.updatedAt = now;
          }
          await this.persistGlobalPolicies();
        } else {
          const wsMap = await this.ensureWorkspaceLoaded(safeWorkspaceId!);
          const actual = wsMap.get(duplicate.id);
          if (actual) {
            actual.enabled = true;
            actual.updatedAt = now;
          }
          await this.persistWorkspacePolicies(safeWorkspaceId!);
        }
        duplicate.enabled = true;
      }
      return { ...duplicate };
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : `pol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const policy: ApprovalPolicy = {
      id,
      schemaVersion: POLICY_SCHEMA_VERSION,
      scope,
      workspaceId: scope === 'workspace' ? safeWorkspaceId : undefined,
      ruleType,
      commandPattern,
      decision,
      enabled,
      description,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.isValidPolicy(policy)) {
      throw new Error('Policy object failed schema validation.');
    }

    if (scope === 'global') {
      this.globalPolicies.set(id, policy);
      try {
        await this.persistGlobalPolicies();
      } catch (err) {
        this.globalPolicies.delete(id);
        throw err;
      }
    } else {
      const wsMap = await this.ensureWorkspaceLoaded(safeWorkspaceId!);
      wsMap.set(id, policy);
      try {
        await this.persistWorkspacePolicies(safeWorkspaceId!);
      } catch (err) {
        wsMap.delete(id);
        throw err;
      }
    }

    this.logger.info(`[ApprovalPolicyService] Created policy id=${id} scope=${scope} pattern="${commandPattern}"`);
    return { ...policy };
  }

  // Updates an existing approval policy by ID with validation, scope migration, and atomic rollback on persistence failure.
  public async updatePolicy(id: string, updates: UpdatePolicyInput): Promise<ApprovalPolicy> {
    await this.initialize();

    let targetPolicy: ApprovalPolicy | null = null;
    let targetMap: Map<string, ApprovalPolicy> | null = null;
    let workspaceId: string | undefined;

    if (this.globalPolicies.has(id)) {
      targetPolicy = this.globalPolicies.get(id)!;
      targetMap = this.globalPolicies;
    } else {
      for (const [wsId, wsMap] of this.workspacePolicies.entries()) {
        if (wsMap.has(id)) {
          targetPolicy = wsMap.get(id)!;
          targetMap = wsMap;
          workspaceId = wsId;
          break;
        }
      }
    }

    if (!targetPolicy || !targetMap) {
      throw new Error(`Policy not found with id: "${id}"`);
    }

    const newCommandPattern = updates.commandPattern?.trim() ?? targetPolicy.commandPattern;
    if (newCommandPattern && CommandMatcher.isCompoundCommand(newCommandPattern)) {
      throw new Error('Cannot update policy to chained or compound command pattern.');
    }

    const previous = { ...targetPolicy };
    const targetScope = updates.scope ?? targetPolicy.scope;
    const isScopeChange = targetScope !== targetPolicy.scope;

    const updated: ApprovalPolicy = {
      ...targetPolicy,
      scope: targetScope,
      workspaceId: targetScope === 'workspace' ? (updates.workspaceId ?? targetPolicy.workspaceId) : undefined,
      ruleType: updates.ruleType ?? targetPolicy.ruleType,
      commandPattern: newCommandPattern,
      decision: updates.decision ?? targetPolicy.decision,
      enabled: updates.enabled ?? targetPolicy.enabled,
      description: updates.description?.trim() ?? targetPolicy.description,
      updatedAt: new Date().toISOString(),
    };

    if (targetScope === 'workspace' && !updated.workspaceId) {
      throw new Error('Workspace ID is required when updating policy to workspace scope.');
    }

    if (!this.isValidPolicy(updated)) {
      throw new Error('Updated policy object failed schema validation.');
    }

    if (!isScopeChange) {
      targetMap.set(id, updated);
      try {
        if (updated.scope === 'global') {
          await this.persistGlobalPolicies();
        } else if (workspaceId) {
          await this.persistWorkspacePolicies(workspaceId);
        }
      } catch (err) {
        targetMap.set(id, previous);
        throw err;
      }
      return { ...updated };
    }

    // Handle atomic scope migration between global and workspace
    if (previous.scope === 'global' && targetScope === 'workspace') {
      const targetWsId = this.validateWorkspaceId(updated.workspaceId!);
      const targetWsMap = await this.ensureWorkspaceLoaded(targetWsId);
      this.globalPolicies.delete(id);
      targetWsMap.set(id, updated);

      try {
        await this.persistGlobalPolicies();
        await this.persistWorkspacePolicies(targetWsId);
      } catch (err) {
        this.globalPolicies.set(id, previous);
        targetWsMap.delete(id);
        throw err;
      }
      return { ...updated };
    } else {
      const prevWsId = workspaceId!;
      targetMap.delete(id);
      this.globalPolicies.set(id, updated);

      try {
        await this.persistWorkspacePolicies(prevWsId);
        await this.persistGlobalPolicies();
      } catch (err) {
        targetMap.set(id, previous);
        this.globalPolicies.delete(id);
        throw err;
      }
      return { ...updated };
    }
  }

  /**
   * Delete an existing policy.
   */
  public async deletePolicy(id: string): Promise<boolean> {
    await this.initialize();

    if (this.globalPolicies.has(id)) {
      const existing = this.globalPolicies.get(id)!;
      this.globalPolicies.delete(id);
      try {
        await this.persistGlobalPolicies();
        return true;
      } catch (err) {
        this.globalPolicies.set(id, existing);
        throw err;
      }
    }

    for (const [wsId, wsMap] of this.workspacePolicies.entries()) {
      if (wsMap.has(id)) {
        const existing = wsMap.get(id)!;
        wsMap.delete(id);
        try {
          await this.persistWorkspacePolicies(wsId);
          return true;
        } catch (err) {
          wsMap.set(id, existing);
          throw err;
        }
      }
    }

    return false;
  }

  /**
   * Enable or disable an existing policy.
   */
  public async enablePolicy(id: string, enabled: boolean): Promise<ApprovalPolicy> {
    return this.updatePolicy(id, { enabled });
  }

  /**
   * Evaluate a command against all applicable global and workspace policies.
   */
  public async evaluate(
    command: string,
    context: { workspaceId: string },
  ): Promise<PolicyEvaluationResult> {
    await this.initialize();

    const wsMap = context.workspaceId ? await this.ensureWorkspaceLoaded(context.workspaceId) : new Map();
    const allApplicable: ApprovalPolicy[] = [
      ...Array.from(this.globalPolicies.values()),
      ...Array.from(wsMap.values()),
    ];

    return CommandMatcher.evaluatePolicies(command, allApplicable, context.workspaceId);
  }

  private async persistGlobalPolicies(): Promise<void> {
    const file = this.getGlobalFilePath();
    const records = Array.from(this.globalPolicies.values());
    await this.storageManager.writeAtomicJson(file, records);
  }

  private async persistWorkspacePolicies(workspaceId: string): Promise<void> {
    const file = this.getWorkspaceFilePath(workspaceId);
    const wsMap = this.workspacePolicies.get(workspaceId);
    const records = wsMap ? Array.from(wsMap.values()) : [];
    await this.storageManager.writeAtomicJson(file, records);
  }
}
