import { useMemo } from "react";
import type { RaceDetail, RouteSegment } from "../api";

const fmtP = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const fmtDur = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * 爬升剖面图。
 *
 * 数据来源决定画法：
 *  - GPX：直接用采样点（几百个），能看出真实坡度
 *  - 路书 DEM：只有插值路点，画出来的坡很平缓，**必须标注这是估算**
 *
 * 这一点很重要：把 DEM 估算画成和 GPX 一样的图，会让人误以为
 * 这条赛道就是连续的缓坡，而实际上 DEM 看不见路面微起伏。
 */
function ElevationChart({ d }: { d: RaceDetail }) {
  const p = d.profile;
  const isGpx = p?.source === "gpx" && !!p.profile?.length;
  /** dem=实测，city=降级估算。标注必须与底部的 caveat 一致 */
  const isEstimated = !isGpx && p?.altitudeBasis !== "dem";

  // 路书来源时用分段的净变化重建一条粗曲线
  const series = useMemo(() => {
    if (!p) return [];
    if (isGpx) return p.profile!.map((x) => ({ d: x.distKm, e: x.ele }));
    // 分段累计
    const out: { d: number; e: number }[] = [{ d: 0, e: p.altMin ?? 0 }];
    let acc = 0;
    for (const s of p.segments ?? []) {
      acc += s.distanceM / 1000;
      out.push({ d: acc, e: s.altTo });
    }
    return out;
  }, [p, isGpx]);

  if (series.length < 2) return null;

  const W = 720;
  const H = 130;
  const PAD = { l: 34, r: 8, t: 10, b: 20 };
  const totalKm = d.race.distanceKm;
  const es = series.map((s) => s.e);
  const lo = Math.min(...es);
  const hi = Math.max(...es);
  /** 高差全平时给个最小跨度，否则 y 坐标会除以 0 变成 NaN */
  const span = Math.max(hi - lo, 4);

  /*
   * X 轴缩放基准的选择很关键：
   * 路书路点是用直线插值算的，遇到折返段（去+回）只会算一次，
   * 所以累加出来的距离一定小于官方距离（实测某场只有 29km vs 官方 42.195km）。
   *
   * 如果 X 轴按官方距离缩放，曲线画到 ~29km 就结束了，
   * 后面 13km 会留下一段空白，填充区还会斜落下去 —— 那不是地形，是 bug。
   *
   * 所以这里必须按**路书实际累加出来的距离**缩放，
   * 让曲线铺满整个宽度；X 轴刻度标签仍按官方赛段距离标注，
   * 并明确提示"剖面来自路书推算，非赛道实测分段"。
   */
  const seriesKm = Math.max(...series.map((s) => s.d));
  const x = (km: number) => PAD.l + (km / seriesKm) * (W - PAD.l - PAD.r);
  const y = (e: number) => PAD.t + (1 - (e - lo) / span) * (H - PAD.t - PAD.b);

  const path = series.map((s, i) => `${i === 0 ? "M" : "L"}${x(s.d).toFixed(1)},${y(s.e).toFixed(1)}`).join(" ");

  // 刻度也按路书实际距离铺，标签换成官方赛段距离
  const tickCount = Math.floor(seriesKm / 10);
  const ticks: { x: number; label: string }[] = [];
  for (let k = 1; k <= tickCount; k++) {
    ticks.push({ x: x(k * 10), label: `${(k * 10 * totalKm / seriesKm).toFixed(0)}K` });
  }
  const scaleNote =
    seriesKm < totalKm * 0.9
      ? `（X 轴已按路书推算的 ${seriesKm.toFixed(0)}km 缩放显示，刻度标签换算为官方赛段距离）`
      : "";

  return (
    <div style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* 刻度 */}
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} y1={PAD.t} x2={t.x} y2={H - PAD.b} stroke="var(--border)" strokeWidth="1" />
            <text x={t.x} y={H - 6} fontSize="10" fill="var(--text-faint)" textAnchor="middle">{t.label}</text>
          </g>
        ))}
        <text x={4} y={PAD.t + 4} fontSize="9.5" fill="var(--text-faint)">{Math.round(hi)}m</text>
        <text x={4} y={H - PAD.b} fontSize="9.5" fill="var(--text-faint)">{Math.round(lo)}m</text>

        {/* 高程线下方填充 */}
        <path
          d={`${path} L${x(seriesKm)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`}
          fill="var(--chart-accent)"
          opacity="0.12"
        />
        <path d={path} fill="none" stroke="var(--chart-accent)" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <div className="hint" style={{ marginTop: 6 }}>
        {isGpx
          ? "曲线来自 GPX 实测轨迹，可信度高。"
          : isEstimated
            ? `曲线由${d.race.city ?? "该城市"}基准海拔加路名地形词推断，**非实测**。${scaleNote}`
            : `曲线来自 30m DEM 路点插值 —— 分辨率粗，看不到路面微起伏，仅供整体趋势参考。${scaleNote}`}
      </div>
    </div>
  );
}

