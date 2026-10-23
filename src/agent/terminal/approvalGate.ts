/**
 * Centralized Approval Gate for Kodra.
 * 
 * Intercepts all terminal command executions before they start:
 * 1. Enforces strict mode restrictions (Chat is non-autonomous, Plan is read-only).
 * 2. Evaluates persistent approval policies (explicit denials, workspace, global).
 * 3. Requests 4-way user decisions when required.
 * 4. Persists policies only when the user explicitly chooses 'always_allow_*'.
 */

import { IAgentEventBus } from '../agentEventBus';
import { IPermissionManager } from '../permissionManager';
import { PermissionRequest } from '../types';
import { CommandMatcher } from './commandMatcher';
import {
  ApprovalDecisionType,
  GateAuthorizationRequest,
  GateAuthorizationResult,
  IApprovalGate,
  IApprovalPolicyService,
} from './types';

export class ApprovalGate implements IApprovalGate {
  constructor(
    private readonly policyService: IApprovalPolicyService,
    private readonly permissionManager: IPermissionManager,
    private eventBus?: IAgentEventBus,
  ) {}

  public setEventBus(eventBus: IAgentEventBus): void {
    this.eventBus = eventBus;
  }

  public async evaluateAndAuthorize(
    request: GateAuthorizationRequest,
    signal?: AbortSignal,
  ): Promise<GateAuthorizationResult> {
    const command = (request.command || '').trim();
    if (!command) {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Command cannot be empty.',
      };
    }

    // ─── 1. Command Safety Validation (AC10) ─────────────────────────────────
    if (CommandMatcher.isCompoundCommand(command)) {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Chained or compound commands (&&, ;, ||, |, newlines) are prohibited for safety.',
      };
    }

    if (CommandMatcher.hasUnbalancedQuotes(command)) {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Command has unbalanced quotes or dangling escape characters.',
      };
    }

    const mode = (request.mode || '').toLowerCase();

    // ─── 2. Enforce Mode Restrictions (AC13) ─────────────────────────────────
    if (mode === 'chat') {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Autonomous command execution is not permitted in Chat mode. Switch to Agent mode to execute commands.',
      };
    }

    if (mode === 'plan') {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Command execution is prohibited in Plan mode. Plan mode is restricted to read-only architecture and specification analysis.',
      };
    }

    if (!['agent', 'goal'].includes(mode)) {
      return {
        authorized: false,
        decision: 'deny',
        reason: `Command execution is not permitted in mode: "${request.mode}". Only Agent or Goal mode is permitted.`,
      };
    }

    if (signal?.aborted) {
      return {
        authorized: false,
        decision: 'cancel',
        reason: 'Execution was cancelled before evaluation.',
      };
    }

    // ─── 2. Evaluate Persistent Policies (AC6, AC7, AC11) ───────────────────
    const evalResult = await this.policyService.evaluate(request.command, {
      workspaceId: request.workspaceId,
    });

    if (evalResult.decision === 'deny') {
      return {
        authorized: false,
        decision: 'policy_denied',
        reason: evalResult.reason,
        matchedPolicyId: evalResult.matchedPolicy?.id,
      };
    }

    if (evalResult.decision === 'allow') {
      return {
        authorized: true,
        decision: 'policy_allowed',
        reason: evalResult.reason,
        matchedPolicyId: evalResult.matchedPolicy?.id,
      };
    }

    // ─── 3. Request User Approval Decision (AC4, AC5, AC8) ───────────────────
    const requestId = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const permReq: PermissionRequest = {
      requestId,
      executionId: request.executionId || `exec_${Date.now()}`,
      toolCallId: request.toolCallId || `tc_${Date.now()}`,
      toolName: 'terminal',
      command: request.command,
      cwd: request.cwd,
      workspaceId: request.workspaceId,
      mode: request.mode,
      description: request.description || `Execute command: "${request.command}"`,
    };

    const isAuto =
      'isAutoApprove' in this.permissionManager &&
      typeof (this.permissionManager as any).isAutoApprove === 'function'
        ? (this.permissionManager as any).isAutoApprove()
        : false;

    if (this.eventBus && !isAuto) {
      this.eventBus.emit({
        type: 'tool.approval_required',
        executionId: permReq.executionId,
        toolCallId: permReq.toolCallId || '',
        toolName: 'terminal',
        description: permReq.description,
        command: permReq.command,
        requestId,
        timestamp: Date.now(),
      });
    }

    const userDecision = await this.permissionManager.requestDecision(permReq, signal);

    if (signal?.aborted || userDecision === 'cancel') {
      return {
        authorized: false,
        decision: 'cancel',
        reason: 'Execution was cancelled by the user.',
      };
    }

    if (userDecision === 'deny') {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'User denied permission to execute the command.',
      };
    }

    if (userDecision === 'allow_once') {
      // AC5: Allow once executes the pending command WITHOUT creating a persistent policy
      return {
        authorized: true,
        decision: 'allow_once',
      };
    }

    if (userDecision === 'always_allow_global') {
      // AC6: Create persistent global allow policy
      try {
        const policy = await this.policyService.createPolicy({
          scope: 'global',
          commandPattern: request.command,
          ruleType: 'exact',
          decision: 'allow',
          description: `Always allow globally: "${request.command}"`,
        });
        return {
          authorized: true,
          decision: 'always_allow_global',
          matchedPolicyId: policy.id,
        };
      } catch (err: any) {
        // Fall back to allow_once if persistence fails, but allow execution
        return {
          authorized: true,
          decision: 'allow_once',
          reason: `Policy persistence failed: ${err.message}`,
        };
      }
    }

    if (userDecision === 'always_allow_workspace') {
      // AC7: Create persistent workspace-scoped allow policy
      try {
        const policy = await this.policyService.createPolicy({
          scope: 'workspace',
          workspaceId: request.workspaceId,
          commandPattern: request.command,
          ruleType: 'exact',
          decision: 'allow',
          description: `Always allow in workspace: "${request.command}"`,
        });
        return {
          authorized: true,
          decision: 'always_allow_workspace',
          matchedPolicyId: policy.id,
        };
      } catch (err: any) {
        return {
          authorized: true,
          decision: 'allow_once',
          reason: `Policy persistence failed: ${err.message}`,
        };
      }
    }

    // Default conservative fallback
    return {
      authorized: false,
      decision: 'deny',
      reason: 'Unrecognized approval decision.',
    };
  }

  public resolvePendingDecision(
    requestId: string,
    decision: ApprovalDecisionType,
  ): boolean {
    return this.permissionManager.resolveRequest(requestId, decision);
  }

  public cancelAll(): void {
    this.permissionManager.cancelAll();
  }

  public hasPending(): boolean {
    return this.permissionManager.hasPendingRequests();
  }
}
