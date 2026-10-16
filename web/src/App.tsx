import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { FollowState } from "./api";
import { ThemeToggle, useTheme } from "./theme";
import { IconChat, IconDatabase, IconFlag, IconPulse, IconShoe, IconSync, IconTrend, IconTrophy } from "./icons";
import RaceDay from "./pages/RaceDay";
import RacePrep from "./pages/RacePrep";
import Training from "./pages/Training";
import ActivityDetailView from "./pages/ActivityDetail";
import Health from "./pages/Health";
import Fitness from "./pages/Fitness";
import Settings from "./pages/Settings";
import SessionView from "./pages/Session";
import Week from "./pages/Week";
import Prediction from "./pages/Prediction";
import RaceSetup from "./pages/RaceSetup";
import WorkflowPanel from "./pages/WorkflowPanel";

type Route = { page: "training" | "health" | "fitness" | "settings" | "activity" | "session" | "prediction" | "prep" | "race" | "week"; labelId?: string; sessionKey?: string; weekStart?: string };

const NAV: { key: Route["page"]; label: string; sub: string; icon: any }[] = [
  { key: "training", label: "训练", sub: "跑量 · 负荷", icon: IconShoe },
  { key: "prediction", label: "自建预测", sub: "我的模型", icon: IconTrend },
  { key: "race", label: "赛事路线", sub: "赛道 · 配速", icon: IconFlag },
  { key: "prep", label: "备赛体检", sub: "能不能达标", icon: IconTrend },
  { key: "fitness", label: "体能", sub: "配速 · 区间", icon: IconTrophy },
  { key: "health", label: "恢复", sub: "睡眠 · 压力", icon: IconPulse },
  { key: "settings", label: "设置", sub: "AI · 同步", icon: IconDatabase },
];

export default function App() {
  const [route, setRoute] = useState<Route>({ page: "training" });
  const [status, setStatus] = useState<any>(null);
  const { theme, toggle } = useTheme();

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

  const openActivity = (labelId: string) => labelId && setRoute({ page: "activity", labelId });
  const openSession = (sessionKey: string) => sessionKey && setRoute({ page: "session", sessionKey });
  // 周跑量柱状图点进来的是「这一周」，不是某一条记录
  const openWeek = (weekStart: string) => weekStart && setRoute({ page: "week", weekStart });

  return (
    <div className="app">
      <aside className="sidebar">
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
          return (
            <button
              key={n.key}
              className={`nav-item ${route.page === n.key ? "active" : ""}`}
              onClick={() => setRoute({ page: n.key })}
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
              <div style={{ marginTop: 6 }}>
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
        <WorkflowPanel aiConfigured={!!status?.aiConfigured} />

        {route.page === "training" && (
          <>
            <div className="page-head">
              <div>
                <h2>训练</h2>
                <div className="sub">周跑量、训练负荷与负荷比趋势</div>
              </div>
            </div>
            <Training key={`training-${dataVersion}`} onOpen={openActivity} onOpenSession={openSession} onOpenWeek={openWeek} />
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
            onBack={() => setRoute({ page: "training" })}
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

        {route.page === "health" && (
          <>
            <div className="page-head">
              <div>
                <h2>恢复</h2>
                <div className="sub">恢复度、压力、全天心率与睡眠</div>
              </div>
            </div>
            <Health key={`health-${dataVersion}`} />
          </>
        )}

        {route.page === "prediction" && (
          <>
            <div className="page-head">
              <div>
                <h2>自建成绩预测</h2>
                <div className="sub">只用你自己的训练数据，不依赖官方体能评分</div>
              </div>
            </div>
            <Prediction key={`prediction-${dataVersion}`} />
          </>
        )}

        {route.page === "race" && (
          <>
            <div className="page-head">
              <div>
                <h2>赛事路线与备赛</h2>
                <div className="sub">设置目标赛事，自动分析赛道爬升；下方为比赛日复盘与赛前方案</div>
              </div>
            </div>
            <RaceSetup key={`race-setup-${dataVersion}`} onChanged={refresh} />
            <RaceDay aiConfigured={!!status?.aiConfigured} dataVersion={dataVersion} />
          </>
        )}

        {route.page === "prep" && (
          <>
            <div className="page-head">
              <div>
                <h2>备赛体检</h2>
                <div className="sub">按最近几周的真实训练，判断能不能跑出目标成绩</div>
              </div>
            </div>
            <RacePrep aiConfigured={!!status?.aiConfigured} dataVersion={dataVersion} />
          </>
        )}

        {route.page === "fitness" && (
          <>
            <div className="page-head">
              <div>
                <h2>体能</h2>
                <div className="sub">VO₂max、阈值配速与各距离成绩预测</div>
              </div>
            </div>
            <Fitness key={`fitness-${dataVersion}`} />
          </>
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
    </div>
  );
}