function Segments({ segs }: { segs: RouteSegment[] }) {
  const notable = segs.filter((s) => Math.abs(s.netChange) >= 5);
  if (notable.length === 0) return null;
  return (
    <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
      <table>
        <thead>
          <tr><th>路段</th><th>距离</th><th>高程</th><th>变化</th><th>坡度</th></tr>
        </thead>
        <tbody>
          {notable.map((s, i) => (
            <tr key={i}>
              <td style={{ textAlign: "left", fontSize: 11.5 }}>{s.from} → {s.to}</td>
              <td className="num">{(s.distanceM / 1000).toFixed(1)}km</td>
              <td className="num">{s.altFrom} → {s.altTo}m</td>
              <td className="num" style={{ color: s.netChange > 0 ? "var(--warn)" : "var(--z2)", fontWeight: 600 }}>
                {s.netChange > 0 ? "↑" : "↓"} {Math.abs(s.netChange)}m
              </td>
              <td className="num">{s.gradePct > 0 ? "+" : ""}{s.gradePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 路线画像卡片 —— 有路线就画剖面，没路线就说明缺什么 */
export default function RouteProfileCard({ d }: { d: RaceDetail }) {
  const p = d.profile;
  const isGpx = p?.source === "gpx";
  /** dem=实测，city=降级估算。标注必须与底部的 caveat 一致，不能各说各话 */
  const isEstimated = !isGpx && p?.altitudeBasis !== "dem";

  if (!p) {
    return (
      <div className="banner warn" style={{ marginTop: 12 }}>
        <strong>路线画像暂不可用</strong>
        <div style={{ marginTop: 4 }}>{d.missingRoute ?? "尚未设置路线"}</div>
        <div style={{ marginTop: 8, fontSize: 12 }}>
          可行做法：上传 GPX（Strava / 高驰 / Garmin 导出）—— GPX 自带实测海拔，
          不依赖在线高程接口，是最可靠的来源。
        </div>
      </div>
    );
  }

  const gain = p.gainM;
  const perKm = p.gainPerKm;
  const eleLo = p.eleMin ?? p.altMin ?? 0;
  const eleHi = p.eleMax ?? p.altMax ?? 0;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="label">估算爬升</span>
          <span className="value num" style={{ color: "var(--warn)" }}>{gain}<span className="unit">m</span></span>
          <span className="hint">{isGpx ? "GPX 实测" : isEstimated ? "城市基准估算" : "DEM 估算"}</span>
        </div>
        <div className="stat">
          <span className="label">爬升率</span>
          <span className="value num">{perKm}<span className="unit">m/km</span></span>
          <span className="hint">{perKm < 3 ? "极平缓" : perKm < 8 ? "轻微起伏" : perKm < 15 ? "有实质爬升" : "越野级"}</span>
        </div>
        <div className="stat">
          <span className="label">累计下降</span>
          <span className="value num" style={{ color: "var(--z2)" }}>{p.lossM}<span className="unit">m</span></span>
          <span className="hint">净变化 {p.netChange >= 0 ? "+" : ""}{p.netChange}m</span>
        </div>
        <div className="stat">
          <span className="label">高程范围</span>
          <span className="value num" style={{ fontSize: 20 }}>{Math.round(eleLo)}–{Math.round(eleHi)}<span className="unit">m</span></span>
          <span className="hint">{d.race.city ?? "—"}</span>
        </div>
      </div>

      <div className="banner info" style={{ padding: "8px 11px" }}>
        {p.verdict}
        {d.plan && (
          <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
            目标 <strong>{d.plan.targetLabel}</strong> → 全程配速 <strong>{fmtP(d.plan.fullPaceSec)}/km</strong>
            （地形折算 {d.plan.costSecPerKm} s/km；半程 {fmtP(d.plan.halfPaceSec)}/km）
          </div>
        )}
      </div>

      <ElevationChart d={d} />

      {p.segments && p.segments.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 4px", fontSize: 13, color: "var(--text-dim)" }}>
            明显起伏路段（±5m 以上）
          </h4>
          <Segments segs={p.segments} />
        </>
      )}

      <div className="hint" style={{ marginTop: 10 }}>
        {p.caveat}
      </div>
    </div>
  );
}