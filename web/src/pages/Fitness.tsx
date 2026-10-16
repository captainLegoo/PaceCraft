import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDur, fmtPace } from "../charts";
import { IconGauge, IconHeart, IconTrophy } from "../icons";

export default function Fitness() {
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.fitness().then((r) => setF(r.latest)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="banner error">{err}</div>;
  if (!f) return <div className="empty">加载中…</div>;

  // 目标配速：以全马预测配速为基准
  const marPace = f.predMarathonSec ? f.predMarathonSec / 42.195 : null;
  const thresholdPace = f.thresholdPaceSec;
  const thresholdPct = thresholdPace && marPace ? (marPace / thresholdPace) * 100 : null;

  const preds = [
    { name: "5 公里", sec: f.pred5kSec, km: 5 },
    { name: "10 公里", sec: f.pred10kSec, km: 10 },
    { name: "半程马拉松", sec: f.predHalfSec, km: 21.0975 },
    { name: "全程马拉松", sec: f.predMarathonSec, km: 42.195 },
  ];

  // 备赛配速建议：全马目标配速的三个训练区间
  const zones = marPace
    ? [
        { label: "马拉松目标配速", sec: marPace, note: "比赛日目标强度", color: "var(--accent)" },
        { label: "半马强度", sec: marPace * 0.95, note: "马拉松配速跑训练用，比 MP 略快 3–5 秒", color: "var(--z2)" },
        { label: "阈值配速", sec: thresholdPace ?? marPace * 0.92, note: "乳酸阈值，约等于 30 分钟比赛强度", color: "var(--warn)" },
        { label: "轻松跑", sec: (thresholdPace ?? marPace) * 1.18, note: "恢复性跑量，能正常说话", color: "var(--hr)" },
      ]
    : [];

  return (
    <>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconHeart size={15} />VO₂max</span>
            <span className="value num" style={{ color: "var(--accent)" }}>{f.vo2max ?? "—"}</span>
            <span className="hint">COROS 综合评估</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconTrophy size={15} />跑步等级</span>
            <span className="value num">{f.runningLevel ?? "—"}</span>
            <span className="hint">同年龄人群中的相对水平</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconGauge size={15} />阈值配速</span>
            <span className="value num">{fmtPace(f.thresholdPaceSec)}<span className="unit">/km</span></span>
            <span className="hint">
              {thresholdPct != null &&
                `全马目标配速比阈值配速慢 ${Math.round(thresholdPct - 100)}%`}
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">成绩预测</h3>
        <p className="card-sub">
          <strong style={{ color: "var(--text-dim)" }}>COROS 官方模型</strong>，只吃当前
          VO₂max 与阈值配速。备赛页和赛事页显示的是自建预测（锚定你的真实比赛成绩），
          口径不同、数值会有几分钟差异，以自建预测为准。
        </p>
        <div className="grid g4">
          {preds.map((p) => (
            <div className="stat" key={p.name}>
              <span className="label">{p.name}</span>
              <span className="value num" style={{ fontSize: 22 }}>{fmtDur(p.sec)}</span>
              <span className="hint">等效配速 {fmtPace(p.sec ? p.sec / p.km : null)} /km</span>
            </div>
          ))}
        </div>
      </div>

      {zones.length > 0 && (
        <div className="card">
          <h3 className="card-title">备赛配速区间</h3>
          <p className="card-sub">
            以全马预测配速 <strong style={{ color: "var(--accent)" }}>{fmtPace(marPace)}/km</strong> 为基准推算的训练强度带。
            备赛时把不同训练放进不同区间，比「每天都跑一样快」更有效。
          </p>
          <div style={{ maxHeight: 400, overflowY: "auto", marginTop: 10 }}>
            <table>
              <thead><tr><th>训练类型</th><th>配速</th><th>说明</th></tr></thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.label}>
                    <td>
                      <span className="pill" style={{ color: z.color, borderColor: "var(--border-strong)" }}>
                        {z.label}
                      </span>
                    </td>
                    <td className="num" style={{ color: z.color, fontWeight: 600 }}>{fmtPace(z.sec)} /km</td>
                    <td style={{ textAlign: "left", color: "var(--text-dim)" }}>{z.note}</td>
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
