import { useEffect, useState } from "react";
import { api, type Activity, type LoadPoint, type Race, type Session, type Weekly } from "../api";
import { BarChart, LineChart, fmtDate, fmtDur, fmtPace } from "../charts";
import { IconCalendar, IconFlag, IconLoad, IconPulse, IconRoute, IconRun, IconShoe } from "../icons";

export default function Training({
  onOpen,
  onOpenSession,
  onOpenWeek,
  onGoRace,
  onGoReadiness,
}: {
  onOpen: (labelId: string) => void;
  onOpenSession: (key: string) => void;
  onOpenWeek: (weekStart: string) => void;
  onGoRace?: () => void;
  onGoReadiness?: () => void;
}) {
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
  if (weekly.length === 0) return <div className="empty-run"><IconRun size={42} /><span>暂无数据，请先在「设置」页同步</span></div>;

  const last = weekly[weekly.length - 1];
  const prev = weekly[weekly.length - 2];
  const deltaKm = prev ? last.distanceKm - prev.distanceKm : null;
  const totalKm = weekly.reduce((s, w) => s + w.distanceKm, 0);
  const totalRun = weekly.reduce((s, w) => s + w.count, 0);

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

  const rangeKm = sessionsInRange.reduce((n, s) => n + s.totals.distanceKm, 0);
  const multiInRange = sessionsInRange.filter((s) => s.activityCount > 1);
  const latestLoad = load[load.length - 1];
  const loadStatus = ratioStatus(latestLoad?.ratio);

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
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 260, flex: "1 1 280px" }}>
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
                <span>目标赛事备赛</span>
                {targetRace && (
                  <span className="pill accent" style={{ fontSize: 11, padding: "1px 6px" }}>
                    {daysLeft != null ? (daysLeft > 0 ? `倒计时 ${daysLeft} 天` : daysLeft === 0 ? "今天比赛" : "已完赛") : targetRace.date}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>
                {targetRace ? targetRace.name : "尚未配置目标赛事"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
                {targetRace
                  ? `${targetRace.distanceKm} km · ${targetRace.city ?? "城市待定"}${targetRace.goalSec ? ` · 目标 ${fmtDur(targetRace.goalSec)}` : ""}`
                  : "前往「赛事中心」上传 GPX 路线并设定目标成绩"}
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
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>今日训练指导</span>
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
                {loadStatus ? loadStatus.advice : "暂无负荷诊断"}
              </div>
            </div>
          </div>

          {/* 快捷跳转操作 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {onGoRace && (
              <button className="btn" onClick={onGoRace} style={{ fontSize: 12, padding: "6px 12px" }}>
                <IconFlag size={13} />
                赛事中心
              </button>
            )}
            {onGoReadiness && (
              <button className="btn" onClick={onGoReadiness} style={{ fontSize: 12, padding: "6px 12px" }}>
                <IconPulse size={13} />
                身体状态
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRoute size={15} />本周跑量</span>
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
              {deltaKm == null ? "仅一周数据" : deltaKm >= 0 ? "较上周持续累积" : "较上周主动减量"}
            </span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconShoe size={15} />本周次数 / 最长单次</span>
            <span className="value num">{last.count}<span className="unit">次 · {last.longestRunKm}km</span></span>
            <span className="hint">周均配速 {fmtPace(last.avgPaceSec)} /km</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconCalendar size={15} />近 {weeks} 周累计</span>
            <span className="value num">{Math.round(totalKm)}<span className="unit">km</span></span>
            <span className="hint">{totalRun} 次训练</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconLoad size={15} />当前负荷比 (ACWR)</span>
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
                  <div title="减量区 (<0.8)" style={{ width: "30%", background: "var(--info)", opacity: 0.85 }} />
                  <div title="安全甜点区 (0.8–1.3)" style={{ width: "35%", background: "var(--good)" }} />
                  <div title="警示区 (1.3–1.5)" style={{ width: "15%", background: "var(--warn)" }} />
                  <div title="高危区 (>1.5)" style={{ width: "20%", background: "var(--bad)" }} />
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
              {latestLoad?.comment ?? "—"}｜短期 {latestLoad?.shortLoad ?? "—"} / 长期 {latestLoad?.longLoad ?? "—"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="seg" style={{ marginBottom: 12 }}>
            {[12, 16, 26].map((w) => (
              <button key={w} className={weeks === w ? "active" : ""} onClick={() => setWeeks(w)}>{w} 周</button>
            ))}
          </div>
          <h3 className="card-title">周跑量</h3>
          <p className="card-sub">柱状为周总公里数，折线为该周平均心率。点柱子看这一周的汇总</p>
          <BarChart
            data={weekly.map((w) => ({
              label: fmtDate(w.weekStart),
              value: w.distanceKm,
              extra: w.avgHr ?? 0,
              tip: [
                [`${w.distanceKm} km`, "距离"],
                [`${w.count} 次`, "次数"],
                [`${w.longestRunKm} km`, "最长单次"],
                [fmtPace(w.avgPaceSec) + " /km", "周均配速"],
                [`${w.avgHr ?? "—"} bpm`, "周均心率"],
              ] as [string, string][],
            }))}
            overlayColor="var(--hr)"
            overlayLabel="平均心率"
            height={200}
            onSelect={(i) => onOpenWeek(weekly[i].weekStart)}
          />
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3 className="card-title" style={{ marginBottom: 2 }}>训练负荷与伤病监控</h3>
              <p className="card-sub" style={{ margin: 0 }}>
                {loadMode === "combo"
                  ? "短期(疲劳) / 长期(体能)与急慢性负荷比，双轴联动"
                  : "Tim Gabbett 理论：ACWR 7日均比值与 0.8–1.3 最佳甜点区"}
              </p>
            </div>
            <div className="seg">
              <button className={loadMode === "combo" ? "active" : ""} onClick={() => setLoadMode("combo")}>
                体能与疲劳
              </button>
              <button className={loadMode === "acwr" ? "active" : ""} onClick={() => setLoadMode("acwr")}>
                ACWR 甜点区
              </button>
            </div>
          </div>

          {loadMode === "combo" ? (
            <LineChart
              labels={recentLoad.map((p) => p.date)}
              series={[
                { key: "short", label: "短期负荷", color: "var(--chart-accent)", values: recentLoad.map((p) => p.shortLoad) },
                { key: "long", label: "长期负荷", color: "var(--chart-muted)", values: recentLoad.map((p) => p.longLoad) },
                { key: "ratio", label: "负荷比 (ACWR)", color: "var(--chart-warn)", values: recentLoad.map((p) => p.ratio), axis: "right" },
              ]}
              height={190}
              yFmt={(n) => String(Math.round(n))}
              yFmtRight={(n) => n.toFixed(2)}
            />
          ) : (
            <LineChart
              labels={recentLoad.map((p) => p.date)}
              series={[{ key: "ratio", label: "负荷比（7日均）", color: "var(--chart-warn)", values: recentLoad.map((p) => p.ratioAvg7 ?? p.ratio) }]}
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
                  Banister 冲量反应模型 · 体能与疲劳消长
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                  短期疲劳 {latestLoad?.shortLoad ?? "—"} ｜ 长期体能 {latestLoad?.longLoad ?? "—"} ｜ 负荷比 {latestLoad?.ratio?.toFixed(2) ?? "—"}
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
                        ? `负荷刺激冲击期（疲劳高于体能 +${Math.round(diff)}）`
                        : diff < -10
                        ? `减量消退期（疲劳低于体能 ${Math.round(diff)}）`
                        : "平稳维持期（疲劳与体能均衡）"}
                    </strong>
                    ：
                    {diff > 10
                      ? "近期训练刺激高于过去四周基准，体能处于积极蓄能期，需注意软组织放松与营养补充以促进超量代偿。"
                      : diff < -10
                      ? "近期训练负荷主动回落，前期疲劳正加速消退，长期体能储备即将释放，适合赛前减量或状态摸底。"
                      : "当前短期刺激与长期储备高度同步，训练负荷稳步推进，没有过量疲劳积压。"}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 4, fontWeight: 500, fontSize: 11.5 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--good)" }} />
                  0.80–1.30 最佳甜点区
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--warn)" }} />
                  1.30–1.50 负荷警示
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--bad)" }} />
                  &gt;1.50 高危区
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--info)" }} />
                  &lt;0.80 减量区
                </span>
              </div>
              {loadStatus && (
                <div style={{ color: "var(--text)", fontSize: 11.5 }}>
                  <strong style={{ color: loadStatus.color }}>当前伤病诊断</strong>：{loadStatus.advice}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 className="card-title" style={{ marginBottom: 2 }}>{view === "session" ? "训练场次" : "训练记录（逐条）"}</h3>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {view === "session"
                ? "同一天的多次记录已合并为一场；脱钩率评估持续稳态跑（保护性门槛：≥4km 且 ≥25min），<5% 证明基础有氧扎实"
                : "这是手表记录的原始条目，一条一次训练"}
            </p>
          </div>
          <div className="seg">
            <button className={view === "session" ? "active" : ""} onClick={() => setView("session")}>
              按场次 {sessions.length}
            </button>
            <button className={view === "record" ? "active" : ""} onClick={() => setView("record")}>
              逐条 {acts.length}
            </button>
          </div>
        </div>

        {view === "session" ? (
          <>
            {multiSessions.length > 0 && (
              <div className="banner info" style={{ marginBottom: 12 }}>
                有 <strong>{multiSessions.length}</strong> 场训练包含多条记录
                {intervalSessions.length > 0 && <>，其中 <strong>{intervalSessions.length}</strong> 场被识别为间歇训练</>}
                。点任意一行进入场次详情，AI 会一次分析整场而不是逐条点评。
              </div>
            )}
            <div className="range-bar">
              <div className="seg">
                {([["2w", "近 2 周"], ["1m", "近 1 月"], ["3m", "近 3 月"], ["all", "全部"]] as const).map(([k, lbl]) => (
                  <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{lbl}</button>
                ))}
              </div>
              <span className="range-info">
                共 <strong>{sessions.length}</strong> 场，当前显示 <strong>{sessionsInRange.length}</strong> 场
                {range !== "all" && <> · {Math.round(rangeKm)} km{multiInRange.length > 0 && ` · ${multiInRange.length} 场多记录`}</>}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>类型</th>
                  <th>记录数</th>
                  <th>总距离</th>
                  <th>总时长</th>
                  <th>均配速</th>
                  <th>均心率</th>
                  <th>负荷</th>
                  <th
                    title="基于 Joe Friel 耐力模型：稳态有氧跑对比前后半程效率因子（EF = 配速 / 心率）。保护性过滤：需满足时长 ≥25min、距离 ≥4km、分圈 ≥4 且非间歇跑。"
                    style={{ cursor: "help" }}
                  >
                    有氧脱钩率 (Pw:Hr) ⓘ
                  </th>
                  <th>组结构</th>
                </tr>
              </thead>
              <tbody>
                {sessionsInRange.length === 0 && (
                  <tr><td colSpan={10}><div className="empty-run"><IconCalendar size={40} /><span>该时间范围内没有训练</span></div></td></tr>
                )}
                {sessionsInRange.map((s) => (
                  <tr key={s.key} className="clickable" onClick={() => onOpenSession(s.key)}>
                    <td>{s.date.slice(5)}</td>
                    <td style={{ textAlign: "left" }}>
                      <span className={`pill ${s.kind === "multi" ? "accent" : ""}`}>{s.classification}</span>
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
                          title={`Joe Friel 有氧脱钩率：后程效率因子变化 ${s.decoupling.pct}%`}
                        >
                          {s.decoupling.label}
                        </span>
                      ) : (
                        <span
                          style={{ color: "var(--text-faint)", fontSize: 12, cursor: "help" }}
                          title={decouplingReason(s)}
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
          </>
        ) : (
        <table>
          <thead>
            <tr>
              <th>日期</th><th>项目</th><th>距离</th><th>用时</th>
              <th>配速</th><th>心率</th><th>步频</th><th>负荷</th><th>重点</th>
            </tr>
          </thead>
          <tbody>
            {actsInRange.map((a) => (
              <tr key={a.labelId} className="clickable" onClick={() => onOpen(a.labelId)}>
                <td>{a.dateLabel.slice(5)}</td>
                <td style={{ textAlign: "left", color: "var(--text-dim)" }}>{a.sportName}</td>
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
        )}
      </div>
    </>
  );
}

function ratioColor(r: number | null | undefined) {
  if (r == null) return "var(--text)";
  if (r >= 1.5) return "var(--bad)";
  if (r >= 1.3) return "var(--warn)";
  if (r < 0.8) return "var(--hr)";
  return "var(--good)";
}

function ratioStatus(r: number | null | undefined) {
  if (r == null) return null;
  if (r >= 1.5) {
    return {
      label: "危险激增 (>1.5)",
      color: "var(--bad)",
      bg: "var(--bad-bg)",
      border: "var(--bad-border)",
      title: "危险激增区（高伤病风险）",
      advice: "短期疲劳显著超过长期体能储备，软组织伤病发生率成倍飙升。强烈建议未来 48 小时以纯休息或 Z1 轻松慢摇排酸为主，严禁冲击高强度课表。",
    };
  }
  if (r >= 1.3) {
    return {
      label: "负荷警示 (1.3–1.5)",
      color: "var(--warn)",
      bg: "var(--warn-bg)",
      border: "var(--warn-border)",
      title: "负荷警示累积区",
      advice: "疲劳累积速度快于体能恢复速度，需密切关注跟腱、足底及小腿肌肉酸痛反馈，避免连续安排两场高强度训练。",
    };
  }
  if (r >= 0.8) {
    return {
      label: "安全甜点区 (0.8–1.3)",
      color: "var(--good)",
      bg: "var(--good-bg)",
      border: "var(--good-border)",
      title: "最佳适宜甜点区（The Sweet Spot）",
      advice: "短期疲劳与长期体能储备维持在极佳的动态平衡中，伤病发生概率极低（<5%），体能正处于高效率稳步累积期。",
    };
  }
  return {
    label: "减量恢复区 (<0.8)",
    color: "var(--hr)",
    bg: "var(--info-bg)",
    border: "var(--info-border)",
    title: "减量恢复/欠训练区",
    advice: "短期负荷较低，身体处于充分休整或疲劳消退期。适合赛前 1~2 周减量恢复巅峰体能，若处于正常训练期则可逐步恢复跑量以维持体能储备。",
  };
}

function decouplingReason(s: Session): string {
  if (s.classification === "间歇训练") {
    return "不适用：间歇训练快慢交替、心率剧烈起伏，不符合稳态跑评估前提";
  }
  if (s.classification === "组合训练" || s.classification === "多次短距离") {
    return "不适用：组合训练可能由多组间歇或力量训练等混合项目构成，配速与心率非持续稳态，脱钩率判定不准确";
  }
  if (s.totals.durationSec < 1500 || s.totals.distanceKm < 4.0) {
    return `保护性过滤：当前单次 ${s.totals.distanceKm}km / ${fmtDur(s.totals.durationSec)}，时长或距离较短，处于前程心率爬坡升温期，不满足稳态门槛（需 ≥4km 且 ≥25min）`;
  }
  return "不适用：分圈样本数不足、心率缺失或山地大爬升（>20m/km）扰动";
}
