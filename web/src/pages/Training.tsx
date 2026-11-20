import { useEffect, useState } from "react";
import { api, type Activity, type LoadPoint, type Race, type Session, type Weekly } from "../api";
import { BarChart, LineChart, fmtDate, fmtDur, fmtPace } from "../charts";
import { IconCalendar, IconFlag, IconLoad, IconPulse, IconRoute, IconRun, IconShoe } from "../icons";
import { useI18n } from "../i18n";

const CLASSIFICATION_EN_MAP: Record<string, string> = {
  "中等距离跑": "Medium Distance",
  "长距离跑": "Long Run",
  "间歇训练": "Intervals",
  "间歇跑": "Intervals",
  "多次短距离": "Multiple Reps",
  "组合训练": "Mixed Workout",
  "轻松跑": "Easy Run",
  "恢复跑": "Recovery Run",
  "节奏跑": "Tempo Run",
  "乳酸阈值跑": "Threshold Run",
  "马拉松配速跑": "Marathon Pace",
  "冲刺跑": "Strides / Sprints",
  "越野跑": "Trail Run",
  "未分类跑": "Unclassified Run",
  "单次训练": "Single Session",
  "单次记录": "Single Run",
  "常规训练": "Regular Run",
};

export function formatClassification(c: string | undefined | null, isZh = true) {
  if (!c) return "—";
  if (isZh) return c;
  if (CLASSIFICATION_EN_MAP[c]) return CLASSIFICATION_EN_MAP[c];
  if (c.includes("单次")) return "Single Session";
  if (c.includes("间歇")) return "Intervals";
  if (c.includes("恢复")) return "Recovery Run";
  if (c.includes("长距离")) return "Long Run";
  if (c.includes("中等距离")) return "Medium Distance";
  if (c.includes("节奏")) return "Tempo Run";
  if (c.includes("阈值")) return "Threshold Run";
  if (c.includes("马拉松")) return "Marathon Pace";
  return c;
}

