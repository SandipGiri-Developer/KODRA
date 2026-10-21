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

import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ArtifactManager,
  ConversationRepository,
  ExecutionJournal,
  StorageManager,
  StoredConversation,
  WorkspaceRegistry,
} from '../storage';

export class KodraViewProvider implements vscode.WebviewViewProvider, IWebviewMessagePoster {
  public static readonly viewType = 'KODRA.chatView';
  
  private view?: vscode.WebviewView;
  private chatHistory: ChatMessage[] = [];
  private currentSessionHistory: any[] = [];
  private currentSessionId: string | null = null;
  private agent: AgentLoop | null = null;
  private readonly logger = Logger.getInstance();
  private readonly settingsBridge: WebviewSettingsBridge;
  private conversationRepository?: ConversationRepository;
  private executionJournal?: ExecutionJournal;
  private artifactManager?: ArtifactManager;
  private workspaceRegistry?: WorkspaceRegistry;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly providerRegistry: ProviderRegistry,
    private readonly indexer: CodebaseIndexer,
    settingsBridge?: WebviewSettingsBridge,
    conversationRepository?: ConversationRepository,
    executionJournal?: ExecutionJournal,
    artifactManager?: ArtifactManager,
    workspaceRegistry?: WorkspaceRegistry,
  ) {
    this.settingsBridge = settingsBridge ?? new WebviewSettingsBridge(this.providerRegistry);
    this.conversationRepository = conversationRepository;
    this.executionJournal = executionJournal;
    this.artifactManager = artifactManager;
    this.workspaceRegistry = workspaceRegistry;
  }

  private ensureStorageServices() {
    if (!this.conversationRepository) {
      try {
        const sm = StorageManager.getInstance();
        const wr = new WorkspaceRegistry(sm.storageRoot);
        const ej = new ExecutionJournal(sm);
        const am = new ArtifactManager(sm);
        this.conversationRepository = new ConversationRepository(sm, wr, ej, am);
        this.executionJournal = ej;
        this.artifactManager = am;
        this.workspaceRegistry = wr;
      } catch {
        // Fallback if StorageManager was not initialized
      }
    }
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
    this.currentSessionHistory = [];
    this.currentSessionId = null;
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
    this.ensureStorageServices();

    // ── Handle IdeMessenger request-reply protocol from webview ─────────────
    if (typeof data === 'object' && data !== null && 'messageType' in data && 'messageId' in data) {
      await this.handleIdeMessengerMessage(data as { messageType: string; messageId: string; data?: any });
      return;
    }

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
          await this.handleUserMessage(msg.text, msg.contextFiles, msg.sessionId);
          break;
          
        case 'cancelGeneration':
          this.agent?.cancel();
          if (this.currentSessionId) {
            this.postMessage({
              type: 'agentActivity',
              executionId: '',
              event: { kind: 'cancelled', timestamp: Date.now() },
            });
          }
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

        case 'openFile':
          if (msg.filepath) {
            try {
              let uri: vscode.Uri;
              const cleanPath = msg.filepath.split('#')[0]; // Remove hash anchors like #L1-10
              if (cleanPath.startsWith('file://')) {
                uri = vscode.Uri.parse(cleanPath);
              } else if (cleanPath.match(/^[a-zA-Z]:\\/) || cleanPath.startsWith('/')) {
                uri = vscode.Uri.file(cleanPath);
              } else if (vscode.workspace.workspaceFolders?.[0]) {
                uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, cleanPath);
              } else {
                uri = vscode.Uri.file(cleanPath);
              }
              const doc = await vscode.workspace.openTextDocument(uri);
              await vscode.window.showTextDocument(doc, { preview: true });
            } catch (err) {
              this.logger.error(`Failed to open file: ${msg.filepath}`, err);
            }
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

  private async handleIdeMessengerMessage(req: { messageType: string; messageId: string; data?: any }) {
    const { messageType, messageId, data } = req;
    this.ensureStorageServices();

    try {
      switch (messageType) {
        case 'history/list': {
          const limit = data?.limit;
          const offset = data?.offset;
          const workspaceId = data?.workspaceId;
          const search = data?.search;
          const rawList = this.conversationRepository
            ? await this.conversationRepository.listConversations({ limit, offset, workspaceId, search })
            : [];
          const content = rawList.map((item) => ({
            sessionId: item.sessionId,
            title: item.title,
            dateCreated: item.dateCreated,
            workspaceDirectory: item.workspaceDirectory,
            messageCount: item.messageCount,
            status: item.status,
            hasInterruptedRun: item.hasInterruptedRun,
          }));
          this.respondToIdeMessenger(messageId, { status: 'success', content });
          break;
        }

        case 'history/load': {
          const id = data?.id;
          if (!id) {
            this.respondToIdeMessenger(messageId, { status: 'error', error: 'Missing session id' });
            return;
          }
          const conv = this.conversationRepository ? await this.conversationRepository.getConversation(id) : null;
          if (!conv) {
            this.respondToIdeMessenger(messageId, { status: 'error', error: 'Conversation not found' });
            return;
          }
          this.currentSessionId = conv.sessionId;
          this.currentSessionHistory = conv.history || [];
          this.chatHistory = this.currentSessionHistory.map((h: any) => h.message || h);
          this.respondToIdeMessenger(messageId, { status: 'success', content: conv });
          break;
        }

        case 'history/save': {
          if (!data || !data.sessionId) {
            this.respondToIdeMessenger(messageId, { status: 'error', error: 'Missing session data' });
            return;
          }
          const saved = this.conversationRepository
            ? await this.conversationRepository.saveConversation(data)
            : data;
          this.currentSessionId = data.sessionId;
          this.currentSessionHistory = data.history || [];
          this.chatHistory = this.currentSessionHistory.map((h: any) => (h.message ? h.message : h));
          this.respondToIdeMessenger(messageId, { status: 'success', content: saved });
          break;
        }

        case 'history/delete': {
          const id = data?.id;
          if (!id) {
            this.respondToIdeMessenger(messageId, { status: 'error', error: 'Missing session id' });
            return;
          }
          if (this.conversationRepository) {
            await this.conversationRepository.deleteConversation(id);
          }
          if (this.currentSessionId === id) {
            this.currentSessionId = null;
            this.chatHistory = [];
            this.currentSessionHistory = [];
          }
          this.respondToIdeMessenger(messageId, { status: 'success' });
          break;
        }

        case 'history/clear': {
          if (this.conversationRepository) {
            await this.conversationRepository.clearAllConversations();
          }
          this.currentSessionId = null;
          this.chatHistory = [];
          this.currentSessionHistory = [];
          this.respondToIdeMessenger(messageId, { status: 'success' });
          break;
        }

        case 'chatDescriber/describe': {
          const text = data?.text || '';
          const title = this.generateTitleFromText(text);
          this.respondToIdeMessenger(messageId, { status: 'success', content: title });
          break;
        }

        case 'session/share': {
          const id = data?.sessionId;
          if (id && this.conversationRepository) {
            const conv = await this.conversationRepository.getConversation(id);
            if (conv) {
              const md = this.formatSessionAsMarkdown(conv);
              const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
              await vscode.window.showTextDocument(doc);
            }
          }
          this.respondToIdeMessenger(messageId, { status: 'success' });
          break;
        }

        case 'history/interrupted': {
          const interrupted = this.conversationRepository
            ? await this.conversationRepository.getInterruptedConversations()
            : [];
          this.respondToIdeMessenger(messageId, { status: 'success', content: interrupted });
          break;
        }

        case 'history/recover': {
          if (data?.sessionId && this.conversationRepository) {
            await this.conversationRepository.markStatus(data.sessionId, 'completed');
          }
          this.respondToIdeMessenger(messageId, { status: 'success' });
          break;
        }

        default:
          this.respondToIdeMessenger(messageId, { status: 'error', error: `Unknown request type: ${messageType}` });
          break;
      }
    } catch (err: any) {
      this.logger.error(`Error handling IdeMessenger message ${messageType}:`, err);
      this.respondToIdeMessenger(messageId, { status: 'error', error: err?.message || String(err) });
    }
  }

  private respondToIdeMessenger(messageId: string, data: any) {
    this.view?.webview.postMessage({
      messageId,
      data,
    });
  }

  private generateTitleFromText(text: string): string {
    if (!text) {
      return 'New Session';
    }
    const clean = text.replace(/^[#\s*>-]+/, '').trim().split('\n')[0];
    return clean.slice(0, 60) || 'New Session';
  }

  private formatSessionAsMarkdown(conv: StoredConversation): string {
    const lines: string[] = [`# ${conv.title || 'Chat Session'}\n`];
    lines.push(`_Date: ${new Date(conv.dateCreated).toLocaleString()} | Workspace: ${conv.workspaceName}_\n`);
    lines.push('---\n');

    for (const item of conv.history || []) {
      const msg = item.message || item;
      const role = msg.role === 'user' ? 'User' : 'Kodra';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);
      lines.push(`### ${role}:\n\n${content}\n`);
    }

    return lines.join('\n');
  }

  private async handleUserMessage(text: string, contextFiles?: string[], sessionId?: string) {
    const t0 = Date.now();
    const logger = this.logger;
    let unsubscribeActivity: (() => void) | undefined;
    let terminalSent = false;
    let agentActivityTerminalSent = false;
    let activeExecutionId = '';
    let accumulatedContent = '';
    this.ensureStorageServices();

    if (sessionId) {
      this.currentSessionId = sessionId;
    } else if (!this.currentSessionId) {
      this.currentSessionId = uuidv4();
    }

    this.chatHistory.push({ role: 'user', content: text });
    this.currentSessionHistory.push({
      message: { role: 'user', content: text, id: uuidv4() },
      contextItems: [],
    });

    const wsInfo = WorkspaceRegistry.getWorkspaceInfo();
    if (this.conversationRepository) {
      await this.conversationRepository.saveConversation({
        sessionId: this.currentSessionId!,
        title: this.generateTitleFromText(text),
        workspaceDirectory: wsInfo.path,
        workspaceId: wsInfo.id,
        workspaceName: wsInfo.name,
        history: this.currentSessionHistory,
        status: 'active',
      });
    }

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
          this.postMessage({ type: 'streamError', error: 'Ollama is not running. Please start it to use Kodra.' });
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
      const executionId = uuidv4();
      activeExecutionId = executionId;
      logger.info(
        `[KODRA Lifecycle] Request started executionId=${executionId} sessionId=${this.currentSessionId} provider=${config.provider} model=${modelName}`
      );
      if (this.executionJournal) {
        await this.executionJournal.startRun(this.currentSessionId!, executionId, wsInfo.id, {
          text,
          model: modelName,
          provider: config.provider,
          contextFiles,
        });
      }

      const requireApproval = vscode.workspace.getConfiguration('KODRA').get<boolean>('agent.requireApproval', true);
      const maxIterations = vscode.workspace.getConfiguration('KODRA').get<number>('agent.maxIterations', 15);

      if (this.agent) {
        this.agent.cancel();
      }
      this.agent = new AgentLoop(this.indexer, requireApproval);

      // ── Bridge AgentEventBus → agentActivity IPC messages ────────────────────
      const agentStartTime = Date.now();
      unsubscribeActivity = this.agent.getRuntime().onEvent(async (normalizedEvent) => {
        const execId = (normalizedEvent as any).executionId as string || executionId;
        switch (normalizedEvent.type) {
          case 'agent.started':
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: { kind: 'started', timestamp: normalizedEvent.timestamp },
            });
            break;

          case 'tool.started':
            if (this.executionJournal) {
              await this.executionJournal.appendEvent(this.currentSessionId!, execId, {
                type: 'tool.started',
                data: {
                  toolName: normalizedEvent.toolName,
                  toolCallId: normalizedEvent.toolCallId,
                  args: normalizedEvent.args,
                },
              });
            }
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: {
                kind: 'tool_started',
                toolName: normalizedEvent.toolName,
                toolCallId: normalizedEvent.toolCallId,
                args: normalizedEvent.args,
                timestamp: normalizedEvent.timestamp,
              },
            });
            break;

          case 'tool.requested':
            if (this.executionJournal) {
              await this.executionJournal.appendEvent(this.currentSessionId!, execId, {
                type: 'tool.requested',
                data: {
                  toolName: normalizedEvent.toolName,
                  toolCallId: normalizedEvent.toolCallId,
                  args: normalizedEvent.args,
                },
              });
            }
            break;

          case 'tool.completed':
            if (this.executionJournal) {
              await this.executionJournal.appendEvent(this.currentSessionId!, execId, {
                type: 'tool.completed',
                data: {
                  toolName: normalizedEvent.toolName,
                  toolCallId: normalizedEvent.toolCallId,
                  durationMs: normalizedEvent.durationMs,
                  success: normalizedEvent.result.success,
                  metadata: normalizedEvent.result.metadata,
                },
              });
            }
            if (this.artifactManager && (normalizedEvent.result.diff || normalizedEvent.result.filepath)) {
              const savedArt = await this.artifactManager.saveArtifact({
                conversationId: this.currentSessionId!,
                executionId: execId,
                title: `${normalizedEvent.toolName}: ${normalizedEvent.result.filepath || 'Patch'}`,
                type: normalizedEvent.result.diff ? 'patch' : 'file',
                filepath: normalizedEvent.result.filepath,
                filename: normalizedEvent.result.filepath ? path.basename(normalizedEvent.result.filepath) : undefined,
                content: normalizedEvent.result.content,
                diff: normalizedEvent.result.diff,
                metadata: {
                  toolCallId: normalizedEvent.toolCallId,
                  toolName: normalizedEvent.toolName,
                },
              });
              if (this.conversationRepository) {
                await this.conversationRepository.addArtifactRef(this.currentSessionId!, {
                  id: savedArt.id,
                  type: savedArt.type,
                  title: savedArt.title,
                  filename: savedArt.filename,
                  createdAt: savedArt.createdAt,
                });
              }
            }
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: {
                kind: 'tool_completed',
                toolName: normalizedEvent.toolName,
                toolCallId: normalizedEvent.toolCallId,
                durationMs: normalizedEvent.durationMs,
                success: normalizedEvent.result.success,
                metadata: normalizedEvent.result.metadata,
                timestamp: normalizedEvent.timestamp,
              },
            });
            break;

          case 'tool.failed':
            if (this.executionJournal) {
              await this.executionJournal.appendEvent(this.currentSessionId!, execId, {
                type: 'tool.failed',
                data: {
                  toolName: normalizedEvent.toolName,
                  toolCallId: normalizedEvent.toolCallId,
                  error: normalizedEvent.error,
                  durationMs: normalizedEvent.durationMs,
                },
              });
            }
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: {
                kind: 'tool_failed',
                toolName: normalizedEvent.toolName,
                toolCallId: normalizedEvent.toolCallId,
                error: normalizedEvent.error,
                durationMs: normalizedEvent.durationMs,
                timestamp: normalizedEvent.timestamp,
              },
            });
            break;

          case 'agent.completed':
            agentActivityTerminalSent = true;
            if (this.executionJournal) {
              await this.executionJournal.completeRun(this.currentSessionId!, execId, normalizedEvent.usage);
            }
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: {
                kind: 'completed',
                durationMs: normalizedEvent.durationMs,
                timestamp: normalizedEvent.timestamp,
              },
            });
            break;

          case 'agent.failed':
            agentActivityTerminalSent = true;
            if (this.executionJournal) {
              await this.executionJournal.failRun(this.currentSessionId!, execId, normalizedEvent.error);
            }
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: { kind: 'failed', error: normalizedEvent.error, timestamp: normalizedEvent.timestamp },
            });
            break;

          case 'agent.cancelled':
            agentActivityTerminalSent = true;
            if (this.executionJournal) {
              await this.executionJournal.cancelRun(this.currentSessionId!, execId);
            }
            this.postMessage({
              type: 'agentActivity',
              executionId: execId,
              event: { kind: 'cancelled', timestamp: normalizedEvent.timestamp },
            });
            break;
        }
      });

      const historyToPass = [...this.chatHistory];
      historyToPass.pop(); // remove last user message (passed separately)

      const tStream = Date.now();
      let ttftMs: number | null = null;
      let firstToken = true;

      const requestTimeoutSec = vscode.workspace.getConfiguration('KODRA').get<number>('agent.requestTimeout', 120);
      const stallTimeoutSec = vscode.workspace.getConfiguration('KODRA').get<number>('agent.streamStallTimeout', 60);

      const generator = this.agent.run(text, historyToPass, provider, {
        model: modelName,
        maxTokens: config.maxTokens,
        maxIterations: maxIterations,
        contextFiles,
        toolCalling,
        firstTokenTimeoutMs: requestTimeoutSec > 0 ? requestTimeoutSec * 1000 : 0,
        idleChunkTimeoutMs: stallTimeoutSec > 0 ? stallTimeoutSec * 1000 : 0,
      });

      accumulatedContent = '';
      let currentExecutionId: string | undefined = undefined;

      for await (const event of generator) {
        switch (event.type) {
          case 'agentStarted':
            currentExecutionId = event.executionId;
            this.postMessage({ type: 'agentStarted', executionId: event.executionId });
            break;

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
            this.postMessage({ type: 'toolCall', toolName: event.toolName, args: event.args, toolCallId: event.toolCallId });
            break;

          case 'toolStarted':
            this.postMessage({ type: 'toolStarted', toolName: event.toolName, toolCallId: event.toolCallId });
            break;

          case 'toolResult':
            this.postMessage({
              type: 'toolResult',
              toolName: event.toolName,
              content: event.result.content,
              success: event.result.success,
              toolCallId: event.toolCallId,
              durationMs: event.durationMs,
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
            terminalSent = true;
            this.postMessage({ type: 'streamError', error: event.error });
            if (this.conversationRepository) {
              await this.conversationRepository.saveConversation({
                sessionId: this.currentSessionId!,
                history: this.currentSessionHistory,
                status: 'error',
              });
            }
            break;

          case 'cancelled':
            terminalSent = true;
            this.postMessage({ type: 'streamCancelled' });
            if (this.conversationRepository) {
              await this.conversationRepository.saveConversation({
                sessionId: this.currentSessionId!,
                history: this.currentSessionHistory,
                status: 'interrupted',
              });
            }
            break;

          case 'done':
            terminalSent = true;
            this.postMessage({ type: 'streamDone' });
            if (accumulatedContent) {
              this.chatHistory.push({ role: 'assistant', content: accumulatedContent });
              this.currentSessionHistory.push({
                message: { role: 'assistant', content: accumulatedContent, id: uuidv4() },
                contextItems: [],
              });
            }
            if (this.artifactManager && accumulatedContent && (
              accumulatedContent.includes('# Plan') ||
              accumulatedContent.includes('## Plan') ||
              accumulatedContent.includes('# Implementation Plan') ||
              accumulatedContent.includes('## Implementation Plan') ||
              accumulatedContent.includes('# Task Breakdown') ||
              accumulatedContent.includes('## Task Breakdown')
            )) {
              try {
                const planArt = await this.artifactManager.saveArtifact({
                  conversationId: this.currentSessionId!,
                  executionId: currentExecutionId,
                  title: 'Implementation Plan',
                  type: 'plan',
                  content: accumulatedContent,
                });
                if (this.conversationRepository) {
                  await this.conversationRepository.addArtifactRef(this.currentSessionId!, {
                    id: planArt.id,
                    type: planArt.type,
                    title: planArt.title,
                    createdAt: planArt.createdAt,
                  });
                }
              } catch (artErr) {
                this.logger.warn('Failed to persist plan artifact', artErr);
              }
            }
            if (this.conversationRepository) {
              await this.conversationRepository.saveConversation({
                sessionId: this.currentSessionId!,
                history: this.currentSessionHistory,
                status: 'completed',
              });
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
      const errMsg = error instanceof Error ? error.message : String(error);
      if (this.conversationRepository && this.currentSessionId) {
        await this.conversationRepository.saveConversation({
          sessionId: this.currentSessionId,
          title: this.generateTitleFromText(text),
          history: this.currentSessionHistory,
          status: 'error',
        });
      }
      terminalSent = true;
      if (!agentActivityTerminalSent && activeExecutionId) {
        agentActivityTerminalSent = true;
        this.postMessage({
          type: 'agentActivity',
          executionId: activeExecutionId,
          event: { kind: 'failed', error: errMsg, timestamp: Date.now() },
        });
      }
      this.postMessage({
        type: 'streamError',
        error: errMsg,
      });
    } finally {
      if (!terminalSent) {
        terminalSent = true;
        if (accumulatedContent) {
          this.postMessage({ type: 'streamDone' });
          if (!agentActivityTerminalSent && activeExecutionId) {
            agentActivityTerminalSent = true;
            this.postMessage({
              type: 'agentActivity',
              executionId: activeExecutionId,
              event: { kind: 'completed', durationMs: Date.now() - t0, timestamp: Date.now() },
            });
          }
        } else {
          this.postMessage({
            type: 'streamError',
            error: 'Request terminated unexpectedly without completing.',
          });
          if (!agentActivityTerminalSent && activeExecutionId) {
            agentActivityTerminalSent = true;
            this.postMessage({
              type: 'agentActivity',
              executionId: activeExecutionId,
              event: { kind: 'failed', error: 'Request terminated unexpectedly.', timestamp: Date.now() },
            });
          }
        }
      }
      unsubscribeActivity?.();
      this.agent = null;
      logger.info(`[KODRA Lifecycle] Cleanup completed sessionId=${this.currentSessionId} executionId=${activeExecutionId} totalElapsed=${Date.now() - t0}ms`);
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
