/**
 * Typed message protocol between webview and extension host.
 * 
 * All communication goes through VS Code's postMessage mechanism.
 * Messages are validated on receipt — the webview never has direct filesystem
 * or network access.
 */

import {
  ApprovalDecisionType,
  ApprovalPolicy,
  CreatePolicyInput,
  PolicyScope,
  UpdatePolicyInput,
} from '../agent/terminal/types';
import { IndexingProgress } from '../indexing/types';
import { DiscoveredModel, ProviderSettings, WorkspaceModel } from '../providers/types';

// ─── Messages from Webview to Extension ────────────────────────────────────

export type WebviewToExtensionMessage =
  | { type: 'sendMessage'; text: string; contextFiles?: string[]; sessionId?: string }
  | { type: 'cancelGeneration' }
  | { type: 'newChat' }
  | {
      type: 'approveAction';
      approved?: boolean;
      decision?: ApprovalDecisionType;
      requestId?: string;
    }
  | { type: 'revealTerminal'; executionId: string }
  | { type: 'policy/list'; scope?: PolicyScope; workspaceId?: string }
  | { type: 'policy/create'; policy: CreatePolicyInput }
  | { type: 'policy/update'; id: string; updates: UpdatePolicyInput }
  | { type: 'policy/delete'; id: string }
  | { type: 'policy/enable'; id: string; enabled: boolean }
  | { type: 'getConfig' }
  | { type: 'openFile'; filepath: string }
  | { type: 'setProvider'; provider: string; providerConfigId?: string }
  | { type: 'setModel'; model: string; provider?: string; providerConfigId?: string }
  | { type: 'setApiKey'; provider: string; key: string }
  | { type: 'testConnection' }
  | { type: 'discoverModels'; provider: string; apiKey?: string; endpoint?: string }
  | { type: 'startIndexing'; fullReindex?: boolean }
  | { type: 'cancelIndexing' }
  | { type: 'getIndexStatus' }
  | { type: 'executeCommand'; command: string; args?: unknown[] }
  | { type: 'webviewReady' }
  | { type: 'getSettings' }
  | { type: 'saveProviderSetting'; setting: ProviderSettings; apiKey?: string }
  | { type: 'deleteProviderSetting'; id: string }
  | { type: 'saveWorkspaceModels'; models: WorkspaceModel[] }
  | { type: 'getProviderApiKey'; id: string }
  | { type: 'returnToChat' }
  | { type: 'closeSettings' };

// ─── Messages from Extension to Webview ────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'agentStarted'; executionId: string }
  | { type: 'streamContent'; content: string }
  | { type: 'streamDone' }
  | { type: 'streamError'; error: string }
  | { type: 'streamCancelled' }
  | { type: 'toolCall'; toolName: string; args: Record<string, unknown>; toolCallId?: string }
  | { type: 'toolStarted'; toolName: string; toolCallId: string }
  | { type: 'toolResult'; toolName: string; content: string; success: boolean; toolCallId?: string; durationMs?: number }
  | {
      type: 'approvalRequest';
      toolName: string;
      description: string;
      command?: string;
      diff?: string;
      filepath?: string;
      requestId?: string;
      executionId?: string;
    }
  | { type: 'policyList'; policies: ApprovalPolicy[] }
  | { type: 'policyUpdated'; policy: ApprovalPolicy }
  | { type: 'policyDeleted'; id: string }
  | { type: 'config'; provider: string; model: string; hasApiKey: boolean; availableProviders: string[]; providerConfigId?: string }
  | { type: 'connectionResult'; success: boolean; models?: string[]; error?: string }
  | { type: 'modelsDiscovered'; provider: string; models?: DiscoveredModel[]; error?: string }
  | { type: 'indexingProgress'; progress: IndexingProgress }
  | { type: 'indexStatus'; indexed: boolean; entryCount: number; fileCount: number; inProgress: boolean }
  | { type: 'addContext'; filepath: string; content?: string; selection?: string }
  | { type: 'settingsData'; providers: ProviderSettings[]; workspaceModels: WorkspaceModel[] }
  | { type: 'providerApiKey'; id: string; apiKey: string }
  | { type: 'sessionTitleUpdated'; sessionId: string; title: string }
  | {
      type: 'agentActivity';
      executionId: string;
      event:
        | { kind: 'started'; timestamp: number }
        | { kind: 'thinking'; timestamp: number }
        | { kind: 'tool_started'; toolName: string; args: Record<string, unknown>; toolCallId: string; timestamp: number }
        | { kind: 'tool_completed'; toolName: string; toolCallId: string; durationMs: number; success: boolean; metadata?: Record<string, unknown>; timestamp: number }
        | { kind: 'tool_failed'; toolName: string; toolCallId: string; error: string; durationMs: number; timestamp: number }
        | { kind: 'completed'; durationMs: number; timestamp: number }
        | { kind: 'failed'; error: string; timestamp: number }
        | { kind: 'cancelled'; timestamp: number };
    };

