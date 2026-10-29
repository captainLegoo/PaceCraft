import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { QuickSyncResult, SyncProgress } from "./api";
import { ThemeToggle, useTheme } from "./theme";
import { useTableScroll } from "./table-scroll";
import { IconBack, IconCloudSync, IconDatabase, IconFlag, IconMenu, IconPulse, IconRefresh, IconShoe, IconSync } from "./icons";
import Training from "./pages/Training";
import ActivityDetailView from "./pages/ActivityDetail";
import Settings from "./pages/Settings";
import SessionView from "./pages/Session";
import Week from "./pages/Week";
import RaceHub, { type RaceTab } from "./pages/RaceHub";
import Readiness, { type ReadinessTab } from "./pages/Readiness";
import { useCorosAuth } from "./use-coros-auth";
import ConnectWatchModal from "./components/ConnectWatchModal";
import type { GarminMultiAuthStatus } from "./api";
import ProfileSwitcher from "./components/ProfileSwitcher";
import { DEFAULT_APP_VERSION } from "./version";
import UpdateModal, { isTauriEnv } from "./components/UpdateModal";
import { check } from "@tauri-apps/plugin-updater";
import { formatElapsed } from "./utils/format";
import { useClipboard } from "./utils/clipboard";

export { formatElapsed };

type Route = {
  page:
    | "training"
    | "race"
    | "readiness"
    | "settings"
    | "activity"
    | "session"
    | "week"
    // 兼容历史直接调用
    | "prediction"
    | "prep"
    | "fitness"
    | "health";
  raceTab?: RaceTab;
  readinessTab?: ReadinessTab;
  labelId?: string;
  sessionKey?: string;
  fromSessionKey?: string;
  weekStart?: string;
};

const NAV: { key: "training" | "race" | "readiness" | "settings"; label: string; sub: string; icon: any }[] = [
  { key: "training", label: "训练看板", sub: "跑量 · 课表 · 负荷", icon: IconShoe },
  { key: "race", label: "赛事中心", sub: "赛道 · 预测 · 备赛", icon: IconFlag },
  { key: "readiness", label: "身体状态", sub: "恢复 · 睡眠 · 体能", icon: IconPulse },
  { key: "settings", label: "系统设置", sub: "AI · 同步 · 工作流", icon: IconDatabase },
];

function routeToHash(r: Route): string {
  switch (r.page) {
    case "activity":
      return `#/activity?id=${encodeURIComponent(r.labelId ?? "")}${r.fromSessionKey ? `&from=${encodeURIComponent(r.fromSessionKey)}` : ""}`;
    case "session":
      return `#/session?key=${encodeURIComponent(r.sessionKey ?? "")}`;
    case "week":
      return `#/week?start=${encodeURIComponent(r.weekStart ?? "")}`;
    case "race":
      return `#/race`;
    case "prediction":
      return `#/prediction`;
    case "prep":
      return `#/prep`;
    case "readiness":
      return `#/readiness`;
    case "fitness":
      return `#/fitness`;
    case "health":
      return `#/health`;
    case "settings":
      return `#/settings`;
    case "training":
    default:
      return `#/training`;
  }
}

function hashToRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  if (!clean) return { page: "training" };

  const [path, query] = clean.split("?");
  const params = new URLSearchParams(query || "");

  switch (path) {
    case "activity": {
      const labelId = params.get("id") || "";
      const fromSessionKey = params.get("from") || undefined;
      return labelId ? { page: "activity", labelId, fromSessionKey } : { page: "training" };
    }
    case "session": {
      const sessionKey = params.get("key") || "";
      return sessionKey ? { page: "session", sessionKey } : { page: "training" };
    }
    case "week": {
      const weekStart = params.get("start") || "";
      return weekStart ? { page: "week", weekStart } : { page: "training" };
    }
    case "race":
      return { page: "race" };
    case "prediction":
      return { page: "prediction" };
    case "prep":
      return { page: "prep" };
    case "readiness":
      return { page: "readiness" };
    case "fitness":
      return { page: "fitness" };
    case "health":
      return { page: "health" };
    case "settings":
      return { page: "settings" };
    case "training":
    default:
      return { page: "training" };
  }
}

function isSameRoute(a: Route, b: Route): boolean {
  return routeToHash(a) === routeToHash(b);
}

