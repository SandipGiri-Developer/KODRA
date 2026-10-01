/**
 * HTML content generator for Webviews (sidebar chat and dedicated settings panel).
 * 
 * Dynamically transforms the Vite-built webview/dist/index.html to work within VS Code's
 * webview security environment (asWebviewUri, strict CSP, nonces, and bootstrapping).
 * Chunk names and assets are NEVER hardcoded.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
  const title = options.title || 'Kodra';
  const initialRoute = options.initialRoute || '/';
  const isSettingsWindow = Boolean(options.isSettingsWindow);

  const distPath = path.join(extensionUri.fsPath, 'webview', 'dist');
  const indexPath = path.join(distPath, 'index.html');

  let rawHtml: string;
  if (fs.existsSync(indexPath)) {
    try {
      rawHtml = fs.readFileSync(indexPath, 'utf8');
    } catch (err) {
      return getErrorHtml('Failed to read webview/dist/index.html', err);
    }
  } else {
    // Graceful fallback for test environments or unbuilt state
    rawHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root">
      <div style="padding: 24px; font-family: monospace; color: #f48771;">
        <h3>Kodra Webview Bundle Not Found</h3>
        <p>The compiled webview file was not found at:</p>
        <code>${indexPath}</code>
      </div>
    </div>
  </body>
</html>`;
  }

  const nonce = getNonce();
  const csp = getCsp(webview, nonce);

  // Helper to convert relative dist paths to valid VS Code webview URIs
  const toWebviewUri = (pathStr: string): string => {
    if (/^(https?:|data:|blob:|vscode-webview:|#|mailto:)/i.test(pathStr)) {
      return pathStr;
    }
    const cleanPath = pathStr.replace(/^(\.\/|\/)/, '');
    const segments = cleanPath.split('/').filter(Boolean);
    const targetUri = vscode.Uri.joinPath(extensionUri, 'webview', 'dist', ...segments);
    return webview.asWebviewUri(targetUri).toString();
  };

  // Dynamically rewrite all relative src and href attributes to webview URIs
  let transformedHtml = rawHtml.replace(/\b(href|src)=["']([^"']+)["']/gi, (match, attr, url) => {
    if (/^(https?:|data:|blob:|vscode-webview:|#|mailto:)/i.test(url)) {
      return match;
    }
    return `${attr}="${toWebviewUri(url)}"`;
  });

  // Ensure all script tags have the CSP nonce
  transformedHtml = transformedHtml.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);

  // Inject CSP meta tag immediately after <head>
  transformedHtml = transformedHtml.replace(
    /<head>/i,
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
  );

  // Update document title if present
  if (/<title>.*?<\/title>/i.test(transformedHtml)) {
    transformedHtml = transformedHtml.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
  }

  // Base CSS styles for layout and dark theme background
  const baseStyles = `
    <style>
      body {
        padding: 0;
        margin: 0;
        height: 100vh;
        overflow: hidden;
        background-color: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #cccccc);
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      }
      #root {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .fallback-message {
        padding: 24px;
        color: var(--vscode-descriptionForeground, #888888);
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
    </style>
  `;

  // Inject base styles before </head>
  transformedHtml = transformedHtml.replace(/<\/head>/i, `${baseStyles}\n  </head>`);

  // Populate #root with a clean fallback message while React initializes
  transformedHtml = transformedHtml.replace(
    /<div id=["']root["']>\s*<\/div>/i,
    `<div id="root"><div class="fallback-message">Loading ${title}...</div></div>`
  );

  // Bootstrap script to initialize VS Code API bridge and global error handling
  const bootstrapScript = `
  <script nonce="${nonce}">
    var nl = String.fromCharCode(10);
    try {
      window.vscode = acquireVsCodeApi();
    } catch (e) {
      console.warn('acquireVsCodeApi already called or not available', e);
    }
    window.vscMediaUrl = "${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media'))}";
    window.vscLogoUrl = "${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'KODRA.png'))}";
    window.initialRoute = "${initialRoute}";
    window.isSettingsWindow = ${isSettingsWindow};

    function showError(title, detail) {
      var root = document.getElementById('root');
      if (!root) return;
      var box = document.createElement('div');
      box.style.cssText = 'color:#f48771;padding:16px;font-family:monospace;font-size:12px;overflow:auto;height:100%;box-sizing:border-box';
      
      var h = document.createElement('b');
      h.style.fontSize = '14px';
      h.textContent = title;
      box.appendChild(h);
      box.appendChild(document.createElement('br'));
      box.appendChild(document.createElement('br'));

      var pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;background:rgba(0,0,0,.3);padding:10px;border-radius:4px;max-height:60vh;overflow:auto';
      pre.textContent = detail;
      box.appendChild(pre);

      root.innerHTML = '';
      root.appendChild(box);
    }

    var _origError = console.error.bind(console);
    var _captured = [];
    console.error = function() {
      var args = Array.prototype.slice.call(arguments);
      _origError.apply(console, args);
      _captured.push(args.map(function(a){
        return typeof a === 'string' ? a : (a instanceof Error ? (a.stack || a.message) : JSON.stringify(a));
      }).join(' '));
    };

    window.addEventListener('error', function(event) {
      _origError('Webview script error:', event);
      var stack = (event.error && event.error.stack) ? event.error.stack : '';
      showError('Script Error: ' + (event.message || 'unknown'), (event.filename || '') + ':' + (event.lineno || '') + nl + stack);
    });

    window.addEventListener('unhandledrejection', function(event) {
      var reason = event.reason;
      var detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
      _origError('Webview unhandled rejection:', reason);
      showError('Unhandled Promise Rejection', detail);
    });

    setTimeout(function() {
      var root = document.getElementById('root');
      if (root && root.querySelector('.fallback-message')) {
        showError(
          'Kodra failed to start (timeout)',
          'React did not mount within 4 seconds.' + nl + nl +
          'Captured console.error calls:' + nl +
          (_captured.length ? _captured.join(nl + '---' + nl) : '(none)') + nl + nl +
          'Open VS Code Developer Tools (Help > Toggle Developer Tools) for details.'
        );
      }
    }, 4000);
  </script>
`;

  // Inject bootstrap script BEFORE any module scripts so window.vscode is immediately ready
  const firstScriptIndex = transformedHtml.search(/<script\b/i);
  if (firstScriptIndex !== -1) {
    transformedHtml =
      transformedHtml.substring(0, firstScriptIndex) +
      bootstrapScript +
      transformedHtml.substring(firstScriptIndex);
  } else {
    transformedHtml = transformedHtml.replace(/<\/body>/i, `${bootstrapScript}\n</body>`);
  }

  return transformedHtml;
}

export function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getMissingBuildHtml(indexPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #1e1e1e; color: #f48771; }
    code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; color: #fff; }
  </style>
</head>
<body>
  <h3>Kodra Webview Bundle Not Found</h3>
  <p>The compiled webview file was not found at:</p>
  <code>${indexPath}</code>
  <p style="margin-top: 16px;">Please run <code>npm run build:webview</code> in the extension directory to build it.</p>
</body>
</html>`;
}

function getErrorHtml(message: string, error: unknown): string {
  const detail = error instanceof Error ? (error.stack || error.message) : String(error);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { padding: 24px; font-family: monospace; background: #1e1e1e; color: #f48771; }
    pre { background: rgba(0,0,0,0.3); padding: 12px; border-radius: 4px; overflow-x: auto; color: #ccc; }
  </style>
</head>
<body>
  <h3>${message}</h3>
  <pre>${detail}</pre>
</body>
</html>`;
}
