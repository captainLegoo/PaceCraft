import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { FollowState } from "./api";
import { ThemeToggle, useTheme } from "./theme";
import { useTableScroll } from "./table-scroll";
import { IconDatabase, IconFlag, IconMenu, IconPulse, IconShoe, IconSync } from "./icons";
import Training from "./pages/Training";
import ActivityDetailView from "./pages/ActivityDetail";
import Settings from "./pages/Settings";
import SessionView from "./pages/Session";
import Week from "./pages/Week";
import RaceHub, { type RaceTab } from "./pages/RaceHub";
import Readiness, { type ReadinessTab } from "./pages/Readiness";
import { useCorosAuth } from "./use-coros-auth";

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

export default function App() {
  const [route, setRoute] = useState<Route>({ page: "training" });
  const [status, setStatus] = useState<any>(null);
  const { theme, toggle } = useTheme();

  /** 窄屏下侧边栏变成抽屉，默认收起 */
  const [navOpen, setNavOpen] = useState(false);
  useTableScroll();

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

  // 抽屉里点任意导航项就顺手收起。两个 setState 会被 React 18 自动批成一次渲染，
  // 所以不会出现「页面已经切了、抽屉还开着」的那种中间态。
  const go = useCallback((page: Route["page"]) => {
    setRoute({ page });
    setNavOpen(false);
  }, []);

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
    connect: connectCoros,
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
    labelId && setRoute({ page: "activity", labelId, fromSessionKey });
  const openSession = (sessionKey: string) => sessionKey && setRoute({ page: "session", sessionKey });
  // 周跑量柱状图点进来的是「这一周」，不是某一条记录
  const openWeek = (weekStart: string) => weekStart && setRoute({ page: "week", weekStart });

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
            <svg viewBox="0 0 40 40" fill="none">
              {/* 跑道分道线 + 跑步的人，做品牌图形 */}
              <path d="M4 33h32" stroke="currentColor" strokeWidth="1" opacity="0.25" strokeLinecap="round" />
              <path d="M6 28.5h28M8 24h24M10 19.5h20" stroke="currentColor" strokeWidth="1" opacity="0.16" strokeLinecap="round" />
              <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="24.5" cy="8.4" r="2.1" fill="currentColor" stroke="none" />
                <path d="M22.4 12.4 18.6 14.6l1.4 3.9-3.3 5.7" />
                <path d="m20 18.2 3.8.8 2.6 4.7" />
                <path d="m21.2 11.8 3.7 2.3 3.3-.7" />
                <path d="M15 15.1 12 16.3" />
              </g>
            </svg>
          </div>
          <h1>COROS 训练看板</h1>
          <p>自建 · 数据仅存本机</p>
        </div>
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
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={navOpen}
          >
            <IconMenu size={20} />
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
            <button
              onClick={connectCoros}
              disabled={authConnecting}
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
              {authConnecting ? "正在打开授权页面…" : "🔗 一键连接 COROS 账号"}
            </button>
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
            onBack={() => setRoute({ page: "training" })}
            onOpenSession={openSession}
            onOpenActivity={openActivity}
            aiConfigured={!!status?.aiConfigured}
          />
        )}

        {route.page === "activity" && route.labelId && (
          <ActivityDetailView
            labelId={route.labelId}
            aiConfigured={!!status?.aiConfigured}
            onBack={() => route.fromSessionKey ? openSession(route.fromSessionKey) : setRoute({ page: "training" })}
            onOpenSession={openSession}
          />
        )}

        {route.page === "session" && route.sessionKey && (
          <SessionView
            sessionKey={route.sessionKey}
            aiConfigured={!!status?.aiConfigured}
            onBack={() => setRoute({ page: "training" })}
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
