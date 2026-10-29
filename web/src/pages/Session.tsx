import { useEffect, useState } from "react";
import { api, type Session, type SessionDetail } from "../api";
import { AerobicDecouplingCard, AiDisclaimerNotice, LineChart, Markdown, ZoneBar, fmtDur, fmtPace, formatPace, paceColor } from "../charts";
import { IconBack, IconHeart, IconLoad, IconRoute, IconStopwatch as IconStopwatch2, IconPulse, IconGauge, IconTrend, IconShoe } from "../icons";

export default function SessionView({
  sessionKey, onBack, aiConfigured, onOpenActivity, onSessionKeyChange,
}: {
  sessionKey: string;
  onBack: () => void;
  aiConfigured: boolean;
  onOpenActivity?: (labelId: string, sessionKey?: string) => void;
  onSessionKeyChange?: (newKey: string) => void;
}) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"overview" | "compare">("overview");
  const [compareMetric, setCompareMetric] = useState<"hr" | "pace" | "cadence">("hr");

  const load = () => api.session(sessionKey).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); setErr(null); load(); }, [sessionKey]);

  if (err || (d as any)?.error) {
    return (
      <div style={{ padding: 20 }}>
        <div className="banner error">{err || (d as any)?.error}</div>
        <button className="btn" onClick={onBack} style={{ marginTop: 12 }}>
          <IconBack size={15} />返回
        </button>
      </div>
    );
  }
  if (!d || !d.session) {
    return (
      <div>
        <div className="skeleton skeleton-hero" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    );
  }

  const { session: s, activities = [], laps = [], comparisonLaps = [], comparisonStats, zones, reports } = d;
  const multi = (s?.activityCount ?? 0) > 1;
  const setCount = (s?.sets ?? []).reduce((a, x) => a + x.reps, 0);

  const allActs = Array.from(new Map([...activities, ...(s?.comparisonActivities ?? [])].map((a) => [a.labelId, a])).values());
  const duplicateAct = allActs.find((a) => a.isDuplicate === 1);
  const primaryAct = allActs.find((a) => a.isDuplicate !== 1) || allActs[0];

  const pairedAct = allActs.find((a) => a.duplicateOf);
  const otherAct = pairedAct ? allActs.find((a) => a.labelId === pairedAct.duplicateOf) : null;

  const actA = primaryAct ?? pairedAct;
  const actB = duplicateAct ?? otherAct ?? allActs.find((a) => a.labelId !== actA?.labelId);

  const getBrandName = (act?: typeof actA) => {
    if (!act) return "";
    const brand = act.source === "garmin" ? "佳明" : "高驰";
    if (actA && actB && actA.source === actB.source) {
      return `${brand} (${act.distanceKm}km)`;
    }
    return brand;
  };

  const hasConflict = Boolean(
    (duplicateAct && primaryAct && duplicateAct.labelId !== primaryAct.labelId) ||
    (actA && actB && actA.labelId !== actB.labelId && (actA.duplicateOf === actB.labelId || actB.duplicateOf === actA.labelId || Math.abs((actA.startTs || 0) - (actB.startTs || 0)) <= 600))
  );

  const isKeepBoth = actA?.conflictStatus === "manual_keep_both" || actB?.conflictStatus === "manual_keep_both";

  const brandA = getBrandName(actA);
  const brandB = getBrandName(actB);
  const colorA = actA?.source === "garmin" ? "#10b981" : "#3b82f6";
  const colorB = actB?.source === "garmin" ? "#10b981" : "#f59e0b";

  const handleResolve = async (priId: string, secId: string, action: "set_primary" | "keep_both") => {
    try {
      await api.resolveConflict(priId, secId, action);
      const newKey = `${s.date}_${priId}`;
      onSessionKeyChange?.(newKey);
      await api.session(newKey).then(setD).catch(() => load());
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // 整场连贯曲线：x 用累计时间，含组间休息。换记录处插一个空点，让休息段在曲线上真的断开
  const chartLabels: string[] = [];
  const chartX: number[] = [];
  const paceSeries: (number | null)[] = [];
  const hrSeries: (number | null)[] = [];
  laps.forEach((l, i) => {
    const prev = laps[i - 1];
    if (prev && prev.labelId !== l.labelId) {
      chartLabels.push(`组间休息 ${fmtDur(l.elapsedSec - prev.elapsedSec)}`);
      chartX.push((prev.elapsedSec + l.elapsedSec) / 2);
      paceSeries.push(null);
      hrSeries.push(null);
    }
    chartLabels.push(`${l.labelId.slice(-4)}#${l.lapIndex}`);
    chartX.push(l.elapsedSec);
    paceSeries.push(l.distanceM >= 900 ? l.avgPaceSec : null);
    hrSeries.push(l.avgHr > 0 ? l.avgHr : null);
  });

  // 对比指标数据容错计算
  const compStats = comparisonStats ?? (hasConflict && actA && actB ? {
    primary: {
      labelId: actA.labelId,
      source: actA.source || "coros",
      name: actA.sportName,
      distanceKm: actA.distanceKm ?? 0,
      durationSec: actA.durationSec ?? 0,
      avgPaceSec: actA.avgPaceSec ?? null,
      avgHr: actA.avgHr ?? null,
      maxHr: Math.max(...laps.map((l) => l.maxHr ?? l.avgHr ?? 0).filter(Boolean), actA.avgHr ?? 0) || null,
      avgCadence: actA.detail?.avgCadence ?? null,
      avgStrideM: actA.detail?.avgStrideM ?? null,
      elevGain: actA.detail?.elevGain ?? null,
      trainingLoad: actA.detail?.trainingLoad ?? null,
    },
    secondary: {
      labelId: actB.labelId,
      source: actB.source || "garmin",
      name: actB.sportName,
      distanceKm: actB.distanceKm ?? 0,
      durationSec: actB.durationSec ?? 0,
      avgPaceSec: actB.avgPaceSec ?? null,
      avgHr: actB.avgHr ?? null,
      maxHr: Math.max(...comparisonLaps.map((l) => l.maxHr ?? l.avgHr ?? 0).filter(Boolean), actB.avgHr ?? 0) || null,
      avgCadence: actB.detail?.avgCadence ?? null,
      avgStrideM: actB.detail?.avgStrideM ?? null,
      elevGain: actB.detail?.elevGain ?? null,
      trainingLoad: actB.detail?.trainingLoad ?? null,
    },
    delta: {
      distanceDiffKm: +((actB.distanceKm ?? 0) - (actA.distanceKm ?? 0)).toFixed(3),
      distanceDiffPct: actA.distanceKm ? +((((actB.distanceKm ?? 0) - actA.distanceKm) / actA.distanceKm) * 100).toFixed(2) : 0,
      durationDiffSec: (actB.durationSec ?? 0) - (actA.durationSec ?? 0),
      paceDiffSec: (actA.avgPaceSec != null && actB.avgPaceSec != null) ? actB.avgPaceSec - actA.avgPaceSec : null,
      avgHrDiff: (actA.avgHr != null && actB.avgHr != null) ? actB.avgHr - actA.avgHr : null,
      maxHrDiff: null,
      avgCadenceDiff: (actA.detail?.avgCadence != null && actB.detail?.avgCadence != null) ? actB.detail.avgCadence - actA.detail.avgCadence : null,
      avgStrideDiffM: (actA.detail?.avgStrideM != null && actB.detail?.avgStrideM != null) ? +(actB.detail.avgStrideM - actA.detail.avgStrideM).toFixed(2) : null,
      elevGainDiff: (actA.detail?.elevGain != null && actB.detail?.elevGain != null) ? actB.detail.elevGain - actA.detail.elevGain : null,
      trainingLoadDiff: (actA.detail?.trainingLoad != null && actB.detail?.trainingLoad != null) ? actB.detail.trainingLoad - actA.detail.trainingLoad : null,
    },
  } : null);

  // 对比曲线序列构建
  const maxLapCount = Math.max(laps.length, comparisonLaps.length);
  const compareLapIndexes = Array.from({ length: maxLapCount }, (_, i) => i + 1);
  const compareChartLabels = compareLapIndexes.map((idx) => `第 ${idx} 圈`);

  const compHrA = compareLapIndexes.map((idx) => {
    const l = laps.find((item) => item.lapIndex === idx);
    return l && l.avgHr > 0 ? l.avgHr : null;
  });
  const compHrB = compareLapIndexes.map((idx) => {
    const l = comparisonLaps.find((item) => item.lapIndex === idx);
    return l && l.avgHr > 0 ? l.avgHr : null;
  });

  const compPaceA = compareLapIndexes.map((idx) => {
    const l = laps.find((item) => item.lapIndex === idx);
    return l && l.avgPaceSec && l.avgPaceSec > 0 ? l.avgPaceSec : null;
  });
  const compPaceB = compareLapIndexes.map((idx) => {
    const l = comparisonLaps.find((item) => item.lapIndex === idx);
    return l && l.avgPaceSec && l.avgPaceSec > 0 ? l.avgPaceSec : null;
  });

  const compCadA = compareLapIndexes.map((idx) => {
    const l = laps.find((item) => item.lapIndex === idx);
    return l && l.avgCadence && l.avgCadence > 0 ? l.avgCadence : null;
  });
  const compCadB = compareLapIndexes.map((idx) => {
    const l = comparisonLaps.find((item) => item.lapIndex === idx);
    return l && l.avgCadence && l.avgCadence > 0 ? l.avgCadence : null;
  });

  const runAnalyze = async () => {
    const currentFocus = focus.trim() || null;
    setBusy(true); setAiErr(null);
    setFocus("");
    try {
      await api.analyzeSession(sessionKey, currentFocus);
      await load();
    } catch (e) {
      setAiErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const activityListCard = (
    <div className="card">
      <h3 className="card-title">逐条记录</h3>
      <p className="card-sub">点单条可进入该条独立的分圈明细</p>
      <div className="table-scroll-wrap">
        <div className="table-scroll" style={{ maxHeight: 320, overflow: "auto" }}>
          <table>
            <thead>
              <tr><th>设备 / 来源</th><th>开始</th><th>距离</th><th>用时</th><th>配速</th><th>心率</th><th>步频</th><th>负荷</th></tr>
            </thead>
            <tbody>
              {allActs.map((a) => (
                <tr key={a.labelId} className="clickable" onClick={() => onOpenActivity?.(a.labelId, sessionKey)}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {a.source === "garmin" ? (
                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(16, 185, 129, 0.12)", color: "#10b981", fontWeight: 600 }}>佳明</span>
                      ) : (
                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6", fontWeight: 600 }}>高驰</span>
                      )}
                      {a.isDuplicate === 1 ? (
                        <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(234, 179, 8, 0.15)", color: "#eab308", fontWeight: 600 }}>对比样本</span>
                      ) : (
                        hasConflict && (
                          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(99, 102, 241, 0.12)", color: "#818cf8", fontWeight: 600 }}>主力有效</span>
                        )
                      )}
                    </span>
                  </td>
                  <td>{a.startTs ? new Date(a.startTs * 1000).toTimeString().slice(0, 5) : "—"}</td>
                  <td className="num">{a.distanceKm}</td>
                  <td className="num">{fmtDur(a.durationSec)}</td>
                  <td className="num">{fmtPace(a.avgPaceSec)}</td>
                  <td className="num">{a.avgHr ?? "—"}</td>
                  <td className="num">{a.detail?.avgCadence ?? "—"}</td>
                  <td className="num">{a.detail?.trainingLoad ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{s.date} 训练场次</h2>
            {hasConflict && actA && actB && (
              <div style={{ display: "inline-flex", background: "var(--border)", padding: 2, borderRadius: 8, gap: 2 }}>
                <button
                  className={`btn xs ${viewTab === "overview" ? "primary" : "ghost"}`}
                  onClick={() => setViewTab("overview")}
                  style={{ borderRadius: 6, fontWeight: viewTab === "overview" ? 600 : 400 }}
                >
                  🏃 整场概览
                </button>
                <button
                  className={`btn xs ${viewTab === "compare" ? "primary" : "ghost"}`}
                  onClick={() => setViewTab("compare")}
                  style={{ borderRadius: 6, fontWeight: viewTab === "compare" ? 600 : 400, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <span>⚖️ 双表同屏对比</span>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "#10b981", color: "#fff", fontWeight: 700 }}>HOT</span>
                </button>
              </div>
            )}
          </div>
          <div className="sub" style={{ wordBreak: "break-word", marginTop: 4 }}>
            <span className={`pill ${s.kind === "multi" ? "accent" : ""}`}>
              {s.kind === "multi" ? `${s.activityCount} 条记录合并` : "单次记录"}
            </span>
            {"  "}判定为 <strong style={{ color: "var(--accent)" }}>{s.classification}</strong> · {s.classificationReason}
          </div>
        </div>
        <button className="btn" style={{ flexShrink: 0 }} onClick={onBack} title="返回上一级（快捷键：Esc 或鼠标后退键）"><IconBack size={15} />返回</button>
      </div>

      {viewTab === "compare" && hasConflict && actA && actB ? (
        /* ---------- 双表同屏对比模式（Head-to-Head Compare） ---------- */
        <div>
          {/* 设备身份与操作栏 */}
          <div className="card" style={{ marginBottom: 14, background: "linear-gradient(to right, rgba(59,130,246,0.06), rgba(16,185,129,0.06))", borderColor: "rgba(59,130,246,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, padding: "3px 8px", borderRadius: 6, background: colorA, color: "#fff", fontWeight: 700 }}>{brandA}</span>
                  <span style={{ fontWeight: 600 }}>{actA.sportName || "主力记录"}</span>
                  <span className="pill accent" style={{ fontSize: 11 }}>{isKeepBoth ? "独立有效" : "主力有效"}</span>
                </div>
                <span style={{ color: "var(--text-faint)", fontWeight: 700 }}>VS</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, padding: "3px 8px", borderRadius: 6, background: colorB, color: "#fff", fontWeight: 700 }}>{brandB}</span>
                  <span style={{ fontWeight: 600 }}>{actB.sportName || "副表记录"}</span>
                  <span className="pill" style={{ fontSize: 11, background: "rgba(234, 179, 8, 0.15)", color: "#eab308" }}>{isKeepBoth ? "独立有效" : "对比样本"}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {!isKeepBoth ? (
                  <>
                    <button className="btn sm" onClick={() => handleResolve(actB.labelId, actA.labelId, "set_primary")}>
                      设 {brandB} 为主力
                    </button>
                    <button className="btn sm" onClick={() => handleResolve(actA.labelId, actB.labelId, "keep_both")}>
                      保留两者（独立计入）
                    </button>
                  </>
                ) : (
                  <button className="btn sm" onClick={() => handleResolve(actA.labelId, actB.labelId, "set_primary")}>
                    恢复以 {brandA} 为主力去重
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => setViewTab("overview")}>
                  返回整场概览
                </button>
              </div>
            </div>
          </div>

          {/* 关键核心指标差异网格 */}
          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconRoute size={15} />总距离对比</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{compStats?.primary?.distanceKm ?? actA.distanceKm ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>km</span></span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{compStats?.secondary?.distanceKm ?? actB.distanceKm ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>km</span></span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.distanceDiffKm != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      差异: {compStats.delta.distanceDiffKm > 0 ? `+${compStats.delta.distanceDiffKm}` : compStats.delta.distanceDiffKm} km ({compStats.delta.distanceDiffPct > 0 ? `+${compStats.delta.distanceDiffPct}` : compStats.delta.distanceDiffPct}%)
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconHeart size={15} />平均心率对比</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{compStats?.primary?.avgHr ?? actA.avgHr ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>bpm</span></span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{compStats?.secondary?.avgHr ?? actB.avgHr ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>bpm</span></span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.avgHrDiff != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px", color: Math.abs(compStats.delta.avgHrDiff) > 3 ? "var(--warn)" : undefined }}>
                      差异: {compStats.delta.avgHrDiff > 0 ? `+${compStats.delta.avgHrDiff}` : compStats.delta.avgHrDiff} bpm
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconStopwatch2 size={15} />全场总用时</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{fmtDur(compStats?.primary?.durationSec ?? actA.durationSec ?? 0)}</span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{fmtDur(compStats?.secondary?.durationSec ?? actB.durationSec ?? 0)}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.durationDiffSec != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      差异: {compStats.delta.durationDiffSec > 0 ? `+${compStats.delta.durationDiffSec}s` : `${compStats.delta.durationDiffSec}s`}
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconLoad size={15} />统一负荷 (TRIMP)</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{compStats?.primary?.trainingLoad ?? "—"}</span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{compStats?.secondary?.trainingLoad ?? "—"}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.trainingLoadDiff != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      差异: {compStats.delta.trainingLoadDiff > 0 ? `+${compStats.delta.trainingLoadDiff}` : compStats.delta.trainingLoadDiff}
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconGauge size={15} />平均配速对比</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{fmtPace(compStats?.primary?.avgPaceSec ?? actA.avgPaceSec)}</span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{fmtPace(compStats?.secondary?.avgPaceSec ?? actB.avgPaceSec)}</span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.paceDiffSec != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      {compStats.delta.paceDiffSec === 0 ? "配速持平" : compStats.delta.paceDiffSec > 0 ? `副表慢 ${compStats.delta.paceDiffSec}秒` : `副表快 ${Math.abs(compStats.delta.paceDiffSec)}秒`}
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconPulse size={15} />最高心率对比</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{compStats?.primary?.maxHr ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>bpm</span></span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{compStats?.secondary?.maxHr ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>bpm</span></span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.maxHrDiff != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      差异: {compStats.delta.maxHrDiff > 0 ? `+${compStats.delta.maxHrDiff}` : compStats.delta.maxHrDiff} bpm
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconShoe size={15} />平均步频对比</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{compStats?.primary?.avgCadence ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>spm</span></span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{compStats?.secondary?.avgCadence ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>spm</span></span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.avgCadenceDiff != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      差异: {compStats.delta.avgCadenceDiff > 0 ? `+${compStats.delta.avgCadenceDiff}` : compStats.delta.avgCadenceDiff} spm
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconTrend size={15} />累计爬升对比</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorA }}>{compStats?.primary?.elevGain ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>m</span></span>
                  <span style={{ color: "var(--text-faint)", fontSize: 12 }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: colorB }}>{compStats?.secondary?.elevGain ?? "—"}<span style={{ fontSize: 12, fontWeight: 400 }}>m</span></span>
                </div>
                <div style={{ marginTop: 6 }}>
                  {compStats?.delta?.elevGainDiff != null ? (
                    <span className="pill" style={{ fontSize: 11, padding: "1px 6px" }}>
                      差异: {compStats.delta.elevGainDiff > 0 ? `+${compStats.delta.elevGainDiff}` : compStats.delta.elevGainDiff} m
                    </span>
                  ) : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* 同屏双线重叠图 */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 className="card-title">分圈同屏曲线重叠对比</h3>
                <p className="card-sub">
                  两块手表按各分圈同轴对齐，一眼研判光电心率响应延迟、起伏与配速一致性
                </p>
              </div>
              <div style={{ display: "inline-flex", background: "var(--border)", padding: 2, borderRadius: 6, gap: 2 }}>
                <button
                  className={`btn xs ${compareMetric === "hr" ? "primary" : "ghost"}`}
                  onClick={() => setCompareMetric("hr")}
                  style={{ borderRadius: 4 }}
                >
                  ❤️ 心率重叠
                </button>
                <button
                  className={`btn xs ${compareMetric === "pace" ? "primary" : "ghost"}`}
                  onClick={() => setCompareMetric("pace")}
                  style={{ borderRadius: 4 }}
                >
                  ⚡ 配速重叠
                </button>
                <button
                  className={`btn xs ${compareMetric === "cadence" ? "primary" : "ghost"}`}
                  onClick={() => setCompareMetric("cadence")}
                  style={{ borderRadius: 4 }}
                >
                  👟 步频重叠
                </button>
              </div>
            </div>

            {compareMetric === "hr" && (
              <LineChart
                labels={compareChartLabels}
                series={[
                  { key: "hrA", label: `${brandA} 心率 (bpm)`, color: colorA, values: compHrA },
                  { key: "hrB", label: `${brandB} 心率 (bpm)`, color: colorB, values: compHrB },
                ]}
                yFmt={(n) => `${Math.round(n)} bpm`}
                height={240}
                fill={false}
              />
            )}

            {compareMetric === "pace" && (
              <LineChart
                labels={compareChartLabels}
                series={[
                  { key: "paceA", label: `${brandA} 配速`, color: colorA, values: compPaceA },
                  { key: "paceB", label: `${brandB} 配速`, color: colorB, values: compPaceB },
                ]}
                yFmt={fmtPace}
                yInvert={true}
                height={240}
                fill={false}
              />
            )}

            {compareMetric === "cadence" && (
              <LineChart
                labels={compareChartLabels}
                series={[
                  { key: "cadA", label: `${brandA} 步频 (spm)`, color: colorA, values: compCadA },
                  { key: "cadB", label: `${brandB} 步频 (spm)`, color: colorB, values: compCadB },
                ]}
                yFmt={(n) => `${Math.round(n)} spm`}
                height={240}
                fill={false}
              />
            )}

            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 10, lineHeight: 1.6, padding: "8px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: 6 }}>
              💡 <strong>跑者验表观察指引：</strong>
              <br />• <strong>光电心率稳定性</strong>：如果前 1~2 公里两表心率曲线有较大偏差随后重合，多为冷启动阶段体温或佩戴松紧度差异；若中后程剧烈变速时某表响应滞后 5~15 秒，是由于不同算法滤波平滑窗口长度不同。
              <br />• <strong>GPS 与距离测算</strong>：高楼林立或树荫遮蔽路段可能导致瞬时轨迹抖动，一般全场距离差异在 ±1% 以内均属两家 GPS 滤波芯片正常公差范围。
            </div>
          </div>

          {/* 逐圈横向指标明细对照明细 */}
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">逐圈横向数据对照表</h3>
            <p className="card-sub">逐圈比对单圈用时、配速、心率与步频（括号内显示副表相对于主表的偏差）</p>
            <div className="table-scroll-wrap">
              <div className="table-scroll" style={{ maxHeight: 380, overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>分圈</th>
                      <th>距离 ({brandA} / {brandB})</th>
                      <th>平均配速 ({brandA} vs {brandB})</th>
                      <th>平均心率 ({brandA} vs {brandB})</th>
                      <th>最大心率 ({brandA} vs {brandB})</th>
                      <th>平均步频 ({brandA} vs {brandB})</th>
                      <th>单圈用时 ({brandA} vs {brandB})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareLapIndexes.map((idx) => {
                      const lapA = laps.find((l) => l.lapIndex === idx);
                      const lapB = comparisonLaps.find((l) => l.lapIndex === idx);
                      const hrDiff = (lapA?.avgHr && lapB?.avgHr) ? lapB.avgHr - lapA.avgHr : null;
                      const paceDiff = (lapA?.avgPaceSec && lapB?.avgPaceSec) ? lapB.avgPaceSec - lapA.avgPaceSec : null;
                      const cadDiff = (lapA?.avgCadence && lapB?.avgCadence) ? lapB.avgCadence - lapA.avgCadence : null;
                      const timeDiff = (lapA?.timeSec && lapB?.timeSec) ? Math.round(lapB.timeSec - lapA.timeSec) : null;

                      return (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>第 {idx} 圈</td>
                          <td className="num">
                            {lapA ? (lapA.distanceM / 1000).toFixed(2) : "—"} / {lapB ? (lapB.distanceM / 1000).toFixed(2) : "—"} km
                          </td>
                          <td className="num">
                            <span style={{ color: colorA, fontWeight: 600 }}>{fmtPace(lapA?.avgPaceSec ?? null)}</span>
                            {" vs "}
                            <span style={{ color: colorB, fontWeight: 600 }}>{fmtPace(lapB?.avgPaceSec ?? null)}</span>
                            {paceDiff != null && (
                              <span style={{ fontSize: 11, marginLeft: 6, color: "var(--text-dim)" }}>
                                ({paceDiff > 0 ? `+${paceDiff}s` : `${paceDiff}s`})
                              </span>
                            )}
                          </td>
                          <td className="num">
                            <span style={{ color: colorA, fontWeight: 600 }}>{lapA?.avgHr ?? "—"}</span>
                            {" vs "}
                            <span style={{ color: colorB, fontWeight: 600 }}>{lapB?.avgHr ?? "—"}</span>
                            {hrDiff != null && (
                              <span style={{ fontSize: 11, marginLeft: 6, color: hrDiff === 0 ? "var(--text-dim)" : Math.abs(hrDiff) > 3 ? "var(--warn)" : "var(--text-dim)", fontWeight: 600 }}>
                                ({hrDiff > 0 ? `+${hrDiff}` : hrDiff} bpm)
                              </span>
                            )}
                          </td>
                          <td className="num">
                            <span>{lapA?.maxHr ?? "—"}</span> vs <span>{lapB?.maxHr ?? "—"}</span>
                          </td>
                          <td className="num">
                            <span>{lapA?.avgCadence ?? "—"}</span> vs <span>{lapB?.avgCadence ?? "—"}</span>
                            {cadDiff != null && (
                              <span style={{ fontSize: 11, marginLeft: 6, color: "var(--text-dim)" }}>
                                ({cadDiff > 0 ? `+${cadDiff}` : cadDiff})
                              </span>
                            )}
                          </td>
                          <td className="num">
                            <span>{fmtDur(lapA?.timeSec ?? 0)}</span> vs <span>{fmtDur(lapB?.timeSec ?? 0)}</span>
                            {timeDiff != null && timeDiff !== 0 && (
                              <span style={{ fontSize: 11, marginLeft: 6, color: "var(--text-dim)" }}>
                                ({timeDiff > 0 ? `+${timeDiff}s` : `${timeDiff}s`})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ---------- 整场概览模式（默认视图） ---------- */
        <div>
          {multi && (
            <div className="banner info">
              这场训练被手表记录成 <strong>{s.activityCount} 条</strong>，已合并为一次整体分析。
              同一天里间隔超过 4 小时的记录会被判定为<strong>另一场</strong>独立训练，所以早晚各跑一次不会被混在一起。
            </div>
          )}

          {hasConflict && actA && actB && (
            <div className="banner info" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
              <div style={{ minWidth: 240, flex: "1 1 260px" }}>
                <div style={{ fontWeight: 600 }}>⌚ 智能识别：检测到同一场训练的双表记录</div>
                {isKeepBoth ? (
                  <div style={{ fontSize: 12, marginTop: 3, color: "var(--text-dim)" }}>
                    当前设定为：<strong>保留两只手表独立计算跑量</strong>（{brandA} {actA.distanceKm} km · {brandB} {actB.distanceKm} km）。
                  </div>
                ) : (
                  <div style={{ fontSize: 12, marginTop: 3, color: "var(--text-dim)" }}>
                    已选定<strong>{brandA}（{actA.distanceKm} km）</strong>作为主力有效成绩计入周跑量与训练负荷；
                    <strong>{brandB}（{actB.distanceKm} km）</strong>归档为对比样本，不重复累加。
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="btn sm primary"
                  onClick={() => setViewTab("compare")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  ⚖️ 查看双表同屏对比
                </button>
                {!isKeepBoth ? (
                  <>
                    <button
                      className="btn sm"
                      onClick={() => handleResolve(actB.labelId, actA.labelId, "set_primary")}
                    >
                      设 {brandB} 为主力
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => handleResolve(actA.labelId, actB.labelId, "keep_both")}
                    >
                      保留两者（独立训练）
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn sm"
                      onClick={() => handleResolve(actA.labelId, actB.labelId, "set_primary")}
                    >
                      设 {brandA} 为主力
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => handleResolve(actB.labelId, actA.labelId, "set_primary")}
                    >
                      设 {brandB} 为主力
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconRoute size={15} />全场总距离</span>
                <span className="value num" style={{ color: "var(--accent)" }}>{s.totals.distanceKm}<span className="unit">km</span></span>
                <span className="hint">{s.activityCount} 条记录合计</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconStopwatch2 size={15} />全场总时长</span>
                <span className="value num">{fmtDur(s.totals.durationSec)}</span>
                <span className="hint">
                  {multi
                    ? `含记录间休息 ${fmtDur(s.maxGapSec)}`
                    : `均配 ${fmtPace(s.totals.distanceKm ? s.totals.durationSec / s.totals.distanceKm : null)}/km`}
                </span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconHeart size={15} />平均心率</span>
                <span className="value num">{s.totals.avgHr ?? "—"}<span className="unit">bpm</span></span>
                <span className="hint">按时长加权</span>
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat">
                <span className="label"><IconLoad size={15} />训练负荷合计</span>
                <span className="value num">{s.totals.trainingLoad || "—"}</span>
                <span className="hint">爬升 {s.totals.elevGain} m · {s.totals.calories} kcal</span>
              </div>
            </div>
          </div>

          {s.sets.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 className="card-title">组结构识别</h3>
              <p className="card-sub">
                从 {s.activityCount} 条记录中按距离与配速的一致性自动识别出 {s.sets.length} 组重复（共 {setCount} 组次）。
                这只是基于数据模式的推断，最终以你的实际安排为准。
              </p>
              <div className="table-scroll-wrap">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>组</th><th>单组距离</th><th>组数</th><th>平均单组用时</th>
                        <th>平均配速</th><th>平均心率</th><th>组间休息</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.sets.map((set, i) => (
                        <tr key={i}>
                          <td>第 {i + 1} 组</td>
                          <td className="num" style={{ textAlign: "left", color: "var(--accent)" }}>{set.distanceLabel}</td>
                          <td className="num">× {set.reps}</td>
                          <td className="num">{fmtDur(set.avgDurationSec)}</td>
                          <td className="num">{fmtPace(set.avgPaceSec)}</td>
                          <td className="num">{set.avgHr ?? "—"}</td>
                          <td className="num" style={{ color: "var(--text-faint)" }}>
                            {set.restSec != null ? fmtDur(set.restSec) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {laps.length > 2 && (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <h3 className="card-title">整场连贯曲线</h3>
                <p className="card-sub">
                  这张图回答的问题是：<strong>整场跑下来，状态是怎么变化的？</strong>
                  手表常把间歇、放松、拉伸拆成多条记录，单看每条只看到片段；这里把它们并到同一条
                  <strong>累计时间轴</strong>（含组间休息）上，配速起伏、心率漂移、组与组之间歇了多久，一眼可见。
                  短于 900m 的分段不参与配速线，所以配速线常比心率线短。
                </p>
                <LineChart
                  labels={chartLabels}
                  xValues={chartX}
                  xFmt={fmtDur}
                  series={[
                    { key: "pace", label: "配速（左轴）", color: "var(--chart-accent)", values: paceSeries },
                    { key: "hr", label: "平均心率（右轴）", color: "var(--chart-hr)", axis: "right", values: hrSeries },
                  ]}
                  yFmt={fmtPace}
                  yFmtRight={(n) => String(Math.round(n))}
                  yInvert
                  height={230}
                  fill={false}
                />
              </div>

              <AerobicDecouplingCard
                laps={laps}
                options={{
                  distanceKm: s.totals.distanceKm,
                  durationSec: s.totals.durationSec,
                  isInterval: s.classification === "间歇训练" || s.sets.length > 0,
                  isCombo:
                    s.classification === "组合训练" ||
                    s.classification === "多次短距离" ||
                    activities.some((a) => a.sportType != null && ![100, 102, 103, 104].includes(a.sportType)),
                }}
              />

              <div className="grid g2" style={{ marginBottom: 14 }}>
                <div className="card">
                  <h3 className="card-title">心率区间分布</h3>
                  <p className="card-sub">把整场所有分段合并后计算</p>
                  <div style={{ marginTop: 16 }}>
                    <ZoneBar
                      zones={zones.zones.map((z) => ({ ...z, color: z.zone.toLowerCase() }))}
                      basis={zones}
                    />
                  </div>
                </div>

                {activityListCard}
              </div>
            </>
          )}

          {laps.length <= 2 && (
            <div style={{ marginBottom: 14 }}>
              {activityListCard}
            </div>
          )}

          {laps.length > 2 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 className="card-title">全场分段明细</h3>
              <p className="card-sub">按累计时间排序，休息段不会出现数据点</p>
              <div className="table-scroll-wrap">
                <div className="table-scroll" style={{ maxHeight: 380, overflow: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>累计时间</th><th>段</th><th>距离</th><th>配速</th>
                        <th>心率</th><th>最大</th><th>步频</th><th>步幅</th>
                        <th>爬升</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laps.map((l) => (
                        <tr key={`${l.labelId}-${l.lapIndex}`}>
                          <td className="num" style={{ color: "var(--text-faint)" }}>{fmtDur(l.elapsedSec)}</td>
                          <td>{l.lapIndex}</td>
                          <td className="num">{(l.distanceM / 1000).toFixed(2)}</td>
                          <td className="num" style={{ color: paceColor(l.avgPaceSec, 270, 330) }}>{fmtPace(l.avgPaceSec)}</td>
                          <td className="num">{l.avgHr || "—"}</td>
                          <td className="num" style={{ color: "var(--text-faint)" }}>{l.maxHr || "—"}</td>
                          <td className="num">{l.avgCadence || "—"}</td>
                          <td className="num">{l.avgStrideM ? l.avgStrideM.toFixed(2) : "—"}</td>
                          <td className="num">{l.elevGain != null ? Math.round(l.elevGain) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <h3 className="card-title">AI 场次分析</h3>
            <p className="card-sub">
              把这 {s.activityCount} 条记录作为<strong>一整场</strong>送进模型，而不是逐条点评。
              {multi && " 间歇训练会被当成一组整体结构来解读。"}
            </p>

            {!aiConfigured && (
              <div className="banner info">还没有配置 AI 模型，请到「设置」页填写模型地址、API Key 和模型名。</div>
            )}
            {aiErr && <div className="banner error">{aiErr}</div>}

            <div style={{ display: "flex", gap: 8, marginBottom: 14, minWidth: 0, width: "100%" }}>
              <input
                style={{ flex: 1, minWidth: 0 }}
                placeholder={multi ? "关注点（可选），例如：400m 组掉速，是不是组间休息不够？" : "关注点（可选），例如：这次长距离后程掉速，是不是强度太高了？"}
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && aiConfigured && !busy) runAnalyze(); }}
              />
              <button className="btn primary" style={{ flexShrink: 0, whiteSpace: "nowrap" }} disabled={!aiConfigured || busy} onClick={runAnalyze}>
                {busy ? <><span className="spin" /> 分析中…</> : reports.length > 0 ? "重新分析" : "开始分析"}
              </button>
            </div>

            {reports.length === 0 ? (
              <div className="empty">还没有分析记录</div>
            ) : (
              reports.map((r) => (
                <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 14 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap", minWidth: 0, maxWidth: "100%" }}>
                    <span className="pill accent">{r.model}</span>
                    <span className="hint">{new Date(r.createdAt * 1000).toLocaleString("zh-CN")}</span>
                    <span className="pill">{r.activityCount} 条记录</span>
                    {r.focus && <span className="pill pill-focus">关注：{r.focus}</span>}
                  </div>
                  <Markdown text={r.report} />
                  <AiDisclaimerNotice />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
