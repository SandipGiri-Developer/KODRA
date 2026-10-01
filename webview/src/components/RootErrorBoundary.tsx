import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("RootErrorBoundary caught fatal React render error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetChat = () => {
    try {
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({ type: "newChat" });
      }
    } catch (e) {
      console.error("Failed to post newChat message", e);
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || String(this.state.error);
      const stack = this.state.error?.stack || "";
      const componentStack = this.state.errorInfo?.componentStack || "";

      return (
        <div
          style={{
            padding: "24px",
            color: "var(--vscode-foreground, #cccccc)",
            backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
            height: "100vh",
            overflowY: "auto",
            boxSizing: "border-box",
            fontFamily: "var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ fontSize: "22px", color: "var(--vscode-errorForeground, #f48771)" }}>⚠️</span>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--vscode-errorForeground, #f48771)" }}>
              Kodra Interface Render Error
            </h3>
          </div>

          <p style={{ margin: "0 0 12px 0", color: "var(--vscode-descriptionForeground, #999999)" }}>
            An unexpected error occurred while rendering the Kodra interface. The screen has been prevented from becoming a silent blank screen.
          </p>

          <pre
            style={{
              padding: "12px",
              backgroundColor: "var(--vscode-input-background, rgba(0,0,0,0.25))",
              border: "1px solid var(--vscode-input-border, rgba(255,255,255,0.1))",
              borderRadius: "4px",
              color: "var(--vscode-errorForeground, #f48771)",
              fontFamily: "var(--vscode-editor-font-family, Consolas, Monaco, monospace)",
              fontSize: "12px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "160px",
              overflowY: "auto",
            }}
          >
            {errorMsg}
          </pre>

          {(stack || componentStack) && (
            <details style={{ marginTop: "12px", marginBottom: "16px", cursor: "pointer" }}>
              <summary style={{ color: "var(--vscode-textLink-foreground, #3794ff)", fontSize: "12px" }}>
                View Stack Trace
              </summary>
              <pre
                style={{
                  marginTop: "8px",
                  padding: "10px",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontFamily: "Consolas, Monaco, monospace",
                  whiteSpace: "pre-wrap",
                  maxHeight: "220px",
                  overflowY: "auto",
                }}
              >
                {stack}
                {componentStack}
              </pre>
            </details>
          )}

          <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
            <button
              onClick={this.handleReload}
              style={{
                backgroundColor: "var(--vscode-button-background, #0e639c)",
                color: "var(--vscode-button-foreground, #ffffff)",
                border: "none",
                borderRadius: "3px",
                padding: "6px 14px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Reload Interface
            </button>
            <button
              onClick={this.handleResetChat}
              style={{
                backgroundColor: "var(--vscode-button-secondaryBackground, #3a3d41)",
                color: "var(--vscode-button-secondaryForeground, #ffffff)",
                border: "none",
                borderRadius: "3px",
                padding: "6px 14px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Start New Chat
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
