/**
 * Typed message protocol between webview and extension host.
 * 
 * All communication goes through VS Code's postMessage mechanism.
 * Messages are validated on receipt — the webview never has direct filesystem
 * or network access.
 */

import { IndexingProgress } from '../indexing/types';
import { DiscoveredModel, ProviderSettings, WorkspaceModel } from '../providers/types';

// ─── Messages from Webview to Extension ────────────────────────────────────

export type WebviewToExtensionMessage =
  | { type: 'sendMessage'; text: string; contextFiles?: string[] }
  | { type: 'cancelGeneration' }
  | { type: 'newChat' }
  | { type: 'approveAction'; approved: boolean }
  | { type: 'getConfig' }
  | { type: 'setProvider'; provider: string }
  | { type: 'setModel'; model: string }
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
  | { type: 'approvalRequest'; toolName: string; description: string; command?: string; diff?: string; filepath?: string }
  | { type: 'config'; provider: string; model: string; hasApiKey: boolean; availableProviders: string[] }
  | { type: 'connectionResult'; success: boolean; models?: string[]; error?: string }
  | { type: 'modelsDiscovered'; provider: string; models?: DiscoveredModel[]; error?: string }
  | { type: 'indexingProgress'; progress: IndexingProgress }
  | { type: 'indexStatus'; indexed: boolean; entryCount: number; fileCount: number; inProgress: boolean }
  | { type: 'addContext'; filepath: string; content?: string; selection?: string }
  | { type: 'settingsData'; providers: ProviderSettings[]; workspaceModels: WorkspaceModel[] }
  /**
   * Real-time agent activity event for the "Worked" panel.
   * Emitted by the extension host for each meaningful runtime event so
   * the webview can build the activity timeline without a second event bus.
   */
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
    'sendMessage', 'cancelGeneration', 'newChat', 'approveAction',
    'getConfig', 'setProvider', 'setModel', 'setApiKey',
    'testConnection', 'discoverModels', 'startIndexing', 'cancelIndexing',
    'getIndexStatus', 'executeCommand', 'webviewReady',
    'getSettings', 'saveProviderSetting', 'deleteProviderSetting', 'saveWorkspaceModels',
    'returnToChat', 'closeSettings'
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
      break;
    case 'approveAction':
      if (typeof msg.approved !== 'boolean') {
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
    case 'discoverModels':
      if (typeof msg.provider !== 'string') {
        return null;
      }
      break;
  }

  return msg as WebviewToExtensionMessage;
}
