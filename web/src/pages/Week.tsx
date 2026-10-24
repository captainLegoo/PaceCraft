import { useEffect, useMemo, useState } from "react";
import { api, type LoadPoint, type Session, type Weekly, type WeekReport } from "../api";
import { BarChart, Markdown, fmtDate, fmtDur, fmtPace, paceColor } from "../charts";
import { IconBack, IconCalendar, IconLoad, IconRoute, IconRun } from "../icons";

/**
 * 周汇总视图。
 *
 * 周跑量柱状图点进来的是「这一周」，不是某一场训练 ——
 * 所以这里展示的是周内聚合（总里程、总时长、场均配速/心率、
 * 每场明细），而不是跳到某一条记录。
 *
 * 周级 AI 分析与场次级的口径是**相反**的，这里刻意保留这个差异：
 * 场次分析不带任何其它日期的数据（避免跨场次结论混进当天复盘），
 * 周级分析则必须带前 6 周趋势（"这周比上周是多是少"正是周汇总要回答的问题）。
 * 另外场次分析会下发全部逐圈数据（一场最多 43 段），
 * 周级绝不能这么发（一周 70～150 段且大部分是热身和普通有氧跑的分圈），
 * 改成只发按主/次课表切好的训练块，且只对主课表块展开内部结构。
 */