export default function Training({
  onOpen,
  onOpenSession,
  onOpenWeek,
  onGoRace,
  onGoReadiness,
  onGoCoach,
}: {
  onOpen: (labelId: string) => void;
  onOpenSession: (key: string) => void;
  onOpenWeek: (weekStart: string) => void;
  onGoRace?: () => void;
  onGoReadiness?: () => void;
  onGoCoach?: () => void;
}) {
  const { t, isZh } = useI18n();
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [load, setLoad] = useState<LoadPoint[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(16);
  const [view, setView] = useState<"session" | "record">("session");
  const [loadMode, setLoadMode] = useState<"combo" | "acwr">("combo");
  // 默认只看最近两周：116 场全渲染既慢又没人会从上往下翻
  const [range, setRange] = useState<"2w" | "1m" | "3m" | "all">("2w");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  useEffect(() => {
    setPage(1);
  }, [view, range]);

  useEffect(() => {
    Promise.all([api.weekly(weeks), api.load(90), api.activities({ limit: "200" }), api.sessions(), api.races()])
      .then(([w, l, a, s, r]) => {
        setWeekly(w);
        setLoad(l);
        setActs(a);
        setSessions(s);
        setRaces(r);
      })
      .catch((e) => setErr(e.message));
  }, [weeks]);

  if (err) return <div className="banner error">{err}</div>;
  if (!Array.isArray(weekly) || weekly.length === 0)
    return (
      <div className="empty-run">
        <IconRun size={42} />
        <span>{isZh ? "暂无数据，请先在「设置」页同步" : "No data yet. Please sync your workouts in Settings."}</span>
      </div>
    );

  const last = weekly[weekly.length - 1];
  const prev = weekly[weekly.length - 2];
  const deltaKm = prev ? last.distanceKm - prev.distanceKm : null;
  const totalKm = Array.isArray(weekly) ? weekly.reduce((s, w) => s + (w?.distanceKm ?? 0), 0) : 0;
  const totalRun = Array.isArray(weekly) ? weekly.reduce((s, w) => s + (w?.count ?? 0), 0) : 0;

  const recentLoad = load.slice(-42);
  const multiSessions = sessions.filter((s) => s.activityCount > 1);
  const intervalSessions = sessions.filter((s) => s.classification === "间歇训练");

  const RANGE_DAYS = { "2w": 14, "1m": 31, "3m": 92, all: Infinity } as const;
  const cutoff = range === "all" ? "" : (() => {
    const d = new Date();
    d.setDate(d.getDate() - RANGE_DAYS[range]);
    return d.toISOString().slice(0, 10);
  })();
  const sessionsInRange = cutoff ? sessions.filter((s) => s.date >= cutoff) : sessions;
  const actsInRange = cutoff ? acts.filter((a) => a.dateLabel >= cutoff) : acts;

  const totalItems = view === "session" ? sessionsInRange.length : actsInRange.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const paginatedSessions = sessionsInRange.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const paginatedActs = actsInRange.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const rangeKm = sessionsInRange.reduce((n, s) => n + s.totals.distanceKm, 0);
  const multiInRange = sessionsInRange.filter((s) => s.activityCount > 1);
  const latestLoad = load[load.length - 1];
  const loadStatus = ratioStatus(latestLoad?.ratio, isZh);

  // 寻找最近的未来目标赛事
  const today = new Date().toISOString().slice(0, 10);
  const upcomingRaces = races.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const targetRace = upcomingRaces[0] ?? (races.length > 0 ? races[races.length - 1] : null);
  const daysLeft = targetRace
    ? Math.ceil((new Date(`${targetRace.date}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
    : null;

  return (
    <>
      {/* 备战与今日状态 Hero 摘要 */}
      <div
        className="card"
        style={{
          marginBottom: 14,
          padding: "16px 20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          {/* 目标赛事倒计时与信息 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              minWidth: 260,
              flex: "1 1 280px",
              cursor: onGoRace ? "pointer" : "default",
            }}
            onClick={() => onGoRace?.()}
            title={
              targetRace
                ? (isZh ? "点击查看目标赛事与备战简报" : "View target race & preparation briefing")
                : (isZh ? "点击前往赛事中心配置目标比赛与 GPX 路线" : "Configure target race and GPX course in Race Hub")
            }
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "var(--accent-bg)",
                border: "1px solid var(--accent-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
                flexShrink: 0,
              }}
            >
              <IconFlag size={22} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
                <span>{isZh ? "目标赛事备赛" : "Target Race"}</span>
                {targetRace && (
                  <span className="pill accent" style={{ fontSize: 11, padding: "1px 6px" }}>
                    {daysLeft != null
                      ? daysLeft > 0
                        ? (isZh ? `倒计时 ${daysLeft} 天` : `${daysLeft} days to race`)
                        : daysLeft === 0
                        ? (isZh ? "今天比赛" : "Race Day!")
                        : (isZh ? "已完赛" : "Finished")
                      : targetRace.date}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>
                {targetRace ? targetRace.name : (isZh ? "尚未配置目标赛事" : "No target race configured")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
                {targetRace
                  ? `${targetRace.distanceKm} km · ${targetRace.city ?? (isZh ? "城市待定" : "TBD")}${targetRace.goalSec ? ` · ${isZh ? "目标 " : "Goal "}${fmtDur(targetRace.goalSec)}` : ""}`
                  : (isZh ? "点击前往「赛事中心」上传 GPX 路线并设定目标成绩 →" : "Click to go to Race Hub and configure route & goal time →")}
              </div>
            </div>
          </div>

          {/* 今日伤病监控与负荷指导 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 280, flex: "2 1 360px" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: loadStatus ? loadStatus.bg : "var(--surface-3)",
                border: `1px solid ${loadStatus ? loadStatus.border : "var(--border)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: loadStatus ? loadStatus.color : "var(--text)",
                flexShrink: 0,
              }}
            >
              <IconPulse size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{isZh ? "今日训练指导" : "Today's Guidance"}</span>
                {loadStatus && (
                  <span
                    className="pill"
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      color: loadStatus.color,
                      background: loadStatus.bg,
                      borderColor: loadStatus.border,
                      fontWeight: 600,
                    }}
                  >
                    ACWR {latestLoad?.ratio?.toFixed(2)} · {loadStatus.label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--text)", marginTop: 3, fontWeight: 500, lineHeight: 1.4 }}>
                {loadStatus ? loadStatus.advice : (isZh ? "暂无负荷诊断" : "No workload diagnostics available")}
              </div>
            </div>
          </div>

          {/* 快捷跳转操作 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {onGoCoach && (
              <button
                className="btn primary"
                onClick={onGoCoach}
                style={{ fontSize: 12, padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none" }}
              >
                {isZh ? "🎯 AI 课表" : "🎯 AI Coach"}
              </button>
            )}
            {onGoRace && (
              <button className="btn" onClick={onGoRace} style={{ fontSize: 12, padding: "6px 12px" }}>
                <IconFlag size={13} />
                {isZh ? "赛事中心" : "Race Hub"}
              </button>
            )}
            {onGoReadiness && (
              <button className="btn" onClick={onGoReadiness} style={{ fontSize: 12, padding: "6px 12px" }}>
                <IconPulse size={13} />
                {isZh ? "身体状态" : "Readiness"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRoute size={15} />{isZh ? "本周跑量" : "This Week"}</span>
            <span className="value num">
              {last.distanceKm}<span className="unit">km</span>
              {deltaKm != null && (
                <span
                  className={`pill ${deltaKm >= 0 ? "good" : ""}`}
                  style={{ fontSize: 11, marginLeft: 8, verticalAlign: "middle", fontWeight: 500 }}
                >
                  {deltaKm >= 0 ? `+${deltaKm.toFixed(1)} km` : `${deltaKm.toFixed(1)} km`}
                </span>
              )}
            </span>
            <span className="hint">
              {deltaKm == null ? (isZh ? "仅一周数据" : "1 week of data") : deltaKm >= 0 ? (isZh ? "较上周持续累积" : "Building mileage") : (isZh ? "较上周主动减量" : "Deload week")}
            </span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconShoe size={15} />{isZh ? "本周次数 / 最长单次" : "Sessions / Longest"}</span>
            <span className="value num">{last.count}<span className="unit">{isZh ? "次 · " : " · "}{last.longestRunKm}km</span></span>
            <span className="hint">{isZh ? `周均配速 ${fmtPace(last.avgPaceSec)} /km` : `Avg Pace ${fmtPace(last.avgPaceSec)} /km`}</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconCalendar size={15} />{isZh ? `近 ${weeks} 周累计` : `Past ${weeks} Weeks`}</span>
            <span className="value num">{Math.round(totalKm)}<span className="unit">km</span></span>
            <span className="hint">{totalRun} {isZh ? "次训练" : "runs"}</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconLoad size={15} />{isZh ? "当前负荷比 (ACWR)" : "Current ACWR"}</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span className="value num" style={{ color: ratioColor(latestLoad?.ratio) }}>
                {latestLoad?.ratio != null ? latestLoad.ratio.toFixed(2) : "—"}
              </span>
              {loadStatus && (
                <span
                  className="pill"
                  style={{
                    fontSize: 11,
                    verticalAlign: "middle",
                    color: loadStatus.color,
                    background: loadStatus.bg,
                    borderColor: loadStatus.border,
                    fontWeight: 600,
                  }}
                >
                  {loadStatus.label}
                </span>
              )}
            </div>

            {/* Gabbett ACWR 区间色带标尺 */}
            {latestLoad?.ratio != null && (
              <div style={{ marginTop: 8, marginBottom: 4 }}>
                <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--surface-3)", display: "flex", overflow: "hidden" }}>
                  <div title={isZh ? "减量区 (<0.8)" : "Undertraining (<0.8)"} style={{ width: "30%", background: "var(--info)", opacity: 0.85 }} />
                  <div title={isZh ? "安全甜点区 (0.8–1.3)" : "Optimal Sweet Spot (0.8-1.3)"} style={{ width: "35%", background: "var(--good)" }} />
                  <div title={isZh ? "警示区 (1.3–1.5)" : "Caution (1.3-1.5)"} style={{ width: "15%", background: "var(--warn)" }} />
                  <div title={isZh ? "高危区 (>1.5)" : "High Risk (>1.5)"} style={{ width: "20%", background: "var(--bad)" }} />
                </div>
                <div style={{ position: "relative", width: "100%", height: 7, marginTop: 2 }}>
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.min(Math.max(((latestLoad.ratio - 0.4) / (1.8 - 0.4)) * 100, 2), 98)}%`,
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "4px solid transparent",
                      borderRight: "4px solid transparent",
                      borderBottom: `6px solid ${ratioColor(latestLoad.ratio)}`,
                    }}
                  />
                </div>
              </div>
            )}

            <span className="hint">
              {latestLoad?.comment ?? "—"}｜{isZh ? `短期 ${latestLoad?.shortLoad ?? "—"} / 长期 ${latestLoad?.longLoad ?? "—"}` : `ATL ${latestLoad?.shortLoad ?? "—"} / CTL ${latestLoad?.longLoad ?? "—"}`}
            </span>
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="seg" style={{ marginBottom: 12 }}>
            {[12, 16, 26].map((w) => (
              <button key={w} className={weeks === w ? "active" : ""} onClick={() => setWeeks(w)}>{w} {isZh ? "周" : "w"}</button>
            ))}
          </div>
          <h3 className="card-title">{isZh ? "周跑量" : "Weekly Mileage"}</h3>
          <p className="card-sub">{isZh ? "柱状为周总公里数，折线为该周平均心率。点柱子看这一周的汇总" : "Weekly mileage and avg HR trend. Click bar to view weekly summary."}</p>
          <BarChart
            data={weekly.map((w) => ({
              label: fmtDate(w.weekStart),
              value: w.distanceKm,
              extra: w.avgHr ?? 0,
              tip: [
                [`${w.distanceKm} km`, isZh ? "距离" : "Dist"],
                [`${w.count} ${isZh ? "次" : "runs"}`, isZh ? "次数" : "Count"],
                [`${w.longestRunKm} km`, isZh ? "最长单次" : "Longest"],
                [fmtPace(w.avgPaceSec) + " /km", isZh ? "周均配速" : "Avg Pace"],
                [`${w.avgHr ?? "—"} bpm`, isZh ? "周均心率" : "Avg HR"],
              ] as [string, string][],
            }))}
            overlayColor="var(--hr)"
            overlayLabel={isZh ? "平均心率" : "Avg HR"}
            height={200}
            onSelect={(i) => onOpenWeek(weekly[i].weekStart)}
          />
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 className="card-title" style={{ marginBottom: 2 }}>{isZh ? "训练负荷与伤病监控" : "Training Load & Injury Risk"}</h3>
              <p className="card-sub" style={{ margin: 0 }}>
                {loadMode === "combo"
                  ? (isZh ? "短期(疲劳) / 长期(体能)与急慢性负荷比，双轴联动" : "Banister model: ATL(Fatigue) / CTL(Fitness) with ACWR")
                  : (isZh ? "Tim Gabbett 理论：ACWR 7日均比值与 0.8–1.3 最佳甜点区" : "Tim Gabbett model: ACWR sweet spot between 0.8 and 1.3")}
              </p>
            </div>
            <div className="seg">
              <button className={loadMode === "combo" ? "active" : ""} onClick={() => setLoadMode("combo")}>
                {isZh ? "体能与疲劳" : "Fitness & Fatigue"}
              </button>
              <button className={loadMode === "acwr" ? "active" : ""} onClick={() => setLoadMode("acwr")}>
                {isZh ? "ACWR 甜点区" : "ACWR Sweet Spot"}
              </button>
            </div>
          </div>

          {loadMode === "combo" ? (
            <LineChart
              labels={recentLoad.map((p) => p.date)}
              series={[
                { key: "short", label: isZh ? "短期负荷" : "Acute Load (ATL)", color: "var(--chart-accent)", values: recentLoad.map((p) => p.shortLoad) },
                { key: "long", label: isZh ? "长期负荷" : "Chronic Load (CTL)", color: "var(--chart-muted)", values: recentLoad.map((p) => p.longLoad) },
                { key: "ratio", label: isZh ? "负荷比 (ACWR)" : "Workload Ratio (ACWR)", color: "var(--chart-warn)", values: recentLoad.map((p) => p.ratio), axis: "right" },
              ]}
              height={190}
              yFmt={(n) => String(Math.round(n))}
              yFmtRight={(n) => n.toFixed(2)}
            />
          ) : (
            <LineChart
              labels={recentLoad.map((p) => p.date)}
              series={[{ key: "ratio", label: isZh ? "负荷比（7日均）" : "ACWR (7-day Avg)", color: "var(--chart-warn)", values: recentLoad.map((p) => p.ratioAvg7 ?? p.ratio) }]}
              bands={[{ from: 0.8, to: 1.3, color: "var(--chart-good)" }]}
              height={190}
              yMin={0.4}
              yMax={1.8}
              yFmt={(n) => n.toFixed(2)}
            />
          )}

          {/* 依据当前选中的 Tab 动态展示对应视角的科学诊断 */}
          {loadMode === "combo" ? (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 11.5 }}>
                  {isZh ? "Banister 冲量反应模型 · 体能与疲劳消长" : "Banister Impulse-Response Model · Fitness & Fatigue Balance"}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  {isZh
                    ? `短期疲劳 ${latestLoad?.shortLoad ?? "—"} ｜ 长期体能 ${latestLoad?.longLoad ?? "—"} ｜ 负荷比 ${latestLoad?.ratio?.toFixed(2) ?? "—"}`
                    : `Acute ${latestLoad?.shortLoad ?? "—"} | Chronic ${latestLoad?.longLoad ?? "—"} | ACWR ${latestLoad?.ratio?.toFixed(2) ?? "—"}`}
                </span>
              </div>
              {(() => {
                const s = latestLoad?.shortLoad ?? 0;
                const l = latestLoad?.longLoad ?? 0;
                const diff = s - l;
                return (
                  <div style={{ color: "var(--text)", fontSize: 11.5 }}>
                    <strong style={{ color: diff > 10 ? "var(--chart-accent)" : diff < -10 ? "var(--good)" : "var(--text)" }}>
                      {diff > 10
                        ? (isZh ? `负荷刺激冲击期（疲劳高于体能 +${Math.round(diff)}）` : `Stimulation Phase (Fatigue exceeds fitness +${Math.round(diff)})`)
                        : diff < -10
                        ? (isZh ? `减量消退期（疲劳低于体能 ${Math.round(diff)}）` : `Taper / Recovery Phase (Fatigue below fitness ${Math.round(diff)})`)
                        : (isZh ? "平稳维持期（疲劳与体能均衡）" : "Maintenance Phase (Fatigue & fitness balanced)")}
                    </strong>
                    ：
                    {diff > 10
                      ? (isZh
                        ? "近期训练刺激高于过去四周基准，体能处于积极蓄能期，需注意软组织放松与营养补充以促进超量代偿。"
                        : "Recent training exceeds your 4-week baseline. Fitness is building; ensure recovery, mobility work, and nutrition for supercompensation.")
                      : diff < -10
                      ? (isZh
                        ? "近期训练负荷主动回落，前期疲劳正加速消退，长期体能储备即将释放，适合赛前减量或状态摸底。"
                        : "Training load has dialed back. Accumulated fatigue is dissipating and fitness is peaking, ideal for race taper or tune-ups.")
                      : (isZh
                        ? "当前短期刺激与长期储备高度同步，训练负荷稳步推进，没有过量疲劳积压。"
                        : "Acute stimulus and chronic base are synchronized. Workload is progressing smoothly without excessive fatigue accumulation.")}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 4, fontWeight: 500, fontSize: 11.5 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--good)" }} />
                  {isZh ? "0.80–1.30 最佳甜点区" : "0.80–1.30 Sweet Spot"}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--warn)" }} />
                  {isZh ? "1.30–1.50 负荷警示" : "1.30–1.50 Caution"}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--bad)" }} />
                  {isZh ? ">1.50 高危区" : ">1.50 High Risk"}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--info)" }} />
                  {isZh ? "<0.80 减量区" : "<0.80 Taper Zone"}
                </span>
              </div>
              {loadStatus && (
                <div style={{ color: "var(--text)", fontSize: 11.5 }}>
                  <strong style={{ color: loadStatus.color }}>{isZh ? "当前伤病诊断" : "Injury Diagnostics"}</strong>：{loadStatus.advice}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 className="card-title" style={{ marginBottom: 2 }}>{view === "session" ? (isZh ? "训练场次" : "Sessions") : (isZh ? "训练记录（逐条）" : "Raw Activities")}</h3>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {view === "session"
                ? (isZh ? "同一天的多次记录已合并为一场；脱钩率评估持续稳态跑（保护性门槛：≥4km 且 ≥25min），<5% 证明基础有氧扎实" : "Aggregated daily sessions with aerobic decoupling evaluation (threshold: ≥4km & ≥25min).")
                : (isZh ? "这是手表记录的原始条目，一条一次训练" : "Raw unmerged activities imported directly from your sports watch.")}
            </p>
          </div>
          <div className="seg">
            <button className={view === "session" ? "active" : ""} onClick={() => setView("session")}>
              {isZh ? `按场次 ${sessions.length}` : `Sessions ${sessions.length}`}
            </button>
            <button className={view === "record" ? "active" : ""} onClick={() => setView("record")}>
              {isZh ? `逐条 ${acts.length}` : `Raw ${acts.length}`}
            </button>
          </div>
        </div>

        {view === "session" ? (
          <div className="table-wrap" key="session-table-wrap">
            {multiSessions.length > 0 && (
              <div className="banner info" style={{ marginBottom: 12 }}>
                {isZh ? (
                  <>
                    有 <strong>{multiSessions.length}</strong> 场训练包含多条记录
                    {intervalSessions.length > 0 && <>，其中 <strong>{intervalSessions.length}</strong> 场被识别为间歇训练</>}
                    。点任意一行进入场次详情，AI 会一次分析整场而不是逐条点评。
                  </>
                ) : (
                  <>
                    <strong>{multiSessions.length}</strong> multi-activity sessions detected
                    {intervalSessions.length > 0 && <> ({intervalSessions.length} intervals)</>}. Click any row to view session details and full AI review.
                  </>
                )}
              </div>
            )}
            <div className="range-bar">
              <div className="seg">
                {([["2w", isZh ? "近 2 周" : "2 Weeks"], ["1m", isZh ? "近 1 月" : "1 Month"], ["3m", isZh ? "近 3 月" : "3 Months"], ["all", isZh ? "全部" : "All"]] as const).map(([k, lbl]) => (
                  <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{lbl}</button>
                ))}
              </div>
              <span className="range-info">
                {isZh ? `共 ${sessions.length} 场，当前显示 ${sessionsInRange.length} 场` : `${sessionsInRange.length} of ${sessions.length} sessions shown`}
                {range !== "all" && <> · {Math.round(rangeKm)} km{multiInRange.length > 0 && (isZh ? ` · ${multiInRange.length} 场多记录` : ` · ${multiInRange.length} multi-records`)}</>}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{isZh ? "日期" : "Date"}</th>
                  <th>{isZh ? "类型" : "Type"}</th>
                  <th>{isZh ? "记录数" : "Records"}</th>
                  <th>{isZh ? "总距离" : "Distance"}</th>
                  <th>{isZh ? "总时长" : "Duration"}</th>
                  <th>{isZh ? "均配速" : "Avg Pace"}</th>
                  <th>{isZh ? "均心率" : "Avg HR"}</th>
                  <th>{isZh ? "负荷" : "Load"}</th>
                  <th
                    title={isZh ? "基于 Joe Friel 耐力模型：稳态有氧跑对比前后半程效率因子（EF = 配速 / 心率）。" : "Joe Friel model: Aerobic decoupling factor between 1st and 2nd halves."}
                    style={{ cursor: "help" }}
                  >
                    {isZh ? "有氧脱钩率 (Pw:Hr) ⓘ" : "Decoupling (Pw:Hr) ⓘ"}
                  </th>
                  <th>{isZh ? "组结构" : "Sets"}</th>
                </tr>
              </thead>
              <tbody>
                {sessionsInRange.length === 0 && (
                  <tr><td colSpan={10}><div className="empty-run"><IconCalendar size={40} /><span>{isZh ? "该时间范围内没有训练" : "No training sessions in this time range"}</span></div></td></tr>
                )}
                {paginatedSessions.map((s) => (
                  <tr key={s.key} className="clickable" onClick={() => onOpenSession(s.key)}>
                    <td>{s.date || "—"}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className={`pill ${s.kind === "multi" ? "accent" : ""}`}>{formatClassification(s.classification, isZh)}</span>
                    </td>
                    <td className="num" style={{ color: s.activityCount > 1 ? "var(--accent)" : undefined }}>
                      {s.activityCount}
                    </td>
                    <td className="num">{s.totals.distanceKm}</td>
                    <td className="num">{fmtDur(s.totals.durationSec)}</td>
                    <td className="num">{fmtPace(s.totals.distanceKm ? s.totals.durationSec / s.totals.distanceKm : null)}</td>
                    <td className="num">{s.totals.avgHr ?? "—"}</td>
                    <td className="num">{s.totals.trainingLoad || "—"}</td>
                    <td>
                      {s.decoupling && s.classification !== "组合训练" && s.classification !== "多次短距离" && s.classification !== "间歇训练" ? (
                        <span
                          className={`pill ${s.decoupling.level}`}
                          style={{ fontSize: 11, fontWeight: 600 }}
                          title={isZh ? `Joe Friel 有氧脱钩率：后程效率因子变化 ${s.decoupling.pct}%` : `Joe Friel Decoupling: Cardiac drift ${s.decoupling.pct}%`}
                        >
                          {isZh ? s.decoupling.label : (s.decoupling.pct < 0 ? "Negative (<0%)" : s.decoupling.pct <= 5.0 ? "Steady (<5%)" : s.decoupling.pct <= 8.0 ? "Mild (5-8%)" : "High (>8%)")}
                        </span>
                      ) : (
                        <span
                          style={{ color: "var(--text-faint)", fontSize: 12, cursor: "help" }}
                          title={decouplingReason(s, isZh)}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12 }}>
                      {s.sets.length > 0
                        ? s.sets.map((x) => `${x.distanceLabel}×${x.reps}`).join(" + ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              total={sessionsInRange.length}
              page={currentPage}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              unitLabel={isZh ? "场训练" : "sessions"}
              isZh={isZh}
            />
          </div>
        ) : (
          <div className="table-wrap" key="record-table-wrap">
            <div className="range-bar">
              <div className="seg">
                {([["2w", isZh ? "近 2 周" : "2 Weeks"], ["1m", isZh ? "近 1 月" : "1 Month"], ["3m", isZh ? "近 3 月" : "3 Months"], ["all", isZh ? "全部" : "All"]] as const).map(([k, lbl]) => (
                  <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{lbl}</button>
                ))}
              </div>
              <span className="range-info">
                {isZh ? (
                  <>共 <strong>{acts.length}</strong> 条，当前显示 <strong>{actsInRange.length}</strong> 条</>
                ) : (
                  <><strong>{actsInRange.length}</strong> of <strong>{acts.length}</strong> records shown</>
                )}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>{isZh ? "日期" : "Date"}</th>
                  <th>{isZh ? "项目" : "Activity"}</th>
                  <th>{isZh ? "距离" : "Distance"}</th>
                  <th>{isZh ? "用时" : "Duration"}</th>
                  <th>{isZh ? "配速" : "Pace"}</th>
                  <th>{isZh ? "心率" : "HR"}</th>
                  <th>{isZh ? "步频" : "Cadence"}</th>
                  <th>{isZh ? "负荷" : "Load"}</th>
                  <th>{isZh ? "重点" : "Focus"}</th>
                </tr>
              </thead>
              <tbody>
                {actsInRange.length === 0 && (
                  <tr><td colSpan={9}><div className="empty-run"><IconCalendar size={40} /><span>{isZh ? "该时间范围内没有训练记录" : "No activity records in this time range"}</span></div></td></tr>
                )}
                {paginatedActs.map((a) => (
                  <tr key={a.labelId} className="clickable" onClick={() => onOpen(a.labelId)}>
                    <td>{a.dateLabel || "—"}</td>
                    <td style={{ textAlign: "left", color: "var(--text-dim)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {a.source === "garmin" ? (
                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(16, 185, 129, 0.12)", color: "#10b981", fontWeight: 600 }}>Garmin</span>
                        ) : (
                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", fontWeight: 600 }}>COROS</span>
                        )}
                        {a.isDuplicate === 1 && (
                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(234, 179, 8, 0.15)", color: "#eab308", fontWeight: 600 }} title={isZh ? "同一时段双表记录，已归档为对比样本，不重复累加跑量与负荷" : "Dual-watch recording archived as reference; not double-counted"}>
                            {isZh ? "对比样本" : "Reference"}
                          </span>
                        )}
                        <span>{a.sportName}</span>
                      </span>
                    </td>
                    <td className="num">{a.distanceKm ?? "—"}</td>
                    <td className="num">{fmtDur(a.durationSec)}</td>
                    <td className="num">{fmtPace(a.avgPaceSec)}</td>
                    <td className="num">{a.avgHr ?? "—"}</td>
                    <td className="num">{a.detail?.avgCadence ?? "—"}</td>
                    <td className="num">{a.detail?.trainingLoad ?? "—"}</td>
                    <td><span className="pill">{a.detail?.trainingFocus ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              total={actsInRange.length}
              page={currentPage}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              unitLabel={isZh ? "条记录" : "records"}
              isZh={isZh}
            />
          </div>
        )}
      </div>
    </>
  );
}

function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  unitLabel = "条",
  isZh = true,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  unitLabel?: string;
  isZh?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 14,
        paddingTop: 12,
        borderTop: "1px solid var(--border)",
        fontSize: 12,
        color: "var(--text-dim)",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      <div>
        {isZh ? (
          <>共 <strong>{total}</strong> {unitLabel} · 第 <strong>{page}</strong> / {totalPages} 页</>
        ) : (
          <>Total <strong>{total}</strong> {unitLabel} · Page <strong>{page}</strong> of {totalPages}</>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: page <= 1 ? "var(--text-faint)" : "var(--text)",
            borderRadius: 6,
            padding: "4px 9px",
            cursor: page <= 1 ? "not-allowed" : "pointer",
            fontSize: 11.5,
          }}
        >
          {isZh ? "上一页" : "Prev"}
        </button>

        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
          .map((p, idx, arr) => {
            const prev = arr[idx - 1];
            const showEllipsis = prev && p - prev > 1;
            return (
              <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {showEllipsis && <span style={{ color: "var(--text-faint)", padding: "0 2px" }}>…</span>}
                <button
                  type="button"
                  onClick={() => onPageChange(p)}
                  style={{
                    background: p === page ? "var(--accent)" : "var(--surface-2)",
                    color: p === page ? "var(--accent-ink)" : "var(--text)",
                    border: `1px solid ${p === page ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6,
                    minWidth: 26,
                    height: 26,
                    padding: "0 5px",
                    fontSize: 11.5,
                    fontWeight: p === page ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              </span>
            );
          })}

        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: page >= totalPages ? "var(--text-faint)" : "var(--text)",
            borderRadius: 6,
            padding: "4px 9px",
            cursor: page >= totalPages ? "not-allowed" : "pointer",
            fontSize: 11.5,
          }}
        >
          {isZh ? "下一页" : "Next"}
        </button>
      </div>
    </div>
  );
}

