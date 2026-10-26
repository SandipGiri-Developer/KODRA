/**
 * Type definitions for Kodra Terminal Execution, Centralized Approval Gate,
 * and Persistent Approval Policies.
 */

import * as vscode from 'vscode';

// ─── Approval Policies ──────────────────────────────────────────────────────

export type PolicyScope = 'global' | 'workspace';
export type RuleType = 'exact' | 'prefix' | 'pattern';
export type PolicyDecision = 'allow' | 'deny';

export interface ApprovalPolicy {
  /** Stable unique identifier (UUID v4 or sha256) */
  id: string;
  /** Schema version for migrations (currently 1) */
  schemaVersion: number;
  /** Scope: global applies across workspaces; workspace is isolated to one workspace */
  scope: PolicyScope;
  /** Canonical workspace ID (required when scope === 'workspace') */
  workspaceId?: string;
  /** Matching strategy */
  ruleType: RuleType;
  /** Command pattern or exact command */
  commandPattern: string;
  /** Action to take when matched */
  decision: PolicyDecision;
  /** Whether the policy rule is currently active */
  enabled: boolean;
  /** Human-readable description or label */
  description: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp (ISO 8601) */
  updatedAt: string;
}

export interface CreatePolicyInput {
  scope: PolicyScope;
  workspaceId?: string;
  ruleType?: RuleType;
  commandPattern: string;
  decision?: PolicyDecision;
  enabled?: boolean;
  description?: string;
}

export interface UpdatePolicyInput {
  scope?: PolicyScope;
  workspaceId?: string;
  ruleType?: RuleType;
  commandPattern?: string;
  decision?: PolicyDecision;
  enabled?: boolean;
  description?: string;
}

export interface PolicyEvaluationResult {
  decision: 'allow' | 'deny' | 'require_approval';
  matchedPolicy?: ApprovalPolicy;
  reason: string;
}

export interface IApprovalPolicyService {
  initialize(): Promise<void>;
  listPolicies(query?: { scope?: PolicyScope; workspaceId?: string; enabled?: boolean }): Promise<ApprovalPolicy[]>;
  getPolicy(id: string): Promise<ApprovalPolicy | null>;
  createPolicy(input: CreatePolicyInput): Promise<ApprovalPolicy>;
  updatePolicy(id: string, updates: UpdatePolicyInput): Promise<ApprovalPolicy>;
  deletePolicy(id: string): Promise<boolean>;
  enablePolicy(id: string, enabled: boolean): Promise<ApprovalPolicy>;
  evaluate(command: string, context: { workspaceId: string }): Promise<PolicyEvaluationResult>;
}

// ─── Approval Decisions & Gate ──────────────────────────────────────────────

export type ApprovalDecisionType =
  | 'allow_once'
  | 'always_allow_global'
  | 'always_allow_workspace'
  | 'deny'
  | 'cancel';

export type GateActionType =
  | 'command'
  | 'process_start'
  | 'process_input'
  | 'process_stop'
  | 'terminal_change';

export interface GateAuthorizationRequest {
  actionType?: GateActionType;
  command?: string;
  processId?: string;
  input?: string;
  cwd?: string;
  workspaceId: string;
  mode: string;
  executionId?: string;
  toolCallId?: string;
  description?: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface GateAuthorizationResult {
  authorized: boolean;
  decision: ApprovalDecisionType | 'policy_allowed' | 'policy_denied';
  reason?: string;
  matchedPolicyId?: string;
}

export interface IApprovalGate {
  evaluateAndAuthorize(
    request: GateAuthorizationRequest,
    signal?: AbortSignal,
  ): Promise<GateAuthorizationResult>;
  resolvePendingDecision(
    requestId: string,
    decision: ApprovalDecisionType,
  ): boolean;
  cancelAll(): void;
  hasPending(): boolean;
}

// ─── Terminal Lifecycle & Execution ────────────────────────────────────────

export type TerminalExecutionStatus =
  | 'pending_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'unknown';

export type TerminalAction =
  | 'execute'
  | 'status'
  | 'wait'
  | 'cancel'
  | 'close'
  | 'list_sessions';

export interface TerminalSessionInfo {
  sessionId: string;
  terminalName: string;
  workspaceId: string;
  cwd: string;
  isBusy: boolean;
  isClosed: boolean;
  activeExecutionId?: string;
  lastCommand?: string;
  createdAt: number;
  completedExecutionsCount: number;
}

export interface TerminalExecutionRecord {
  executionId: string;
  toolCallId?: string;
  agentRunId?: string;
  terminalSessionId: string;
  terminalId: string;
  terminalName: string;
  command: string;
  cwd: string;
  workspaceId?: string;
  status: TerminalExecutionStatus;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  output: string;
  isTruncated: boolean;
  error?: string;
}

export interface ExecuteCommandOptions {
  command?: string;
  action?: TerminalAction;
  executionId?: string;
  toolCallId?: string;
  agentRunId?: string;
  terminalSessionId?: string;
  cwd?: string;
  workspaceId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  waitMs?: number;
  reuseTerminal?: boolean;
  preserveTerminal?: boolean;
  isolated?: boolean;
  reason?: string;
}

export interface ITerminalExecutionManager {
  executeCommand(options: ExecuteCommandOptions): Promise<TerminalExecutionRecord>;
  revealTerminal(executionOrSessionId?: string): boolean;
  getExecution(executionId: string): TerminalExecutionRecord | undefined;
  cancelExecution(executionId: string): boolean;
  listExecutions(): TerminalExecutionRecord[];
  listSessions(workspaceId?: string): TerminalSessionInfo[];
  getSession(sessionId: string): TerminalSessionInfo | undefined;
  closeSession(sessionId: string): boolean;
  dispose(): void;
}

