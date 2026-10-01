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

export class KodraViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'KODRA.chatView';
  
  private view?: vscode.WebviewView;
  private chatHistory: ChatMessage[] = [];
  private agent: AgentLoop | null = null;
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly providerRegistry: ProviderRegistry,
    private readonly indexer: CodebaseIndexer,
  ) {}

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
    try {
      const manager = SettingsManager.getInstance();
      const providers = await manager.getProviders();
      const workspaceModels = await manager.getWorkspaceModels();
      
      this.postMessage({
        type: 'settingsData',
        providers,
        workspaceModels,
      });
    } catch (e) {
      this.logger.error('Failed to send settings data', e);
    }
  }

  /**
   * Send configuration to the webview.
   */
  public async sendConfig() {
    try {
      const config = await this.providerRegistry.readConfig();
      const hasApiKey = Boolean(config.apiKey && config.apiKey.length > 0);
      
      this.postMessage({
        type: 'config',
        provider: config.provider,
        model: config.modelName,
        hasApiKey,
        availableProviders: this.providerRegistry.getSupportedProviders(),
      });

      // Pre-warm the capabilities cache so the first message doesn't incur a discovery round-trip
      this.providerRegistry.warmCapabilities().catch(() => { /* non-critical */ });
    } catch (e) {
      this.logger.error('Failed to send config', e);
    }
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

  private postMessage(message: ExtensionToWebviewMessage) {
    this.view?.webview.postMessage(message);
  }

  private async handleMessage(data: unknown) {
    const msg = validateWebviewMessage(data);
    if (!msg) {
      this.logger.warn('Received invalid message from webview', data);
      return;
    }

    try {
      switch (msg.type) {
        case 'webviewReady':
          this.sendConfig();
          this.sendIndexStatus();
          this.sendSettingsData();
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
          
        case 'getConfig':
          await this.sendConfig();
          break;
          
        case 'setProvider':
          await vscode.workspace.getConfiguration('KODRA').update('provider', msg.provider, true);
          await this.sendConfig();
          break;
          
        case 'setModel':
          await vscode.workspace.getConfiguration('KODRA').update('modelName', msg.model, true);
          await this.sendConfig();
          break;
          
        case 'setApiKey':
          await this.providerRegistry.setApiKey(msg.provider, msg.key);
          await this.sendConfig();
          break;
          
        case 'testConnection':
          try {
            const provider = await this.providerRegistry.getProvider();
            const models = await provider.testConnection();
            this.postMessage({ type: 'connectionResult', success: true, models });
          } catch (e) {
            this.postMessage({ 
              type: 'connectionResult', 
              success: false, 
              error: e instanceof Error ? e.message : String(e) 
            });
          }
          break;

        case 'discoverModels':
          try {
            const models = await this.providerRegistry.discoverModels(msg.provider, msg.apiKey, msg.endpoint);
            this.postMessage({ type: 'modelsDiscovered', provider: msg.provider, models });
          } catch (e) {
            this.postMessage({
              type: 'modelsDiscovered',
              provider: msg.provider,
              error: e instanceof Error ? e.message : String(e)
            });
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
          
        case 'getSettings':
          await this.sendSettingsData();
          break;
          
        case 'saveProviderSetting': {
          const manager = SettingsManager.getInstance();
          const providers = await manager.getProviders();
          const idx = providers.findIndex(p => p.id === msg.setting.id);
          
          if (msg.apiKey !== undefined) {
            if (msg.apiKey.trim().length > 0) {
              await manager.saveApiKey(msg.setting.id, msg.apiKey);
              msg.setting.apiKeySecret = true;
            } else {
              await manager.deleteApiKey(msg.setting.id);
              msg.setting.apiKeySecret = false;
            }
          }

          if (idx >= 0) {
            providers[idx] = msg.setting;
          } else {
            providers.push(msg.setting);
          }
          await manager.saveProviders(providers);
          await this.sendSettingsData();
          break;
        }

        case 'deleteProviderSetting': {
          const manager = SettingsManager.getInstance();
          const providers = await manager.getProviders();
          const updated = providers.filter(p => p.id !== msg.id);
          await manager.deleteApiKey(msg.id);
          await manager.saveProviders(updated);
          await this.sendSettingsData();
          break;
        }

        case 'saveWorkspaceModels': {
          const manager = SettingsManager.getInstance();
          await manager.saveWorkspaceModels(msg.models);
          await this.sendSettingsData();
          break;
        }
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