/**
 * Validate that a message from the webview is well-formed.
 * Returns the validated message or null if invalid.
 */
export function validateWebviewMessage(data: unknown): WebviewToExtensionMessage | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const msg = data as Record<string, unknown>;
  if (typeof msg.type !== 'string') {
    return null;
  }

  const validTypes: Set<string> = new Set([
    'sendMessage', 'cancelGeneration', 'newChat', 'approveAction', 'revealTerminal',
    'policy/list', 'policy/create', 'policy/update', 'policy/delete', 'policy/enable',
    'getConfig', 'setProvider', 'setModel', 'setApiKey',
    'testConnection', 'discoverModels', 'startIndexing', 'cancelIndexing',
    'getIndexStatus', 'executeCommand', 'webviewReady', 'openFile',
    'getSettings', 'saveProviderSetting', 'deleteProviderSetting', 'saveWorkspaceModels',
    'getProviderApiKey', 'returnToChat', 'closeSettings'
  ]);

  if (!validTypes.has(msg.type)) {
    return null;
  }

  // Type-specific validation
  switch (msg.type) {
    case 'sendMessage':
      if (typeof msg.text !== 'string' || msg.text.trim().length === 0) {
        return null;
      }
      if (msg.sessionId !== undefined && typeof msg.sessionId !== 'string') {
        return null;
      }
      break;
    case 'approveAction':
      if (msg.decision !== undefined) {
        const validDecisions = ['allow_once', 'always_allow_workspace', 'always_allow_global', 'deny', 'cancel'];
        if (!validDecisions.includes(msg.decision as string)) {
          return null;
        }
      } else if (typeof msg.approved !== 'boolean') {
        return null;
      }
      if (msg.requestId !== undefined && (typeof msg.requestId !== 'string' || !msg.requestId.trim())) {
        return null;
      }
      break;
    case 'revealTerminal':
      if (typeof msg.executionId !== 'string' || !msg.executionId.trim()) {
        return null;
      }
      break;
    case 'policy/list':
      if (msg.scope !== undefined && msg.scope !== 'global' && msg.scope !== 'workspace') {
        return null;
      }
      if (msg.workspaceId !== undefined && typeof msg.workspaceId !== 'string') {
        return null;
      }
      break;
    case 'policy/create': {
      const pol = msg.policy as any;
      if (!pol || typeof pol !== 'object') {
        return null;
      }
      if (typeof pol.commandPattern !== 'string' || !pol.commandPattern.trim()) {
        return null;
      }
      if (pol.scope !== 'global' && pol.scope !== 'workspace') {
        return null;
      }
      if (pol.decision !== undefined && pol.decision !== 'allow' && pol.decision !== 'deny') {
        return null;
      }
      if (pol.ruleType !== undefined && pol.ruleType !== 'exact' && pol.ruleType !== 'prefix' && pol.ruleType !== 'pattern') {
        return null;
      }
      break;
    }
    case 'policy/update': {
      if (typeof msg.id !== 'string' || !msg.id.trim()) {
        return null;
      }
      const upd = msg.updates as any;
      if (!upd || typeof upd !== 'object') {
        return null;
      }
      if (upd.decision !== undefined && upd.decision !== 'allow' && upd.decision !== 'deny') {
        return null;
      }
      if (upd.ruleType !== undefined && upd.ruleType !== 'exact' && upd.ruleType !== 'prefix' && upd.ruleType !== 'pattern') {
        return null;
      }
      if (upd.commandPattern !== undefined && (typeof upd.commandPattern !== 'string' || !upd.commandPattern.trim())) {
        return null;
      }
      if (upd.enabled !== undefined && typeof upd.enabled !== 'boolean') {
        return null;
      }
      break;
    }
    case 'policy/delete':
      if (typeof msg.id !== 'string' || !msg.id.trim()) {
        return null;
      }
      break;
    case 'policy/enable':
      if (typeof msg.id !== 'string' || !msg.id.trim()) {
        return null;
      }
      if (typeof msg.enabled !== 'boolean') {
        return null;
      }
      break;
    case 'setProvider':
      if (typeof msg.provider !== 'string') {
        return null;
      }
      break;
    case 'setModel':
      if (typeof msg.model !== 'string') {
        return null;
      }
      break;
    case 'setApiKey':
      if (typeof msg.provider !== 'string' || typeof msg.key !== 'string') {
        return null;
      }
      break;
    case 'executeCommand':
      if (typeof msg.command !== 'string') {
        return null;
      }
      break;
    case 'openFile':
      if (typeof msg.filepath !== 'string') {
        return null;
      }
      break;
    case 'discoverModels':
      if (typeof msg.provider !== 'string') {
        return null;
      }
      break;
    case 'getProviderApiKey':
      if (typeof msg.id !== 'string' || !msg.id.trim()) {
        return null;
      }
      break;
  }

  return msg as WebviewToExtensionMessage;
}
