import * as vscode from 'vscode';
import * as cp from 'child_process';
import { Logger } from './logger';

export class OllamaManager {
  /**
   * A singleton startup promise. When non-null, Ollama is in the process of being
   * started. All concurrent callers await this same promise to prevent multi-spawn.
   */
  private static startupPromise: Promise<boolean> | null = null;

  /**
   * Guards the user-facing warning dialog to ensure it is only shown once at a time.
   */
  private static isPrompting = false;

  /**
   * Timestamp (ms) of the last successful ping. Used to skip redundant pings within
   * a short window. 30 seconds is long enough to avoid per-message overhead while
   * still detecting restarts quickly.
   */
  private static lastConfirmedAt = 0;
  private static readonly CONFIRMED_TTL_MS = 30_000;

  /**
   * Silently checks if Ollama is reachable. Does NOT prompt the user.
   * Use this for background tasks (indexing, embeddings) that should not interrupt the user.
   * Results are cached for 30 seconds to avoid repeated pings.
   */
  static async isRunning(endpoint: string = 'http://127.0.0.1:11434'): Promise<boolean> {
    if (Date.now() - this.lastConfirmedAt < this.CONFIRMED_TTL_MS) {
      return true;
    }
    const running = await this.ping(endpoint);
    if (running) { this.lastConfirmedAt = Date.now(); }
    return running;
  }

  /**
   * Ensures Ollama is running, prompting the user to start it if not.
   * Only one user-facing prompt can be shown at a time. If startup is already
   * in progress, all callers await the same singleton promise.
   * Results are cached for 30 seconds to avoid a ping on every message.
   *
   * @returns true if Ollama is running (or was successfully started), false otherwise.
   */
  static async ensureRunning(endpoint: string = 'http://127.0.0.1:11434'): Promise<boolean> {
    // Fast path: confirmed running recently — skip the HTTP round-trip
    if (Date.now() - this.lastConfirmedAt < this.CONFIRMED_TTL_MS) {
      return true;
    }

    // Actual ping — Ollama was not confirmed running within the TTL
    if (await this.ping(endpoint)) {
      this.lastConfirmedAt = Date.now();
      return true;
    }

    // Prevent multiple simultaneous user-facing dialogs
    if (this.isPrompting) {
      return false;
    }

    this.isPrompting = true;
    try {
      const selection = await vscode.window.showWarningMessage(
        'Ollama is not running. KODRA needs it to generate responses.',
        'Start Ollama',
        'Cancel'
      );

      if (selection !== 'Start Ollama') {
        return false;
      }

      // Create the singleton startup promise — all concurrent callers will share this
      this.startupPromise = this.startOllama(endpoint).finally(() => {
        this.startupPromise = null;
      });

      const started = await this.startupPromise;
      if (started) { this.lastConfirmedAt = Date.now(); }
      return started;
    } finally {
      this.isPrompting = false;
    }
  }

  /**
   * Ping Ollama's root endpoint. Returns true if responsive.
   */
  private static async ping(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Spawns 'ollama serve' as a fully detached, hidden background process.
   * Polls until Ollama is reachable or the timeout expires.
   * This method is guaranteed to be called at most once concurrently.
   */
  private static startOllama(endpoint: string): Promise<boolean> {
    const logger = Logger.getInstance();

    return new Promise<boolean>((resolve) => {
      logger.info('[OllamaManager] Spawning ollama serve...');

      let spawnFailed = false;

      const child = cp.spawn('ollama', ['serve'], {
        detached: true,
        shell: false,        // CRITICAL on Windows: prevents a cmd.exe window from opening
        windowsHide: true,   // Belt-and-suspenders: hides any window the OS might create
        stdio: 'ignore',     // Detach stdio so the extension host doesn't hold pipes open
      });

      // Listen for spawn errors (e.g., ollama not in PATH)
      child.on('error', (err) => {
        spawnFailed = true;
        logger.error('[OllamaManager] Failed to spawn ollama process', err);
        vscode.window.showErrorMessage(
          'Failed to start Ollama. Make sure it is installed and available in your system PATH.'
        );
        resolve(false);
      });

      // Detach the child so it outlives the extension host
      child.unref();

      // Show a progress notification and poll until Ollama responds
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Starting Ollama...',
          cancellable: false,
        },
        async () => {
          // Give the error event a tick to fire before we start polling
          await new Promise(r => setTimeout(r, 500));

          if (spawnFailed) {
            return; // resolve(false) already called in the error handler
          }

          // Poll for up to 20 seconds (once per second)
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 1000));

            if (spawnFailed) {
              return;
            }

            if (await this.ping(endpoint)) {
              vscode.window.showInformationMessage('Ollama started successfully.');
              resolve(true);
              return;
            }
          }

          // Timed out
          vscode.window.showErrorMessage(
            'Ollama was started but is not responding. You may need to start it manually.'
          );
          resolve(false);
        }
      );
    });
  }
}
