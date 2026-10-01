import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import App from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import "./index.css";
import { store } from "./redux/store";

try {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Missing #root container element in webview HTML");
  }

  const root = ReactDOM.createRoot(container);

  root.render(
    <React.StrictMode>
      <RootErrorBoundary>
        <Provider store={store}>
          <App />
        </Provider>
      </RootErrorBoundary>
    </React.StrictMode>,
  );

  // Notify extension host that webview is mounted and ready to receive initial state
  if ((window as any).vscode) {
    (window as any).vscode.postMessage({ type: "webviewReady" });
  }
} catch (err: any) {
  console.error("Critical error mounting Kodra webview:", err);
  const container = document.getElementById("root");
  if (container) {
    container.innerHTML = `
      <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--vscode-foreground, #ccc);">
        <h3 style="color: var(--vscode-errorForeground, #f48771); margin-top: 0;">Kodra failed to start</h3>
        <pre style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${err?.message || String(err)}</pre>
        <button onclick="window.location.reload()" style="margin-top: 12px; background: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #fff); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px;">
          Retry
        </button>
      </div>
    `;
  }
}
