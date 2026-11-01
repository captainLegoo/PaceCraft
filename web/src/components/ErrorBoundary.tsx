import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            maxWidth: 520,
            margin: "40px auto",
            background: "#1a1d24",
            color: "#f1f5f9",
            borderRadius: 12,
            border: "1px solid rgba(239, 68, 68, 0.4)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <h2 style={{ color: "#ef4444", marginTop: 0, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠️</span> 界面渲染异常
          </h2>
          <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
            移动端或浏览器加载时遇到了未捕获的错误：
          </p>
          <pre
            style={{
              background: "rgba(0,0,0,0.4)",
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              overflowX: "auto",
              color: "#f87171",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 16px",
                background: "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.clear();
                window.location.hash = "#/";
                window.location.reload();
              }}
              style={{
                padding: "8px 16px",
                background: "rgba(255,255,255,0.08)",
                color: "#cbd5e1",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              重置缓存
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
