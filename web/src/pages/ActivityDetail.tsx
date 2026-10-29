import { useEffect, useState } from "react";
import { api, type ActivityDetail } from "../api";
import { AerobicDecouplingCard, LineChart, ZoneBar, couplingVerdict, fmtDur, fmtPace, hrResiduals, paceColor, paceHrCoupling, paceHrResidual } from "../charts";
import { IconBack, IconGauge, IconHeart, IconLoad, IconMountain, IconPulse, IconRoute, IconSteps, IconStopwatch } from "../icons";

export default function ActivityDetailView({
  labelId, onBack, onOpenSession,
}: {
  labelId: string;
  onBack: () => void;
  onOpenSession?: (sessionKey: string) => void;
  aiConfigured?: boolean;
}) {
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
        const statusText = residual > 3 ? "偏高 · 吃力硬撑" : residual < -3 ? "偏低 · 充沛轻松" : "正常基准";
        return {
          label: `第 ${l.lapIndex} 段`,
          residual,
          tip: [
            [`${residual > 0 ? "+" : ""}${residual.toFixed(1)} bpm（${statusText}）`, "相对基准心率偏差"],
            [fmtPace(l.avgPaceSec) + " /km", "配速"],
            [`${l.avgHr ?? "—"} bpm`, "实际平均心率"],
            [`${l.maxHr ?? "—"} bpm`, "最大心率"],
            [`${l.avgCadence ?? "—"} spm`, "步频"],
            [l.avgStrideM ? `${l.avgStrideM.toFixed(2)} m` : "—", "步幅"],
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
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontWeight: 700 }}>佳明 GARMIN</span>
            ) : (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6", fontWeight: 700 }}>高驰 COROS</span>
            )}
            {a.isDuplicate === 1 ? (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(234, 179, 8, 0.18)", color: "#eab308", fontWeight: 700 }}>对比样本（已归档）</span>
            ) : (
              <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(99, 102, 241, 0.12)", color: "#818cf8", fontWeight: 700 }}>主力有效记录</span>
            )}
            <h2 style={{ margin: 0 }}>{a.dateLabel} · {a.sportName}</h2>
          </div>
          <div className="sub">
            {a.location ?? "—"}
            {d?.trainingFocus ? ` ｜ 判定训练重点：${d.trainingFocus}` : ""}
            {d?.performance ? ` ｜ 表现：${d.performance}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {data.sessionKey && onOpenSession && (
            <button className="btn" onClick={() => onOpenSession(data.sessionKey!)}>所属训练场次</button>
          )}
          <button className="btn" onClick={onBack} title="返回上一级（快捷键：Esc 或鼠标后退键）"><IconBack size={15} />返回</button>
        </div>
      </div>

      {data.comparisonActivity && (
        <div className="card" style={{ marginBottom: 14, background: "rgba(99, 102, 241, 0.05)", border: "1px solid rgba(99, 102, 241, 0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>⌚ 双表同场记录对比</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                检测到该训练由【{a.source === "garmin" ? "佳明" : "高驰"}】与【{data.comparisonActivity.activity.source === "garmin" ? "佳明" : "高驰"}】双表同时记录。
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div>当前表（{a.source === "garmin" ? "佳明" : "高驰"}）：<strong>{a.distanceKm} km</strong> · {fmtPace(a.avgPaceSec)} · {a.avgHr ?? "—"} bpm</div>
              <div style={{ color: "var(--text-dim)" }}>对照表（{data.comparisonActivity.activity.source === "garmin" ? "佳明" : "高驰"}）：<strong>{data.comparisonActivity.activity.distanceKm} km</strong> · {fmtPace(data.comparisonActivity.activity.avgPaceSec)} · {data.comparisonActivity.activity.avgHr ?? "—"} bpm</div>
            </div>
          </div>
        </div>
      )}

      {lapSummary.count > 0 && lapSummary.distanceMatches === false && (
        <div className="banner warn">
          分圈合计 {lapSummary.totalDistanceM / 1000} km 与记录距离 {a.distanceKm} km 不一致，请留意。
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Stat icon={IconRoute} label="距离" value={a.distanceKm} unit="km" />
        <Stat icon={IconStopwatch} label="用时" value={fmtDur(a.durationSec)} />
        <Stat icon={IconGauge} label="平均配速" value={fmtPace(a.avgPaceSec)} unit="/km" />
        <Stat icon={IconHeart} label="平均心率" value={a.avgHr} unit="bpm" />
        <Stat icon={IconSteps} label="步频" value={d?.avgCadence ?? null} unit="spm" hint={d?.avgStrideM ? `步幅 ${d.avgStrideM} m` : undefined} />
        <Stat icon={IconPulse} label="平均功率" value={d?.avgPower ?? null} unit="W" />
        <Stat icon={IconMountain} label="爬升 / 下降" value={d?.elevGain ?? null} unit={`/ ${d?.elevLoss ?? "—"} m`} />
        <Stat icon={IconLoad} label="训练负荷" value={d?.trainingLoad ?? null} hint={d?.aerobicTe != null ? `有氧 TE ${d.aerobicTe}｜无氧 TE ${d.anaerobicTe}` : undefined} />
      </div>

      {lapSummary.count > 2 && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">逐段配速与心率</h3>
            <p className="card-sub">
              {lapSummary.granularityM}m 分段，共 {lapSummary.count} 段。
              最快 {fmtPace(fastest)}／最慢 {fmtPace(slowest)}，波动 {fmtPace(slowest - fastest)}／km
            </p>
            <LineChart
              labels={fullLaps.map((l) => `${(l.distanceM / 1000).toFixed(1)}km`)}
              series={[
                { key: "pace", label: "配速（左轴）", color: "var(--chart-accent)", values: fullLaps.map((l) => l.avgPaceSec) },
                { key: "hr", label: "平均心率（右轴）", color: "var(--chart-hr)", axis: "right", values: fullLaps.map((l) => l.avgHr) },
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
              <h3 className="card-title">各段心率表现（轻松 vs 吃力）</h3>
              <p className="card-sub">
                以全场配速与心率的整体基线为参照：柱子向上代表心率偏高（跑得吃力/出现心率漂移），柱子向下代表心率比平时更低（体能充沛/跑得轻松有余量）。
              </p>
              {coupling && verdict && (
                <div className={`banner ${verdict.level === "none" ? "warn" : "info"}`} style={{ marginTop: 12 }}>
                  <strong>{verdict.title}</strong>：{verdict.text}
                  <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>
                    （相关系数 r = {coupling.r.toFixed(2)}）
                  </span>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                {residualRows.length > 0
                  ? <ResidualChart rows={residualRows} />
                  : <div className="banner info">有效分段不足，无法比较各段心率与配速的关系。</div>}
              </div>
            </div>

            <div className="card">
              <h3 className="card-title">心率区间分布</h3>
              <p className="card-sub">按各段平均心率归类</p>
              <div style={{ marginTop: 16 }}>
                <ZoneBar
                  zones={zones.zones.map((z) => ({ ...z, color: z.zone.toLowerCase() }))}
                  basis={zones}
                />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 className="card-title">逐段明细</h3>
            <p className="card-sub">最后一段通常不足整段距离</p>
            <div className="table-scroll-wrap">
              <div className="table-scroll" style={{ maxHeight: 420, overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>段</th><th>距离</th><th>用时</th><th>配速</th>
                      <th>心率</th><th>最大</th><th>步频</th><th>步幅</th><th>爬升</th>
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
            <h3 className="card-title" style={{ marginBottom: 4 }}>AI 训练复盘已收敛至「训练场次」</h3>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              AI 教练复盘在场次页统一进行（包含多段间歇、组结构、组间休息与整场配速心率综合解读）。
            </p>
          </div>
          <button className="btn primary" onClick={() => onOpenSession(data.sessionKey!)}>
            前往该场次 AI 分析
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
