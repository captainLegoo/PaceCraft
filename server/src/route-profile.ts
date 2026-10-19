/**
 * 赛事路线爬升分析 —— 从路线关键点 + DEM 高程数据推算全程爬升。
 *
 * 为什么需要：
 *  比赛路线决定了配速策略。如果一条赛道有 150m 爬升，配速必须比平路保守；
 *  但赛事官网通常只给「经过哪些道路」，不给累计爬升。
 *  所以这里用「路线关键点 → DEM 高程 → 累加」的思路自己算一遍。
 *
 * 口径说明（很重要，别过度解读）：
 *  - Open-Elevation 用的是 SRTM/Copernicus 30m 级 DEM。
 *    30m 分辨率**看不到真实路面起伏**：一个 20m 长的缓坡在数据里可能是平的。
 *  - 所以算出来的爬升是**趋势值，不是精确值**，误差可能 ±50%。
 *  - 但对「这条赛道值不值得担心爬升」这个问题，趋势值足够用了。
 *
 * 已知案例（某平原城市的全程马拉松）：
 *  全程 42.195km，估算爬升约 100m，爬升率 2.4 m/km —— 属于极平缓赛道。
 */

import { fmtPace } from "./format.ts";

export type RoutePoint = {
  /** 地标名，用于可读的段落说明 */
  name: string;
  lat: number;
  lon: number;
};

export type RouteSegment = {
  from: string;
  to: string;
  /** 水平距离（米） */
  distanceM: number;
  /** 起点高程（m） */
  altFrom: number;
  /** 终点高程（m） */
  altTo: number;
  /** 净变化（m），正为上坡 */
  netChange: number;
  /** 坡度（%） */
  gradePct: number;
};

export type RouteProfile = {
  name: string;
  /** 官方公布的赛段距离（km）。配速换算必须用这个，不能用路书推算值。 */
  totalDistanceKm: number;
  /**
   * 路书关键点的直线距离（km）。
   * 一定小于真实距离 —— 因为折返段是往返的，直线插值只算了一次。
   * 只用于校验爬升估算的合理性，不用于配速换算。
   */
  waypointDistanceKm: number;
  /** 估算累计爬升（m） */
  gainM: number;
  /** 估算累计下降（m） */
  lossM: number;
  /** 爬升率（m/km），已按官方距离归一化 */
  gainPerKm: number;
  altMin: number;
  altMax: number;
  /** 起点→终点的净高程变化 */
  netChange: number;
  segments: RouteSegment[];
  /** 给人的一句话判断 */
  verdict: string;
  /** 数据可信度提示 */
  caveat: string;
};

const EARTH_R = 6371000;

/** 两点间大圆距离（米） */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/**
 * 从「关键点 + 高程」算出完整爬升画像。
 *
 * @param points 路线关键点（含中间插值点，插值点用来提高累计爬升的分辨率）
 * @param altitudes 与 points 等长的高程数组（米）
 * @param officialDistanceKm 官方公布的赛段距离。**必须传**：
 *   路书关键点是直线插值，遇到折返段（去+回）会严重低估真实距离，
 *   用它算配速会得出离谱的结果。
 */
