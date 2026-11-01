import { useEffect, useState } from "react";
import { api, type LanStatus } from "../api";
import { useClipboard } from "../utils/clipboard";
import QrCode from "./QrCode";

export default function LanAccessSection() {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const { copy, copied } = useClipboard();

  const loadStatus = async () => {
    try {
      const data = await api.getLanStatus();
      setStatus(data);
      if (!selectedIp && data.primaryIp) {
        setSelectedIp(data.primaryIp);
      }
    } catch (err: any) {
      console.warn("加载局域网状态失败:", err);
      setError(err?.message || "获取局域网状态失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleToggle = async (newVal: boolean) => {
    setToggling(true);
    setError(null);
    try {
      const res = await api.toggleLan(newVal);
      setStatus(res);
      if (res.primaryIp) setSelectedIp(res.primaryIp);
    } catch (err: any) {
      setError(err?.message || "切换局域网开关失败");
    } finally {
      setToggling(false);
    }
  };

  const activeIp = selectedIp || status?.primaryIp || "127.0.0.1";
  const activePort = status?.port || 43124;
  const activeUrl = `http://${activeIp}:${activePort}`;

  return (
    <div
      className="card"
      style={{
        position: "relative",
        overflow: "hidden",
        marginBottom: 14,
        borderColor: status?.enabled ? "rgba(16, 185, 129, 0.3)" : undefined,
      }}
    >
      {/* 顶栏：标题 + 状态 Badge + 拨动开关 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 className="card-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <span>📱</span> 手机端访问与局域网共享 (PWA)
          </h3>
          {loading ? (
            <span className="pill" style={{ fontSize: 11, opacity: 0.6 }}>检测中…</span>
          ) : status?.enabled ? (
            <span className="pill good" style={{ fontSize: 11, fontWeight: 600 }}>
              ● 局域网已开启 · 手机可直连
            </span>
          ) : (
            <span className="pill" style={{ fontSize: 11, opacity: 0.7 }}>
              ○ 已关闭 · 仅电脑本机
            </span>
          )}
        </div>

        {/* 开关控件 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 500 }}>
            {status?.enabled ? "允许局域网连入" : "仅本机私密模式"}
          </span>
          <label
            style={{
              position: "relative",
              display: "inline-block",
              width: 44,
              height: 24,
              cursor: toggling ? "wait" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={Boolean(status?.enabled)}
              disabled={toggling || loading}
              onChange={(e) => handleToggle(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: "absolute",
                cursor: "pointer",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: status?.enabled ? "var(--good, #10b981)" : "var(--border, #374151)",
                transition: "0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                borderRadius: 24,
                opacity: toggling ? 0.6 : 1,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  content: '""',
                  height: 18,
                  width: 18,
                  left: status?.enabled ? 23 : 3,
                  bottom: 3,
                  background: "#ffffff",
                  transition: "0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  borderRadius: "50%",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            </span>
          </label>
        </div>
      </div>

      <p className="card-sub" style={{ margin: "6px 0 10px" }}>
        跑步回来往沙发上一躺，手机扫码即可直接查看大屏看板与 AI 复盘。支持<strong>「添加到主屏幕」</strong>免上架全屏使用，数据 100% 仅保存在电脑本地。
      </p>

      {error && (
        <div
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            color: "var(--bad, #ef4444)",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {/* 开启后的详细面板：自适应双列（左列扫码与地址，右列 PWA 指南），彻底避免单列纵向拉伸产生空白 */}
      {status?.enabled && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 12,
            marginTop: 10,
          }}
        >
          {/* 左子卡：二维码与访问地址 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 14px",
              background: "var(--surface-2, rgba(255, 255, 255, 0.02))",
              border: "1px solid var(--border)",
              borderRadius: 10,
              flexWrap: "wrap",
            }}
          >
            {/* 二维码展示区 */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                background: "#ffffff",
                padding: "8px 8px 6px",
                borderRadius: 8,
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
                flexShrink: 0,
              }}
            >
              <QrCode text={activeUrl} size={118} border={2} />
              <div style={{ fontSize: 10.5, color: "#4b5563", fontWeight: 600 }}>
                手机自带相机扫码
              </div>
            </div>

            {/* 访问地址与操作 */}
            <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>
                手机浏览器访问网址：
              </div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: "var(--primary, #3b82f6)",
                  background: "var(--surface-3, rgba(0,0,0,0.25))",
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  wordBreak: "break-all",
                  userSelect: "all",
                }}
              >
                {activeUrl}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => copy(activeUrl)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    fontWeight: 500,
                    padding: "4px 10px",
                  }}
                >
                  {copied ? "✓ 已复制到剪贴板" : "📋 复制网址"}
                </button>

                {/* 多网卡切换 */}
                {status.allIps && status.allIps.length > 1 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                    <span style={{ color: "var(--text-dim)" }}>网卡:</span>
                    <select
                      value={activeIp}
                      onChange={(e) => setSelectedIp(e.target.value)}
                      style={{
                        padding: "2px 5px",
                        fontSize: 11.5,
                        borderRadius: 5,
                        background: "var(--surface-3, rgba(255,255,255,0.05))",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {status.allIps.map((n) => (
                        <option key={n.name + n.ip} value={n.ip}>
                          {n.name} ({n.ip})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                手机与电脑连同一个 Wi-Fi 即可秒开。
              </div>
            </div>
          </div>

          {/* 右子卡：PWA 手机安装全屏指南 */}
          <div
            style={{
              padding: "12px 14px",
              background: "rgba(59, 130, 246, 0.04)",
              border: "1px solid rgba(59, 130, 246, 0.18)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  color: "var(--primary, #3b82f6)",
                  fontWeight: 600,
                  fontSize: 12.5,
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>🚀</span> 开启全屏 App 体验（添加到主屏幕）
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--text)" }}>🍎 iPhone (Safari):</strong>
                  <ol style={{ margin: "2px 0 0 14px", padding: 0 }}>
                    <li>Safari 打开上述网址</li>
                    <li>底部「分享」图标</li>
                    <li>选择<strong>「添加到主屏幕」</strong></li>
                  </ol>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--text)" }}>🤖 Android (Chrome):</strong>
                  <ol style={{ margin: "2px 0 0 14px", padding: 0 }}>
                    <li>浏览器打开上述网址</li>
                    <li>右上角菜单「⋮」</li>
                    <li>选择<strong>「添加到主屏幕」</strong></li>
                  </ol>
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: 11,
                color: "var(--text-faint)",
                marginTop: 8,
                borderTop: "1px dashed rgba(255,255,255,0.08)",
                paddingTop: 5,
              }}
            >
              ★ 添加到主屏幕后自动隐藏浏览器顶部地址栏与底栏，享受 100% 沉浸全屏原生 App 手感与安全区避让。
            </div>
          </div>
        </div>
      )}

      {/* 底部小字说明 */}
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
          fontSize: 11,
          color: "var(--text-faint)",
        }}
      >
        <span>🔒 隐私优先：数据仅保存在你电脑本地 SQLite，不经由任何第三方公网服务器。</span>
        <span>💻 手机连入时请保持电脑开机。</span>
      </div>
    </div>
  );
}
