/**
 * HTML content generator for Webviews (sidebar chat and dedicated settings panel).
 */

import * as vscode from 'vscode';
import { getCsp } from './securityPolicy';

export interface WebviewHtmlOptions {
  title?: string;
  initialRoute?: string;
  isSettingsWindow?: boolean;
}

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  options: WebviewHtmlOptions = {}
): string {
  // Determine paths to the compiled React webview assets
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'dist', 'assets', 'index.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview', 'dist', 'assets', 'index.css')
  );

  const nonce = getNonce();
  const csp = getCsp(webview, nonce);
  const title = options.title || 'Kodra';
  const initialRoute = options.initialRoute || '/';
  const isSettingsWindow = Boolean(options.isSettingsWindow);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${title}</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>
    body { padding: 0; margin: 0; height: 100vh; overflow: hidden; }
    #root { height: 100%; display: flex; flex-direction: column; }
    .fallback-message { padding: 20px; font-family: sans-serif; }
  </style>
</head>
<body>
  <div id="root">
    <div class="fallback-message">
      Loading ${title}...
      <br><br>
      <small>If this stays here, run <code>npm run build:webview</code> to compile the React frontend.</small>
    </div>
  </div>
  <script nonce="${nonce}">
    // Pass VS Code API to the React app
    window.vscode = acquireVsCodeApi();
    window.vscMediaUrl = "${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'KODRA.png'))}";
    window.initialRoute = "${initialRoute}";
    window.isSettingsWindow = ${isSettingsWindow};
    
    // Global error handler to catch script loading/syntax errors
    window.addEventListener('error', function(event) {
      document.body.innerHTML += '<div style="color: red; padding: 20px;">' + 
        '<h3>Critical Webview Error</h3>' +
        '<pre style="white-space: pre-wrap;">' + event.message + '\\n' + event.filename + ':' + event.lineno + '</pre>' +
        '</div>';
    });
  </script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