export function buildRouteProfile(
  raceName: string,
  points: RoutePoint[],
  altitudes: number[],
  officialDistanceKm: number,
): RouteProfile {
  if (points.length < 2 || points.length !== altitudes.length) {
    throw new Error("路线点与高程数量不匹配");
  }

  const segments: RouteSegment[] = [];
  let gain = 0;
  let loss = 0;
  let totalM = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    const net = altitudes[i] - altitudes[i - 1];
    totalM += d;
    if (net > 0) gain += net;
    else loss -= net;

    segments.push({
      from: a.name,
      to: b.name,
      distanceM: Math.round(d),
      altFrom: Math.round(altitudes[i - 1]),
      altTo: Math.round(altitudes[i]),
      netChange: Math.round(net),
      gradePct: d > 0 ? Number(((net / d) * 100).toFixed(2)) : 0,
    });
  }

  const km = officialDistanceKm;
  const gainPerKm = km > 0 ? gain / km : 0;

  return {
    name: raceName,
    totalDistanceKm: Number(km.toFixed(2)),
    waypointDistanceKm: Number((totalM / 1000).toFixed(1)),
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    gainPerKm: Number(gainPerKm.toFixed(1)),
    altMin: Math.round(Math.min(...altitudes)),
    altMax: Math.round(Math.max(...altitudes)),
    netChange: Math.round(altitudes[altitudes.length - 1] - altitudes[0]),
    segments,
    verdict: verdictFor(gainPerKm),
    caveat:
      "基于 30m 级 DEM 高程数据估算，看不到真实路面微起伏，误差可达 ±50%；" +
      "比赛当天以手表实测为准。",
  };
}

/**
 * 爬升率 → 赛道定性判断。
 * 分档参考的是路跑圈的经验值：
 *  - < 3 m/km   极平缓，纯靠有氧
 *  - 3–8       轻微起伏，可以忽略
 *  - 8–15      有实质坡，影响配速策略
 *  - > 15      越野级，需要专门适应
 */
export function verdictFor(gainPerKm: number): string {
  if (gainPerKm < 3) return "极平缓赛道，几乎无爬升，配速策略与平路一致";
  if (gainPerKm < 8) return "轻微起伏，对配速影响有限，注意别一冲快了就收不回";
  if (gainPerKm < 15) return "有实质爬升，需要按坡度分段控速，避免前段透支";
  return "爬升密集，属于越野级赛道，赛前需针对性适应";
}

/** 爬升对配速的影响（秒/km），用使用者实测的爬升代价系数 */
export function climbPaceCost(gainPerKm: number, secPerMPerKm = 1.244): number {
  return Number((gainPerKm * secPerMPerKm).toFixed(1));
}

/**
 * 生成比赛配速计划建议。
 * 用爬升率反推「若要跑出目标成绩，平路段需要跑多快」。
 */
export function paceAdvice(profile: RouteProfile, targetMarathonSec: number): {
  flatEquivalentSec: number;
  costSecPerKm: number;
  note: string;
} {
  const cost = climbPaceCost(profile.gainPerKm);
  const flatPace = targetMarathonSec / profile.totalDistanceKm - cost;
  return {
    flatEquivalentSec: Math.round(flatPace),
    costSecPerKm: cost,
    note:
      `该赛道爬升率约 ${profile.gainPerKm} m/km，按实测爬升代价折算，` +
      `全程地形约让配速慢了 ${cost} s/km。` +
      `若目标是 ${Math.floor(targetMarathonSec / 3600)}:${String(Math.floor((targetMarathonSec % 3600) / 60)).padStart(2, "0")}，` +
      `平路等效配速需 ${fmtPace(flatPace)}/km。`,
  };
}
// ---------------- GPX 路线的画像 ----------------

import {
  COARSE_SPACING_M,
  ELEV_WINDOW_M,
  pickForDisplay,
  type GpxTrack,
} from "./gpx.ts";

export type GpxProfile = {
  source: "gpx";
  name: string;
  /** GPX 实测的赛段距离（km）—— 这是真值，比路书推算准 */
  distanceKm: number;
  gainM: number;
  lossM: number;
  gainPerKm: number;
  eleMin: number;
  eleMax: number;
  netChange: number;
  /** 剖面图用的采样点：每点含累计距离与海拔 */
  profile: { distKm: number; ele: number }[];
  /** 轨迹采样间隔（米）。用来判断这份文件本身够不够细 */
  sampleSpacingM: number;
  verdict: string;
  caveat: string;
};

/** 剖面图送进前端的点数。720px 宽的 SVG × 约 1.25 倍过采样 */
const PROFILE_MAX_POINTS = 900;

