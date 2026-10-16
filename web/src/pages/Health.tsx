import { useEffect, useState } from "react";
import { api } from "../api";
import { LineChart, fmtDur } from "../charts";
import { IconHeart, IconMoon, IconPulse, IconRecovery } from "../icons";

export default function Health() {
  const [d, setD] = useState<any>(null);
  const [recovery, setRecovery] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.health(60), api.recovery()])
      .then(([h, r]) => { setD(h); setRecovery(r.latest); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="banner error">{err}</div>;
  if (!d) return <div><div className="skeleton skeleton-hero" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /><div className="skeleton skeleton-row" /></div>;

  const { health, hr, stress, sleep } = d;
  const sleepAvailable = sleep.filter((s: any) => Number(s.available) === 1 && Number(s.score) > 0);
  const sleepMissing = sleep.length - sleepAvailable.length;
  const latest = health[health.length - 1];

  // 静息心率只有一个当前值（queryDailyHealthData 头部），不是序列
  const restingHr = latest?.restingHr ?? null;
  const hrv = latest?.hrvBaseline ?? null;

  const dates = health.map((h: any) => h.dateLabel);
  const stressByDate = new Map(stress.map((s: any) => [s.date, s]));
  const hrByDate = new Map(hr.map((h: any) => [h.date, h]));

  return (
    <>
      {sleepMissing > sleepAvailable.length && (
        <div className="banner warn">
          近 {sleep.length} 天里有 <strong>{sleepMissing}</strong> 天没有睡眠数据。
          原因是手表没有在夜间佩戴记录 —— COROS 的静息心率序列、睡眠 HRV、压力分区也全部返回 No data。
          <br />
          连续戴表睡觉 3–5 天后重新同步，这几项会自动出现。
        </div>
      )}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconRecovery size={15} />当前恢复度</span>
            <span className="value num" style={{ color: recovery?.recoveryPct >= 70 ? "var(--good)" : recovery?.recoveryPct >= 40 ? "var(--warn)" : "var(--bad)" }}>
              {recovery?.recoveryPct ?? "—"}<span className="unit">%</span>
            </span>
            <span className="hint">{recovery?.level ?? "—"}</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconHeart size={15} />静息心率</span>
            <span className="value num">{restingHr ?? "—"}<span className="unit">bpm</span></span>
            <span className="hint">仅当前值，官方未提供历史序列</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconPulse size={15} />HRV 基线</span>
            <span className="value num">{hrv ?? "—"}<span className="unit">ms</span></span>
            <span className="hint">同上，仅当前值</span>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat">
            <span className="label"><IconMoon size={15} />昨日睡眠评分</span>
            <span className="value num">{sleepAvailable.length ? (sleepAvailable.length ? sleepAvailable[sleepAvailable.length - 1].score : "—") : "—"}</span>
            <span className="hint">{sleepAvailable.length} / {sleep.length} 天有数据</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">每日压力</h3>
        <p className="card-sub">日均压力值，背景带为 60–80 的中等区间</p>
        <LineChart
          labels={stress.map((s: any) => s.date)}
          series={[{ key: "s", label: "日均压力", color: "var(--chart-warn)", values: stress.map((s: any) => s.avgStress) }]}
          bands={[{ from: 60, to: 80, color: "var(--chart-good)" }]}
          height={180}
          yFmt={(n) => String(Math.round(n))}
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 className="card-title">全天心率范围</h3>
        <p className="card-sub">来自 queryAvgHeartRate，含当日最低与最高心率</p>
        <LineChart
          labels={hr.map((h: any) => h.date)}
          series={[
            { key: "max", label: "最高心率", color: "var(--chart-bad)", values: hr.map((h: any) => h.maxHr) },
            { key: "avg", label: "平均心率", color: "var(--chart-hr)", values: hr.map((h: any) => h.avgHr) },
            { key: "min", label: "最低心率", color: "var(--chart-z2)", values: hr.map((h: any) => h.minHr) },
          ]}
          height={210}
          yFmt={(n) => String(Math.round(n))}
        />
      </div>

      <div className="grid g2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title">日常步数</h3>
          <p className="card-sub">训练日之外的活动量</p>
          <LineChart
            labels={dates}
            series={[{ key: "steps", label: "步数", color: "var(--chart-accent)", values: health.map((h: any) => h.steps) }]}
            height={170}
            yFmt={(n) => (n >= 1000 ? (n / 1000).toFixed(0) + "k" : String(Math.round(n)))}
          />
        </div>
        <div className="card">
          <h3 className="card-title">运动时长</h3>
          <p className="card-sub">COROS 记录的当日运动分钟数</p>
          <LineChart
            labels={dates}
            series={[{ key: "ex", label: "运动分钟", color: "var(--chart-z2)", values: health.map((h: any) => h.exerciseMin) }]}
            height={170}
            yFmt={(n) => String(Math.round(n))}
          />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">睡眠数据明细</h3>
        <p className="card-sub">
          COROS 记录睡眠时以「醒来那天」为日期。未佩戴的日期会显示为无数据。
        </p>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          <table>
            <thead><tr><th>日期</th><th>睡眠评分</th><th>状态</th></tr></thead>
            <tbody>
              {[...sleep].reverse().map((s: any) => (
                <tr key={s.date}>
                  <td>{s.date}</td>
                  <td className="num">{Number(s.available) && Number(s.score) > 0 ? s.score : "—"}</td>
                  <td>
                    {Number(s.available) && Number(s.score) > 0
                      ? <span className="pill good">有记录</span>
                      : <span className="pill">未佩戴</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
