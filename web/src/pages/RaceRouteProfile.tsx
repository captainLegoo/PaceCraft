import { useMemo } from "react";
import type { RaceDetail, RouteSegment } from "../api";
import { formatDuration as fmtDur, formatPace as fmtP } from "../utils/format";
import { useI18n } from "../i18n";

function formatVerdict(v: string, isZh: boolean): string {
  if (isZh) return v;
  if (v.includes("极平缓")) return "Flat course with minimal elevation change; maintain standard flat-course pacing.";
  if (v.includes("轻微起伏")) return "Slight undulations with limited impact on pacing; avoid surging too early.";
  if (v.includes("实质爬升")) return "Substantial elevation changes; split pacing by grade to avoid early burnout.";
  if (v.includes("爬升密集")) return "Dense climbs with trail-level difficulty; course-specific adaptation required.";
  return v;
}

function formatCaveat(c: string, isZh: boolean): string {
  if (isZh) return c;
  if (c.includes("DEM")) return "Estimated from 30m DEM elevation data; misses micro-undulations, error margin up to ±50%. Reliable GPX track recommended for higher accuracy.";
  if (c.includes("GPS/GPX") || c.includes("实测")) return "Elevation derived from GPS/GPX track (smoothed with 28m window + 0.5m threshold filter). Error margin primarily reflects device GPS accuracy (±5-10m).";
  return c;
}

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
  const { isZh } = useI18n();
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
      ? (isZh
        ? `（X 轴已按路书推算的 ${seriesKm.toFixed(0)}km 缩放显示，刻度标签换算为官方赛段距离）`
        : ` (X axis scaled to calculated ${seriesKm.toFixed(0)}km, converted to official race distance)`)
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
          ? (isZh ? "曲线来自 GPX 实测轨迹，可信度高。" : "Profile derived from GPX GPS track, highly reliable.")
          : isEstimated
            ? (isZh ? `曲线由${d.race.city ?? "该城市"}基准海拔加路名地形词推断，**非实测**。${scaleNote}` : `Inferred from ${d.race.city ?? "city"} baseline elevation, estimated.${scaleNote}`)
            : (isZh ? `曲线来自 30m DEM 路点插值 —— 分辨率粗，看不到路面微起伏，仅供整体趋势参考。${scaleNote}` : `Interpolated from 30m DEM elevation. Overall trend reference.${scaleNote}`)}
      </div>
    </div>
  );
}

function Segments({ segs, isZh }: { segs: RouteSegment[]; isZh: boolean }) {
  const notable = segs.filter((s) => Math.abs(s.netChange) >= 5);
  if (notable.length === 0) return null;
  return (
    <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
      <table>
        <thead>
          <tr>
            <th>{isZh ? "路段" : "Segment"}</th>
            <th>{isZh ? "距离" : "Distance"}</th>
            <th>{isZh ? "高程" : "Elevation"}</th>
            <th>{isZh ? "变化" : "Change"}</th>
            <th>{isZh ? "坡度" : "Grade"}</th>
          </tr>
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
  const { t, isZh } = useI18n();
  const p = d.profile;
  const isGpx = p?.source === "gpx";
  /** dem=实测，city=降级估算。标注必须与底部的 caveat 一致，不能各说各话 */
  const isEstimated = !isGpx && p?.altitudeBasis !== "dem";

  if (!p) {
    return (
      <div className="banner warn" style={{ marginTop: 12 }}>
        <strong>{isZh ? "路线画像暂不可用" : "Route Profile Unavailable"}</strong>
        <div style={{ marginTop: 4 }}>{d.missingRoute ?? (isZh ? "尚未设置路线" : "No course route configured")}</div>
        <div style={{ marginTop: 8, fontSize: 12 }}>
          {isZh
            ? "可行做法：上传 GPX（Strava / 高驰 / Garmin 导出）—— GPX 自带实测海拔，不依赖在线高程接口，是最可靠的来源。"
            : "Tip: Upload GPX files (exported from Strava / COROS / Garmin) which include verified elevation profiles without third-party DEM dependencies."}
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
          <span className="label">{t("race.estClimb")}</span>
          <span className="value num" style={{ color: "var(--warn)" }}>{gain}<span className="unit">m</span></span>
          <span className="hint">{isGpx ? t("race.gpxMeasured") : isEstimated ? (isZh ? "城市基准估算" : "City estimate") : (isZh ? "DEM 估算" : "DEM estimate")}</span>
        </div>
        <div className="stat">
          <span className="label">{t("race.climbRate")}</span>
          <span className="value num">{perKm}<span className="unit">m/km</span></span>
          <span className="hint">{perKm < 3 ? (isZh ? "极平缓" : "Flat") : perKm < 8 ? t("race.slightUndulation") : perKm < 15 ? (isZh ? "有实质爬升" : "Substantial climb") : (isZh ? "越野级" : "Trail grade")}</span>
        </div>
        <div className="stat">
          <span className="label">{t("race.totalDescent")}</span>
          <span className="value num" style={{ color: "var(--z2)" }}>{p.lossM}<span className="unit">m</span></span>
          <span className="hint">{t("race.netChange")} {p.netChange >= 0 ? "+" : ""}{p.netChange}m</span>
        </div>
        <div className="stat">
          <span className="label">{t("race.elevRange")}</span>
          <span className="value num" style={{ fontSize: 20 }}>{Math.round(eleLo)}–{Math.round(eleHi)}<span className="unit">m</span></span>
          <span className="hint">{d.race.city ?? "—"}</span>
        </div>
      </div>

      <div className="banner info" style={{ padding: "8px 11px" }}>
        {formatVerdict(p.verdict, isZh)}
        {d.plan && (
          <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
            {isZh ? "目标" : "Target"} <strong>{d.plan.targetLabel}</strong> → {isZh ? "全程配速" : "Target pace"}{" "}
            <strong>{fmtP(d.plan.fullPaceSec)}/km</strong>
            （{isZh ? "地形折算" : "Terrain cost"} {d.plan.costSecPerKm} s/km；{isZh ? "半程" : "Halfway"}{" "}
            {fmtP(d.plan.halfPaceSec)}/km）
          </div>
        )}
      </div>

      <ElevationChart d={d} />

      {p.segments && p.segments.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 4px", fontSize: 13, color: "var(--text-dim)" }}>
            {isZh ? "明显起伏路段（±5m 以上）" : "Notable Elevation Changes (≥ ±5m)"}
          </h4>
          <Segments segs={p.segments} isZh={isZh} />
        </>
      )}

      <div className="hint" style={{ marginTop: 10 }}>
        {formatCaveat(p.caveat, isZh)}
      </div>
    </div>
  );
}