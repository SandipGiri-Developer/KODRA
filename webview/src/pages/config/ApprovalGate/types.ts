/**
 * Types for the Approval Gate settings management interface.
 */

export type PolicyScope = 'global' | 'workspace';
export type RuleType = 'exact' | 'prefix' | 'pattern';
export type PolicyDecision = 'allow' | 'deny';

export interface ApprovalPolicy {
  id: string;
  schemaVersion?: number;
  scope: PolicyScope;
  workspaceId?: string;
  ruleType: RuleType;
  commandPattern: string;
  decision: PolicyDecision;
  enabled: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyFormData {
  commandPattern: string;
  scope: PolicyScope;
  description: string;
}
