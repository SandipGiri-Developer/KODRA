/**
 * Typed message protocol between webview and extension host.
 *
 * All communication goes through VS Code's postMessage mechanism.
 * Messages are validated on receipt — the webview never has direct filesystem
 * or network access.
 */
import { ApprovalDecisionType, ApprovalPolicy, CreatePolicyInput, PolicyScope, UpdatePolicyInput } from '../agent/terminal/types';
import { IndexingProgress } from '../indexing/types';
import { DiscoveredModel, ProviderSettings, WorkspaceModel } from '../providers/types';
export type WebviewToExtensionMessage = {
    type: 'sendMessage';
    text: string;
    contextFiles?: string[];
    sessionId?: string;
} | {
    type: 'cancelGeneration';
} | {
    type: 'newChat';
} | {
    type: 'approveAction';
    approved?: boolean;
    decision?: ApprovalDecisionType;
    requestId?: string;
} | {
    type: 'revealTerminal';
    executionId: string;
} | {
    type: 'policy/list';
    scope?: PolicyScope;
    workspaceId?: string;
} | {
    type: 'policy/create';
    policy: CreatePolicyInput;
} | {
    type: 'policy/update';
    id: string;
    updates: UpdatePolicyInput;
} | {
    type: 'policy/delete';
    id: string;
} | {
    type: 'policy/enable';
    id: string;
    enabled: boolean;
} | {
    type: 'getConfig';
} | {
    type: 'openFile';
    filepath: string;
} | {
    type: 'setProvider';
    provider: string;
    providerConfigId?: string;
} | {
    type: 'setModel';
    model: string;
    provider?: string;
    providerConfigId?: string;
} | {
    type: 'setApiKey';
    provider: string;
    key: string;
} | {
    type: 'testConnection';
} | {
    type: 'discoverModels';
    provider: string;
    apiKey?: string;
    endpoint?: string;
} | {
    type: 'startIndexing';
    fullReindex?: boolean;
} | {
    type: 'cancelIndexing';
} | {
    type: 'getIndexStatus';
} | {
    type: 'executeCommand';
    command: string;
    args?: unknown[];
} | {
    type: 'webviewReady';
} | {
    type: 'getSettings';
} | {
    type: 'saveProviderSetting';
    setting: ProviderSettings;
    apiKey?: string;
} | {
    type: 'deleteProviderSetting';
    id: string;
} | {
    type: 'saveWorkspaceModels';
    models: WorkspaceModel[];
} | {
    type: 'returnToChat';
} | {
    type: 'closeSettings';
};
export type ExtensionToWebviewMessage = {
    type: 'agentStarted';
    executionId: string;
} | {
    type: 'streamContent';
    content: string;
} | {
    type: 'streamDone';
} | {
    type: 'streamError';
    error: string;
} | {
    type: 'streamCancelled';
} | {
    type: 'toolCall';
    toolName: string;
    args: Record<string, unknown>;
    toolCallId?: string;
} | {
    type: 'toolStarted';
    toolName: string;
    toolCallId: string;
} | {
    type: 'toolResult';
    toolName: string;
    content: string;
    success: boolean;
    toolCallId?: string;
    durationMs?: number;
} | {
    type: 'approvalRequest';
    toolName: string;
    description: string;
    command?: string;
    diff?: string;
    filepath?: string;
    requestId?: string;
    executionId?: string;
} | {
    type: 'policyList';
    policies: ApprovalPolicy[];
} | {
    type: 'policyUpdated';
    policy: ApprovalPolicy;
} | {
    type: 'policyDeleted';
    id: string;
} | {
    type: 'config';
    provider: string;
    model: string;
    hasApiKey: boolean;
    availableProviders: string[];
    providerConfigId?: string;
} | {
    type: 'connectionResult';
    success: boolean;
    models?: string[];
    error?: string;
} | {
    type: 'modelsDiscovered';
    provider: string;
    models?: DiscoveredModel[];
    error?: string;
} | {
    type: 'indexingProgress';
    progress: IndexingProgress;
} | {
    type: 'indexStatus';
    indexed: boolean;
    entryCount: number;
    fileCount: number;
    inProgress: boolean;
} | {
    type: 'addContext';
    filepath: string;
    content?: string;
    selection?: string;
} | {
    type: 'settingsData';
    providers: ProviderSettings[];
    workspaceModels: WorkspaceModel[];
} | {
    type: 'sessionTitleUpdated';
    sessionId: string;
    title: string;
} | {
    type: 'agentActivity';
    executionId: string;
    event: {
        kind: 'started';
        timestamp: number;
    } | {
        kind: 'thinking';
        timestamp: number;
    } | {
        kind: 'tool_started';
        toolName: string;
        args: Record<string, unknown>;
        toolCallId: string;
        timestamp: number;
    } | {
        kind: 'tool_completed';
        toolName: string;
        toolCallId: string;
        durationMs: number;
        success: boolean;
        metadata?: Record<string, unknown>;
        timestamp: number;
    } | {
        kind: 'tool_failed';
        toolName: string;
        toolCallId: string;
        error: string;
        durationMs: number;
        timestamp: number;
    } | {
        kind: 'completed';
        durationMs: number;
        timestamp: number;
    } | {
        kind: 'failed';
        error: string;
        timestamp: number;
    } | {
        kind: 'cancelled';
        timestamp: number;
    };
};
/**
 * Validate that a message from the webview is well-formed.
 * Returns the validated message or null if invalid.
 */
export declare function validateWebviewMessage(data: unknown): WebviewToExtensionMessage | null;
//# sourceMappingURL=messageTypes.d.ts.map