function ratioColor(r: number | null | undefined) {
  if (r == null) return "var(--text)";
  if (r >= 1.5) return "var(--bad)";
  if (r >= 1.3) return "var(--warn)";
  if (r < 0.8) return "var(--hr)";
  return "var(--good)";
}

function ratioStatus(r: number | null | undefined, isZh = true) {
  if (r == null) return null;
  if (r >= 1.5) {
    return {
      label: isZh ? "危险激增 (>1.5)" : "High Risk (>1.5)",
      color: "var(--bad)",
      bg: "var(--bad-bg)",
      border: "var(--bad-border)",
      title: isZh ? "危险激增区（高伤病风险）" : "High Risk Zone (High Injury Probability)",
      advice: isZh
        ? "短期疲劳显著超过长期体能储备，软组织伤病发生率成倍飙升。强烈建议未来 48 小时以纯休息或 Z1 轻松慢摇排酸为主，严禁冲击高强度课表。"
        : "Acute fatigue significantly exceeds chronic fitness. Injury risk escalates exponentially. Rest or easy Z1 recovery is strongly recommended for the next 48 hours; avoid high-intensity workouts.",
    };
  }
  if (r >= 1.3) {
    return {
      label: isZh ? "负荷警示 (1.3–1.5)" : "Caution (1.3–1.5)",
      color: "var(--warn)",
      bg: "var(--warn-bg)",
      border: "var(--warn-border)",
      title: isZh ? "负荷警示累积区" : "Caution Zone (Fatigue Accumulating)",
      advice: isZh
        ? "疲劳累积速度快于体能恢复速度，需密切关注跟腱、足底及小腿肌肉酸痛反馈，避免连续安排两场高强度训练。"
        : "Fatigue accumulation is outpacing recovery. Monitor achilles, calves, and plantars closely; avoid consecutive hard training days.",
    };
  }
  if (r >= 0.8) {
    return {
      label: isZh ? "安全甜点区 (0.8–1.3)" : "Optimal Sweet Spot (0.8–1.3)",
      color: "var(--good)",
      bg: "var(--good-bg)",
      border: "var(--good-border)",
      title: isZh ? "最佳适宜甜点区（The Sweet Spot）" : "Optimal Training Sweet Spot",
      advice: isZh
        ? "短期疲劳与长期体能储备维持在极佳的动态平衡中，伤病发生概率极低（<5%），体能正处于高效率稳步累积期。"
        : "Acute and chronic workloads are in optimal dynamic equilibrium. Injury risk is minimal (<5%); aerobic fitness is building efficiently.",
    };
  }
  return {
    label: isZh ? "减量恢复区 (<0.8)" : "Recovery / Taper (<0.8)",
    color: "var(--hr)",
    bg: "var(--info-bg)",
    border: "var(--info-border)",
    title: isZh ? "减量恢复/欠训练区" : "Recovery / Undertraining Zone",
    advice: isZh
      ? "短期负荷较低，身体处于充分休整或疲劳消退期。适合赛前 1~2 周减量恢复巅峰体能，若处于正常训练期则可逐步恢复跑量以维持体能储备。"
      : "Low acute load. Fatigue is dissipating. Ideal for pre-race taper; during regular training, gradually increase mileage to maintain fitness.",
  };
}