/**
 * 从 GPX 直接生成画像。
 *
 * 与 waypoints 路径的关键区别：这里的每个数字都来自 GPS 实测，
 * 不是 DEM 推算，所以 caveat 是「仅受 GPS 海拔误差影响（±5-10m）」，
 * 而不是 waypoints 那种「DEM 分辨率不足，误差可达 ±50%」。
 *
 * 分层：统计量（gainM / distanceKm / …）直接取自 track 的完整分辨率，
 * 只有 profile 数组走 pickForDisplay 裁出的展示序列。
 * 展示序列**不得回流到任何计算** —— 抽稀是有损的，
 * 在稀 12 倍的点上重算平滑会把真实坡度抹平（实测同一条赛道 181m → 91m）。
 */
export function buildGpxProfile(name: string, track: GpxTrack): GpxProfile {
  const km = track.distanceM / 1000;
  // 调用方（race-service）已用 usableForProfile 验过每个点都有有限高程，
  // 这里仍兜一次底：库里存的是 JSON，可能来自旧版本解析器，
  // 而 smooth/accumulate 一旦吃到 null 会静默产出 NaN 并一路带到配速建议上
  const eles = track.points.map((p) => (p.ele as number) || 0);
  const gainPerKm = km > 0 ? track.gainM / km : 0;

  // 剖面图：累计距离 + 海拔。这是**唯一**允许用展示序列的地方。
  // 段间（trkseg 边界 = 自动暂停）不累加距离 —— 那一跳是记录仪切段造成的，
  // 不是人跑出来的；算进去会让剖面横轴凭空多出几百米，赛段配速全部失真。
  const draw = pickForDisplay(track.points, PROFILE_MAX_POINTS);
  const profile: GpxProfile["profile"] = [{ distKm: 0, ele: (draw[0].ele as number) || 0 }];
  let acc = 0;
  for (let i = 1; i < draw.length; i++) {
    const prev = draw[i - 1];
    const cur = draw[i];
    if (cur.seg === prev.seg) {
      acc += haversine(prev.lat, prev.lon, cur.lat, cur.lon);
    }
    profile.push({ distKm: acc / 1000, ele: (cur.ele as number) || 0 });
  }

  // 采样过稀的文件：爬升会系统性偏低，且没有任何算法能补回来。如实说。
  const coarse =
    track.sampleSpacingM > COARSE_SPACING_M
      ? ` 但这份轨迹采样较稀（平均每点 ${track.sampleSpacingM}m），` +
        `起伏在采样点之间已经丢了，爬升很可能偏低。`
      : "";

  return {
    source: "gpx",
    name,
    distanceKm: Number(km.toFixed(2)),
    gainM: track.gainM,
    lossM: track.lossM,
    gainPerKm: Number(gainPerKm.toFixed(1)),
    eleMin: Math.round(track.eleMin),
    eleMax: Math.round(track.eleMax),
    netChange: Math.round(eles[eles.length - 1] - eles[0]),
    profile,
    sampleSpacingM: track.sampleSpacingM,
    verdict: verdictFor(gainPerKm),
    caveat:
      `海拔来自 GPS/GPX 实测（${ELEV_WINDOW_M}m 滑动窗口平滑 + 0.5m 阈值滤波），` +
      `误差主要来自 GPS 本身的 ±5-10m。${coarse}`,
  };
}

/** 按目标成绩算配速建议，两种来源共用 */
export function pacePlan(
  gainPerKm: number,
  distanceKm: number,
  targetSec: number,
): { flatPaceSec: number; costSecPerKm: number; halfSec: number } {
  const cost = climbPaceCost(gainPerKm);
  const flat = targetSec / distanceKm - cost;
  return {
    flatPaceSec: Math.round(flat),
    costSecPerKm: cost,
    halfSec: Math.round((targetSec / 2) / (distanceKm / 2) - cost),
  };
}
