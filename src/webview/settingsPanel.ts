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
import { WebviewSettingsBridge, IWebviewMessagePoster } from './webviewSettingsBridge';

export class SettingsPanel implements IWebviewMessagePoster {
  public static currentPanel: SettingsPanel | undefined;
  public static readonly viewType = 'KODRA.settingsPanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly providerRegistry: ProviderRegistry;
  private readonly logger = Logger.getInstance();
  private readonly settingsBridge: WebviewSettingsBridge;
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
    this.settingsBridge = new WebviewSettingsBridge(this.providerRegistry);

    // Set panel icon
    try {
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
        dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.png'),
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
    return this.panel.webview.postMessage(message);
  }

  public async sendSettingsData() {
    await this.settingsBridge.sendSettingsData(this);
  }

  public async sendConfig() {
    await this.settingsBridge.sendConfig(this);
  }

  private async handleMessage(data: unknown) {
    const msg = validateWebviewMessage(data);
    if (!msg) {
      this.logger.warn('Received invalid message from Settings webview', data);
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
          await this.sendSettingsData();
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
