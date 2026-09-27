import * as vscode from 'vscode';

/**
 * Structured logger that writes to a dedicated VS Code output channel.
 * All log entries include timestamps and severity levels.
 */
export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Kodra');
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  info(message: string, ...args: unknown[]): void {
    this.log('INFO', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('WARN', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('ERROR', message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('DEBUG', message, ...args);
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = args.length > 0
      ? `[${timestamp}] [${level}] ${message} ${args.map(a => this.stringify(a)).join(' ')}`
      : `[${timestamp}] [${level}] ${message}`;
    this.outputChannel.appendLine(formatted);

    if (level === 'ERROR') {
      console.error(`[Kodra] ${message}`, ...args);
    }
  }

  private stringify(value: unknown): string {
    if (value instanceof Error) {
      return `${value.message}\n${value.stack ?? ''}`;
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}
