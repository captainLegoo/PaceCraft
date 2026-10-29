import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openExternal } from "../openExternal";
import MarkdownView from "./MarkdownView";

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export type PlatformAsset = {
  name: string;
  downloadUrl: string;
  rawUrl: string;
  size?: number;
  platform: "windows" | "macos" | "linux" | "unknown";
};

export type ReleaseCheckResponse = {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  publishedAt?: string;
  downloadUrl: string;
  routeUsed: string;
  platformAsset?: PlatformAsset | null;
  assets?: Array<{ name: string; downloadUrl: string; rawUrl?: string; size?: number }>;
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
  const [releaseData, setReleaseData] = useState<ReleaseCheckResponse | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error"
  >("idle");
  const [downloadMode, setDownloadMode] = useState<"tauri" | "installer">("tauri");
  const [downloadSpeed, setDownloadSpeed] = useState<number>(0);
  const [installerStarted, setInstallerStarted] = useState(false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number; percent: number }>({
    downloaded: 0,
    total: 0,
    percent: 0,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const downloadedRef = useRef(0);
  const totalRef = useRef(0);
  const inFlightRef = useRef(false);
  const pollTimerRef = useRef<any>(null);

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearPollTimer();
  }, []);

  const executeCheck = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setChecking(true);
    setStatus("checking");
    setErrorMsg(null);
    setUpdateObj(null);
    setReleaseData(null);
    setNewVersion(null);
    setNotes(null);
    setInstallerStarted(false);
    clearPollTimer();

    try {
      const startTime = Date.now();
      const clientPlatform =
        typeof navigator !== "undefined"
          ? /Win/i.test(navigator.userAgent || (navigator as any).platform)
            ? "windows"
            : /Mac/i.test(navigator.userAgent || (navigator as any).platform)
            ? "macos"
            : "linux"
          : undefined;

      // 手动触发检查时携带 force=true，强制穿透后端缓存重新向远端获取
      const checkRes = await fetch(
        `/api/updater/check?currentVersion=${encodeURIComponent(currentAppVersion)}&channel=auto&force=true&platform=${clientPlatform || ""}&_t=${Date.now()}`
      );
      if (!checkRes.ok) {
        throw new Error(`无法获取更新信息 (${checkRes.status})`);
      }
      const data: ReleaseCheckResponse = await checkRes.json();
      setReleaseData(data);

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
      clearPollTimer();
      setStatus("idle");
      setUpdateObj(null);
      setReleaseData(null);
      setNewVersion(null);
      setNotes(null);
      setErrorMsg(null);
      setInstallerStarted(false);
      setDownloadSpeed(0);
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

  // 启动本地伴生服务安装包后台下载流程
  const startInstallerDownloadFlow = async (asset: PlatformAsset) => {
    setDownloadMode("installer");
    setStatus("downloading");
    setErrorMsg(null);
    setInstallerStarted(false);
    setProgress({ downloaded: 0, total: asset.size || 0, percent: 0 });
    setDownloadSpeed(0);

    try {
      const res = await fetch("/api/updater/download-installer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: asset.downloadUrl,
          fileName: asset.name,
          platform: asset.platform,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `启动下载失败 (${res.status})`);
      }

      clearPollTimer();
      pollTimerRef.current = setInterval(async () => {
        try {
          const pRes = await fetch(`/api/updater/download-progress?_t=${Date.now()}`);
          if (!pRes.ok) return;
          const pData = await pRes.json();

          if (pData.status === "downloading") {
            setProgress({
              downloaded: pData.downloaded || 0,
              total: pData.total || 0,
              percent: pData.percent || 0,
            });
            setDownloadSpeed(pData.speed || 0);
          } else if (pData.status === "completed") {
            clearPollTimer();
            setProgress({
              downloaded: pData.total || pData.downloaded,
              total: pData.total || pData.downloaded,
              percent: 100,
            });
            setDownloadSpeed(0);
            setStatus("ready");
          } else if (pData.status === "error") {
            clearPollTimer();
            setStatus("error");
            setErrorMsg(pData.error || "下载过程中断");
          }
        } catch {
          // 忽略临时网络波动
        }
      }, 350);
    } catch (e: any) {
      console.error("Installer download failed:", e);
      setStatus("error");
      setErrorMsg(e?.message || "无法连接到更新下载服务器");
    }
  };

  const handleStartUpdate = async () => {
    // 方案 A：Tauri 原生 Updater（存在签名与 latest.json 资源）
    if (isTauriEnv() && updateObj) {
      setDownloadMode("tauri");
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
        console.error("Tauri download/install failed:", err);
        // 若 Tauri 原生更新失败且存在平台安装包，自动降级为安装包极速下载
        if (releaseData?.platformAsset) {
          startInstallerDownloadFlow(releaseData.platformAsset);
        } else {
          setStatus("error");
          const raw = String(err?.message || err || "");
          if (/Operation not permitted|Read-only|Permission denied|os error 1/i.test(raw)) {
            setErrorMsg("更新写入受限：若在 macOS 上运行，请确保已将应用移入「应用程序」文件夹，而非直接在 DMG 挂载盘中运行。");
          } else {
            setErrorMsg(raw || "安装包下载中断或签名校验未通过");
          }
        }
      }
      return;
    }

    // 方案 B：有对应平台的安装包资产（如 Windows setup.exe 或 macOS dmg），直接由后台开始极速下载
    if (releaseData?.platformAsset) {
      startInstallerDownloadFlow(releaseData.platformAsset);
      return;
    }

    // 方案 C：纯网页环境或未匹配到资产时，直接在浏览器中打开安装包直链下载（绝非仅跳转 Release 首页）
    const directUrl =
      releaseData?.platformAsset?.downloadUrl ||
      releaseData?.downloadUrl ||
      "https://github.com/captainLegoo/PaceCraft/releases";
    openExternal(directUrl);
  };

  const handleRunInstaller = async () => {
    try {
      setInstallerStarted(true);
      const res = await fetch("/api/updater/run-installer", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "启动安装程序失败");
      }
    } catch (e: any) {
      console.error("Run installer error:", e);
      setErrorMsg(e?.message || "启动安装程序失败，请尝试在文件夹中手动双击安装");
    }
  };

  const handleOpenFolder = async () => {
    try {
      await fetch("/api/updater/open-dir", { method: "POST" });
    } catch (e) {
      console.error("Open folder error:", e);
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

  const formatSpeed = (bytesPerSec: number) => {
    if (!bytesPerSec || bytesPerSec <= 0) return "";
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
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
          maxWidth: 460,
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
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      maxHeight: 210,
                      overflowY: "auto",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      overscrollBehavior: "contain",
                    }}
                  >
                    <MarkdownView content={notes} />
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
                <span>
                  正在下载{releaseData?.platformAsset?.name ? ` ${releaseData.platformAsset.name}` : "更新安装包"}…
                </span>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                <span>
                  {progress.total > 0
                    ? `${formatSize(progress.downloaded)} / ${formatSize(progress.total)}`
                    : progress.downloaded > 0
                    ? formatSize(progress.downloaded)
                    : "正在连接下载节点…"}
                </span>
                {downloadSpeed > 0 && (
                  <span style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 500 }}>
                    ⚡ {formatSpeed(downloadSpeed)}
                  </span>
                )}
              </div>
            </div>
          )}

          {status === "ready" && (
            <div style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>
                {downloadMode === "installer" ? "安装包下载完成" : "更新已准备就绪"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {downloadMode === "installer"
                  ? installerStarted
                    ? "已启动安装向导。请在系统安装窗口中按提示操作；安装完成后重新打开 PaceCraft 即可。"
                    : `新版本安装包 (${releaseData?.platformAsset?.name || "安装程序"}) 已下载至本地，点击「立即安装」将为您启动安装向导。`
                  : "安装包已校验完成，重启应用即可升级到最新版本。"}
              </div>
            </div>
          )}

          {status === "error" && (
            <div style={{ padding: "6px 0" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--bad, #ef4444)", marginBottom: 4 }}>
                更新或下载未成功
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
            <>
              {downloadMode === "installer" ? (
                <>
                  <button
                    type="button"
                    className="btn btn-subtle"
                    onClick={handleOpenFolder}
                    style={{ padding: "5px 12px", fontSize: 12 }}
                    title="在系统文件管理器中查看已下载的安装包"
                  >
                    在文件夹中显示
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleRunInstaller}
                    style={{
                      padding: "5px 14px",
                      fontSize: 12,
                      background: "var(--accent)",
                      color: "#1a1d23",
                      fontWeight: 600,
                      borderColor: "transparent",
                    }}
                  >
                    {installerStarted ? "再次启动安装程序" : "立即安装"}
                  </button>
                </>
              ) : (
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
            </>
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
              {releaseData?.platformAsset?.downloadUrl && (
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={() => openExternal(releaseData.platformAsset!.downloadUrl)}
                  style={{ padding: "5px 12px", fontSize: 12 }}
                  title="直接在浏览器中下载安装包文件"
                >
                  在浏览器中下载
                </button>
              )}
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
