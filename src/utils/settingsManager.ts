import * as vscode from 'vscode';
import { ProviderSettings, WorkspaceModel } from '../providers/types';

export class SettingsManager {
  private static instance: SettingsManager;
  private secretStorage: vscode.SecretStorage;
  private readonly _onDidChangeSettings = new vscode.EventEmitter<void>();
  public readonly onDidChangeSettings = this._onDidChangeSettings.event;

  private constructor(context: vscode.ExtensionContext) {
    this.secretStorage = context.secrets;
    if (context.subscriptions) {
      context.subscriptions.push(this._onDidChangeSettings);
      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration('arc1610')) {
            this._onDidChangeSettings.fire();
          }
        })
      );
    }
  }

  public static initialize(context: vscode.ExtensionContext) {
    if (!this.instance) {
      this.instance = new SettingsManager(context);
    }
  }

  public static getInstance(): SettingsManager {
    if (!this.instance) {
      throw new Error('SettingsManager not initialized');
    }
    return this.instance;
  }

  private getConfig() {
    return vscode.workspace.getConfiguration('arc1610');
  }

  public async getProviders(): Promise<ProviderSettings[]> {
    const config = this.getConfig();
    return config.get<ProviderSettings[]>('providers', []);
  }

  public async saveProviders(providers: ProviderSettings[]): Promise<void> {
    const config = this.getConfig();
    await config.update('providers', providers, vscode.ConfigurationTarget.Global);
    this._onDidChangeSettings.fire();
  }

  public async getWorkspaceModels(): Promise<WorkspaceModel[]> {
    const config = this.getConfig();
    return config.get<WorkspaceModel[]>('workspaceModels', []);
  }

  public async saveWorkspaceModels(models: WorkspaceModel[]): Promise<void> {
    const config = this.getConfig();
    await config.update('workspaceModels', models, vscode.ConfigurationTarget.Global);
    this._onDidChangeSettings.fire();
  }

  public async getApiKey(providerId: string): Promise<string | undefined> {
    return await this.secretStorage.get(`arc1610.provider.${providerId}.apiKey`);
  }

  public async saveApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.secretStorage.store(`arc1610.provider.${providerId}.apiKey`, apiKey);
    this._onDidChangeSettings.fire();
  }

  public async deleteApiKey(providerId: string): Promise<void> {
    await this.secretStorage.delete(`arc1610.provider.${providerId}.apiKey`);
    this._onDidChangeSettings.fire();
  }
}
