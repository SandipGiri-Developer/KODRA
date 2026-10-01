/**
 * Typed message protocol between webview and extension host.
 *
 * All communication goes through VS Code's postMessage mechanism.
 * Messages are validated on receipt — the webview never has direct filesystem
 * or network access.
 */
import { IndexingProgress } from '../indexing/types';
import { DiscoveredModel, ProviderSettings, WorkspaceModel } from '../providers/types';
export type WebviewToExtensionMessage = {
    type: 'sendMessage';
    text: string;
    contextFiles?: string[];
} | {
    type: 'cancelGeneration';
} | {
    type: 'newChat';
} | {
    type: 'approveAction';
    approved: boolean;
} | {
    type: 'getConfig';
} | {
    type: 'setProvider';
    provider: string;
} | {
    type: 'setModel';
    model: string;
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
} | {
    type: 'toolResult';
    toolName: string;
    content: string;
    success: boolean;
} | {
    type: 'approvalRequest';
    toolName: string;
    description: string;
    command?: string;
    diff?: string;
    filepath?: string;
} | {
    type: 'config';
    provider: string;
    model: string;
    hasApiKey: boolean;
    availableProviders: string[];
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
};
/**
 * Validate that a message from the webview is well-formed.
 * Returns the validated message or null if invalid.
 */
export declare function validateWebviewMessage(data: unknown): WebviewToExtensionMessage | null;
//# sourceMappingURL=messageTypes.d.ts.map