import { useEffect, useState } from "react";
import { api, type ActivityDetail } from "../api";
import { AerobicDecouplingCard, LineChart, ZoneBar, couplingVerdict, fmtDur, fmtPace, hrResiduals, paceColor, paceHrCoupling, paceHrResidual } from "../charts";
import { IconBack, IconGauge, IconHeart, IconLoad, IconMountain, IconPulse, IconRoute, IconSteps, IconStopwatch } from "../icons";
import { useI18n } from "../i18n";

export default function ActivityDetailView({
  labelId, onBack, onOpenSession,
}: {
  labelId: string;
  onBack: () => void;
  onOpenSession?: (sessionKey: string) => void;
  aiConfigured?: boolean;
}) {
  const { t, isZh } = useI18n();
  const [data, setData] = useState<ActivityDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.activity(labelId).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setErr(null); load(); }, [labelId]);

  if (err) return <div className="banner error">{err}</div>;
  if (!data) return <div><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>;

  const { activity: a, detail: d, laps, scatter, zones, lapSummary } = data;
  const fullLaps = laps.length > 1 ? laps.slice(0, -1) : laps;
  const fastest = lapSummary.fastestLapSec ?? 0;
  const slowest = lapSummary.slowestLapSec ?? fastest;

  // 配速-心率耦合：拟合出「这个配速该有的心率」，再看每段实际偏高还是偏低
  const coupling = paceHrCoupling(fullLaps.map((l) => ({ paceSec: l.avgPaceSec, hr: l.avgHr })));
  const verdict = coupling ? couplingVerdict(coupling.r) : null;
  const residualRows = coupling
    ? hrResiduals(fullLaps.map((l) => ({ paceSec: l.avgPaceSec, hr: l.avgHr })), coupling).map((residual, i) => {
        const l = fullLaps[i];
        const statusText = residual > 3 
          ? (isZh ? "偏高 · 吃力硬撑" : "High · Straining") 
          : residual < -3 
          ? (isZh ? "偏低 · 充沛轻松" : "Low · Economical") 
          : (isZh ? "正常基准" : "Baseline");
        return {
          label: isZh ? `第 ${l.lapIndex} 段` : `Lap ${l.lapIndex}`,
          residual,
          tip: [
            [`${residual > 0 ? "+" : ""}${residual.toFixed(1)} bpm（${statusText}）`, isZh ? "相对基准心率偏差" : "Deviation from Baseline HR"],
            [fmtPace(l.avgPaceSec) + " /km", isZh ? "配速" : "Pace"],
            [`${l.avgHr ?? "—"} bpm`, isZh ? "实际平均心率" : "Actual Avg HR"],
            [`${l.maxHr ?? "—"} bpm`, isZh ? "最大心率" : "Max HR"],
            [`${l.avgCadence ?? "—"} spm`, isZh ? "步频" : "Cadence"],
            [l.avgStrideM ? `${l.avgStrideM.toFixed(2)} m` : "—", isZh ? "步幅" : "Stride"],
          ] as [string, string][],
        };
      })
    : [];

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            {a.source === "garmin" ? (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontWeight: 700 }}>{isZh ? "佳明 GARMIN" : "Garmin"}</span>
            ) : (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", fontWeight: 700 }}>{isZh ? "高驰 COROS" : "COROS"}</span>
            )}
            {a.isDuplicate === 1 ? (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(234, 179, 8, 0.18)", color: "#eab308", fontWeight: 700 }}>{isZh ? "对比样本（已归档）" : "Archived Duplicate"}</span>
            ) : (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(99, 102, 241, 0.12)", color: "#818cf8", fontWeight: 700 }}>{isZh ? "主力有效记录" : "Primary Record"}</span>
            )}
            <h2 style={{ margin: 0 }}>{a.dateLabel} · {a.sportName}</h2>
          </div>
          <div className="sub">
            {a.location ?? "—"}
            {d?.trainingFocus ? (isZh ? ` ｜ 判定训练重点：${d.trainingFocus}` : ` | Focus: ${d.trainingFocus}`) : ""}
            {d?.performance ? (isZh ? ` ｜ 表现：${d.performance}` : ` | Performance: ${d.performance}`) : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {data.sessionKey && onOpenSession && (
            <button className="btn" onClick={() => onOpenSession(data.sessionKey!)}>{isZh ? "所属训练场次" : "Parent Session"}</button>
          )}
          <button className="btn" onClick={onBack} title={isZh ? "返回上一级（快捷键：Esc 或鼠标后退键）" : "Back (Esc or Back button)"}><IconBack size={15} />{t("common.back")}</button>
        </div>
      </div>

      {data.comparisonActivity && (
        <div className="card" style={{ marginBottom: 14, background: "rgba(99, 102, 241, 0.05)", border: "1px solid rgba(99, 102, 241, 0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{isZh ? "⌚ 双表同场记录对比" : "⌚ Dual-Watch Parallel Recording Comparison"}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                {isZh
                  ? `检测到该训练由【${a.source === "garmin" ? "佳明" : "高驰"}】与【${data.comparisonActivity.activity.source === "garmin" ? "佳明" : "高驰"}】双表同时记录。`
                  : `Recorded concurrently by both watches: ${a.source === "garmin" ? "Garmin" : "COROS"} and ${data.comparisonActivity.activity.source === "garmin" ? "Garmin" : "COROS"}.`}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div>{isZh ? "当前表" : "Active"}（{a.source === "garmin" ? (isZh ? "佳明" : "Garmin") : (isZh ? "高驰" : "COROS")}）：<strong>{a.distanceKm} km</strong> · {fmtPace(a.avgPaceSec)} · {a.avgHr ?? "—"} bpm</div>
              <div style={{ color: "var(--text-dim)" }}>{isZh ? "对照表" : "Reference"}（{data.comparisonActivity.activity.source === "garmin" ? (isZh ? "佳明" : "Garmin") : (isZh ? "高驰" : "COROS")}）：<strong>{data.comparisonActivity.activity.distanceKm} km</strong> · {fmtPace(data.comparisonActivity.activity.avgPaceSec)} · {data.comparisonActivity.activity.avgHr ?? "—"} bpm</div>
            </div>
          </div>
        </div>
      )}

      {lapSummary.count > 0 && lapSummary.distanceMatches === false && (
        <div className="banner warn">
          {isZh
            ? `分圈合计 ${lapSummary.totalDistanceM / 1000} km 与记录距离 ${a.distanceKm} km 不一致，请留意。`
            : `Lap distance sum (${lapSummary.totalDistanceM / 1000} km) does not match total distance (${a.distanceKm} km).`}
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat icon={IconRoute} label={isZh ? "距离" : "Distance"} value={a.distanceKm} unit="km" />
        <Stat icon={IconStopwatch} label={isZh ? "用时" : "Duration"} value={fmtDur(a.durationSec)} />
        <Stat icon={IconGauge} label={isZh ? "平均配速" : "Avg Pace"} value={fmtPace(a.avgPaceSec)} unit="/km" />
        <Stat icon={IconHeart} label={isZh ? "平均心率" : "Avg HR"} value={a.avgHr} unit="bpm" />
        <Stat icon={IconSteps} label={isZh ? "步频" : "Cadence"} value={d?.avgCadence ?? null} unit="spm" hint={d?.avgStrideM ? (isZh ? `步幅 ${d.avgStrideM} m` : `Stride ${d.avgStrideM} m`) : undefined} />
        <Stat icon={IconPulse} label={isZh ? "平均功率" : "Avg Power"} value={d?.avgPower ?? null} unit="W" />
        <Stat icon={IconMountain} label={isZh ? "爬升 / 下降" : "Elev Gain / Loss"} value={d?.elevGain ?? null} unit={`/ ${d?.elevLoss ?? "—"} m`} />
        <Stat icon={IconLoad} label={isZh ? "训练负荷" : "Training Load"} value={d?.trainingLoad ?? null} hint={d?.aerobicTe != null ? (isZh ? `有氧 TE ${d.aerobicTe}｜无氧 TE ${d.anaerobicTe}` : `Aerobic TE ${d.aerobicTe} | Anaerobic TE ${d.anaerobicTe}`) : undefined} />
      </div>

      {lapSummary.count > 2 && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">{isZh ? "逐段配速与心率" : "Splits Pace & Heart Rate"}</h3>
            <p className="card-sub">
              {isZh
                ? `${lapSummary.granularityM}m 分段，共 ${lapSummary.count} 段。最快 ${fmtPace(fastest)}／最慢 ${fmtPace(slowest)}，波动 ${fmtPace(slowest - fastest)}／km`
                : `${lapSummary.granularityM}m splits, ${lapSummary.count} total. Fastest ${fmtPace(fastest)} / Slowest ${fmtPace(slowest)}, variance ${fmtPace(slowest - fastest)}/km`}
            </p>
            <LineChart
              labels={fullLaps.map((l) => `${(l.distanceM / 1000).toFixed(1)}km`)}
              series={[
                { key: "pace", label: isZh ? "配速（左轴）" : "Pace (Left Axis)", color: "var(--chart-accent)", values: fullLaps.map((l) => l.avgPaceSec) },
                { key: "hr", label: isZh ? "平均心率（右轴）" : "Avg HR (Right Axis)", color: "var(--chart-hr)", axis: "right", values: fullLaps.map((l) => l.avgHr) },
              ]}
              height={220}
              yFmt={fmtPace}
              yFmtRight={(n) => String(Math.round(n))}
              yInvert
            />
          </div>

          <AerobicDecouplingCard
            laps={fullLaps}
            options={{
              distanceKm: a.distanceKm ?? undefined,
              durationSec: a.durationSec ?? undefined,
              isCombo: a.sportType != null && ![100, 102, 103, 104].includes(a.sportType),
            }}
          />

          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="card">
              <h3 className="card-title">{isZh ? "各段心率表现（轻松 vs 吃力）" : "Lap HR vs Baseline (Effort vs Reserve)"}</h3>
              <p className="card-sub">
                {isZh
                  ? "以全场配速与心率的整体基线为参照：柱子向上代表心率偏高（跑得吃力/出现心率漂移），柱子向下代表心率比平时更低（体能充沛/跑得轻松有余量）。"
                  : "Compared to overall pace-HR baseline: upward bars indicate higher HR (straining/drift), downward bars indicate lower HR (aerobic reserve/effortless)."}
              </p>
              {coupling && verdict && (
                <div className={`banner ${verdict.level === "none" ? "warn" : "info"}`} style={{ marginTop: 12 }}>
                  <strong>{verdict.title}</strong>：{verdict.text}
                  <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>
                    {isZh ? `（相关系数 r = ${coupling.r.toFixed(2)}）` : `(Correlation r = ${coupling.r.toFixed(2)})`}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                {residualRows.length > 0
                  ? <ResidualChart rows={residualRows} />
                  : <div className="banner info">{isZh ? "有效分段不足，无法比较各段心率与配速的关系。" : "Insufficient splits to model pace-HR relationship."}</div>}
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">{isZh ? "心率区间分布" : "Heart Rate Zone Distribution"}</h3>
              <p className="card-sub">{isZh ? "按各段平均心率归类" : "Grouped by segment average HR"}</p>
              <div style={{ marginTop: 16 }}>
                <ZoneBar
                  zones={zones.zones.map((z) => ({ ...z, color: z.zone.toLowerCase() }))}
                  basis={zones}
                />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">{isZh ? "逐段明细" : "Lap Breakdown"}</h3>
            <p className="card-sub">{isZh ? "最后一段通常不足整段距离" : "The final segment may be partial distance"}</p>
            <div className="table-scroll-wrap">
              <div className="table-scroll" style={{ maxHeight: 420, overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{isZh ? "段" : "Lap"}</th>
                      <th>{isZh ? "距离" : "Dist (km)"}</th>
                      <th>{isZh ? "用时" : "Dur"}</th>
                      <th>{isZh ? "配速" : "Pace"}</th>
                      <th>{isZh ? "心率" : "HR"}</th>
                      <th>{isZh ? "最大" : "Max"}</th>
                      <th>{isZh ? "步频" : "Cadence"}</th>
                      <th>{isZh ? "步幅" : "Stride"}</th>
                      <th>{isZh ? "爬升" : "Elev"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laps.map((l) => {
                      const isPartial = l.distanceM < (lapSummary.granularityM ?? 1000) * 0.9;
                      return (
                        <tr key={l.lapIndex} style={{ opacity: isPartial ? 0.6 : 1 }}>
                          <td>{l.lapIndex}{isPartial ? " *" : ""}</td>
                          <td className="num">{(l.distanceM / 1000).toFixed(2)}</td>
                          <td className="num">{fmtDur(l.timeSec)}</td>
                          <td className="num" style={{ color: paceColor(l.avgPaceSec, fastest, slowest) }}>
                            {fmtPace(l.avgPaceSec)}
                          </td>
                          <td className="num">{l.avgHr || "—"}</td>
                          <td className="num" style={{ color: "var(--text-faint)" }}>{l.maxHr || "—"}</td>
                          <td className="num">{l.avgCadence || "—"}</td>
                          <td className="num">{l.avgStrideM ? l.avgStrideM.toFixed(2) : "—"}</td>
                          <td className="num" style={{ color: "var(--text-faint)" }}>{Math.round(l.elevGain)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---- 所属场次与整场 AI 分析引导 ---- */}
      {data.sessionKey && onOpenSession && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <h3 className="card-title" style={{ marginBottom: 4 }}>{isZh ? "AI 训练复盘已收敛至「训练场次」" : "AI Coach Reviews are Consolidated into Workout Sessions"}</h3>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              {isZh
                ? "AI 教练复盘在场次页统一进行（包含多段间歇、组结构、组间休息与整场配速心率综合解读）。"
                : "AI Coach review is conducted at the Session level (covering multi-lap intervals, set rest periods, and combined pace-heart rate analysis)."}
            </p>
          </div>
          <button className="btn primary" onClick={() => onOpenSession(data.sessionKey!)}>
            {isZh ? "前往该场次 AI 分析" : "Open Session AI Analysis"}
          </button>
        </div>
      )}
    </>
  );
}

/** paceHrResidual 内部用了 useWidth/useState，必须作为组件渲染而不是直接调用 */
function ResidualChart({ rows }: { rows: Parameters<typeof paceHrResidual>[0] }) {
  return paceHrResidual(rows, 240);
}

function Stat({ label, value, unit, hint, icon: Icon }: { label: string; value: any; unit?: string; hint?: string; icon?: any }) {
  return (
    <div className="card stat-card">
      <div className="stat">
        <span className="label">{Icon && <Icon size={15} />}{label}</span>
        <span className="value num">{value ?? "—"}{unit ? <span className="unit">{unit}</span> : null}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
    </div>
  );
}
