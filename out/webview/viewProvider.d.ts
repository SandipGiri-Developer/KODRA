/**
 * Webview Provider for the ARC1610 sidebar chat interface.
 *
 * Handles the lifecycle of the webview, message routing to the agent loop,
 * configuration updates, and indexing status reporting.
 */
import * as vscode from 'vscode';
import { CodebaseIndexer } from '../indexing/indexer';
import { ProviderRegistry } from '../providers/registry';
export declare class Arc1610ViewProvider implements vscode.WebviewViewProvider {
    private readonly extensionUri;
    private readonly providerRegistry;
    private readonly indexer;
    static readonly viewType = "arc1610.chatView";
    private view?;
    private chatHistory;
    private agent;
    private readonly logger;
    constructor(extensionUri: vscode.Uri, providerRegistry: ProviderRegistry, indexer: CodebaseIndexer);
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
    private postMessage;
    private handleMessage;
    private handleUserMessage;
    private getHtmlForWebview;
}
//# sourceMappingURL=viewProvider.d.ts.map