function decouplingReason(s: Session, isZh = true): string {
  if (s.classification === "间歇训练") {
    return isZh
      ? "不适用：间歇训练快慢交替、心率剧烈起伏，不符合稳态跑评估前提"
      : "Not applicable: Interval sessions involve fluctuating paces and spikes, unsuitable for steady-state decoupling.";
  }
  if (s.classification === "组合训练" || s.classification === "多次短距离") {
    return isZh
      ? "不适用：组合训练可能由多组间歇或力量训练等混合项目构成，配速与心率非持续稳态，脱钩率判定不准确"
      : "Not applicable: Mixed workouts contain multiple discontinuous activities; decoupling is not reliable.";
  }
  if (s.totals.durationSec < 1500 || s.totals.distanceKm < 4.0) {
    return isZh
      ? `保护性过滤：当前单次 ${s.totals.distanceKm}km / ${fmtDur(s.totals.durationSec)}，时长或距离较短，处于前程心率爬坡升温期，不满足稳态门槛（需 ≥4km 且 ≥25min）`
      : `Protected: Session (${s.totals.distanceKm}km / ${fmtDur(s.totals.durationSec)}) is too short for steady-state assessment (requires ≥4km & ≥25min).`;
  }
  return isZh
    ? "不适用：分圈样本数不足、心率缺失或山地大爬升（>20m/km）扰动"
    : "Not applicable: Insufficient lap samples, missing HR, or extreme elevation gain (>20m/km).";
}
