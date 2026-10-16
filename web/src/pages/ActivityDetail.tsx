import { useEffect, useState } from "react";
import { api, type ActivityDetail } from "../api";
import { LineChart, Markdown, ZoneBar, couplingVerdict, fmtDur, fmtPace, hrResiduals, paceColor, paceHrCoupling, paceHrResidual } from "../charts";
import { IconBack, IconGauge, IconHeart, IconLoad, IconMountain, IconPulse, IconRoute, IconSteps, IconStopwatch } from "../icons";

export default function ActivityDetailView({
  labelId, onBack, aiConfigured,
}: { labelId: string; onBack: () => void; aiConfigured: boolean }) {
  const [data, setData] = useState<ActivityDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const load = () => api.activity(labelId).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setErr(null); load(); }, [labelId]);

  if (err) return <div className="banner error">{err}</div>;
  if (!data) return <div><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>;

  const { activity: a, detail: d, laps, scatter, zones, reports, lapSummary } = data;
  const fullLaps = laps.length > 1 ? laps.slice(0, -1) : laps;
  const fastest = lapSummary.fastestLapSec ?? 0;
  const slowest = lapSummary.slowestLapSec ?? fastest;

  // 配速-心率耦合：拟合出「这个配速该有的心率」，再看每段实际偏高还是偏低
  const coupling = paceHrCoupling(fullLaps.map((l) => ({ paceSec: l.avgPaceSec, hr: l.avgHr })));
  const verdict = coupling ? couplingVerdict(coupling.r) : null;
  const residualRows = coupling
    ? hrResiduals(fullLaps.map((l) => ({ paceSec: l.avgPaceSec, hr: l.avgHr })), coupling).map((residual, i) => {
        const l = fullLaps[i];
        return {
          label: `第 ${l.lapIndex} 段`,
          residual,
          tip: [
            [`${residual > 0 ? "+" : ""}${residual.toFixed(1)} bpm`, "与该配速应有心率之差"],
            [fmtPace(l.avgPaceSec) + " /km", "配速"],
            [`${l.avgHr} bpm`, "实际平均心率"],
            [`${l.maxHr} bpm`, "最大心率"],
            [`${l.avgCadence} spm`, "步频"],
            [`${l.avgStrideM.toFixed(2)} m`, "步幅"],
          ] as [string, string][],
        };
      })
    : [];

  const runAnalyze = async () => {
    setBusy(true); setAiErr(null);
    try {
      await api.analyze(labelId, focus.trim() || null);
      await load();
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{a.dateLabel} · {a.sportName}</h2>
          <div className="sub">
            {a.location ?? "—"}
            {d?.trainingFocus ? ` ｜ COROS 判定训练重点：${d.trainingFocus}` : ""}
            {d?.performance ? ` ｜ 表现：${d.performance}` : ""}
          </div>
        </div>
        <button className="btn" onClick={onBack}><IconBack size={15} />返回</button>
      </div>

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
            />
          </div>

          <div className="grid g2" style={{ marginBottom: 14 }}>
            <div className="card">
              <h3 className="card-title">每段心率的「欠账」</h3>
              <p className="card-sub">
                按这次全程的配速-心率关系，先算出每段「本该是多少心率」，再看实际差多少。
                零线以上是心率被顶得比该配速应有的更高，零线以下是同样的速度心率反而更低、说明身体有余量。
                纵轴单位 bpm，横轴是段序。
              </p>
              {coupling && verdict && (
                <div className={`banner ${verdict.level === "none" ? "warn" : "info"}`} style={{ marginTop: 12 }}>
                  相关度 r = {coupling.r.toFixed(2)}（-1 到 1，越接近 -1 表示跑得慢心率降得越明显）：{verdict.text}。
                  {verdict.level === "none" && "下面的条形图只能说明各段心率的起伏，不宜当作能力差解读。"}
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
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
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
        </>
      )}

      {/* ---- AI 分析 ---- */}
      <div className="card">
        <h3 className="card-title">AI 训练分析</h3>
        <p className="card-sub">
          只分析你指定的这一次训练，不做全量分析。可填写关注点，留空则做通用分析。
        </p>

        {!aiConfigured && (
          <div className="banner info">
            还没有配置 AI 模型，请到「设置」页填写你的模型地址、API Key 和模型名。
          </div>
        )}
        {aiErr && <div className="banner error">{aiErr}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            placeholder="关注点（可选），例如：后程掉速明显，是不是强度太高了？"
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <span className="pill accent">{r.model}</span>
                <span className="hint">{new Date(r.createdAt * 1000).toLocaleString("zh-CN")}</span>
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
