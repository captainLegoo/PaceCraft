import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDur, fmtPace } from "../charts";
import { IconGauge, IconHeart, IconTrophy } from "../icons";

export default function Fitness() {
  const [f, setF] = useState<any>(null);
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.fitness().then((r) => r.latest).catch(() => null),
      api.prediction().catch(() => null),
    ])
      .then(([fitLatest, predReport]) => {
        setF(fitLatest);
        setP(predReport);
      })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="banner error">{err}</div>;
  if (!f && !p) return <div className="empty">加载中…</div>;

  // 全马预测配速
  const marPredSec = p?.predictions?.find((item: any) => item.distanceKm > 42)?.seconds ?? f?.predMarathonSec;
  const marPace = marPredSec ? marPredSec / 42.195 : null;

  // 阈值配速与心率
  const thresholdPace = p?.threshold?.paceSec ?? f?.thresholdPaceSec;
  const thresholdPct = thresholdPace && marPace ? (marPace / thresholdPace) * 100 : null;
  const thresholdHr = p?.threshold?.hr ? Math.round(p.threshold.hr) : null;

  const distTargets = [
    { name: "5 公里", km: 5 },
    { name: "10 公里", km: 10 },
    { name: "半程马拉松", km: 21.0975 },
    { name: "全程马拉松", km: 42.195 },
  ];

  const preds = distTargets.map((d) => {
    const mine = p?.predictions?.find((item: any) => Math.abs(item.distanceKm - d.km) < 0.2);
    let defaultSec: number | null = null;
    if (d.km === 5) defaultSec = f?.pred5kSec ?? null;
    else if (d.km === 10) defaultSec = f?.pred10kSec ?? null;
    else if (d.km === 21.0975) defaultSec = f?.predHalfSec ?? null;
    else if (d.km === 42.195) defaultSec = f?.predMarathonSec ?? null;

    const sec = mine?.seconds ?? defaultSec;
    return {
      name: d.name,
      km: d.km,
      sec,
      paceSec: sec ? sec / d.km : null,
      low: mine?.low,
      high: mine?.high,
      confidence: mine?.confidence,
      confidenceNote: mine?.confidenceNote,
    };
  });

  // 备战配速区间
  const zones = marPace
    ? [
        { label: "马拉松目标配速 (MP)", sec: marPace, note: "比赛日目标巡航强度，长距离配速跑核心区间", color: "var(--accent)" },
        { label: "半马强度 (HMP)", sec: marPace * 0.95, note: "节奏跑用，比 MP 略快 5–8 秒，增强乳酸耐受", color: "var(--z2)" },
        { label: "乳酸阈值配速 (T)", sec: thresholdPace ?? marPace * 0.92, note: "无氧阈值临界点，约等于 30~60 分钟全力比赛强度", color: "var(--warn)" },
        { label: "轻松跑区间 (E)", sec: (thresholdPace ?? marPace) * 1.18, note: "有氧基础与恢复跑，心率在 Z1-Z2，能顺畅说话", color: "var(--hr)" },
      ]
    : [];

  return (
    <>
      {/* 核心体能概览卡片 */}
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconGauge size={15} />乳酸阈值配速</span>
            <span className="value num" style={{ color: "var(--accent)" }}>
              {fmtPace(thresholdPace)}<span className="unit">/km</span>
            </span>
            <span className="hint">
              {thresholdHr ? `阈值心率约 ${thresholdHr} bpm` : "基于实际训练数据稳健回归"}
              {thresholdPct != null && ` · 全马目标配速慢 ${Math.round(thresholdPct - 100)}%`}
            </span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconHeart size={15} />VO₂max</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="value num">{f?.vo2max ?? "—"}</span>
              {f?.runningLevel && (
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  跑步等级 <strong style={{ color: "var(--strong)" }}>{f.runningLevel}</strong>
                </span>
              )}
            </div>
            <span className="hint">最大有氧摄氧能力评估</span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconTrophy size={15} />最长实测实战锚点</span>
            <span className="value num">
              {p?.longestActual ? `${p.longestActual.km} km` : "—"}
            </span>
            <span className="hint">
              {p?.longestActual
                ? `${p.longestActual.date} 完成 · 均速 ${fmtPace(p.longestActual.paceSec)}/km (${fmtDur(p.longestActual.sec)})`
                : "基于历史最长连续长距离训练"}
            </span>
          </div>
        </div>
      </div>

      {/* 比赛成绩预测卡片组 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>比赛成绩预测</h3>
          <p className="card-sub" style={{ margin: "4px 0 0" }}>
            基于你的全部实际跑步记录，提取最佳连续成绩段（Best Efforts）并结合 Riegel 幂律有氧模型综合推算：
          </p>
        </div>

        <div className="grid g4">
          {preds.map((item) => (
            <div className="stat" key={item.name} style={{ background: "var(--surface-2)", padding: "12px 14px", borderRadius: 8 }}>
              <span className="label" style={{ color: "var(--strong)", fontWeight: 600 }}>{item.name}</span>
              <span className="value num" style={{ fontSize: 24, color: "var(--accent)", margin: "4px 0" }}>
                {fmtDur(item.sec)}
              </span>
              <span className="hint" style={{ fontSize: 12 }}>
                目标配速 <strong>{fmtPace(item.paceSec)}</strong> /km
              </span>
              {item.low && item.high && (
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                  参考区间: {fmtDur(item.low)} ~ {fmtDur(item.high)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 成绩预测与配速参考明细表 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ marginBottom: 10 }}>
          <h3 className="card-title" style={{ margin: 0 }}>成绩预测与配速参考明细</h3>
          <p className="card-sub" style={{ margin: "4px 0 0" }}>
            各项目完赛时间预期与等效比赛配速，适合作为比赛配速制定与训练目标参考：
          </p>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>比赛项目</th>
                <th style={{ color: "var(--accent)" }}>预测完赛时间</th>
                <th>建议比赛配速</th>
                <th>表现参考区间</th>
                <th>推算依据</th>
              </tr>
            </thead>
            <tbody>
              {preds.map((item) => (
                <tr key={item.name}>
                  <td style={{ fontWeight: 600 }}>{item.name}</td>
                  <td className="num">
                    <strong style={{ color: "var(--accent)", fontSize: 16 }}>{fmtDur(item.sec)}</strong>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmtPace(item.paceSec)} /km
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
                    {item.low && item.high ? `${fmtDur(item.low)} ~ ${fmtDur(item.high)}` : "—"}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {item.confidenceNote ? item.confidenceNote.slice(0, 48) + "..." : "历史训练段最佳表现回归"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 备赛配速区间建议 */}
      {zones.length > 0 && (
        <div className="card">
          <h3 className="card-title">备赛配速区间建议</h3>
          <p className="card-sub">
            以全马预测配速 <strong style={{ color: "var(--accent)" }}>{fmtPace(marPace)}/km</strong> 与乳酸阈值配速为基准推算的训练强度带：
          </p>
          <div style={{ maxHeight: 400, overflowY: "auto", marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>训练类型</th>
                  <th>配速区间</th>
                  <th>训练目的与生理刺激</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.label}>
                    <td>
                      <span className="pill" style={{ color: z.color, borderColor: "var(--border-strong)" }}>
                        {z.label}
                      </span>
                    </td>
                    <td className="num" style={{ color: z.color, fontWeight: 600, fontSize: 14 }}>
                      {fmtPace(z.sec)} /km
                    </td>
                    <td style={{ textAlign: "left", color: "var(--text-dim)", fontSize: 12.5 }}>
                      {z.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
