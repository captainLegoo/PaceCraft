import { useEffect, useState } from "react";
import { api, type Activity, type LoadPoint, type Session, type Weekly } from "../api";
import { BarChart, LineChart, fmtDate, fmtDur, fmtPace } from "../charts";
import { IconCalendar, IconLoad, IconRoute, IconRun, IconShoe } from "../icons";

export default function Training({ onOpen, onOpenSession, onOpenWeek }: { onOpen: (labelId: string) => void; onOpenSession: (key: string) => void; onOpenWeek: (weekStart: string) => void }) {
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [load, setLoad] = useState<LoadPoint[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(16);
  const [view, setView] = useState<"session" | "record">("session");
  // 默认只看最近两周：116 场全渲染既慢又没人会从上往下翻
  const [range, setRange] = useState<"2w" | "1m" | "3m" | "all">("2w");
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    Promise.all([api.weekly(weeks), api.load(90), api.activities({ limit: "200" }), api.sessions()])
      .then(([w, l, a, s]) => { setWeekly(w); setLoad(l); setActs(a); setSessions(s); })
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

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRoute size={15} />本周跑量</span>
            <span className="value num">{last.distanceKm}<span className="unit">km</span></span>
            <span className="hint">
              {deltaKm == null ? "仅一周数据" : deltaKm >= 0 ? `较上周 +${deltaKm.toFixed(1)} km` : `较上周 ${deltaKm.toFixed(1)} km`}
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
            <span className="label"><IconLoad size={15} />当前负荷比</span>
            <span className="value num" style={{ color: ratioColor(latestLoad?.ratio) }}>
              {latestLoad?.ratio ?? "—"}
            </span>
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
            // 点柱子进的是「这一周」的汇总，不是其中某一条记录
            onSelect={(i) => onOpenWeek(weekly[i].weekStart)}
          />
        </div>

        <div className="card">
          <h3 className="card-title">训练负荷（近 6 周）</h3>
          <p className="card-sub">短期 / 长期负荷与负荷比，负荷比 0.8–1.3 通常视为合理区间</p>
          <LineChart
            labels={recentLoad.map((p) => p.date)}
            series={[
              { key: "short", label: "短期负荷", color: "var(--chart-accent)", values: recentLoad.map((p) => p.shortLoad) },
              { key: "long", label: "长期负荷", color: "var(--chart-muted)", values: recentLoad.map((p) => p.longLoad) },
            ]}
            height={230}
            yFmt={(n) => String(Math.round(n))}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">负荷比趋势</h3>
        <p className="card-sub">负荷比 = 短期负荷 / 长期负荷。连续高于 1.3 有累积疲劳风险，长期低于 0.8 刺激不足</p>
        <LineChart
          labels={recentLoad.map((p) => p.date)}
          series={[{ key: "ratio", label: "负荷比（7日均）", color: "var(--chart-warn)", values: recentLoad.map((p) => p.ratioAvg7 ?? p.ratio) }]}
          bands={[{ from: 0.8, to: 1.3, color: "var(--chart-good)" }]}
          height={150}
          yMin={0.4}
          yMax={1.6}
          yFmt={(n) => n.toFixed(1)}
        />
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 className="card-title" style={{ marginBottom: 2 }}>{view === "session" ? "训练场次" : "训练记录（逐条）"}</h3>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {view === "session"
                ? "同一天的多次记录已合并为一场，AI 会按整场结构分析"
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
                  <th>日期</th><th>类型</th><th>记录数</th><th>总距离</th><th>总时长</th>
                  <th>均配速</th><th>均心率</th><th>负荷</th><th>组结构</th>
                </tr>
              </thead>
              <tbody>
                {sessionsInRange.length === 0 && (
                  <tr><td colSpan={9}><div className="empty-run"><IconCalendar size={40} /><span>该时间范围内没有训练</span></div></td></tr>
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
            {acts.map((a) => (
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

function ratioColor(r: number | null) {
  if (r == null) return "var(--text)";
  if (r > 1.3) return "var(--bad)";
  if (r > 1.15) return "var(--warn)";
  if (r < 0.8) return "var(--hr)";
  return "var(--good)";
}
