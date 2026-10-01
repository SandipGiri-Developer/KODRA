/**
 * Webview Provider for the KODRA sidebar chat interface.
 * 
 * Handles the lifecycle of the webview, message routing to the agent loop,
 * configuration updates, and indexing status reporting.
 */

import * as vscode from 'vscode';
import { AgentLoop } from '../agent/agentLoop';
import { CodebaseIndexer } from '../indexing/indexer';
import { ProviderRegistry } from '../providers/registry';
import { Logger } from '../utils/logger';
import { SettingsManager } from '../utils/settingsManager';
import { ExtensionToWebviewMessage, validateWebviewMessage, WebviewToExtensionMessage } from './messageTypes';
import { getCsp } from './securityPolicy';
import { getWebviewContent } from './htmlHelper';
import { OllamaManager } from '../utils/ollamaManager';
import { ChatMessage } from '../providers/types';
import { WebviewSettingsBridge, IWebviewMessagePoster } from './webviewSettingsBridge';

export class KodraViewProvider implements vscode.WebviewViewProvider, IWebviewMessagePoster {
  public static readonly viewType = 'KODRA.chatView';
  
  private view?: vscode.WebviewView;
  private chatHistory: ChatMessage[] = [];
  private agent: AgentLoop | null = null;
  private readonly logger = Logger.getInstance();
  private readonly settingsBridge: WebviewSettingsBridge;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly providerRegistry: ProviderRegistry,
    private readonly indexer: CodebaseIndexer,
    settingsBridge?: WebviewSettingsBridge,
  ) {
    this.settingsBridge = settingsBridge ?? new WebviewSettingsBridge(this.providerRegistry);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    // Set webview options
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Set HTML content
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (data) => this.handleMessage(data),
      undefined,
      [], // disposables
    );
    
    // Send initial configuration, index status, and settings data
    this.sendConfig();
    this.sendIndexStatus();
    this.sendSettingsData();

    // Re-send settings when sidebar becomes visible again
    webviewView.onDidChangeVisibility?.(() => {
      if (webviewView.visible) {
        this.sendConfig();
        this.sendSettingsData();
      }
    });
    
    // Subscribe to indexer progress events
    this.indexer.onProgress((progress) => {
      this.postMessage({ type: 'indexingProgress', progress });
      if (progress.status === 'complete' || progress.status === 'error' || progress.status === 'cancelled') {
        this.sendIndexStatus();
      }
    });

    // Subscribe to settings changes from SettingsManager (e.g. from dedicated Settings panel)
    try {
      SettingsManager.getInstance().onDidChangeSettings(() => {
        this.sendSettingsData();
        this.sendConfig();
      });
    } catch {
      // Ignore if not initialized yet
    }
  }

  /**
   * Start a new chat session.
   */
  public newChat() {
    this.chatHistory = [];
    this.agent?.cancel();
    this.agent = null;
    
    if (this.view) {
      this.postMessage({ type: 'newSession' } as any); 
    }
  }

  /**
   * Navigate the webview to a specific path.
   */
  public navigateTo(path: string) {
    if (this.view) {
      this.view.show?.(true);
      this.postMessage({ type: 'navigateTo', path } as any);
    }
  }

  /**
   * Add context to the current chat (from editor commands).
   */
  public addContext(filepath: string, content?: string, selection?: string) {
    if (this.view) {
      this.view.show?.(true);
      this.postMessage({
        type: 'addContext',
        filepath,
        content,
        selection,
      });
    }
  }

  /**
   * Send all settings to the webview.
   */
  public async sendSettingsData() {
    await this.settingsBridge.sendSettingsData(this);
  }

  /**
   * Send configuration to the webview.
   */
  public async sendConfig() {
    await this.settingsBridge.sendConfig(this);
  }

  /**
   * Send index status to the webview.
   */
  public sendIndexStatus() {
    const status = this.indexer.getStatus();
    this.postMessage({
      type: 'indexStatus',
      indexed: status.indexed,
      entryCount: status.entryCount,
      fileCount: status.fileCount,
      inProgress: status.inProgress,
    });
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    return this.view?.webview.postMessage(message);
  }

  private async handleMessage(data: unknown) {
    const msg = validateWebviewMessage(data);
    if (!msg) {
      this.logger.warn('Received invalid message from webview', data);
      return;
    }

    try {
      // Delegate settings and model configuration messages to WebviewSettingsBridge
      if (await this.settingsBridge.handleSettingsMessage(msg, this)) {
        return;
      }

      switch (msg.type) {
        case 'webviewReady':
          await this.sendConfig();
          this.sendIndexStatus();
          await this.sendSettingsData();
          break;
          
        case 'sendMessage':
          await this.handleUserMessage(msg.text, msg.contextFiles);
          break;
          
        case 'cancelGeneration':
          this.agent?.cancel();
          this.postMessage({ type: 'streamCancelled' });
          break;
          
        case 'newChat':
          this.newChat();
          break;
          
        case 'executeCommand':
          if (msg.args && msg.args.length > 0) {
            vscode.commands.executeCommand(msg.command, ...msg.args);
          } else {
            vscode.commands.executeCommand(msg.command);
          }
          break;
          
        case 'approveAction':
          if (this.agent) {
            this.agent.resolveApproval(msg.approved);
          }
          break;
          
        case 'startIndexing':
          this.indexer.indexWorkspace(msg.fullReindex);
          break;
          
        case 'cancelIndexing':
          this.indexer.cancelIndexing();
          break;
          
        case 'getIndexStatus':
          this.sendIndexStatus();
          break;
      }
    } catch (error) {
      this.logger.error(`Error handling webview message: ${msg.type}`, error);
    }
  }

  private async handleUserMessage(text: string, contextFiles?: string[]) {
    const t0 = Date.now();
    const logger = this.logger;

    try {
      // ─── Phase 1: Config (single read — eliminates 3x duplicate readConfig) ───
      const t1 = Date.now();
      const config = await this.providerRegistry.readConfig();
      const configMs = Date.now() - t1;

      // ─── Phase 2: Ollama availability check (cached, skipped within 30s) ─────
      const t2 = Date.now();
      if (config.provider === 'ollama') {
        const isRunning = await OllamaManager.ensureRunning(config.endpoint);
        if (!isRunning) {
          this.postMessage({ type: 'streamError', error: 'Ollama is not running. Please start it to kodra.' });
          this.postMessage({ type: 'streamDone' });
          return;
        }
      }
      const pingMs = Date.now() - t2;

      // ─── Phase 3: Parallel pre-request work ──────────────────────────────────
      const t3 = Date.now();
      const [provider] = await Promise.all([
        this.providerRegistry.getProvider(),
        this.indexer.ensureLoaded(),
      ]);
      const parallelMs = Date.now() - t3;

      // ─── Phase 4: Capabilities (from stable cache — no network call) ─────────
      const t4 = Date.now();
      const modelName = config.modelName || provider.getDefaultModel();
      const capabilities = await this.providerRegistry.getModelCapabilities(config.provider, modelName);
      const toolCalling = capabilities?.toolCalling ?? provider.capabilities.toolCalling;
      const capsMs = Date.now() - t4;

      // Log full model routing info on every request
      logger.info(
        `[KODRA Request] ` +
        `Selected Model: ${modelName || '(none)'} | ` +
        `Provider: ${config.provider} | ` +
        `Endpoint: ${config.endpoint || 'default'} | ` +
        `ToolCalling: ${toolCalling} | ` +
        `Router: none (direct pass-through)`
      );
      logger.info(
        `[KODRA Timing] config=${configMs}ms ping=${pingMs}ms provider+index=${parallelMs}ms caps=${capsMs}ms`
      );

      // ─── Phase 5: Run agent ───────────────────────────────────────────────────
      this.chatHistory.push({ role: 'user', content: text });

      const requireApproval = vscode.workspace.getConfiguration('KODRA').get<boolean>('agent.requireApproval', true);
      const maxIterations = vscode.workspace.getConfiguration('KODRA').get<number>('agent.maxIterations', 15);

      if (this.agent) {
        this.agent.cancel();
      }
      this.agent = new AgentLoop(this.indexer, requireApproval);

      const historyToPass = [...this.chatHistory];
      historyToPass.pop(); // remove last user message (passed separately)

      const tStream = Date.now();
      let ttftMs: number | null = null;
      let firstToken = true;

      const generator = this.agent.run(text, historyToPass, provider, {
        model: modelName,
        maxTokens: config.maxTokens,
        maxIterations: maxIterations,
        contextFiles,
        toolCalling,
      });

      let accumulatedContent = '';

      for await (const event of generator) {
        switch (event.type) {
          case 'content':
            if (firstToken) {
              ttftMs = Date.now() - tStream;
              logger.info(`[KODRA Timing] TTFT=${ttftMs}ms (time from streamChat call to first token)`);
              firstToken = false;
            }
            accumulatedContent += event.content;
            this.postMessage({ type: 'streamContent', content: event.content });
            break;

          case 'toolCall':
            this.postMessage({ type: 'toolCall', toolName: event.toolName, args: event.args });
            break;

          case 'toolResult':
            this.postMessage({
              type: 'toolResult',
              toolName: event.toolName,
              content: event.result.content,
              success: event.result.success
            });
            break;

          case 'approval':
            this.postMessage({
              type: 'approvalRequest',
              toolName: event.toolName,
              description: event.description,
              command: event.command,
              diff: event.diff,
              filepath: event.filepath
            });
            break;

          case 'error':
            this.postMessage({ type: 'streamError', error: event.error });
            break;

          case 'cancelled':
            this.postMessage({ type: 'streamCancelled' });
            break;

          case 'done':
            this.postMessage({ type: 'streamDone' });
            if (accumulatedContent) {
              this.chatHistory.push({ role: 'assistant', content: accumulatedContent });
            }
            break;
        }
      }

      const totalMs = Date.now() - t0;
      const generationMs = Date.now() - (tStream + (ttftMs ?? 0));
      logger.info(
        `[KODRA Timing] total=${totalMs}ms generation=${generationMs}ms TTFT=${ttftMs ?? 'N/A'}ms`
      );

    } catch (error) {
      this.logger.error('Failed to handle user message', error);
      this.postMessage({
        type: 'streamError',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.agent = null;
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    return getWebviewContent(webview, this.extensionUri, {
      title: 'Kodra',
      initialRoute: '/',
      isSettingsWindow: false,
    });
  }
}
