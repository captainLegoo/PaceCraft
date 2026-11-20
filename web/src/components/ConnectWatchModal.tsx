import { useState } from "react";
import { createPortal } from "react-dom";
import type { AuthStatus, GarminMultiAuthStatus } from "../api";
import { useI18n } from "../i18n";

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
  const { t, isZh } = useI18n();
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
      setErrorMsg(t("connect.garminKeyEmptyWarn", { region: region === "cn" ? (isZh ? "中国区" : "China") : (isZh ? "国际区" : "Global") }));
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setConnectingRegion(region);
    try {
      await onConnectGarmin(key, region);
      setSuccessMsg(t("connect.garminConnectSuccess", { region: region === "cn" ? (isZh ? "中国区" : "China") : (isZh ? "国际区" : "Global") }));
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
              <span>⌚</span> {t("connect.modalTitle")}
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0, lineHeight: 1.5 }}>
              {t("connect.modalDesc")}
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
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("connect.corosTab")}</span>
                <span style={{ fontSize: 11, color: "#3b82f6", background: "rgba(59,130,246,0.1)", padding: "1px 6px", borderRadius: 10 }}>
                  OAuth 2.0
                </span>
              </div>
              {corosAuth?.connected ? (
                <span style={{ fontSize: 11.5, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>
                  ● {t("connect.connected")} ({corosAuth.nickname || (isZh ? "已授权" : "Authorized")})
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{t("connect.notConnected")}</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
              {t("connect.corosDesc")}
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
                  {corosConnecting ? t("connect.connecting") : t("connect.connectCorosBtn")}
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
                    {t("connect.reauth")}
                  </button>
                  {confirmDisconnect !== "coros" ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect("coros")}
                      style={{ fontSize: 12, padding: "5px 12px", background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, cursor: "pointer" }}
                    >
                      {t("connect.disconnect")}
                    </button>
                  ) : (
                    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, color: "#ef4444" }}>{t("connect.disconnectConfirm")}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await onDisconnectCoros();
                          setConfirmDisconnect(null);
                        }}
                        style={{ fontSize: 11, padding: "3px 8px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(null)}
                        style={{ fontSize: 11, padding: "3px 6px", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                      >
                        {t("common.cancel")}
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
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("connect.garminRegionCn")}</span>
                <span style={{ fontSize: 11, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "1px 6px", borderRadius: 10 }}>
                  connect.garmin.cn
                </span>
              </div>
              {isGarminCnConnected ? (
                <span style={{ fontSize: 11.5, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>
                  ● {t("connect.connected")} ({garminAuth?.cn?.userFullName || (isZh ? "中国区账号" : "CN Account")})
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{t("connect.notConnected")}</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
              {isZh ? "适用于国行设备、Garmin Connect 中国版 App 用户，支持全量下载原始 .FIT 分圈文件。" : "For China mainland devices and Garmin Connect CN app accounts. Supports raw .FIT downloads."}
            </p>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 5 }}>
              ℹ️ {isZh ? "首次同步需回溯拉取 1 年历史分圈以构建全量预测模型与体能曲线，时间可能较长（约 20~60 秒）。" : "Initial sync downloads past 1 year of workout laps to build EWMA load curves (~20-60s)."}
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
                  {t("connect.disconnect")}
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    type="password"
                    placeholder={isZh ? "粘贴中国区 Key (GCDC_...)" : "Paste CN Key (GCDC_...)"}
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
                    {connectingRegion === "cn" ? (isZh ? "验证中…" : "Connecting...") : (isZh ? "连接中国区" : "Connect CN")}
                  </button>
                </div>
                <div style={{ fontSize: 11.5 }}>
                  <a
                    href="https://connect.garmin.cn/app/settings/personalApiToken"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    🔗 {isZh ? "打开 Garmin 中国区后台生成 Key (connect.garmin.cn)" : "Open Garmin CN Portal to generate Key (connect.garmin.cn)"}
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
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t("connect.garminRegionGlobal")}</span>
                <span style={{ fontSize: 11, color: "#60a5fa", background: "rgba(96,165,250,0.1)", padding: "1px 6px", borderRadius: 10 }}>
                  connect.garmin.com
                </span>
              </div>
              {isGarminGlobalConnected ? (
                <span style={{ fontSize: 11.5, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>
                  ● {t("connect.connected")} ({garminAuth?.global?.userFullName || (isZh ? "国际区账号" : "Global Account")})
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{t("connect.notConnected")}</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
              {isZh ? "适用于海外版设备、Garmin Connect 国际服 App 跑友。" : "For global Garmin watches & Garmin Connect Global app users worldwide."}
            </p>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10, padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 5 }}>
              ℹ️ {isZh ? "首次同步需回溯拉取 1 年历史分圈以构建全量预测模型与体能曲线，时间可能较长（约 20~60 秒）。" : "Initial sync downloads past 1 year of workout laps to build EWMA load curves (~20-60s)."}
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
                  {t("connect.disconnect")}
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    type="password"
                    placeholder={isZh ? "粘贴国际区 Key (GCDC_...)" : "Paste Global Key (GCDC_...)"}
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
                    {connectingRegion === "global" ? (isZh ? "验证中…" : "Connecting...") : (isZh ? "连接国际区" : "Connect Global")}
                  </button>
                </div>
                <div style={{ fontSize: 11.5 }}>
                  <a
                    href="https://connect.garmin.com/app/settings/personalApiToken"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                  >
                    🔗 {isZh ? "打开 Garmin 国际区后台生成 Key (connect.garmin.com)" : "Open Garmin Global Portal to generate Key (connect.garmin.com)"}
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
                <span style={{ fontSize: 13, fontWeight: 600 }}>{isZh ? "原始 .FIT / GPX 文件直读导入 & Suunto 颂拓" : "Raw .FIT / GPX File Direct Import & Suunto"}</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface)", padding: "1px 6px", borderRadius: 8 }}>
                {isZh ? "规划中" : "Upcoming"}
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: "4px 0 0 0" }}>
              {isZh ? "直接拖入任意运动手表导出的原始 .FIT 文件，本地即时解析。" : "Drop raw .FIT files directly for instant local parsing and analysis."}
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
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalDom, document.body) : null;
}
