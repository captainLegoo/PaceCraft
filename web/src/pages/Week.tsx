import { useEffect, useMemo, useState } from "react";
import { api, type LoadPoint, type Session, type Weekly, type WeekReport } from "../api";
import { AiDisclaimerNotice, BarChart, Markdown, fmtDate, fmtDur, fmtPace, paceColor } from "../charts";
import { IconBack, IconCalendar, IconLoad, IconRoute, IconRun } from "../icons";
import { useI18n } from "../i18n";

/**
 * 周汇总视图。
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
  const { t, isZh } = useI18n();
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
          <div><h2>{isZh ? `${fmtDate(weekStart)} 起这一周` : `Week of ${fmtDate(weekStart)}`}</h2></div>
          <button className="btn" onClick={onBack} title={isZh ? "返回上一级（快捷键：Esc 或鼠标后退键）" : "Back (Esc or Back button)"}><IconBack size={15} />{t("common.back")}</button>
        </div>
        <div className="banner info">{isZh ? "这一周没有训练记录。" : "No workout records found for this week."}</div>
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
      [`${s.totals.distanceKm} km`, isZh ? "距离" : "Distance"],
      [fmtDur(s.totals.durationSec), isZh ? "时长" : "Duration"],
      [fmtPace(s.totals.durationSec / s.totals.distanceKm) + " /km", isZh ? "配速" : "Pace"],
      [`${s.totals.avgHr ?? "—"} bpm`, isZh ? "平均心率" : "Avg HR"],
      [s.classification, isZh ? "类型" : "Type"],
    ] as [string, string][],
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{fmtDate(weekStart)} — {fmtDate(weekEndLabel)} {isZh ? "周汇总" : "Weekly Summary"}</h2>
          <div className="sub">
            {isZh
              ? `周一至周日 · ${week.count} 条记录 · ${weekSessions.length} 场训练`
              : `Mon - Sun · ${week.count} activities · ${weekSessions.length} sessions`}
          </div>
        </div>
        <button className="btn" onClick={onBack} title={isZh ? "返回上一级（快捷键：Esc 或鼠标后退键）" : "Back (Esc or Back button)"}><IconBack size={15} />{t("common.back")}</button>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRoute size={15} />{isZh ? "周总跑量" : "Weekly Mileage"}</span>
            <span className="value num">{week.distanceKm}<span className="unit">km</span></span>
            <span className="hint">{isZh ? `场均配速 ${fmtPace(week.avgPaceSec)} /km` : `Avg Pace ${fmtPace(week.avgPaceSec)} /km`}</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconCalendar size={15} />{isZh ? "场次 / 最长单次" : "Sessions / Longest"}</span>
            <span className="value num">{weekSessions.length}<span className="unit">{isZh ? `场 · ${week.longestRunKm}km` : ` sessions · ${week.longestRunKm}km`}</span></span>
            <span className="hint">
              {longSessions > 0 ? (isZh ? `${longSessions} 场长距离` : `${longSessions} long runs`) : (isZh ? "无长距离" : "No long run")}
              {intervalSessions > 0 && (isZh ? ` · ${intervalSessions} 场间歇` : ` · ${intervalSessions} intervals`)}
            </span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRun size={15} />{isZh ? "总时长 / 消耗" : "Duration / Burn"}</span>
            <span className="value num">{fmtDur(totals.durationSec)}</span>
            <span className="hint">{week.calories} kcal {isZh ? `· 爬升 ${weekSessions.reduce((n, s) => n + (s.totals.elevGain || 0), 0)} m` : `· Gain ${weekSessions.reduce((n, s) => n + (s.totals.elevGain || 0), 0)} m`}</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconLoad size={15} />{isZh ? "周均心率 / 负荷" : "Avg HR / Load"}</span>
            <span className="value num">{weightedHr ?? "—"}<span className="unit">bpm</span></span>
            <span className="hint">
              {weekLoad
                ? (isZh ? <>负荷合计 {totals.trainingLoad}｜比 {weekLoad.ratio ?? "—"}（{weekLoad.comment ?? "—"}）</> : <>Load {totals.trainingLoad} | ACWR {weekLoad.ratio ?? "—"} ({weekLoad.comment ?? "—"})</>)
                : (isZh ? `负荷合计 ${totals.trainingLoad}` : `Load Total ${totals.trainingLoad}`)}
            </span>
          </div>
        </div>
      </div>

      {weekSessions.length > 1 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">{isZh ? "逐场跑量" : "Mileage per Session"}</h3>
          <p className="card-sub">{isZh ? "柱高为该场距离，折线为平均心率。点柱子进入该场次详情" : "Bar height indicates distance; line shows average HR. Click a bar for session details."}</p>
          <BarChart
            data={perSession}
            overlayColor="var(--hr)"
            overlayLabel={isZh ? "平均心率" : "Avg HR"}
            height={200}
            onSelect={(i) => onOpenSession(weekSessions[i].key)}
          />
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">{isZh ? "本周每日分布" : "Weekly Schedule Distribution"}</h3>
        <p className="card-sub">{isZh ? "看训练是怎么分布在这一周里的，堆得匀比堆在同一天更重要" : "Observe workout distribution across the week — steady consistency outperforms clustering."}</p>
        <div className="table-scroll-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{isZh ? "日期" : "Date"}</th>
                  <th>{isZh ? "星期" : "Day"}</th>
                  <th>{isZh ? "距离" : "Dist (km)"}</th>
                  <th>{isZh ? "时长" : "Duration"}</th>
                  <th>{isZh ? "配速" : "Pace"}</th>
                  <th>{isZh ? "心率" : "HR"}</th>
                  <th>{isZh ? "负荷" : "Load"}</th>
                  <th>{isZh ? "类型" : "Type"}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(`${weekStart}T00:00:00Z`);
                  d.setUTCDate(d.getUTCDate() + i);
                  const label = d.toISOString().slice(0, 10);
                  const dow = isZh 
                    ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][i]
                    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i];
                  const daySessions = weekSessions.filter((s) => s.date === label);
                  if (daySessions.length === 0) {
                    return (
                      <tr key={label}>
                        <td>{label.slice(5)}</td>
                        <td style={{ color: "var(--text-faint)" }}>{dow}</td>
                        <td colSpan={6} style={{ color: "var(--text-faint)" }}>{isZh ? "休息" : "Rest"}</td>
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
        <h3 className="card-title">{isZh ? `本周全部场次（${weekSessions.length}）` : `All Sessions This Week (${weekSessions.length})`}</h3>
        <p className="card-sub">{isZh ? "点任意一行进入场次详情，可让 AI 分析那一场" : "Click any row for session details and AI coach deep-dive analysis."}</p>
        {weekSessions.length === 0 ? (
          <div className="empty-run"><IconRun size={40} /><span>{isZh ? "这一周没有训练" : "No workouts this week"}</span></div>
        ) : (
          <div className="table-scroll-wrap">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{isZh ? "日期" : "Date"}</th>
                    <th>{isZh ? "类型" : "Type"}</th>
                    <th>{isZh ? "记录数" : "Records"}</th>
                    <th>{isZh ? "距离" : "Dist (km)"}</th>
                    <th>{isZh ? "时长" : "Duration"}</th>
                    <th>{isZh ? "配速" : "Pace"}</th>
                    <th>{isZh ? "心率" : "HR"}</th>
                    <th>{isZh ? "负荷" : "Load"}</th>
                    <th>{isZh ? "组结构" : "Sets"}</th>
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
        <h3 className="card-title">{isZh ? "AI 周度分析" : "AI Weekly Review"}</h3>
        <p className="card-sub">
          {isZh
            ? "把这一周按主课表 / 次课表切好再送进模型：长距离与间歇块标为主课表（并展开组结构与四分位），普通有氧与热身标为次课表只给完成度，不会把一周的全部分段数据丢给模型。"
            : "Structures the week into Key and Supporting workouts: Long runs and intervals are treated as Key workouts with detailed sets analysis, while easy runs provide volume completion context."}
        </p>

        {!aiConfigured && (
          <div className="banner info">{isZh ? "还没有配置 AI 模型，请到「设置」页填写模型地址、API Key 和模型名。" : "AI model not configured. Please configure your API key in Settings."}</div>
        )}
        {aiErr && <div className="banner error">{aiErr}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14, minWidth: 0, width: "100%" }}>
          <input
            style={{ flex: 1, minWidth: 0 }}
            placeholder={isZh ? "关注点（可选），例如：这周强度刺激够不够？两个主课表隔了几天？" : "Focus area (optional), e.g., Was the stimulus sufficient? Recovery between key workouts?"}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && aiConfigured && !busy) runAnalyze(); }}
          />
          <button className="btn primary" style={{ flexShrink: 0, whiteSpace: "nowrap" }} disabled={!aiConfigured || busy} onClick={runAnalyze}>
            {busy ? <><span className="spin" /> {isZh ? "分析中…" : "Analyzing…"}</> : reports.length > 0 ? (isZh ? "重新分析" : "Re-analyze") : (isZh ? "开始分析" : "Analyze")}
          </button>
        </div>

        {reports.length === 0 ? (
          <div className="empty">{isZh ? "还没有分析记录" : "No analysis history yet"}</div>
        ) : (
          reports.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
                <span className="pill accent">{r.model}</span>
                <span className="hint">{new Date(r.createdAt * 1000).toLocaleString(isZh ? "zh-CN" : "en-US")}</span>
                <span className="pill">{isZh ? `${r.sessionCount} 场 / ${r.blockCount} 个训练块` : `${r.sessionCount} sessions / ${r.blockCount} blocks`}</span>
                {r.focus && <span className="pill pill-focus">{isZh ? `关注：${r.focus}` : `Focus: ${r.focus}`}</span>}
              </div>
              <Markdown text={r.report} />
              <AiDisclaimerNotice />
            </div>
          ))
        )}
      </div>
    </>
  );
}
