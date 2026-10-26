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

import { ProcessManager } from '../process/processManager';

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
    const actionType = request.actionType ?? 'command';
    const mode = (request.mode || '').toLowerCase();

    // ─── 1. Enforce Mode Restrictions (AC13) ─────────────────────────────────
    if (mode === 'chat') {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Autonomous execution is not permitted in Chat mode. Switch to Agent mode to execute actions.',
      };
    }

    if (mode === 'plan') {
      return {
        authorized: false,
        decision: 'deny',
        reason: 'Action execution is prohibited in Plan mode. Plan mode is restricted to read-only architecture and specification analysis.',
      };
    }

    if (!['agent', 'goal'].includes(mode)) {
      return {
        authorized: false,
        decision: 'deny',
        reason: `Execution is not permitted in mode: "${request.mode}". Only Agent or Goal mode is permitted.`,
      };
    }

    if (signal?.aborted) {
      return {
        authorized: false,
        decision: 'cancel',
        reason: 'Execution was cancelled before evaluation.',
      };
    }

    // ─── 2. Action-Specific Validation & Policy Target ───────────────────────
    let policyTarget = '';

    if (actionType === 'command' || actionType === 'process_start') {
      const command = (request.command || '').trim();
      if (!command) {
        return {
          authorized: false,
          decision: 'deny',
          reason: 'Command cannot be empty.',
        };
      }

      // Command Safety Validation (AC10)
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

      policyTarget = command;
    } else if (actionType === 'process_input') {
      const processId = (request.processId || '').trim();
      if (!processId) {
        return {
          authorized: false,
          decision: 'deny',
          reason: 'Missing processId for send_process_input.',
        };
      }

      // Match persistent approval to the actual payload, not only a process ID.
      // Otherwise "always allow" could authorize arbitrary future input to that process.
      policyTarget = `send_process_input ${processId} ${JSON.stringify(request.input ?? '')}`;
    } else if (actionType === 'process_stop') {
      const processId = (request.processId || '').trim();
      if (!processId) {
        return {
          authorized: false,
          decision: 'deny',
          reason: 'Missing processId for stop_process.',
        };
      }

      // Keep graceful and forceful termination permissions distinct.
      policyTarget = `stop_process ${processId} ${request.metadata?.force === true ? 'force' : 'graceful'}`;
    } else if (actionType === 'terminal_change') {
      // A persistent approval for cancel must not authorize close (or vice versa).
      const terminalAction =
        typeof request.metadata?.terminalAction === 'string'
          ? request.metadata.terminalAction.trim()
          : 'change';
      const identifier =
        terminalAction === 'close'
          ? request.metadata?.terminalSessionId || request.metadata?.terminalExecutionId
          : request.metadata?.terminalExecutionId || request.metadata?.terminalSessionId;
      policyTarget = `terminal ${terminalAction || 'change'} ${identifier || '<missing-id>'}`;
    } else {
      policyTarget = request.command || actionType;
    }

    // ─── 3. Evaluate Persistent Policies (AC6, AC7, AC11) ───────────────────
    let evalResult;
    try {
      evalResult = await this.policyService.evaluate(policyTarget, {
        workspaceId: request.workspaceId,
      });
    } catch (err: any) {
      // Fail closed on evaluation error
      return {
        authorized: false,
        decision: 'deny',
        reason: `Policy evaluation failed: ${err.message}`,
      };
    }

    if (evalResult.decision === 'deny') {
      return {
        authorized: false,
        decision: 'policy_denied',
        reason: evalResult.reason,
        matchedPolicyId: evalResult.matchedPolicy?.id,
      };
    }

    if (evalResult.decision === 'allow') {
      // If allowed by policy, still ensure process actions target KODRA-managed processes
      if (actionType === 'process_input' && request.processId) {
        const proc = ProcessManager.getInstance().getProcess(request.processId.trim());
        if (!proc) {
          return {
            authorized: false,
            decision: 'deny',
            reason: `Process "${request.processId}" not found. Only active KODRA-managed processes can receive input.`,
          };
        }
        if (proc.status !== 'running') {
          return {
            authorized: false,
            decision: 'deny',
            reason: `Process "${request.processId}" is not running (status: ${proc.status}).`,
          };
        }
      } else if (actionType === 'process_stop' && request.processId) {
        const proc = ProcessManager.getInstance().getProcess(request.processId.trim());
        if (!proc) {
          return {
            authorized: false,
            decision: 'deny',
            reason: `Process "${request.processId}" not found. Only KODRA-managed processes can be terminated.`,
          };
        }
      }

      return {
        authorized: true,
        decision: 'policy_allowed',
        reason: evalResult.reason,
        matchedPolicyId: evalResult.matchedPolicy?.id,
      };
    }

    // ─── 4. Request User Approval Decision (AC4, AC5, AC8) ───────────────────
    const requestId = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const permReq: PermissionRequest = {
      requestId,
      executionId: request.executionId || `exec_${Date.now()}`,
      toolCallId: request.toolCallId || `tc_${Date.now()}`,
      toolName: request.toolName || 'terminal',
      command: request.command || policyTarget,
      cwd: request.cwd,
      workspaceId: request.workspaceId,
      mode: request.mode,
      description: request.description || `Execute ${actionType}: "${policyTarget}"`,
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
        toolName: permReq.toolName,
        description: permReq.description,
        command: permReq.command,
        requestId,
        timestamp: Date.now(),
      });
    }

    let userDecision: ApprovalDecisionType;
    try {
      userDecision = await this.permissionManager.requestDecision(permReq, signal);
    } catch (err: any) {
      return {
        authorized: false,
        decision: 'deny',
        reason: `Approval decision failed: ${err.message}`,
      };
    }

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
        reason: `User denied permission to execute tool "${request.toolName || 'terminal'}".`,
      };
    }

    // Process ownership verification after user decision
    if (actionType === 'process_input' && request.processId) {
      const proc = ProcessManager.getInstance().getProcess(request.processId.trim());
      if (!proc) {
        return {
          authorized: false,
          decision: 'deny',
          reason: `Process "${request.processId}" not found. Only active KODRA-managed processes can receive input.`,
        };
      }
      if (proc.status !== 'running') {
        return {
          authorized: false,
          decision: 'deny',
          reason: `Process "${request.processId}" is not running (status: ${proc.status}).`,
        };
      }
    } else if (actionType === 'process_stop' && request.processId) {
      const proc = ProcessManager.getInstance().getProcess(request.processId.trim());
      if (!proc) {
        return {
          authorized: false,
          decision: 'deny',
          reason: `Process "${request.processId}" not found. Only KODRA-managed processes can be terminated.`,
        };
      }
    }

    if (userDecision === 'allow_once') {
      // Allow once executes without creating persistent policy
      return {
        authorized: true,
        decision: 'allow_once',
      };
    }

    if (userDecision === 'always_allow_global') {
      // Create persistent global allow policy
      try {
        const policy = await this.policyService.createPolicy({
          scope: 'global',
          commandPattern: policyTarget,
          ruleType: 'exact',
          decision: 'allow',
          description: `Always allow globally: "${policyTarget}"`,
        });
        return {
          authorized: true,
          decision: 'always_allow_global',
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

    if (userDecision === 'always_allow_workspace') {
      // Create persistent workspace-scoped allow policy
      try {
        const policy = await this.policyService.createPolicy({
          scope: 'workspace',
          workspaceId: request.workspaceId,
          commandPattern: policyTarget,
          ruleType: 'exact',
          decision: 'allow',
          description: `Always allow in workspace: "${policyTarget}"`,
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

    // Default conservative fallback: fail closed
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