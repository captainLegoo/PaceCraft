import { Fragment, useEffect, useState } from "react";
import { fmtP, fmtT } from "../charts";
import { IconGauge, IconLayers, IconStopwatch, IconTrend } from "../icons";

type Report = {
  generatedAt: number;
  age: number;
  hrMax: number;
  threshold: { paceSec: number; hr: number; samples: number; r2: number; method: string };
  exponent: { k: number; spread: number; pairs: number; note: string };
  climb: {
    penaltySecPerKm: number | null; penaltyPct: number | null; note: string;
    model: { costSecPerRate: number; r2: number; samples: number; rateSd: number; usable: boolean };
    bands: {
      hrLo: number; hrHi: number;
      climbingPaceSec: number | null; flatPaceSec: number | null;
      penaltySecPerKm: number | null; nClimbing: number; nFlat: number;
    }[];
  };
  terrainSplit: {
    terrain: string; label: string; count: number; distanceKm: number;
    durationSec: number; elevGain: number; sharePct: number; avgClimbRate: number;
  }[];
  anchors: any[];
  weeklyKm: number;
  longestActual: { km: number; sec: number; date: string; paceSec: number } | null;
  fatigue: {
    score: number;
    level: number;
    label: string;
    levelLabel: string;
    tone: "good" | "warn" | "bad";
    components: {
      key: string; label: string; raw: number; normalized: number; weight: number;
      /** false = 该信号没有区分度，未参与计分，权重已转给其它分量 */
      active: boolean; note: string;
    }[];
    summary: string;
    reliability: "高" | "中" | "低";
    reliabilityNote: string;
    series: { date: string; score: number; load: number }[];
  };
  predictions: {
    distanceKm: number; name: string; seconds: number; paceSec: number;
    low: number; high: number; officialSeconds: number | null; deltaVsOfficial: number | null;
    models: { model: string; label: string; seconds: number; weight: number; basis: string; tier: "A" | "B" | "C"; caveat?: string }[];
    groundTruth: {
      actualKm: number; actualSec: number; date: string; impliedSec: number; deltaPct: number;
    } | null;
    confidence: string; confidenceNote: string;
  }[];
  zones: { name: string; purpose: string; paceSec: number; hr: number; range: string; color: string }[];
  official: { vo2max: number | null; runningLevel: number | null; thresholdPaceSec: number | null; pred5kSec: number | null; pred10kSec: number | null; predHalfSec: number | null; predMarathonSec: number | null };
  meta: { activitiesAnalyzed: number; lapsAnalyzed: number; lapsDropped: number; dateRange: [string, string] | null; anchorCount: number };
  candidateCounts: Record<string, number>;
};

const TIER_DESC: Record<string, { label: string; color: string; desc: string }> = {
  A: { label: "A 级", color: "var(--accent)", desc: "长距离锚点：训练强度≈比赛强度，外推最可信" },
  B: { label: "B 级", color: "var(--warn)", desc: "阈值/中等距离锚点：需要模型外推" },
  C: { label: "C 级", color: "var(--text-faint)", desc: "短距离锚点：训练中的短距离几乎不是全力，系统性偏保守" },
};

