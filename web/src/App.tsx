import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { FollowState } from "./api";
import { ThemeToggle, useTheme } from "./theme";
import { useTableScroll } from "./table-scroll";
import { IconBack, IconDatabase, IconFlag, IconMenu, IconPulse, IconShoe, IconSync } from "./icons";
import Training from "./pages/Training";
import ActivityDetailView from "./pages/ActivityDetail";
import Settings from "./pages/Settings";
import SessionView from "./pages/Session";
import Week from "./pages/Week";
import RaceHub, { type RaceTab } from "./pages/RaceHub";
import Readiness, { type ReadinessTab } from "./pages/Readiness";
import { useCorosAuth } from "./use-coros-auth";
import ProfileSwitcher from "./components/ProfileSwitcher";

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
  /** 让轮询回调能调用最新的 doSync，避免闭包捕获旧函数 */
  const doSyncRef = useRef<(() => Promise<void>) | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [follow, setFollow] = useState<FollowState | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number; exhausted: boolean } | null>(null);

  const refresh = () => api.status().then(setStatus).catch(() => {});
  const loadQuota = () => api.fitQuota().then(setQuota).catch(() => {});

  const {
    connecting: authConnecting,
    authUrl,
    connect: connectCoros,
    cancel: cancelCoros,
    openBrowser: openCorosBrowser,
  } = useCorosAuth(() => {
    refresh();
    void doSyncRef.current?.();
  });
  useEffect(() => {
    refresh();
    api.followStatus().then(setFollow).catch(() => {});
    loadQuota();
  }, []);

  // 跟随开启时轮询状态；一旦服务端说有新数据待拉，提醒用户
  useEffect(() => {
    if (!follow?.active) return;
    const t = setInterval(() => {
      api.followStatus().then((s) => {
        setFollow((prev) => {
          // 发现「服务端有今天的数据但本地没有」时自动同步
          if (s.lastCheckMessage?.includes("本地还没有")) {
            void doSyncRef.current?.();
          }
          return s;
        });
      }).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [follow?.active]);



  const doSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.quickSync();
      if (r.busy) {
        setSyncMsg({ text: r.message, kind: "err" });
      } else if (r.ok) {
        setSyncMsg({ text: r.message, kind: "ok" });
        // 通知所有页面：重新拉数据 + 刷新侧边栏统计
        setDataVersion((v) => v + 1);
        refresh();
      } else {
        setSyncMsg({ text: r.message, kind: "err" });
      }
      api.followStatus().then(setFollow).catch(() => {});
      loadQuota();
    } catch (e) {
      setSyncMsg({ text: `同步失败：${(e as Error).message}`, kind: "err" });
    } finally {
      setSyncing(false);
      // 成功提示 6 秒后自动消失，失败提示留着等人看清
      setTimeout(() => setSyncMsg(null), 6000);
    }
  };

  doSyncRef.current = doSync;

  const toggleFollow = async () => {
    try {
      const s = follow?.active ? await api.followStop() : await api.followStart();
      setFollow(s);
      setSyncMsg({
        text: s.active
          ? "已开启跟随：手表上传后会自动同步（每 3 分钟探测一次）"
          : "已停止跟随",
        kind: "ok",
      });
    } catch (e) {
      setSyncMsg({ text: `操作失败：${(e as Error).message}`, kind: "err" });
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
          onRequireAuth={connectCoros}
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
            onClick={doSync}
            disabled={syncing}
            title="立即从 COROS 拉取最近 3 天的训练数据"
          >
            <IconSync size={14} />
            <span>{syncing ? "同步中…" : "立即同步"}</span>
          </button>
          <button
            className={`sync-btn follow ${follow?.active ? "on" : ""}`}
            onClick={toggleFollow}
            title="手表上传后自动同步（COROS 通常有 1-4 小时延迟）"
          >
            <span className="dot" />
            <span>{follow?.active ? "跟随中" : "开启自动跟随"}</span>
          </button>
          {quota && (
            <div className="sync-msg follow-msg" title="FIT 文件每日下载上限（COROS 官方限制）">
              FIT 额度 {quota.used}/{quota.limit}{quota.exhausted ? " · 今日已用完" : ""}
            </div>
          )}
          {follow?.active && follow.lastCheckMessage && (
            <div className="sync-msg follow-msg">{follow.lastCheckMessage}</div>
          )}
          {syncMsg && (
            <div className={`sync-msg ${syncMsg.kind}`}>{syncMsg.text}</div>
          )}
          {status ? (
            <>
              <div>数据截至 {status.latestActivityDate ?? "—"}</div>
              <div style={{ marginTop: 3 }}>
                {status.counts.activities} 次活动 · {status.counts.laps} 行分圈
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {status.auth?.connected
                  ? <span className="pill good">COROS 已连接</span>
                  : <span className="pill warn" style={{ cursor: "pointer" }} onClick={connectCoros} title="点击连接高驰账号">COROS 未连接</span>}
                {status.aiConfigured
                  ? <span className="pill good">AI 已配置</span>
                  : <span className="pill warn">AI 未配置</span>}
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
          <button className="mobile-sync" onClick={doSync} disabled={syncing} title="立即从 COROS 拉取最近 3 天的训练数据">
            <IconSync size={15} />
            <span>{syncing ? "同步中" : "同步"}</span>
          </button>
        </div>

        {/* 同步结果提示。桌面版它在侧边栏底部，窄屏侧边栏收着看不见，
            所以在正文里再挂一份 —— 宽屏 display:none，不会重复显示。 */}
        {syncMsg && <div className={`sync-msg mobile-sync-msg ${syncMsg.kind}`}>{syncMsg.text}</div>}

        {status?.auth && !status.auth.connected && (
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
                👋 欢迎使用 COROS 训练看板！
              </div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
                当前尚未绑定 COROS 高驰账号。一键授权后即可自动拉取你的跑步记录、心率与体能负荷数据。
              </div>
            </div>
            {!authConnecting ? (
              <button
                onClick={connectCoros}
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
                🔗 一键连接 COROS 账号
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
                    onClick={() => {
                      navigator.clipboard.writeText(authUrl);
                      alert("授权链接已复制到剪贴板，请直接粘贴至浏览器地址栏打开。");
                    }}
                    style={{ fontSize: 12, padding: "5px 10px", background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, cursor: "pointer" }}
                  >
                    📋 复制链接
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
            <Settings onStatus={refresh} />
          </>
        )}
      </main>

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
    </div>
  );
}
