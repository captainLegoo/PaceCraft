import { useState } from "react";
import { createPortal } from "react-dom";
import type { AuthStatus, GarminMultiAuthStatus } from "../api";

export default function ConnectWatchModal({
  open,
  onClose,
  corosAuth,
  corosConnecting,
  onConnectCoros,
  onDisconnectCoros,
  garminAuth,
  onConnectGarmin,
  onDisconnectGarmin,
}: {
  open: boolean;
  onClose: () => void;
  corosAuth: AuthStatus | null;
  corosConnecting: boolean;
  onConnectCoros: () => void;
  onDisconnectCoros: () => Promise<void> | void;
  garminAuth: GarminMultiAuthStatus | null;
  onConnectGarmin: (apiKey: string, region: "auto" | "global" | "cn") => Promise<void>;
  onDisconnectGarmin: (region?: "cn" | "global") => Promise<void> | void;
}) {
  const [cnKey, setCnKey] = useState("");
  const [globalKey, setGlobalKey] = useState("");
  const [connectingRegion, setConnectingRegion] = useState<"cn" | "global" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<"coros" | "garmin" | null>(null);

  if (!open) return null;

  const handleGarminSubmit = async (region: "cn" | "global") => {
    const key = region === "cn" ? cnKey.trim() : globalKey.trim();
    if (!key) {
      setErrorMsg(`请输入 Garmin (${region === "cn" ? "中国区" : "国际区"}) Personal API Key`);
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setConnectingRegion(region);
    try {
      await onConnectGarmin(key, region);
      setSuccessMsg(`Garmin ${region === "cn" ? "中国区" : "国际区"} 连接成功！`);
      if (region === "cn") setCnKey("");
      else setGlobalKey("");
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setConnectingRegion(null);
    }
  };

  const isGarminCnConnected = Boolean(garminAuth?.cn?.connected);
  const isGarminGlobalConnected = Boolean(garminAuth?.global?.connected);

  const modalDom = (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 999999,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !connectingRegion && !corosConnecting) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius, 12px)",
          boxShadow: "0 20px 45px -8px rgba(0, 0, 0, 0.5)",
          boxSizing: "border-box",
          padding: "22px 24px",
          fontFamily: "var(--font)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <span>⌚</span> 连接运动手表 / 数据源
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0, lineHeight: 1.5 }}>
              支持多品牌无缝并存。无论今天戴佳明、明天戴高驰，数据 100% 仅保存在你的本地电脑。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-dim)",
              fontSize: 18,
              cursor: "pointer",
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Global Messages */}
        {errorMsg && (
          <div style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 14 }}>
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#10b981", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 14 }}>
            {successMsg}
          </div>
        )}

        {/* List of Data Sources */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Card 1: COROS */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "14px 16px",
              background: "var(--surface-2, rgba(255,255,255,0.02))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🏃</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>COROS 高驰</span>
                <span style={{ fontSize: 11, color: "#3b82f6", background: "rgba(59,130,246,0.1)", padding: "1px 6px", borderRadius: 10 }}>
                  官方 Web OAuth
                </span>
              </div>
              {corosAuth?.connected ? (
                <span style={{ fontSize: 11.5, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>
                  ● 已连接 ({corosAuth.nickname || "已授权"})
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>未连接</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
              通过高驰官方开放平台授权，支持一键拉取全部历史活动、分圈与体能负荷。
            </p>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {!corosAuth?.connected ? (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    onConnectCoros();
                  }}
                  disabled={corosConnecting}
                  style={{
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {corosConnecting ? "正在调起浏览器授权…" : "🔗 前往高驰网页一键授权"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      onConnectCoros();
                    }}
                    disabled={corosConnecting}
                    style={{ fontSize: 12, padding: "5px 12px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, cursor: "pointer" }}
                  >
                    重新授权
                  </button>
                  {confirmDisconnect !== "coros" ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect("coros")}
                      style={{ fontSize: 12, padding: "5px 12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, cursor: "pointer" }}
                    >
                      解除绑定
                    </button>
                  ) : (
                    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, color: "#ef4444" }}>确定解除？</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDisconnectCoros();
                          setConfirmDisconnect(null);
                        }}
                        style={{ fontSize: 11, padding: "3px 8px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(null)}
                        style={{ fontSize: 11, padding: "3px 6px", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Card 2: Garmin China */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "14px 16px",
              background: "var(--surface-2, rgba(255,255,255,0.02))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🇨🇳</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Garmin 佳明 (中国区)</span>
                <span style={{ fontSize: 11, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "1px 6px", borderRadius: 10 }}>
                  connect.garmin.cn
                </span>
              </div>
              {isGarminCnConnected ? (
                <span style={{ fontSize: 11.5, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>
                  ● 已连接 ({garminAuth?.cn?.userFullName || "中国区账号"})
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>未连接</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
              适用于国行设备、Garmin Connect 中国版 App 用户，支持全量下载原始 .FIT 分圈文件。
            </p>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 5 }}>
              ℹ️ 首次同步需回溯拉取 1 年历史分圈以构建全量预测模型与体能曲线，时间可能较长（约 20~60 秒）。
            </div>

            {isGarminCnConnected ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={async () => {
                    await onDisconnectGarmin("cn");
                  }}
                  style={{ fontSize: 12, padding: "5px 12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, cursor: "pointer" }}
                >
                  解除绑定
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    type="password"
                    placeholder="粘贴中国区 Key (GCDC_...)"
                    value={cnKey}
                    onChange={(e) => setCnKey(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 200,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 12.5,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleGarminSubmit("cn")}
                    disabled={connectingRegion === "cn" || !cnKey.trim()}
                    style={{
                      background: "#10b981",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 14px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      opacity: connectingRegion === "cn" || !cnKey.trim() ? 0.6 : 1,
                    }}
                  >
                    {connectingRegion === "cn" ? "验证中…" : "连接中国区"}
                  </button>
                </div>
                <div style={{ fontSize: 11.5 }}>
                  <a
                    href="https://connect.garmin.cn/app/settings/personalApiToken"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    🔗 打开 Garmin 中国区后台生成 Key (connect.garmin.cn)
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Garmin Global */}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "14px 16px",
              background: "var(--surface-2, rgba(255,255,255,0.02))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🌐</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Garmin 佳明 (国际区)</span>
                <span style={{ fontSize: 11, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "1px 6px", borderRadius: 10 }}>
                  connect.garmin.com
                </span>
              </div>
              {isGarminGlobalConnected ? (
                <span style={{ fontSize: 11.5, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>
                  ● 已连接 ({garminAuth?.global?.userFullName || "国际区账号"})
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>未连接</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
              适用于海外版设备、Garmin Connect 国际服 App 跑友。
            </p>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 5 }}>
              ℹ️ 首次同步需回溯拉取 1 年历史分圈以构建全量预测模型与体能曲线，时间可能较长（约 20~60 秒）。
            </div>

            {isGarminGlobalConnected ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={async () => {
                    await onDisconnectGarmin("global");
                  }}
                  style={{ fontSize: 12, padding: "5px 12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, cursor: "pointer" }}
                >
                  解除绑定
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    type="password"
                    placeholder="粘贴国际区 Key (GCDC_...)"
                    value={globalKey}
                    onChange={(e) => setGlobalKey(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 200,
                      padding: "6px 10px",
                      borderRadius: 6,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 12.5,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleGarminSubmit("global")}
                    disabled={connectingRegion === "global" || !globalKey.trim()}
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 14px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      opacity: connectingRegion === "global" || !globalKey.trim() ? 0.6 : 1,
                    }}
                  >
                    {connectingRegion === "global" ? "验证中…" : "连接国际区"}
                  </button>
                </div>
                <div style={{ fontSize: 11.5 }}>
                  <a
                    href="https://connect.garmin.com/app/settings/personalApiToken"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    🔗 打开 Garmin 国际区后台生成 Key (connect.garmin.com)
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Card 4: Suunto / Local FIT (Upcoming) */}
          <div
            style={{
              border: "1px dashed var(--border)",
              borderRadius: 8,
              padding: "12px 16px",
              background: "rgba(255,255,255,0.01)",
              opacity: 0.75,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15 }}>📁</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>原始 .FIT / GPX 文件直读导入 & Suunto 颂拓</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface)", padding: "1px 6px", borderRadius: 8 }}>
                规划中
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "4px 0 0 0" }}>
              直接拖入任意运动手表导出的原始 .FIT 文件，本地即时解析。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalDom, document.body) : null;
}
