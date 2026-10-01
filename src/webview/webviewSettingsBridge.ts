/**
 * WebviewSettingsBridge — Unified IPC handler for model and provider settings.
 * 
 * Eliminates duplicate switch-case logic across KodraViewProvider and SettingsPanel,
 * providing a single source of truth for provider/model configuration operations.
 */

import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/registry';
import { SettingsManager } from '../utils/settingsManager';
import { Logger } from '../utils/logger';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './messageTypes';

export interface IWebviewMessagePoster {
  postMessage(message: ExtensionToWebviewMessage): Thenable<boolean> | void;
}

export class WebviewSettingsBridge {
  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly settingsManager: SettingsManager = SettingsManager.getInstance(),
    private readonly logger: Logger = Logger.getInstance(),
  ) {}

  /**
   * Broadcast current configuration to the webview.
   */
  public async sendConfig(poster: IWebviewMessagePoster): Promise<void> {
    try {
      const config = await this.providerRegistry.readConfig();
      const hasApiKey = Boolean(config.apiKey && config.apiKey.length > 0);

      poster.postMessage({
        type: 'config',
        provider: config.provider,
        model: config.modelName,
        hasApiKey,
        availableProviders: this.providerRegistry.getSupportedProviders(),
      });

      // Warm capabilities cache non-critically
      this.providerRegistry.warmCapabilities().catch(() => {});
    } catch (e) {
      this.logger.error('Failed to send configuration to webview', e);
    }
  }

  /**
   * Broadcast stored provider and workspace model settings to the webview.
   */
  public async sendSettingsData(poster: IWebviewMessagePoster): Promise<void> {
    try {
      const providers = await this.settingsManager.getProviders();
      const workspaceModels = await this.settingsManager.getWorkspaceModels();

      poster.postMessage({
        type: 'settingsData',
        providers,
        workspaceModels,
      });
    } catch (e) {
      this.logger.error('Failed to send settings data to webview', e);
    }
  }

  /**
   * Processes a webview message if it is a settings or model-configuration message.
   * Returns true if the message was handled, or false if it belongs to another domain.
   */
  public async handleSettingsMessage(
    msg: WebviewToExtensionMessage,
    poster: IWebviewMessagePoster,
  ): Promise<boolean> {
    switch (msg.type) {
      case 'getConfig':
        await this.sendConfig(poster);
        return true;

      case 'getSettings':
        await this.sendSettingsData(poster);
        return true;

      case 'setProvider':
        await vscode.workspace.getConfiguration('KODRA').update('provider', msg.provider, true);
        await this.sendConfig(poster);
        return true;

      case 'setModel':
        await vscode.workspace.getConfiguration('KODRA').update('modelName', msg.model, true);
        await this.sendConfig(poster);
        return true;

      case 'setApiKey':
        await this.providerRegistry.setApiKey(msg.provider, msg.key);
        await this.sendConfig(poster);
        return true;

      case 'testConnection':
        try {
          const provider = await this.providerRegistry.getProvider();
          const models = await provider.testConnection();
          poster.postMessage({ type: 'connectionResult', success: true, models });
        } catch (e) {
          poster.postMessage({
            type: 'connectionResult',
            success: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return true;

      case 'discoverModels':
        try {
          const models = await this.providerRegistry.discoverModels(msg.provider, msg.apiKey, msg.endpoint);
          poster.postMessage({ type: 'modelsDiscovered', provider: msg.provider, models });
        } catch (e) {
          poster.postMessage({
            type: 'modelsDiscovered',
            provider: msg.provider,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return true;

      case 'saveProviderSetting': {
        const providers = await this.settingsManager.getProviders();
        const idx = providers.findIndex((p) => p.id === msg.setting.id);

        if (msg.apiKey !== undefined) {
          if (msg.apiKey.trim().length > 0) {
            await this.settingsManager.saveApiKey(msg.setting.id, msg.apiKey);
            msg.setting.apiKeySecret = true;
          } else {
            await this.settingsManager.deleteApiKey(msg.setting.id);
            msg.setting.apiKeySecret = false;
          }
        }

        if (idx >= 0) {
          providers[idx] = msg.setting;
        } else {
          providers.push(msg.setting);
        }

        await this.settingsManager.saveProviders(providers);
        await this.sendSettingsData(poster);
        return true;
      }

      case 'deleteProviderSetting': {
        const providers = await this.settingsManager.getProviders();
        const updated = providers.filter((p) => p.id !== msg.id);
        await this.settingsManager.deleteApiKey(msg.id);
        await this.settingsManager.saveProviders(updated);
        await this.sendSettingsData(poster);
        return true;
      }

      case 'saveWorkspaceModels':
        await this.settingsManager.saveWorkspaceModels(msg.models);
        await this.sendSettingsData(poster);
        return true;

      default:
        return false;
    }
  }
}
