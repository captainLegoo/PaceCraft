import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export type ReleaseCheckResponse = {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  publishedAt?: string;
  downloadUrl: string;
  routeUsed: string;
};

export default function UpdateModal({
  open,
  onClose,
  currentAppVersion,
}: {
  open: boolean;
  onClose: () => void;
  currentAppVersion: string;
}) {
  const [checking, setChecking] = useState(false);
  const [updateObj, setUpdateObj] = useState<Update | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error"
  >("idle");
  const [progress, setProgress] = useState<{ downloaded: number; total: number; percent: number }>({
    downloaded: 0,
    total: 0,
    percent: 0,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const downloadedRef = useRef(0);
  const totalRef = useRef(0);
  const inFlightRef = useRef(false);

  const executeCheck = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setChecking(true);
    setStatus("checking");
    setErrorMsg(null);
    setUpdateObj(null);
    setNewVersion(null);
    setNotes(null);

    try {
      const startTime = Date.now();
      // 手动触发检查时携带 force=true，强制穿透后端缓存重新向远端获取
      const checkRes = await fetch(
        `/api/updater/check?currentVersion=${encodeURIComponent(currentAppVersion)}&channel=auto&force=true&_t=${Date.now()}`
      );
      if (!checkRes.ok) {
        throw new Error(`无法获取更新信息 (${checkRes.status})`);
      }
      const data: ReleaseCheckResponse = await checkRes.json();

      // 保证至少展示 450ms 的检查动效，给用户明确的“正在实时联网探测”的视觉反馈
      const elapsed = Date.now() - startTime;
      if (elapsed < 450) {
        await new Promise((r) => setTimeout(r, 450 - elapsed));
      }

      if (data.hasUpdate && data.latestVersion) {
        setNewVersion(data.latestVersion);
        setNotes(data.releaseNotes || "");

        if (isTauriEnv()) {
          try {
            const tauriUpdate = await check();
            if (tauriUpdate) {
              setUpdateObj(tauriUpdate);
            }
          } catch (e) {
            console.warn("Tauri updater check background notice:", e);
          }
        }

        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch (err: any) {
      console.warn("Check update failed:", err);
      setStatus("error");
      setErrorMsg(err?.message || "网络连接异常，暂时无法连接更新服务器");
    } finally {
      inFlightRef.current = false;
      setChecking(false);
    }
  }, [currentAppVersion]);

  useEffect(() => {
    if (open) {
      executeCheck();
    } else {
      setStatus("idle");
      setUpdateObj(null);
      setNewVersion(null);
      setNotes(null);
      setErrorMsg(null);
    }
  }, [open, executeCheck]);

  // 桌面端快捷键：按 ESC 键优雅关闭弹窗（下载中禁止）
  useEffect(() => {
    if (!open || status === "downloading") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, status, onClose]);

  const handleStartUpdate = async () => {
    if (!isTauriEnv() || !updateObj) {
      window.open("https://github.com/captainLegoo/PaceCraft/releases/latest", "_blank");
      return;
    }

    setStatus("downloading");
    setErrorMsg(null);
    downloadedRef.current = 0;
    totalRef.current = 0;
    setProgress({ downloaded: 0, total: 0, percent: 0 });

    try {
      await updateObj.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalRef.current = event.data.contentLength ?? 0;
          setProgress({
            downloaded: 0,
            total: totalRef.current,
            percent: 0,
          });
        } else if (event.event === "Progress") {
          downloadedRef.current += event.data.chunkLength;
          const total = totalRef.current;
          const pct = total > 0 ? Math.min(100, Math.round((downloadedRef.current / total) * 100)) : 0;
          setProgress({
            downloaded: downloadedRef.current,
            total,
            percent: pct,
          });
        } else if (event.event === "Finished") {
          setProgress((prev) => ({ ...prev, percent: 100 }));
        }
      });

      setStatus("ready");
    } catch (err: any) {
      console.error("Download/Install update failed:", err);
      setStatus("error");
      const raw = String(err?.message || err || "");
      if (/Operation not permitted|Read-only|Permission denied|os error 1/i.test(raw)) {
        setErrorMsg("更新写入受限：若在 macOS 上运行，请确保已将应用移入「应用程序」文件夹，而非直接在 DMG 挂载盘中运行。");
      } else {
        setErrorMsg(raw || "安装包下载中断或签名校验未通过");
      }
    }
  };

  const handleRestart = async () => {
    try {
      await relaunch();
    } catch (err) {
      console.error("Relaunch failed:", err);
      window.location.reload();
    }
  };

  if (!open) return null;

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return "";
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const cleanCurrent = currentAppVersion.replace(/^v/, "");

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
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        boxSizing: "border-box",
        overscrollBehavior: "contain",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== "downloading") {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius, 10px)",
          boxShadow: "0 12px 32px -4px rgba(0, 0, 0, 0.35)",
          boxSizing: "border-box",
          padding: "20px 22px",
          fontFamily: "var(--font)",
        }}
      >
        {/* 顶部产品标志与标题 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* 项目原生 SVG Brand Mark */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg viewBox="0 0 120 120" fill="none" style={{ width: 17, height: 17 }}>
                <path
                  d="M34 94 V26 H64 C79 26 88 35 88 48 C88 61 79 70 64 70 H48"
                  stroke="var(--accent)"
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M68 41 H55 C50.5 41 47 44 47 48 C47 52 50.5 55 55 55 H68"
                  stroke="var(--hr, #f43f5e)"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <circle cx="56" cy="48" r="3.2" fill="var(--accent)" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>PaceCraft</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>跑者 AI 训练中心</div>
            </div>
          </div>

          {status !== "downloading" && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: 4,
                fontSize: 14,
                lineHeight: 1,
              }}
              title="关闭"
            >
              ✕
            </button>
          )}
        </div>

        {/* 核心信息卡片 */}
        <div style={{ minHeight: 90, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {status === "checking" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
              <span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>正在检查可用更新…</span>
            </div>
          )}

          {status === "up-to-date" && (
            <div style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>
                当前已是最新版本
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="version-tag">
                  <span className="dot" />
                  <span>v{cleanCurrent}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>PaceCraft 目前无需更新。</span>
              </div>
            </div>
          )}

          {status === "available" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
                  发现新版本
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>v{cleanCurrent} →</span>
                  <span
                    className="version-tag"
                    style={{
                      color: "var(--accent)",
                      borderColor: "var(--accent)",
                      background: "var(--surface-2)",
                      fontWeight: 600,
                    }}
                  >
                    v{newVersion}
                  </span>
                </div>
              </div>

              {notes && (
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      maxHeight: 140,
                      overflowY: "auto",
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: "var(--text)",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {notes}
                  </div>
                </div>
              )}

              {!isTauriEnv() && (
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                  当前在网页端运行，请前往 Release 页面获取桌面安装包。
                </div>
              )}
            </div>
          )}

          {status === "downloading" && (
            <div style={{ padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, color: "var(--text)" }}>
                <span>正在下载…</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontFamily: "var(--mono)" }}>
                  {progress.percent}%
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: 3,
                  background: "var(--border)",
                  borderRadius: 2,
                  overflow: "hidden",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: `${progress.percent}%`,
                    height: "100%",
                    background: "var(--accent)",
                    transition: "width 0.2s linear",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {progress.total > 0
                  ? `${formatSize(progress.downloaded)} / ${formatSize(progress.total)}`
                  : "正在连接服务器…"}
              </div>
            </div>
          )}

          {status === "ready" && (
            <div style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>
                更新已准备就绪
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                安装包已校验完成，重启应用即可升级到最新版本。
              </div>
            </div>
          )}

          {status === "error" && (
            <div style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--bad, #ef4444)", marginBottom: 4 }}>
                检查更新未成功
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {errorMsg}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--border)",
          }}
        >
          {status === "up-to-date" && (
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{ padding: "5px 14px", fontSize: 12 }}
            >
              确定
            </button>
          )}

          {status === "available" && (
            <>
              <button
                type="button"
                className="btn btn-subtle"
                onClick={onClose}
                style={{ padding: "5px 12px", fontSize: 12 }}
              >
                稍后
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleStartUpdate}
                style={{
                  padding: "5px 14px",
                  fontSize: 12,
                  background: "var(--accent)",
                  color: "#1a1d23",
                  fontWeight: 600,
                  borderColor: "transparent",
                }}
              >
                {isTauriEnv() && updateObj ? "立即更新" : "下载更新"}
              </button>
            </>
          )}

          {status === "ready" && (
            <button
              type="button"
              className="btn"
              onClick={handleRestart}
              style={{
                padding: "5px 14px",
                fontSize: 12,
                background: "var(--accent)",
                color: "#1a1d23",
                fontWeight: 600,
                borderColor: "transparent",
              }}
            >
              重启应用
            </button>
          )}

          {status === "error" && (
            <>
              <button
                type="button"
                className="btn btn-subtle"
                onClick={onClose}
                style={{ padding: "5px 12px", fontSize: 12 }}
              >
                关闭
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => executeCheck()}
                style={{ padding: "5px 14px", fontSize: 12 }}
              >
                重试
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalDom, document.body) : modalDom;
}