export default function Prediction() {
  const [d, setD] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openModels, setOpenModels] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/prediction")
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setD(j)))
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="banner error">{err}</div>;
  if (!d) return <div><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>;

  return (
    <>
      <div className="banner info">
        这页的预测<strong>完全基于你自己的训练数据</strong>算出来，不使用 COROS 的体能评分。
        做法是：先从每次训练里找出「连续跑出的最好成绩」当锚点，
        再用多个模型加权合成。下方每个数字都可以展开看它是怎么来的。
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconGauge size={15} />自建阈值配速</span>
            <span className="value num" style={{ color: "var(--accent)" }}>{fmtP(d.threshold.paceSec)}<span className="unit">/km</span></span>
            <span className="hint">官方给的是 {fmtP(d.official.thresholdPaceSec)}/km</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconTrend size={15} />你的 Riegel 指数 k</span>
            <span className="value num">{d.exponent.k.toFixed(3)}</span>
            <span className="hint">理论值 1.06，{d.exponent.pairs} 组配对拟合</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconLayers size={15} />参与计算的锚点</span>
            <span className="value num">{d.meta.anchorCount}<span className="unit">个距离档</span></span>
            <span className="hint">{d.meta.activitiesAnalyzed} 次训练 / {d.meta.lapsAnalyzed} 段（滤噪 {d.meta.lapsDropped}）</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconStopwatch size={15} />数据区间</span>
            <span className="value num" style={{ fontSize: 17 }}>{d.meta.dateRange?.[0]}<br />{d.meta.dateRange?.[1]}</span>
            <span className="hint">年龄 {d.age} 岁，推算最大心率 {d.hrMax.toFixed(0)} bpm</span>
          </div>
        </div>
      </div>

      {/* 疲劳指数：预测说「能力上限在哪」，这个说「现在离上限有多远」 */}
      {d.fatigue && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 className="card-title">
            疲劳指数
            <span className={`pill ${d.fatigue.tone}`} style={{ marginLeft: 10 }}>
              {d.fatigue.label}
            </span>
            <span className="pill" style={{ marginLeft: 6 }}>
              可信度 {d.fatigue.reliability}
            </span>
          </h3>
          <p className="card-sub">
            由三项合成：<strong>负荷累积</strong>（7 天指数加权 vs 28 天基线）、
            <strong>恢复不足</strong>（静息心率相对基线的抬升）、
            <strong>累积压力</strong>（连续高负荷天数）。
            只用每天都有的数据 —— 你的睡眠评分在库里 60 天只有 1 天有效，所以没进模型。
          </p>

          <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
            {/* 主分数：百分比刻度 */}
            <div style={{ minWidth: 260, flex: "1 1 260px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>
                <span>0 · 状态充沛</span>
                <span>50</span>
                <span>100 · 过度负荷</span>
              </div>
              <div style={{ height: 12, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
                {/* 底色分级 */}
                <div style={{
                  position: "absolute", inset: 0, display: "flex",
                }}>
                  <div style={{ flex: 25, background: "rgba(52,211,153,.14)" }} />
                  <div style={{ flex: 20, background: "rgba(250,204,21,.12)" }} />
                  <div style={{ flex: 17, background: "rgba(251,146,60,.14)" }} />
                  <div style={{ flex: 18, background: "rgba(248,113,113,.16)" }} />
                  <div style={{ flex: 20, background: "rgba(239,68,68,.2)" }} />
                </div>
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${d.fatigue.score}%`,
                  background: d.fatigue.tone === "good" ? "var(--good)" : d.fatigue.tone === "warn" ? "var(--warn)" : "var(--bad)",
                  opacity: 0.85, transition: "width .3s",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, alignItems: "baseline" }}>
                <span className="num" style={{ fontSize: 28, fontWeight: 700, color: `var(--${d.fatigue.tone})` }}>
                  {d.fatigue.score}<span style={{ fontSize: 13, opacity: .55 }}>/100</span>
                </span>
                <span className="hint">{d.fatigue.reliabilityNote}</span>
              </div>
            </div>

            {/* 1–10 分刻度 */}
            <div style={{ minWidth: 210, flex: "0 1 210px" }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>1–10 分</div>
              <div style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <div key={n} style={{
                    flex: 1, height: 30, borderRadius: 4, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 12, fontWeight: 700,
                    background: n <= d.fatigue!.level
                      ? `var(--${d.fatigue!.tone})`
                      : "var(--bg-2)",
                    color: n <= d.fatigue!.level ? "#0b1a10" : "var(--text-faint)",
                    opacity: n <= d.fatigue!.level ? 0.88 : 1,
                  }}>{n}</div>
                ))}
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {d.fatigue.level}/10 · {d.fatigue.levelLabel}
              </div>
            </div>
          </div>

          <div className="hint" style={{ marginTop: 12, marginBottom: 4 }}>{d.fatigue.summary}</div>

          {/* 分量拆解 */}
          <div className="grid g3" style={{ marginTop: 12 }}>
            {d.fatigue.components.map((c) => (
              <div key={c.key} style={{
                border: "1px solid var(--border)", borderRadius: 8, padding: 10,
                opacity: c.active ? 1 : 0.6,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>
                    {c.label}
                    {!c.active && <span className="hint" style={{ marginLeft: 6, fontWeight: 400 }}>· 未计入</span>}
                  </strong>
                  <span className="hint">权重 {(c.weight * 100).toFixed(0)}%</span>
                </div>
                <div style={{ height: 5, background: "var(--bg-2)", borderRadius: 3, overflow: "hidden", marginBottom: 7 }}>
                  <div style={{
                    width: `${Math.round(c.normalized * 100)}%`, height: "100%",
                    background: c.active ? "var(--warn)" : "var(--border)",
                  }} />
                </div>
                <div className="hint">{c.note}</div>
              </div>
            ))}
          </div>

          {/* 近 14 天趋势 */}
          {d.fatigue.series.length > 2 && (
            <div style={{ marginTop: 14 }}>
              <div className="hint" style={{ marginBottom: 8 }}>
                近 {d.fatigue.series.length} 天趋势（柱高 = 疲劳指数，柱下数字 = 当日自算负荷；0 = 休息日）
              </div>
              <div style={{
                display: "flex", gap: 6, alignItems: "flex-end",
                height: 88, paddingBottom: 2, borderBottom: "1px solid var(--border)",
              }}>
                {d.fatigue.series.map((s) => (
                  <div key={s.date} style={{
                    flex: 1, height: "100%", display: "flex",
                    flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
                  }} title={`${s.date}｜疲劳 ${s.score}｜负荷 ${s.load}`}>
                    <div className="hint num" style={{ fontSize: 9, marginBottom: 2, opacity: .7 }}>{s.score}</div>
                    <div style={{
                      width: "72%", maxWidth: 30,
                      height: `${Math.max(4, (s.score / 100) * 62)}px`,
                      background: s.score < 30 ? "var(--good)" : s.score < 60 ? "var(--warn)" : "var(--bad)",
                      opacity: .82, borderRadius: "3px 3px 0 0",
                      transition: "height .3s",
                    }} />
                    <div className="hint num" style={{ fontSize: 9, marginTop: 3 }}>{s.load}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">爬升与地形</h3>
        <p className="card-sub">
          阈值配速和上方所有预测用的都是<strong>平路等效配速</strong>：先用你历史数据拟合出的爬升代价
          （每 1 m/km 爬升多耗 <strong>{d.climb.model.costSecPerRate.toFixed(2)} s/km</strong>，
          {d.climb.model.samples} 段样本、R²={d.climb.model.r2.toFixed(2)}）
          把爬升路段的配速折算回平路，再做回归。所以起伏路段配速慢不会被误判成体能退步。
        </p>

        <div className="grid g3" style={{ marginTop: 12, marginBottom: 14 }}>
          <div className="stat">
            <span className="label">爬升短板</span>
            <span className="value num" style={{ color: d.climb.penaltyPct != null && d.climb.penaltyPct > 8 ? "var(--warn)" : "var(--accent)" }}>
              {d.climb.penaltySecPerKm != null ? `+${d.climb.penaltySecPerKm.toFixed(0)}` : "—"}
              <span className="unit">s/km</span>
            </span>
            <span className="hint">
              {d.climb.penaltyPct != null
                ? `同心率下爬升比平路慢 ${d.climb.penaltyPct.toFixed(1)}%`
                : "样本不足"}
            </span>
          </div>
          <div className="stat">
            <span className="label">爬升代价系数</span>
            <span className="value num" style={{ fontSize: 20 }}>
              {d.climb.model.costSecPerRate.toFixed(2)}<span className="unit">s/(m/km)</span>
            </span>
            <span className="hint">
              {d.climb.model.usable
                ? `11 m/km 路段 ≈ 慢 ${(d.climb.model.costSecPerRate * 11).toFixed(0)} s/km`
                : "地形变化不足，已退回不修正"}
            </span>
          </div>
          <div className="stat">
            <span className="label">爬升率噪声阈值</span>
            <span className="value num" style={{ fontSize: 20 }}>&lt; 1<span className="unit">m/km</span></span>
            <span className="hint">低于此值按操场平路处理（气压计噪声）</span>
          </div>
        </div>

        <h4 style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--text-dim)" }}>
          同心率下的爬升 vs 平路配速
        </h4>
        <table>
          <thead>
            <tr><th>心率区间</th><th>爬升路段配速</th><th>平路配速</th><th>爬升代价</th><th>样本（爬升/平路）</th></tr>
          </thead>
          <tbody>
            {d.climb.bands.map((b) => (
              <tr key={`${b.hrLo}-${b.hrHi}`}>
                <td>{b.hrLo}–{b.hrHi} bpm</td>
                <td className="num">{fmtP(b.climbingPaceSec)} /km</td>
                <td className="num">{fmtP(b.flatPaceSec)} /km</td>
                <td className="num" style={{ color: "var(--warn)", fontWeight: 600 }}>
                  {b.penaltySecPerKm != null ? `+${b.penaltySecPerKm.toFixed(0)} s/km` : "—"}
                </td>
                <td className="num" style={{ color: "var(--text-faint)" }}>
                  {b.nClimbing} / {b.nFlat}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ margin: "16px 0 8px", fontSize: 13, color: "var(--text-dim)" }}>
          训练量的地形分布
        </h4>
        <table>
          <thead>
            <tr><th>地形</th><th>次数</th><th>距离</th><th>占比</th><th>累计爬升</th><th>平均爬升率</th></tr>
          </thead>
          <tbody>
            {d.terrainSplit.map((t) => (
              <tr key={t.terrain}>
                <td>
                  <span className="pill" style={{ color: t.terrain === "flat" ? "var(--z2)" : "var(--warn)", borderColor: "var(--border-strong)" }}>
                    {t.label}
                  </span>
                </td>
                <td className="num">{t.count}</td>
                <td className="num">{t.distanceKm} km</td>
                <td className="num">{t.sharePct}%</td>
                <td className="num">{t.elevGain.toLocaleString()} m</td>
                <td className="num">{t.avgClimbRate} m/km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">成绩预测（自建模型）vs COROS 官方</h3>
        <p className="card-sub">
          点任意一行展开，看这个数字由哪几个模型合成、各自权重多少、锚点是哪次训练。
        </p>
        <table>
          <thead>
            <tr>
              <th>距离</th><th>自建预测</th><th>配速</th><th>可信区间</th>
              <th>信心</th><th>实测校验</th><th>官方预测</th><th>差异</th>
            </tr>
          </thead>
          <tbody>
            {d.predictions.map((p) => {
              const delta = p.deltaVsOfficial;
              const pct = delta != null && p.officialSeconds ? (delta / p.officialSeconds) * 100 : null;
              const isOpen = openModels === String(p.distanceKm);
              return (
                <Fragment key={p.distanceKm}>
                  <tr
                    className={`clickable ${isOpen ? "open" : ""}`}
                    onClick={() => setOpenModels(isOpen ? null : String(p.distanceKm))}
                    title={isOpen ? "点击收起模型明细" : "点击展开模型明细"}
                  >
                    <td>{p.name}</td>
                    <td className="num" style={{ color: "var(--accent)", fontWeight: 600 }}>{fmtT(p.seconds)}</td>
                    <td className="num">{fmtP(p.paceSec)}</td>
                    <td className="num" style={{ color: "var(--text-faint)" }}>{fmtT(p.low)} ~ {fmtT(p.high)}</td>
                    <td><span className={`pill ${p.confidence === "高" ? "good" : p.confidence === "中" ? "warn" : "bad"}`}>{p.confidence}</span></td>
                    {/* 实测交叉校验：预测 vs 真实跑出来的配速 */}
                    <td className="num" style={{
                      color: p.groundTruth
                        ? Math.abs(p.groundTruth.deltaPct) < 3 ? "var(--good)"
                          : Math.abs(p.groundTruth.deltaPct) < 6 ? "var(--warn)" : "var(--bad)"
                        : "var(--text-faint)",
                    }}>
                      {p.groundTruth
                        ? `${p.groundTruth.deltaPct > 0 ? "+" : ""}${p.groundTruth.deltaPct.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="num">{p.officialSeconds ? fmtT(p.officialSeconds) : "—"}</td>
                    <td className="num" style={{ color: pct == null ? undefined : Math.abs(pct) < 2 ? "var(--good)" : Math.abs(pct) < 5 ? "var(--warn)" : "var(--bad)" }}>
                      {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="expanded-detail-row">
                      <td colSpan={8}>
                        <div className="prediction-detail-box">
                          <div className="hint" style={{ marginBottom: 10 }}>{p.confidenceNote}</div>
                          {p.groundTruth && (
                            <div className="ground-truth-box">
                              <strong>实测交叉校验</strong>：
                              你在 {p.groundTruth.date} 跑过 {p.groundTruth.actualKm.toFixed(2)}km，
                              用时 {fmtT(p.groundTruth.actualSec)}（{fmtP(p.groundTruth.actualSec / p.groundTruth.actualKm)}/km）。
                              按这个配速折算到{p.name}是 <strong className="num">{fmtT(p.groundTruth.impliedSec)}</strong>，
                              本模型预测 <strong className="num">{fmtT(p.seconds)}</strong>，
                              <span style={{
                                color: Math.abs(p.groundTruth.deltaPct) < 3 ? "var(--good)"
                                  : Math.abs(p.groundTruth.deltaPct) < 6 ? "var(--warn)" : "var(--bad)",
                              }}>
                                {" "}相差 {p.groundTruth.deltaPct > 0 ? "+" : ""}{p.groundTruth.deltaPct.toFixed(1)}%
                              </span>。
                            </div>
                          )}
                          <table className="detail-table">
                            <thead>
                              <tr><th>锚点层级</th><th>模型</th><th>预测</th><th>权重</th><th>依据</th></tr>
                            </thead>
                            <tbody>
                              {p.models.map((m) => (
                                <tr key={m.model}>
                                  <td style={{ color: TIER_DESC[m.tier].color, whiteSpace: "nowrap" }}>{TIER_DESC[m.tier].label}</td>
                                  <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{m.label}</td>
                                  <td className="num">{fmtT(m.seconds)}</td>
                                  <td className="num">{m.weight.toFixed(2)}</td>
                                  <td style={{ textAlign: "left", color: "var(--text-faint)", fontSize: 11.5, whiteSpace: "normal" }}>
                                    {m.basis}
                                    {m.caveat && <div style={{ color: "var(--warn)", marginTop: 3 }}>⚠ {m.caveat}</div>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="legend" style={{ marginTop: 8 }}>
                            {Object.entries(TIER_DESC).map(([k, v]) => (
                              <div className="legend-item" key={k}>
                                <span className="legend-swatch" style={{ background: v.color }} />
                                <strong style={{ color: v.color }}>{v.label}</strong> {v.desc}
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title">训练区间（由你的阈值配速反推）</h3>
          <p className="card-sub">心率由「心率 = a + b × 配速」的实测回归换算，不是拍的</p>
          <table>
            <thead><tr><th>训练类型</th><th>配速</th><th>预估心率</th><th>用途</th></tr></thead>
            <tbody>
              {d.zones.map((z) => (
                <tr key={z.name}>
                  <td><span className="pill" style={{ color: z.color, borderColor: "var(--border-strong)" }}>{z.name}</span></td>
                  <td className="num" style={{ color: z.color, fontWeight: 600 }}>{fmtP(z.paceSec)}/km</td>
                  <td className="num" style={{ color: "var(--hr)" }}>{z.hr ? `${z.hr.toFixed(0)} bpm` : "—"}</td>
                  <td style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12 }}>{z.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 className="card-title">算法参数是怎么来的</h3>
          <table>
            <tbody>
              <tr>
                <td style={{ textAlign: "left", color: "var(--text-dim)" }}>阈值配速</td>
                <td className="num" style={{ textAlign: "left", whiteSpace: "normal" }}>{d.threshold.method}</td>
              </tr>
              <tr>
                <td style={{ textAlign: "left", color: "var(--text-dim)" }}>个人 k 值</td>
                <td className="num" style={{ textAlign: "left", whiteSpace: "normal" }}>{d.exponent.note}</td>
              </tr>
              <tr>
                <td style={{ textAlign: "left", color: "var(--text-dim)" }}>为什么不用短距离</td>
                <td className="num" style={{ textAlign: "left", whiteSpace: "normal" }}>
                  训练里的「最快 1 公里/5 公里」通常只是间歇课的一组，跑完还有余力，
                  拿它当锚点会系统性低估你的短距离能力。所以短距离锚点只给 C 级权重。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">锚点明细：每个距离的最佳连续成绩</h3>
        <p className="card-sub">
          必须是在<strong>同一次训练内连续</strong>跑出来的。间歇组之间不会拼接，
          所以不会出现「10 组 ×1km 被当成 10 公里成绩」这种假锚点。
        </p>
        <table>
          <thead>
            <tr><th>目标距离</th><th>实际跑出</th><th>用时</th><th>配速</th><th>平均心率</th><th>日期</th><th>当日负荷</th><th>候选数</th><th>层级</th></tr>
          </thead>
          <tbody>
            {d.anchors.map((e) => {
              const tier = e.targetKm >= 15 ? "A" : e.targetKm >= 8 ? "B" : "C";
              return (
                <tr key={e.targetKm}>
                  <td>
                    {e.targetKm >= 42.195 ? "全程马拉松" : e.targetKm >= 21.0975 ? "半程马拉松" : `${e.targetKm} km`}
                  </td>
                  <td className="num">{e.actualKm.toFixed(2)} km</td>
                  <td className="num">{fmtT(e.seconds)}</td>
                  <td className="num">{fmtP(e.paceSec)}</td>
                  <td className="num">{e.avgHr.toFixed(0)}</td>
                  <td style={{ color: "var(--text-faint)" }}>{e.date}</td>
                  <td className="num" style={{ color: "var(--text-faint)" }}>{e.loadThatDay ?? "—"}</td>
                  <td className="num" style={{ color: "var(--text-faint)" }}>{d.candidateCounts[String(e.targetKm)] ?? 1}</td>
                  <td><span className="pill" style={{ color: TIER_DESC[tier].color }}>{tier}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
