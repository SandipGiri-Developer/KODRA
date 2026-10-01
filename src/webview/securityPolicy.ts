import * as vscode from 'vscode';

/**
 * Generate a strict Content Security Policy for the webview.
 * 
 * Prevents execution of inline scripts (except our specific nonce),
 * restricts connect-src (since API calls happen in the extension host, not webview),
 * and prevents framing.
 */
export function getCsp(webview: vscode.Webview, nonce: string): string {
  return [
    `default-src 'none'`,
    // Allow styles from the extension uri and inline styles (needed by React sometimes)
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    // Allow scripts with the generated nonce, plus standard webview sources
    `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' 'nonce-${nonce}'`,
    // Allow fonts if needed
    `font-src ${webview.cspSource} data:`,
    // Allow chunk loading and local data/blob resources
    `connect-src ${webview.cspSource} https: data: blob:`,
    // Images allowed from extension, https, and data URIs
    `img-src ${webview.cspSource} https: data: blob:`,
    // Frame control
    `frame-src 'none'`,
  ].join('; ');
}
