/**
 * Dedicated WebviewPanel for Kodra Settings.
 * 
 * Provides an independent, dedicated window/editor surface for Settings
 * that operates separately from the Chat sidebar view.
 */

import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/registry';
import { Logger } from '../utils/logger';
import { SettingsManager } from '../utils/settingsManager';
import { getWebviewContent } from './htmlHelper';
import { ExtensionToWebviewMessage, validateWebviewMessage } from './messageTypes';

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  public static readonly viewType = 'KODRA.settingsPanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly providerRegistry: ProviderRegistry;
  private readonly logger = Logger.getInstance();
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    providerRegistry: ProviderRegistry,
    viewColumn?: vscode.ViewColumn
  ): SettingsPanel {
    const column = viewColumn || (vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One);

    // If we already have a panel, reveal it.
    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      return SettingsPanel.currentPanel;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'Kodra Settings',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, providerRegistry);
    return SettingsPanel.currentPanel;
  }

  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    providerRegistry: ProviderRegistry
  ): SettingsPanel {
    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, providerRegistry);
    return SettingsPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    providerRegistry: ProviderRegistry
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.providerRegistry = providerRegistry;

    // Set panel icon
    try {
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.webp'),
        dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.webp'),
      };
    } catch {
      // Ignore if icon not found
    }

    // Set the webview's initial html content
    this.panel.webview.html = getWebviewContent(this.panel.webview, this.extensionUri, {
      title: 'Kodra Settings',
      initialRoute: '/config',
      isSettingsWindow: true,
    });

    // Listen for when the panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (data) => this.handleMessage(data),
      null,
      this.disposables
    );

    // Subscribe to external settings changes
    try {
      const settingsManager = SettingsManager.getInstance();
      this.disposables.push(
        settingsManager.onDidChangeSettings(() => {
          this.sendSettingsData();
          this.sendConfig();
        })
      );
    } catch {
      // SettingsManager might not be initialized yet in test environments
    }

    // Send initial configuration and settings data
    this.sendConfig();
    this.sendSettingsData();
  }

  public postMessage(message: ExtensionToWebviewMessage) {
    this.panel.webview.postMessage(message);
  }

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
      this.logger.error('Failed to send settings data to SettingsPanel', e);
    }
  }

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
    } catch (e) {
      this.logger.error('Failed to send config to SettingsPanel', e);
    }
  }

  private async handleMessage(data: unknown) {
    const msg = validateWebviewMessage(data);
    if (!msg) {
      this.logger.warn('Received invalid message from Settings webview', data);
      return;
    }

    try {
      switch (msg.type) {
        case 'webviewReady':
          this.sendConfig();
          this.sendSettingsData();
          break;

        case 'getSettings':
          await this.sendSettingsData();
          break;

        case 'getConfig':
          await this.sendConfig();
          break;

        case 'returnToChat':
        case 'closeSettings':
          // Focus chat view and dispose settings panel
          vscode.commands.executeCommand('KODRA.chatView.focus');
          this.dispose();
          break;

        case 'executeCommand':
          if (msg.args && msg.args.length > 0) {
            vscode.commands.executeCommand(msg.command, ...msg.args);
          } else {
            vscode.commands.executeCommand(msg.command);
          }
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
              error: e instanceof Error ? e.message : String(e),
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
              error: e instanceof Error ? e.message : String(e),
            });
          }
          break;

        case 'saveProviderSetting': {
          const manager = SettingsManager.getInstance();
          const providers = await manager.getProviders();
          const idx = providers.findIndex((p) => p.id === msg.setting.id);

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
          const updated = providers.filter((p) => p.id !== msg.id);
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
      }
    } catch (error) {
      this.logger.error(`Error handling Settings webview message: ${msg.type}`, error);
    }
  }

  private isDisposing = false;

  public dispose() {
    if (this.isDisposing) {
      return;
    }
    this.isDisposing = true;
    SettingsPanel.currentPanel = undefined;

    // Clean up our resources
    this.panel.dispose();

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}

/**
 * Serializer to restore the SettingsPanel when VS Code restarts/reloads.
 */
export class SettingsPanelSerializer implements vscode.WebviewPanelSerializer {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly providerRegistry: ProviderRegistry
  ) {}

  async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, _state: unknown) {
    SettingsPanel.revive(webviewPanel, this.extensionUri, this.providerRegistry);
  }
}
