/**
 * Webview Provider for the KODRA sidebar chat interface.
 *
 * Handles the lifecycle of the webview, message routing to the agent loop,
 * configuration updates, and indexing status reporting.
 */
import * as vscode from 'vscode';
import { CodebaseIndexer } from '../indexing/indexer';
import { ProviderRegistry } from '../providers/registry';
import { ExtensionToWebviewMessage } from './messageTypes';
import { WebviewSettingsBridge, IWebviewMessagePoster } from './webviewSettingsBridge';
import { ArtifactManager, ConversationRepository, ExecutionJournal, WorkspaceRegistry } from '../storage';
export declare class KodraViewProvider implements vscode.WebviewViewProvider, IWebviewMessagePoster {
    private readonly extensionUri;
    private readonly providerRegistry;
    private readonly indexer;
    static readonly viewType = "KODRA.chatView";
    private view?;
    private chatHistory;
    private currentSessionHistory;
    private currentSessionId;
    private agent;
    private readonly logger;
    private readonly settingsBridge;
    private conversationRepository?;
    private executionJournal?;
    private artifactManager?;
    private workspaceRegistry?;
    private contextEngine?;
    constructor(extensionUri: vscode.Uri, providerRegistry: ProviderRegistry, indexer: CodebaseIndexer, settingsBridge?: WebviewSettingsBridge, conversationRepository?: ConversationRepository, executionJournal?: ExecutionJournal, artifactManager?: ArtifactManager, workspaceRegistry?: WorkspaceRegistry);
    private ensureStorageServices;
    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    /**
     * Start a new chat session.
     */
    newChat(): void;
    /**
     * Navigate the webview to a specific path.
     */
    navigateTo(path: string): void;
    /**
     * Add context to the current chat (from editor commands).
     */
    addContext(filepath: string, content?: string, selection?: string): void;
    /**
     * Send all settings to the webview.
     */
    sendSettingsData(): Promise<void>;
    /**
     * Send configuration to the webview.
     */
    sendConfig(): Promise<void>;
    /**
     * Send index status to the webview.
     */
    sendIndexStatus(): void;
    postMessage(message: ExtensionToWebviewMessage): Thenable<boolean> | undefined;
    private handleMessage;
    private handleIdeMessengerMessage;
    private respondToIdeMessenger;
    private generateTitleFromText;
    private formatSessionAsMarkdown;
    private handleUserMessage;
    private getHtmlForWebview;
}
//# sourceMappingURL=viewProvider.d.ts.map