export default function Week({
  weekStart, onBack, onOpenSession, onOpenActivity, aiConfigured,
}: {
  weekStart: string;
  onBack: () => void;
  onOpenSession: (key: string) => void;
  onOpenActivity: (labelId: string) => void;
  aiConfigured: boolean;
}) {
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [load, setLoad] = useState<LoadPoint[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [reports, setReports] = useState<WeekReport[]>([]);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.weekly(16), api.load(120), api.sessions()])
      .then(([w, l, s]) => { setWeekly(w); setLoad(l); setSessions(s); })
      .catch((e) => setErr(e.message));
  }, []);

  // 报告随 weekStart 变化重新拉；weekStart 是周一，服务端会再做一次归一化兜底
  useEffect(() => {
    setReports([]);
    api.weekReports(weekStart).then(setReports).catch(() => setReports([]));
  }, [weekStart]);

  const week = useMemo(() => weekly.find((w) => w.weekStart === weekStart) ?? null, [weekly, weekStart]);

  // 周内场次：weekStart 是周一，往后 7 天。sessions.date 就是活动当天日期。
  const weekSessions = useMemo(() => {
    const end = new Date(`${weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    const endLabel = end.toISOString().slice(0, 10);
    return sessions
      .filter((s) => s.date >= weekStart && s.date < endLabel)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions, weekStart]);

  const weekEndLabel = useMemo(() => {
    const end = new Date(`${weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    return end.toISOString().slice(0, 10);
  }, [weekStart]);

  // 当周的训练负荷：取周一那天的 7 日滚动值作为该周口径
  const weekLoad = useMemo(() => {
    const rows = load.filter((l) => l.date >= weekStart && l.date <= weekEndLabel);
    if (rows.length === 0) return null;
    const last = rows[rows.length - 1];
    return {
      shortLoad: last.shortLoad,
      longLoad: last.longLoad,
      ratio: last.ratio,
      comment: last.comment,
      days: rows.length,
    };
  }, [load, weekStart, weekEndLabel]);

  if (err) return <div className="banner error">{err}</div>;
  if (!week) {
    return (
      <>
        <div className="page-head">
          <div><h2>{fmtDate(weekStart)} 起这一周</h2></div>
          <button className="btn" onClick={onBack}><IconBack size={15} />返回</button>
        </div>
        <div className="banner info">这一周没有训练记录。</div>
      </>
    );
  }

  const totals = weekSessions.reduce(
    (a, s) => ({
      distanceKm: a.distanceKm + s.totals.distanceKm,
      durationSec: a.durationSec + s.totals.durationSec,
      calories: a.calories + s.totals.calories,
      trainingLoad: a.trainingLoad + (s.totals.trainingLoad || 0),
      elevGain: a.elevGain + (s.totals.elevGain || 0),
    }),
    { distanceKm: 0, durationSec: 0, calories: 0, trainingLoad: 0, elevGain: 0 },
  );

  // 场次级加权心率（按时长加权，避免短跑的 180 拉高整周均值）
  const weightedHr = (() => {
    let sum = 0, weight = 0;
    for (const s of weekSessions) {
      if (s.totals.avgHr && s.totals.durationSec) {
        sum += s.totals.avgHr * s.totals.durationSec;
        weight += s.totals.durationSec;
      }
    }
    return weight > 0 ? Math.round(sum / weight) : null;
  })();

  const longSessions = weekSessions.filter((s) => s.totals.distanceKm >= 15).length;
  const intervalSessions = weekSessions.filter((s) => s.classification === "间歇训练").length;

  const runAnalyze = async () => {
    const currentFocus = focus.trim() || null;
    setBusy(true); setAiErr(null);
    setFocus("");
    try {
      await api.analyzeWeek(weekStart, currentFocus);
      setReports(await api.weekReports(weekStart));
    } catch (e) {
      setAiErr((e as Error).message);
    } finally { setBusy(false); }
  };

  // 逐场柱状：横轴是日期，柱高是该场距离
  const perSession = weekSessions.map((s) => ({
    label: s.date.slice(5),
    value: s.totals.distanceKm,
    extra: s.totals.avgHr ?? 0,
    tip: [
      [`${s.totals.distanceKm} km`, "距离"],
      [fmtDur(s.totals.durationSec), "时长"],
      [fmtPace(s.totals.durationSec / s.totals.distanceKm) + " /km", "配速"],
      [`${s.totals.avgHr ?? "—"} bpm`, "平均心率"],
      [s.classification, "类型"],
    ] as [string, string][],
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{fmtDate(weekStart)} — {fmtDate(weekEndLabel)} 周汇总</h2>
          <div className="sub">
            周一至周日 · {week.count} 条记录 · {weekSessions.length} 场训练
          </div>
        </div>
        <button className="btn" onClick={onBack}><IconBack size={15} />返回</button>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRoute size={15} />周总跑量</span>
            <span className="value num">{week.distanceKm}<span className="unit">km</span></span>
            <span className="hint">场均配速 {fmtPace(week.avgPaceSec)} /km</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconCalendar size={15} />场次 / 最长单次</span>
            <span className="value num">{weekSessions.length}<span className="unit">场 · {week.longestRunKm}km</span></span>
            <span className="hint">
              {longSessions > 0 ? `${longSessions} 场长距离` : "无长距离"}
              {intervalSessions > 0 && ` · ${intervalSessions} 场间歇`}
            </span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRun size={15} />总时长 / 消耗</span>
            <span className="value num">{fmtDur(totals.durationSec)}</span>
            <span className="hint">{week.calories} kcal · 爬升 {weekSessions.reduce((n, s) => n + (s.totals.elevGain || 0), 0)} m</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconLoad size={15} />周均心率 / 负荷</span>
            <span className="value num">{weightedHr ?? "—"}<span className="unit">bpm</span></span>
            <span className="hint">
              {weekLoad
                ? <>负荷合计 {totals.trainingLoad}｜比 {weekLoad.ratio ?? "—"}（{weekLoad.comment ?? "—"}）</>
                : `负荷合计 ${totals.trainingLoad}`}
            </span>
          </div>
        </div>
      </div>

      {weekSessions.length > 1 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">逐场跑量</h3>
          <p className="card-sub">柱高为该场距离，折线为平均心率。点柱子进入该场次详情</p>
          <BarChart
            data={perSession}
            overlayColor="var(--hr)"
            overlayLabel="平均心率"
            height={200}
            onSelect={(i) => onOpenSession(weekSessions[i].key)}
          />
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">本周每日分布</h3>
        <p className="card-sub">看训练是怎么分布在这一周里的，堆得匀比堆在同一天更重要</p>
        <div className="table-scroll-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日期</th><th>星期</th><th>距离</th><th>时长</th>
                  <th>配速</th><th>心率</th><th>负荷</th><th>类型</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(`${weekStart}T00:00:00Z`);
                  d.setUTCDate(d.getUTCDate() + i);
                  const label = d.toISOString().slice(0, 10);
                  const dow = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i];
                  const daySessions = weekSessions.filter((s) => s.date === label);
                  if (daySessions.length === 0) {
                    return (
                      <tr key={label}>
                        <td>{label.slice(5)}</td>
                        <td style={{ color: "var(--text-faint)" }}>{dow}</td>
                        <td colSpan={6} style={{ color: "var(--text-faint)" }}>休息</td>
                      </tr>
                    );
                  }
                  const km = daySessions.reduce((n, s) => n + s.totals.distanceKm, 0);
                  const sec = daySessions.reduce((n, s) => n + s.totals.durationSec, 0);
                  return (
                    <tr key={label}>
                      <td>{label.slice(5)}</td>
                      <td style={{ color: "var(--text-dim)" }}>{dow}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{km.toFixed(2)}</td>
                      <td className="num">{fmtDur(sec)}</td>
                      <td className="num" style={{ color: paceColor(sec / km, 270, 330) }}>{fmtPace(km ? sec / km : null)}</td>
                      <td className="num">{daySessions[0].totals.avgHr ?? "—"}</td>
                      <td className="num">{daySessions.reduce((n, s) => n + (s.totals.trainingLoad || 0), 0) || "—"}</td>
                      <td style={{ textAlign: "left" }}>
                        <span className={`pill ${daySessions[0].classification === "间歇训练" ? "accent" : ""}`}>
                          {daySessions.map((s) => s.classification).join(" + ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">本周全部场次（{weekSessions.length}）</h3>
        <p className="card-sub">点任意一行进入场次详情，可让 AI 分析那一场</p>
        {weekSessions.length === 0 ? (
          <div className="empty-run"><IconRun size={40} /><span>这一周没有训练</span></div>
        ) : (
          <div className="table-scroll-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日期</th><th>类型</th><th>记录数</th><th>距离</th><th>时长</th>
                    <th>配速</th><th>心率</th><th>负荷</th><th>组结构</th>
                  </tr>
                </thead>
                <tbody>
                  {weekSessions.map((s) => (
                    <tr key={s.key} className="clickable" onClick={() => onOpenSession(s.key)}>
                      <td>{s.date.slice(5)}</td>
                      <td style={{ textAlign: "left" }}>
                        <span className={`pill ${s.kind === "multi" ? "accent" : ""}`}>{s.classification}</span>
                      </td>
                      <td className="num">{s.activityCount}</td>
                      <td className="num">{s.totals.distanceKm}</td>
                      <td className="num">{fmtDur(s.totals.durationSec)}</td>
                      <td className="num" style={{ color: paceColor(s.totals.durationSec / s.totals.distanceKm, 270, 330) }}>
                        {fmtPace(s.totals.distanceKm ? s.totals.durationSec / s.totals.distanceKm : null)}
                      </td>
                      <td className="num">{s.totals.avgHr ?? "—"}</td>
                      <td className="num">{s.totals.trainingLoad || "—"}</td>
                      <td style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12 }}>
                        {s.sets.length > 0 ? s.sets.map((x) => `${x.distanceLabel}×${x.reps}`).join(" + ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3 className="card-title">AI 周度分析</h3>
        <p className="card-sub">
          把这一周按<strong>主课表 / 次课表</strong>切好再送进模型：
          长距离与间歇块标为主课表（并展开组结构与四分位），
          普通有氧与热身标为次课表只给完成度，
          <strong>不会把一周的全部分段数据丢给模型</strong>。
        </p>

        {!aiConfigured && (
          <div className="banner info">还没有配置 AI 模型，请到「设置」页填写模型地址、API Key 和模型名。</div>
        )}
        {aiErr && <div className="banner error">{aiErr}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            placeholder="关注点（可选），例如：这周强度刺激够不够？两个主课表隔了几天？"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && aiConfigured && !busy) runAnalyze(); }}
          />
          <button className="btn primary" disabled={!aiConfigured || busy} onClick={runAnalyze}>
            {busy ? <><span className="spin" /> 分析中…</> : reports.length > 0 ? "重新分析" : "开始分析"}
          </button>
        </div>

        {reports.length === 0 ? (
          <div className="empty">还没有分析记录</div>
        ) : (
          reports.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                <span className="pill accent">{r.model}</span>
                <span className="hint">{new Date(r.createdAt * 1000).toLocaleString("zh-CN")}</span>
                <span className="pill">{r.sessionCount} 场 / {r.blockCount} 个训练块</span>
                {r.focus && <span className="pill">关注：{r.focus}</span>}
              </div>
              <Markdown text={r.report} />
            </div>
          ))
        )}
      </div>
    </>
  );
}