function getSyncBrandTitle(p: SyncProgress): string {
  const msg = p.message || "";
  if (p.phase === "list" || p.phase === "fit" || msg.includes("Garmin") || msg.includes("佳明")) {
    return "佳明 Garmin 训练数据同步中";
  }
  if (p.phase === "workflow") {
    return "疲劳负荷与智能模型分析中";
  }
  if (msg.includes("高驰") || p.phase === "records" || p.phase === "details" || p.phase === "health") {
    return "高驰 COROS 训练数据同步中";
  }
  return "运动手表数据增量同步中";
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => {
    const initial = hashToRoute(typeof window !== "undefined" ? window.location.hash : "");
    if (typeof window !== "undefined") {
      window.history.replaceState({ ...initial, appNav: true }, "", routeToHash(initial));
    }
    return initial;
  });

  const routeRef = useRef(route);
  routeRef.current = route;

  const historyDepth = useRef(0);
  const [status, setStatus] = useState<any>(null);
  const appVersion = status?.version || DEFAULT_APP_VERSION;
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [hasNewUpdate, setHasNewUpdate] = useState(false);

  // 桌面应用启动 3 秒后静默检测是否有新更新
  useEffect(() => {
    if (!isTauriEnv()) return;
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update && update.available) {
          setHasNewUpdate(true);
        }
      } catch {
        // 静默检查忽略错误
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  const { theme, toggle } = useTheme();

  /** 窄屏下侧边栏变成抽屉，默认收起 */
  const [navOpen, setNavOpen] = useState(false);
  useTableScroll();

  const navigate = useCallback((newRoute: Route, replace = false) => {
    if (isSameRoute(routeRef.current, newRoute)) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setNavOpen(false);
      return;
    }
    const hash = routeToHash(newRoute);
    if (replace) {
      window.history.replaceState({ ...newRoute, appNav: true }, "", hash);
    } else {
      window.history.pushState({ ...newRoute, appNav: true, hasPrev: true }, "", hash);
      historyDepth.current += 1;
    }
    setRoute(newRoute);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const handleBack = useCallback(() => {
    if (historyDepth.current > 0 || window.history.state?.hasPrev) {
      window.history.back();
    } else {
      // 兜底：如果是直接访问详情页进来的，回退至逻辑上一层
      const current = routeRef.current;
      if (current.page === "activity" && current.fromSessionKey) {
        navigate({ page: "session", sessionKey: current.fromSessionKey }, true);
      } else {
        navigate({ page: "training" }, true);
      }
    }
  }, [navigate]);

  // 监听浏览器后退/前进事件（支持移动端原生手势侧滑、浏览器后退按钮、鼠标侧键）
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const targetRoute = (e.state as Route | null) ?? hashToRoute(window.location.hash);
      setRoute(targetRoute);
      setNavOpen(false);
      if (historyDepth.current > 0) {
        historyDepth.current -= 1;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // 抽屉开着时锁住背景滚动：否则手指在遮罩上滑一下，
  // 背后的长页面会跟着滚，抽屉看起来像没打开。
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  // 键盘快捷键监听：Web 端在非输入状态下按 Esc 键返回上一级
  const isDetailPage = route.page === "activity" || route.page === "session" || route.page === "week";

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (navOpen) return; // 抽屉打开时由上面的监听器优先关闭抽屉

        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea") {
          (document.activeElement as HTMLElement)?.blur();
          return;
        }

        if (isDetailPage) {
          e.preventDefault();
          handleBack();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen, isDetailPage, handleBack]);

  const go = useCallback((page: Route["page"]) => {
    navigate({ page });
  }, [navigate]);

  /** 数据版本号：同步成功后 +1，所有页面据此重新拉数据 */
  const [dataVersion, setDataVersion] = useState(0);
  /** 让轮询回调能调用最新的 runSync，避免闭包捕获旧函数 */
  const runSyncRef = useRef<(() => Promise<void>) | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncSummary, setSyncSummary] = useState<{
    timestamp: number;
    hasErrors: boolean;
    errorMessage?: string;
    coros?: { synced: boolean; newCount: number; totalCount: number; errorCount: number };
    garmin?: { synced: boolean; scannedCount: number; newCount: number; fitCount: number };
    conflicts?: { detected: number; resolved: number };
  } | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [syncMsg, setSyncMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [showSyncDropdown, setShowSyncDropdown] = useState(false);
  const syncDropdownRef = useRef<HTMLDivElement | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number; exhausted: boolean } | null>(null);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [garminAuth, setGarminAuth] = useState<GarminMultiAuthStatus | null>(null);

  const refreshGarminAuth = useCallback(async () => {
    try {
      const res = await api.garminAuthStatus();
      setGarminAuth(res);
      return res;
    } catch {
      return null;
    }
  }, []);

  const refresh = useCallback(() => {
    api.status().then(setStatus).catch(() => {});
    refreshGarminAuth();
  }, [refreshGarminAuth]);
  const loadQuota = () => api.fitQuota().then(setQuota).catch(() => {});

  const stopProgressPolling = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const startProgressPolling = useCallback(() => {
    if (progressTimerRef.current) return;
    progressTimerRef.current = setInterval(async () => {
      try {
        const p = await api.syncProgress();
        setSyncProgress(p);
        if (p.active) {
          setSyncing(true);
        } else {
          stopProgressPolling();
          setSyncing(false);
          if (p.phase === "done") {
            setDataVersion((v) => v + 1);
            refresh();
            loadQuota();
            setTimeout(() => setSyncProgress(null), 4000);
          } else if (p.phase === "error") {
            setTimeout(() => setSyncProgress(null), 6000);
          } else {
            setSyncProgress(null);
          }
        }
      } catch {
        // 容忍轮询偶发抖动
      }
    }, 600);
  }, [stopProgressPolling]);

  const {
    auth,
    connecting: authConnecting,
    authUrl,
    msg: authMsg,
    connect: connectCoros,
    disconnect: disconnectCoros,
    cancel: cancelCoros,
    openBrowser: openCorosBrowser,
    refreshAuth,
  } = useCorosAuth(
    () => {
      refresh();
      void runSyncRef.current?.();
    },
    () => {
      refresh();
    }
  );

  const [resolvingMismatch, setResolvingMismatch] = useState(false);
  const [mismatchError, setMismatchError] = useState<string | null>(null);
  const { copy: copyAuthUrl, copied: copiedAuthUrl } = useClipboard();

  const handleResolveMismatch = async (action: "create_new" | "overwrite" | "merge") => {
    setResolvingMismatch(true);
    setMismatchError(null);
    try {
      await api.resolveMismatch(action);
      await refreshAuth();
      refresh();
      void runSyncRef.current?.();
    } catch (err: any) {
      setMismatchError(err?.message || "处理失败，请稍后重试");
    } finally {
      setResolvingMismatch(false);
    }
  };
  useEffect(() => {
    refresh();
    loadQuota();

    // 挂载时检查后端是否已有正在进行的同步（如授权回调后自动触发），若有立刻接管进度轮询
    api.syncProgress().then((p) => {
      if (p.active) {
        setSyncProgress(p);
        setSyncing(true);
        startProgressPolling();
      }
    }).catch(() => {});

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      stopProgressPolling();
    };
  }, [startProgressPolling, stopProgressPolling]);

  useEffect(() => {
    refreshGarminAuth();
  }, [refreshGarminAuth]);

  // 点击外部自动关闭同步下拉框
  useEffect(() => {
    if (!showSyncDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (syncDropdownRef.current && !syncDropdownRef.current.contains(e.target as Node)) {
        setShowSyncDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSyncDropdown]);

  const handleConnectGarmin = async (apiKey: string, region: "auto" | "global" | "cn") => {
    await api.connectGarmin(apiKey, region);
    await refreshGarminAuth();
    refresh();
    void api.syncGarmin(100, region === "auto" ? "all" : region).then(() => refresh()).catch(() => {});
  };

  const handleDisconnectGarmin = async (region?: "cn" | "global") => {
    await api.disconnectGarmin(region);
    await refreshGarminAuth();
    refresh();
  };

  const isConnected = Boolean(status?.auth?.connected || garminAuth?.connected);

  const runSync = async (): Promise<QuickSyncResult | null> => {
    if (syncing) return null;
    setSyncing(true);
    setSyncMsg(null);
    startProgressPolling();
    let syncRes: QuickSyncResult | null = null;
    try {
      const r = await api.quickSync();
      syncRes = r;
      if (r.busy) {
        setSyncMsg({ text: r.message, kind: "err" });
      } else if (r.ok) {
        setSyncMsg({ text: r.message, kind: "ok" });
        setDataVersion((v) => v + 1);
        refresh();
      } else {
        setSyncMsg({ text: r.message, kind: "err" });
      }
      loadQuota();
      return r;
    } catch (e) {
      setSyncMsg({ text: `同步失败：${(e as Error).message}`, kind: "err" });
      return null;
    } finally {
      // 保持轮询直到后端真正完成 active: false
      try {
        const finalP = await api.syncProgress();
        setSyncProgress(finalP);
        if (!finalP.active) {
          stopProgressPolling();
          setSyncing(false);
          setTimeout(() => setSyncProgress(null), 4000);
        }
      } catch {
        stopProgressPolling();
        setSyncing(false);
      }
      setTimeout(() => setSyncMsg(null), 6000);
    }
  };

  runSyncRef.current = () => runSync().then(() => {});

  const doSync = async (target: "all" | "coros" | "garmin_cn" | "garmin_global" = "all") => {
    if (!isConnected) {
      setShowConnectModal(true);
      return;
    }
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    setSyncSummary(null);

    // 确保任何现有旧轮询被清除
    stopProgressPolling();

    let corosSummary: { synced: boolean; newCount: number; totalCount: number; errorCount: number } | undefined = undefined;
    let garminSummary: { synced: boolean; scannedCount: number; newCount: number; fitCount: number } | undefined = undefined;
    let totalConflictsDetected = 0;
    let totalConflictsResolved = 0;
    let syncError: string | null = null;

    try {
      // 1. 同步高驰 COROS（串行第 1 阶段）
      const shouldSyncCoros = (target === "all" || target === "coros") && Boolean(status?.auth?.connected);
      if (shouldSyncCoros) {
        setSyncProgress({
          active: true,
          phase: "records",
          current: 0,
          total: 100,
          percent: 10,
          message: "正在连接高驰 COROS 检查增量记录...",
          startedAt: Date.now(),
        });

        // 仅启动高驰单表进度轮询
        let corosPoller: ReturnType<typeof setInterval> | null = setInterval(async () => {
          try {
            const p = await api.syncProgress();
            if (p.active) {
              setSyncProgress(p);
            }
          } catch {}
        }, 500);

        try {
          const res = await api.quickSync();
          if (corosPoller) {
            clearInterval(corosPoller);
            corosPoller = null;
          }
          if (res.ok) {
            corosSummary = {
              synced: true,
              newCount: res.newActivities ?? 0,
              totalCount: res.activities ?? 0,
              errorCount: res.errors?.length ?? 0,
            };
            if (res.conflictsDetected) totalConflictsDetected += res.conflictsDetected;
            if (res.conflictsResolved) totalConflictsResolved += res.conflictsResolved;
          } else if (res.busy) {
            syncError = res.message;
          } else {
            syncError = res.message || "高驰同步未正常完成";
          }
        } catch (e: any) {
          if (corosPoller) {
            clearInterval(corosPoller);
            corosPoller = null;
          }
          syncError = `高驰同步失败：${e?.message || "网络异常"}`;
        }
      }

      // 2. 同步佳明 Garmin（串行第 2 阶段，避免同时发起导致后台锁冲突）
      const hasGarminCn = Boolean(garminAuth?.cn?.connected);
      const hasGarminGlobal = Boolean(garminAuth?.global?.connected);
      const shouldSyncGarmin =
        (target === "all" && (hasGarminCn || hasGarminGlobal)) ||
        (target === "garmin_cn" && hasGarminCn) ||
        (target === "garmin_global" && hasGarminGlobal);

      if (shouldSyncGarmin) {
        const garminRegion: "cn" | "global" | "all" =
          target === "garmin_cn" ? "cn" : target === "garmin_global" ? "global" : "all";

        setSyncProgress({
          active: true,
          phase: "list",
          current: 0,
          total: 100,
          percent: 15,
          message: "正在连接 Garmin 佳明检查增量训练...",
          startedAt: Date.now(),
        });

        // 仅启动佳明单表进度轮询
        let garminPoller: ReturnType<typeof setInterval> | null = setInterval(async () => {
          try {
            const gp = await api.garminSyncProgress();
            if (gp.active) {
              setSyncProgress({
                active: true,
                phase: gp.phase,
                current: gp.current,
                total: gp.total,
                percent: gp.percent,
                message: gp.message,
                startedAt: Date.now(),
              });
            }
          } catch {}
        }, 500);

        try {
          const gRes = await api.syncGarmin(100, garminRegion);
          if (garminPoller) {
            clearInterval(garminPoller);
            garminPoller = null;
          }
          garminSummary = {
            synced: true,
            scannedCount: gRes.syncedCount,
            newCount: gRes.newActivities,
            fitCount: gRes.fitDownloaded,
          };
          if (gRes.conflictsDetected) totalConflictsDetected += gRes.conflictsDetected;
          if (gRes.conflictsResolved) totalConflictsResolved += gRes.conflictsResolved;
        } catch (e: any) {
          if (garminPoller) {
            clearInterval(garminPoller);
            garminPoller = null;
          }
          const msg = e?.message || "网络异常";
          syncError = syncError ? `${syncError}；佳明同步失败：${msg}` : `佳明同步失败：${msg}`;
        }
      }

      // 3. 构建结构化结算卡片数据
      const summaryData = {
        timestamp: Date.now(),
        hasErrors: Boolean(syncError),
        errorMessage: syncError || undefined,
        coros: corosSummary,
        garmin: garminSummary,
        conflicts: totalConflictsDetected > 0 ? { detected: totalConflictsDetected, resolved: totalConflictsResolved } : undefined,
      };

      setSyncSummary(summaryData);

      const totalNew = (corosSummary?.newCount ?? 0) + (garminSummary?.newCount ?? 0);
      const dedupNote = totalConflictsResolved > 0 ? `，识别并去重 ${totalConflictsResolved} 笔同场重叠记录` : "";

      if (syncError) {
        setSyncMsg({ text: `同步提示：${syncError}`, kind: "err" });
      } else {
        setSyncMsg({
          text: totalNew > 0 ? `同步完成：新增 ${totalNew} 笔训练${dedupNote}` : `同步完成：所有设备已是最新${dedupNote}`,
          kind: "ok",
        });
      }

      setDataVersion((v) => v + 1);
      refresh();
      loadQuota();
    } catch (e) {
      setSyncMsg({ text: `同步失败：${(e as Error).message}`, kind: "err" });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 6000);
      setTimeout(() => setSyncProgress(null), 2500);
    }
  };

  const openActivity = (labelId: string, fromSessionKey?: string) =>
    labelId && navigate({ page: "activity", labelId, fromSessionKey });
  const openSession = (sessionKey: string) => sessionKey && navigate({ page: "session", sessionKey });
  // 周跑量柱状图点进来的是「这一周」，不是某一条记录
  const openWeek = (weekStart: string) => weekStart && navigate({ page: "week", weekStart });

  // 顶栏标题：详情页（某次活动/某次训练）在 NAV 里没有条目，用副标题兜底
  const currentLabel =
    (NAV.find((n) => n.key === route.page)?.label)
    ?? (route.page === "prediction" || route.page === "prep" ? "赛事中心" : undefined)
    ?? (route.page === "fitness" || route.page === "health" ? "身体状态" : undefined)
    ?? ({ activity: "活动详情", session: "训练详情", week: "本周" } as Record<string, string>)[route.page]
    ?? "看板";

  return (
    <div className="app">
      {/* 遮罩只承担「点外面关抽屉」，点它等于收起 */}
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg viewBox="0 0 120 120" fill="none">
              {/* PaceCraft 品牌标志：外层 P (Pace 配速突破) + 内嵌 C (Craft 隐私数据锁扣) */}
              <path
                d="M34 94 V26 H64 C79 26 88 35 88 48 C88 61 79 70 64 70 H48"
                stroke="var(--accent)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M68 41 H55 C50.5 41 47 44 47 48 C47 52 50.5 55 55 55 H68"
                stroke="var(--hr)"
                strokeWidth="6.5"
                strokeLinecap="round"
              />
              <circle cx="56" cy="48" r="3.2" fill="var(--accent)" />
            </svg>
          </div>
          <h1>PaceCraft</h1>
          <p>跑者 AI 训练中心 · 数据仅存本机</p>
        </div>
        <ProfileSwitcher
          onProfileChanged={() => {
            setDataVersion((v) => v + 1);
            refresh();
          }}
          onRequireAuth={() => setShowConnectModal(true)}
        />
        <ThemeToggle theme={theme} onToggle={toggle} />
        {NAV.map((n) => {
          const Icon = n.icon;
          const isActive =
            route.page === n.key ||
            (n.key === "training" && (route.page === "session" || route.page === "activity" || route.page === "week")) ||
            (n.key === "race" && (route.page === "prediction" || route.page === "prep")) ||
            (n.key === "readiness" && (route.page === "fitness" || route.page === "health"));
          return (
            <button
              key={n.key}
              className={`nav-item ${isActive ? "active" : ""}`}
              onClick={() => go(n.key)}
            >
              <span className="nav-icon"><Icon size={17} /></span>
              <span className="nav-text">
                <span className="nav-label">{n.label}</span>
                <span className="nav-sub">{n.sub}</span>
              </span>
            </button>
          );
        })}

        <div className="sidebar-foot">
          <button
            className="sync-btn"
            onClick={() => window.location.reload()}
            title="刷新页面（快捷键 Cmd+R / Ctrl+R）"
          >
            <IconRefresh size={14} />
            <span>刷新页面</span>
          </button>
          {syncProgress?.active && (
            <div
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, marginBottom: 4 }}>
                <span
                  style={{ fontWeight: 600, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={syncProgress.startedAt ? `${syncProgress.message}（已用时 ${formatElapsed(syncProgress.startedAt)}）` : syncProgress.message}
                >
                  <span className="spin" style={{ width: 10, height: 10, borderColor: "var(--accent)" }} />
                  {syncProgress.message}
                </span>
                <span style={{ color: "var(--accent)", fontWeight: 700, flexShrink: 0, marginLeft: 4 }}>
                  {syncProgress.percent}%
                </span>
              </div>
              <div style={{ height: 4, background: "var(--surface-3)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(5, syncProgress.percent)}%`, background: "var(--accent)", transition: "width 0.3s ease" }} />
              </div>
            </div>
          )}
          {isConnected ? (
            <div ref={syncDropdownRef} style={{ position: "relative", display: "flex", width: "100%", gap: 2 }}>
              <button
                className="sync-btn"
                onClick={() => {
                  setShowSyncDropdown(false);
                  doSync("all");
                }}
                disabled={syncing}
                style={{ flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                title="立即增量同步所有已连接设备的训练数据"
              >
                <IconCloudSync size={14} />
                <span>{syncProgress?.active ? `同步中 ${syncProgress.percent}%` : syncing ? "同步中…" : "立即同步"}</span>
              </button>
              <button
                className="sync-btn"
                onClick={() => setShowSyncDropdown((prev) => !prev)}
                disabled={syncing}
                style={{ width: 28, padding: 0, justifyContent: "center", borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                title="选择仅同步特定品牌手表"
              >
                <span style={{ fontSize: 9 }}>▼</span>
              </button>

              {showSyncDropdown && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    right: 0,
                    marginBottom: 4,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
                    zIndex: 100,
                    overflow: "hidden",
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                    onClick={() => {
                      setShowSyncDropdown(false);
                      doSync("all");
                    }}
                  >
                    <span>🔄</span> <strong>全部已连设备</strong>
                  </div>
                  {status?.auth?.connected && (
                    <div
                      style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--border)" }}
                      onClick={() => {
                        setShowSyncDropdown(false);
                        doSync("coros");
                      }}
                    >
                      <span>🏃</span> 仅同步高驰 (COROS)
                    </div>
                  )}
                  {garminAuth?.cn?.connected && (
                    <div
                      style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--border)" }}
                      onClick={() => {
                        setShowSyncDropdown(false);
                        doSync("garmin_cn");
                      }}
                    >
                      <span>🇨🇳</span> 仅同步佳明 (中国区)
                    </div>
                  )}
                  {garminAuth?.global?.connected && (
                    <div
                      style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--border)" }}
                      onClick={() => {
                        setShowSyncDropdown(false);
                        doSync("garmin_global");
                      }}
                    >
                      <span>🌐</span> 仅同步佳明 (国际区)
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              className="sync-btn"
              onClick={() => setShowConnectModal(true)}
              disabled={authConnecting}
              style={{
                background: "rgba(37, 99, 235, 0.12)",
                color: "#60a5fa",
                borderColor: "rgba(59, 130, 246, 0.35)",
                fontWeight: 600,
              }}
              title="当前尚未连接手表设备，点击立即连接"
            >
              <span>{authConnecting ? "正在等待授权…" : "➕ 连接运动手表"}</span>
            </button>
          )}
          {status?.auth?.connected && quota && (
            <div className="sync-msg follow-msg" title="高驰 FIT 文件每日下载配额（COROS 官方平台限制为 50 次/日，Garmin 不受此限）">
              高驰 FIT 额度 {quota.used}/{quota.limit}{quota.exhausted ? " · 今日已用完" : ""}
            </div>
          )}
          {syncMsg && (
            <div className={`sync-msg ${syncMsg.kind}`}>{syncMsg.text}</div>
          )}
          {status ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <span>数据截至 {status.latestActivityDate ?? "—"}</span>
                {/* 版本号 */}
                <span
                  className="version-tag"
                  style={{ cursor: "pointer", userSelect: "none", fontSize: 10, padding: "0 6px" }}
                  onClick={() => setShowUpdateModal(true)}
                  title={`当前版本：${appVersion}（点击检查更新）`}
                >
                  <span className="dot" style={{ width: 4, height: 4 }} />
                  <span>{appVersion}</span>
                  {hasNewUpdate && (
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        display: "inline-block",
                        marginLeft: 1,
                      }}
                      title="发现新版本"
                    />
                  )}
                </span>
              </div>
              <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
                {status.counts.activities} 次活动 · {status.counts.laps} 行分圈
              </div>

              {/* 设备来源徽标列表：独立行横向平铺，间距整齐 */}
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                {status.auth?.connected && (
                  <span className="pill good" style={{ cursor: "pointer", fontSize: 11, padding: "2px 8px" }} onClick={() => setShowConnectModal(true)} title="点击管理高驰连接">
                    高驰 ●
                  </span>
                )}
                {garminAuth?.cn?.connected && (
                  <span className="pill good" style={{ cursor: "pointer", fontSize: 11, padding: "2px 8px" }} onClick={() => setShowConnectModal(true)} title="点击管理佳明中国区连接">
                    佳明(中国区) ●
                  </span>
                )}
                {garminAuth?.global?.connected && (
                  <span className="pill good" style={{ cursor: "pointer", fontSize: 11, padding: "2px 8px" }} onClick={() => setShowConnectModal(true)} title="点击管理佳明国际区连接">
                    佳明(国际区) ●
                  </span>
                )}
                {!status.auth?.connected && !garminAuth?.connected && (
                  <span className="pill warn" style={{ cursor: "pointer", fontSize: 11, padding: "2px 8px" }} onClick={() => setShowConnectModal(true)} title="点击连接手表设备">
                    + 连接设备
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="spin" />
          )}
        </div>
      </aside>

      <main className="main">
        {/* 顶栏只在窄屏出现（样式里 display:none 兜底），宽屏保持桌面原样 */}
        <div className="mobile-bar">
          <button
            className="menu-btn"
            onClick={() => isDetailPage ? handleBack() : setNavOpen((v) => !v)}
            aria-label={isDetailPage ? "返回" : navOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={navOpen}
            title={isDetailPage ? "返回上一级（可手势侧滑返回）" : undefined}
          >
            {isDetailPage ? <IconBack size={20} /> : <IconMenu size={20} />}
          </button>
          <span className="mobile-bar-title">{currentLabel}</span>
          {/* 同步按钮同时常驻这里：桌面版它在侧边栏底部，手机上侧边栏是收起的 */}
          <button
            className="mobile-sync"
            onClick={isConnected ? () => doSync() : () => setShowConnectModal(true)}
            disabled={syncing || authConnecting}
            title={isConnected ? "增量同步训练数据" : "点击连接运动手表"}
          >
            <IconCloudSync size={15} />
            <span>{syncProgress?.active ? `${syncProgress.percent}%` : syncing ? "同步中" : isConnected ? "同步" : "连接"}</span>
          </button>
        </div>

        {/* 全局实时同步进度条（浮动提示条） */}
        {syncProgress?.active && (
          <div
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235, 0.12) 0%, rgba(59, 130, 246, 0.06) 100%)",
              border: "1px solid rgba(59, 130, 246, 0.35)",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 260, flex: "1 1 280px" }}>
              <span className="spin" style={{ width: 15, height: 15, borderColor: "var(--accent)" }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                  {getSyncBrandTitle(syncProgress)} · {syncProgress.percent}%
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2, wordBreak: "break-all" }}>
                  {syncProgress.message}
                  {syncProgress.startedAt && `（已用时 ${formatElapsed(syncProgress.startedAt)}）`}
                </div>
              </div>
            </div>
            <div style={{ width: 180, height: 6, background: "var(--surface-3)", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(5, syncProgress.percent)}%`,
                  background: "var(--accent)",
                  borderRadius: 3,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* 同步完成成果结算卡片（跨平台浮动通知，兼容 Mac 和 Windows，自适应深浅主题） */}
        {syncSummary && (
          <div className="sync-summary-toast">
            <div className="sync-summary-header">
              <div className="sync-summary-title">
                <span style={{ fontSize: 16 }}>{syncSummary.hasErrors ? "⚠️" : "🎉"}</span>
                <span>
                  {syncSummary.hasErrors ? "同步完成（部分有提示）" : "运动数据同步结算"}
                </span>
              </div>
              <button
                className="sync-summary-close"
                onClick={() => setSyncSummary(null)}
                title="关闭通知"
              >
                ×
              </button>
            </div>

            <div className="sync-summary-body">
              {syncSummary.coros?.synced && (
                <div className="sync-summary-item coros">
                  <span className="sync-summary-tag coros">高驰 COROS</span>
                  <div className="sync-summary-item-content">
                    {syncSummary.coros.newCount > 0 ? (
                      <span>新增 <strong>{syncSummary.coros.newCount}</strong> 笔训练记录</span>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>已是最新，无新增训练</span>
                    )}
                    {syncSummary.coros.errorCount > 0 && (
                      <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 2 }}>
                        {syncSummary.coros.errorCount} 项网络请求超时已跳过
                      </div>
                    )}
                  </div>
                </div>
              )}

              {syncSummary.garmin?.synced && (
                <div className="sync-summary-item garmin">
                  <span className="sync-summary-tag garmin">佳明 Garmin</span>
                  <div className="sync-summary-item-content">
                    <span>
                      扫描 <strong>{syncSummary.garmin.scannedCount}</strong> 条
                      {syncSummary.garmin.newCount > 0 ? <> · 新增 <strong>{syncSummary.garmin.newCount}</strong> 笔训练</> : <> · 无新记录</>}
                      {syncSummary.garmin.fitCount > 0 && <> · 解析 FIT <strong>{syncSummary.garmin.fitCount}</strong> 份</>}
                    </span>
                  </div>
                </div>
              )}

              {syncSummary.conflicts && syncSummary.conflicts.detected > 0 && (
                <div className="sync-summary-item dedup">
                  <span className="sync-summary-tag dedup">智能去重</span>
                  <div className="sync-summary-item-content">
                    自动识别并归档 <strong>{syncSummary.conflicts.resolved}</strong> 对同场双表重叠训练（主力有效成绩计入周跑量）
                  </div>
                </div>
              )}

              {syncSummary.errorMessage && (
                <div className="sync-summary-error">
                  提示：{syncSummary.errorMessage}
                </div>
              )}
            </div>

            <div className="sync-summary-footer">
              <span>{new Date(syncSummary.timestamp).toLocaleTimeString("zh-CN", { hour12: false })} 完成同步</span>
              <span>可随时在设置页重新全量拉取</span>
            </div>
          </div>
        )}

        {/* 同步结果提示。桌面版它在侧边栏底部，窄屏侧边栏收着看不见，
            所以在正文里再挂一份 —— 宽屏 display:none，不会重复显示。 */}
        {syncMsg && <div className={`sync-msg mobile-sync-msg ${syncMsg.kind}`}>{syncMsg.text}</div>}

        {!isConnected && (
          <div style={{
            background: "linear-gradient(135deg, rgba(37, 99, 235, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            borderRadius: 12,
            padding: "16px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#60a5fa", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                👋 欢迎使用 PaceCraft 跑者训练中心！
              </div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
                当前尚未连接运动手表。支持一键接入 COROS 高驰或 Garmin 佳明（中国区 / 国际区），自动拉取跑步记录与心率负荷。
              </div>
              {authMsg && (
                <div style={{ fontSize: 12.5, color: authMsg.kind === "err" ? "#ef4444" : "#10b981", marginTop: 6, fontWeight: 500 }}>
                  {authMsg.text}
                </div>
              )}
            </div>
            {!authConnecting ? (
              <button
                onClick={() => setShowConnectModal(true)}
                style={{
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(37, 99, 235, 0.35)",
                }}
              >
                ⌚ 连接运动手表设备
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#93c5fd" }}>正在等待浏览器授权…</span>
                <button
                  type="button"
                  onClick={openCorosBrowser}
                  style={{ fontSize: 12, padding: "5px 10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
                >
                  🌐 打开页面
                </button>
                {authUrl && (
                  <button
                    type="button"
                    onClick={() => copyAuthUrl(authUrl)}
                    style={{ fontSize: 12, padding: "5px 10px", background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, cursor: "pointer" }}
                  >
                    {copiedAuthUrl ? "✓ 已复制" : "📋 复制链接"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={cancelCoros}
                  style={{ fontSize: 12, padding: "5px 10px", background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}

        {route.page === "training" && (
          <>
            <div className="page-head">
              <div>
                <h2>训练</h2>
                <div className="sub">周跑量、训练负荷与负荷比趋势</div>
              </div>
            </div>
            <Training
              key={`training-${dataVersion}`}
              onOpen={openActivity}
              onOpenSession={openSession}
              onOpenWeek={openWeek}
              onGoRace={() => go("race")}
              onGoReadiness={() => go("readiness")}
            />
          </>
        )}

        {route.page === "week" && route.weekStart && (
          <Week
            weekStart={route.weekStart}
            onBack={handleBack}
            onOpenSession={openSession}
            onOpenActivity={openActivity}
            aiConfigured={!!status?.aiConfigured}
          />
        )}

        {route.page === "activity" && route.labelId && (
          <ActivityDetailView
            labelId={route.labelId}
            aiConfigured={!!status?.aiConfigured}
            onBack={handleBack}
            onOpenSession={openSession}
          />
        )}

        {route.page === "session" && route.sessionKey && (
          <SessionView
            sessionKey={route.sessionKey}
            aiConfigured={!!status?.aiConfigured}
            onBack={handleBack}
            onOpenActivity={openActivity}
            onSessionKeyChange={(newKey) => navigate({ page: "session", sessionKey: newKey }, true)}
          />
        )}

        {route.page === "race" && (
          <RaceHub
            key={`race-hub-${dataVersion}`}
            dataVersion={dataVersion}
            aiConfigured={!!status?.aiConfigured}
            onRefresh={refresh}
          />
        )}

        {route.page === "prediction" && (
          <RaceHub
            key={`race-hub-pred-${dataVersion}`}
            initialTab="prediction"
            dataVersion={dataVersion}
            aiConfigured={!!status?.aiConfigured}
            onRefresh={refresh}
          />
        )}

        {route.page === "prep" && (
          <RaceHub
            key={`race-hub-prep-${dataVersion}`}
            initialTab="prep"
            dataVersion={dataVersion}
            aiConfigured={!!status?.aiConfigured}
            onRefresh={refresh}
          />
        )}

        {route.page === "readiness" && (
          <Readiness
            key={`readiness-${dataVersion}`}
            dataVersion={dataVersion}
          />
        )}

        {route.page === "health" && (
          <Readiness
            key={`readiness-health-${dataVersion}`}
            initialTab="recovery"
            dataVersion={dataVersion}
          />
        )}

        {route.page === "fitness" && (
          <Readiness
            key={`readiness-fit-${dataVersion}`}
            initialTab="fitness"
            dataVersion={dataVersion}
          />
        )}

        {route.page === "settings" && (
          <>
            <div className="page-head">
              <div>
                <h2>设置</h2>
                <div className="sub">配置 AI 模型、同步数据</div>
              </div>
            </div>
            <Settings
              onStatus={refresh}
              hasNewUpdate={hasNewUpdate}
              onCheckUpdate={() => setShowUpdateModal(true)}
            />
          </>
        )}
      </main>

      {/* 防串号数据隔离保护：检测到高驰账号变更提示弹窗 */}
      {auth?.mismatch && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.78)",
          backdropFilter: "blur(5px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
        }}>
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            maxWidth: 540,
            width: "100%",
            padding: 24,
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 24 }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text)" }}>
                检测到高驰账号变更
              </h3>
            </div>
            
            <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, margin: "0 0 16px 0" }}>
              当前档案已有「<strong style={{ color: "#60a5fa" }}>{auth.mismatch.existingNickname}</strong>」的{" "}
              <strong>{auth.mismatch.activityCount}</strong> 条训练数据，但刚刚在浏览器中授权登录的高驰官方账号是「<strong style={{ color: "#34d399" }}>{auth.mismatch.incomingNickname}</strong>」。
              <br /><br />
              为防止不同跑友的运动记录、分圈配速与体能负荷模型发生混淆与交叉污染，请选择如何处置：
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
              {/* 选项 1: 强烈推荐新建档案 */}
              <button
                type="button"
                disabled={resolvingMismatch}
                onClick={() => handleResolveMismatch("create_new")}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                  cursor: resolvingMismatch ? "not-allowed" : "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: "#10b981" }}>
                    ① 为「{auth.mismatch.incomingNickname}」创建新档案并切换
                  </span>
                  <span style={{ fontSize: 11, background: "#10b981", color: "#fff", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                    强烈推荐
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
                  保留当前档案内「{auth.mismatch.existingNickname}」的所有数据不动，自动建立新档案并立即拉取「{auth.mismatch.incomingNickname}」的数据。
                </div>
              </button>

              {/* 选项 2: 重置当前档案 */}
              <button
                type="button"
                disabled={resolvingMismatch}
                onClick={() => handleResolveMismatch("overwrite")}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  cursor: resolvingMismatch ? "not-allowed" : "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5, color: "#ef4444", marginBottom: 4 }}>
                  ② 清空当前档案旧数据，仅保留「{auth.mismatch.incomingNickname}」
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
                  彻底清空当前档案已有的 {auth.mismatch.activityCount} 条历史训练，换绑为新账号并重新开始拉取。
                </div>
              </button>

              {/* 选项 3: 合并 */}
              <button
                type="button"
                disabled={resolvingMismatch}
                onClick={() => handleResolveMismatch("merge")}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  borderRadius: 10,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  cursor: resolvingMismatch ? "not-allowed" : "pointer",
                  color: "var(--text)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)", marginBottom: 4 }}>
                  ③ 确认为同一人（如改名或大小号），合并导入
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>
                  已知晓数据将混入当前档案，将「{auth.mismatch.incomingNickname}」的数据直接合入现有数据库。
                </div>
              </button>
            </div>

            {mismatchError && (
              <div style={{ color: "#ef4444", fontSize: 12.5, marginBottom: 12 }}>
                处理失败：{mismatchError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-subtle"
                disabled={resolvingMismatch}
                onClick={async () => {
                  await disconnectCoros();
                  await refreshAuth();
                }}
                style={{ fontSize: 12 }}
              >
                取消本次授权绑定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移动端常驻底部导航 TabBar */}
      <nav className="mobile-tabbar" aria-label="移动端主导航">
        {NAV.map((n) => {
          const Icon = n.icon;
          const isActive =
            route.page === n.key ||
            (n.key === "training" && (route.page === "session" || route.page === "activity" || route.page === "week")) ||
            (n.key === "race" && (route.page === "prediction" || route.page === "prep")) ||
            (n.key === "readiness" && (route.page === "fitness" || route.page === "health"));
          return (
            <button
              key={n.key}
              className={`mobile-tab-item ${isActive ? "active" : ""}`}
              onClick={() => go(n.key)}
            >
              <Icon size={19} />
              <span>{n.label}</span>
            </button>
          );
        })}
      </nav>

      <UpdateModal
        open={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        currentAppVersion={appVersion}
      />

      <ConnectWatchModal
        open={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        corosAuth={status?.auth ?? auth}
        corosConnecting={authConnecting}
        onConnectCoros={connectCoros}
        onDisconnectCoros={disconnectCoros}
        garminAuth={garminAuth}
        onConnectGarmin={handleConnectGarmin}
        onDisconnectGarmin={handleDisconnectGarmin}
      />
    </div>
  );
}
