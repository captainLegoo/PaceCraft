import { useState, useEffect, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export type UpdateCheckResult = {
  hasUpdate: boolean;
  version?: string;
  currentVersion?: string;
  body?: string;
  date?: string;
};

export default function UpdateModal({
  open,
  onClose,
  autoCheck = false,
  currentAppVersion,
}: {
  open: boolean;
  onClose: () => void;
  autoCheck?: boolean;
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

  const runCheck = useCallback(async () => {
    setChecking(true);
    setStatus("checking");
    setErrorMsg(null);
    setUpdateObj(null);
    setNewVersion(null);
    setNotes(null);

    try {
      if (isTauriEnv()) {
        const update = await check();
        if (update && update.available) {
          setUpdateObj(update);
          setNewVersion(update.version);
          setNotes(update.body ?? "包含稳定性提升与功能改进。");
          setStatus("available");
        } else {
          setStatus("up-to-date");
        }
      } else {
        // 非桌面环境：通过 GitHub API 探测最新 release
        const res = await fetch("https://api.github.com/repos/captainLegoo/PaceCraft/releases/latest", {
          headers: { Accept: "application/vnd.github.v3+json" },
        });
        if (!res.ok) throw new Error(`查询版本失败 (HTTP ${res.status})`);
        const data = await res.json();
        const latestTag: string = data.tag_name || "";
        const cleanLatest = latestTag.replace(/^v/, "");
        const cleanCurrent = currentAppVersion.replace(/^v/, "");

        if (cleanLatest && cleanLatest !== cleanCurrent) {
          setNewVersion(cleanLatest);
          setNotes(data.body ?? "包含新功能与修复。");
          setStatus("available");
        } else {
          setStatus("up-to-date");
        }
      }
    } catch (err: any) {
      console.warn("Check update failed:", err);
      setStatus("error");
      setErrorMsg(err?.message || "检测更新失败，请稍后重试或检查网络连接。");
    } finally {
      setChecking(false);
    }
  }, [currentAppVersion]);

  // 当弹窗打开或指定 autoCheck 时触发检测
  useEffect(() => {
    if (open) {
      runCheck();
    }
  }, [open, runCheck]);

  // 开始执行下载并自动安装
  const handleStartUpdate = async () => {
    if (!isTauriEnv()) {
      window.open("https://github.com/captainLegoo/PaceCraft/releases/latest", "_blank");
      return;
    }

    if (!updateObj) return;

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
      setErrorMsg(err?.message || "下载或解压更新包失败，请检查网络后重试。");
    }
  };

  // 重启应用
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
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
          maxWidth: 480,
          background: "var(--card-bg, #1e1e24)",
          color: "var(--text-primary, #ffffff)",
          border: "1px solid var(--border-color, #2a2a36)",
          borderRadius: 16,
          boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        {/* 顶部标题栏 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🚀</span>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>软件更新检测</h3>
          </div>
          {status !== "downloading" && (
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-sub, #888)",
                fontSize: 20,
                cursor: "pointer",
                padding: "2px 8px",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* 主体状态内容 */}
        <div style={{ minHeight: 120 }}>
          {status === "checking" && (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  border: "3px solid rgba(255, 107, 0, 0.2)",
                  borderTopColor: "#ff6b00",
                  borderRadius: "50%",
                  margin: "0 auto 16px",
                  animation: "spin 1s linear infinite",
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 14, color: "var(--text-sub, #aaa)" }}>
                正在通过加速镜像检测新版本...
              </div>
            </div>
          )}

          {status === "up-to-date" && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>当前已是最新版本</div>
              <div style={{ fontSize: 13, color: "var(--text-sub, #aaa)" }}>
                当前运行版本：v{currentAppVersion.replace(/^v/, "")}
              </div>
            </div>
          )}

          {status === "available" && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "rgba(255, 107, 0, 0.08)",
                  border: "1px solid rgba(255, 107, 0, 0.25)",
                  borderRadius: 10,
                  marginBottom: 14,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "#ff8c3a" }}>发现新版本</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>v{newVersion}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-sub, #888)" }}>
                  当前版本：v{currentAppVersion.replace(/^v/, "")}
                </div>
              </div>

              {notes && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-sub, #888)", marginBottom: 6 }}>更新说明：</div>
                  <div
                    style={{
                      maxHeight: 150,
                      overflowY: "auto",
                      fontSize: 13,
                      lineHeight: 1.6,
                      background: "rgba(0,0,0,0.15)",
                      padding: "10px 12px",
                      borderRadius: 8,
                      whiteSpace: "pre-wrap",
                      color: "var(--text-secondary, #ddd)",
                    }}
                  >
                    {notes}
                  </div>
                </div>
              )}

              {!isTauriEnv() && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#f59e0b",
                    marginBottom: 14,
                    padding: "8px 10px",
                    background: "rgba(245, 158, 11, 0.1)",
                    borderRadius: 6,
                  }}
                >
                  💡 检测到你当前在浏览器中运行，请点击下方按钮前往 Release 页面下载客户端安装包覆盖升级。
                </div>
              )}
            </div>
          )}

          {status === "downloading" && (
            <div style={{ padding: "16px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                <span>正在下载新版本...</span>
                <span>{progress.percent}%</span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: 8,
                  background: "rgba(255, 255, 255, 0.1)",
                  borderRadius: 4,
                  overflow: "hidden",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    width: `${progress.percent}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #ff6b00, #ff8c3a)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--text-sub, #888)",
                }}
              >
                <span>已下载: {formatSize(progress.downloaded)}</span>
                {progress.total > 0 && <span>总大小: {formatSize(progress.total)}</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-sub, #666)", marginTop: 12, textAlign: "center" }}>
                正在通过多路加速通道下载并自动解压校验，请勿关闭程序...
              </div>
            </div>
          )}

          {status === "ready" && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#10b981", marginBottom: 6 }}>
                新版本已成功就绪！
              </div>
              <div style={{ fontSize: 13, color: "var(--text-sub, #aaa)" }}>
                安装包已解压替换完毕，点击下方按钮立即重启应用即可体验最新功能。
              </div>
            </div>
          )}

          {status === "error" && (
            <div style={{ padding: "16px 0" }}>
              <div style={{ fontSize: 14, color: "#ef4444", marginBottom: 10, fontWeight: 500 }}>
                ⚠️ 更新过程出现异常
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-sub, #aaa)",
                  background: "rgba(239, 68, 68, 0.1)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  marginBottom: 16,
                  wordBreak: "break-all",
                }}
              >
                {errorMsg}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-sub, #888)", lineHeight: 1.5 }}>
                若网络多次受阻，你可以直接前往 GitHub Releases 页面或国内加速镜像手动下载最新安装包。
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 20,
            borderTop: "1px solid var(--border-color, #2a2a36)",
            paddingTop: 16,
          }}
        >
          {status === "up-to-date" && (
            <button
              onClick={onClose}
              style={{
                padding: "8px 18px",
                background: "var(--accent-color, #ff6b00)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              我知道了
            </button>
          )}

          {status === "available" && (
            <>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "var(--text-sub, #aaa)",
                  border: "1px solid var(--border-color, #333)",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                稍后提醒
              </button>
              <button
                onClick={handleStartUpdate}
                style={{
                  padding: "8px 20px",
                  background: "var(--accent-color, #ff6b00)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {isTauriEnv() ? "立即自动更新" : "前往 Release 下载"}
              </button>
            </>
          )}

          {status === "ready" && (
            <button
              onClick={handleRestart}
              style={{
                padding: "8px 22px",
                background: "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 14,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              立即重启生效
            </button>
          )}

          {status === "error" && (
            <>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "var(--text-sub, #aaa)",
                  border: "1px solid var(--border-color, #333)",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                关闭
              </button>
              <button
                onClick={() => {
                  window.open("https://github.com/captainLegoo/PaceCraft/releases", "_blank");
                }}
                style={{
                  padding: "8px 16px",
                  background: "transparent",
                  color: "#ff8c3a",
                  border: "1px solid rgba(255, 140, 58, 0.4)",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                手动网页下载
              </button>
              <button
                onClick={runCheck}
                style={{
                  padding: "8px 18px",
                  background: "var(--accent-color, #ff6b00)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                重新检测
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
