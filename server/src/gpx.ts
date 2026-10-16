/**
 * GPX 轨迹解析 —— 从 GPX 文件里取路线与**实测海拔**。
 *
 * 为什么 GPX 比 DEM 靠谱：
 *  GPX 是 GPS 记录时写下的原始轨迹，每个点自带 <ele>（当时的气压/海拔），
 *  分辨率是「一个点几米」，而公开 DEM 是 30m 栅格。
 *  换句话说 GPX 能看见真实路面的缓坡，DEM 看不见。
 *
 * 唯一的坑是 GPS 的海拔也有误差（通常 ±5-10m），所以：
 *  - 计算累计爬升时必须做**阈值滤波**，否则噪声会被累加成假爬升
 *    （1m 噪声 × 2000 个点 = 虚增几百米，这是实测踩过的坑）
 *  - 平滑窗口取 5-9 个点，滤掉单点抖动但保留真实坡度
 */

/** GPX 解析结果 */
export type GpxTrack = {
  points: { lat: number; lon: number; ele: number; time?: string }[];
  /** 从 GPX 直接累加的爬升（已做阈值滤波） */
  gainM: number;
  lossM: number;
  eleMin: number;
  eleMax: number;
  /** 累计距离（米），按 haversine 逐段累加 */
  distanceM: number;
  /** 采样点间隔（米）的中位数，用来判断是否需要抽稀 */
  sampleSpacingM: number;
};

const EARTH_R = 6371000;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/**
 * 累计爬升的阈值滤波。
 *
 * 阈值取 0.5m：小于这个的高差认定为 GPS 噪声，不计入爬升。
 * 代价是丢掉极短的微起伏（±0.5m 级别的），但那些本来就没有训练意义。
 */
export function accumulateElevation(
  eles: number[],
  threshold = 0.5,
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let anchor = eles[0] ?? 0;
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - anchor;
    if (d >= threshold) {
      gain += d;
      anchor = eles[i];
    } else if (d <= -threshold) {
      loss += -d;
      anchor = eles[i];
    }
  }
  return { gain, loss };
}

/** 滑动平均平滑，窗口为奇数 */
export function smooth(values: number[], window = 7): number[] {
  if (window <= 1 || values.length < window) return values;
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    out.push(sum / (hi - lo + 1));
  }
  return out;
}

/**
 * 解析 GPX 文本。
 *
 * 不引第三方 XML 库：GPX 的 trackpoint 结构很规整，
 * 用正则抽 <trkpt lat lon> 和它内部的 <ele>/<time> 就够，
 * 少一个依赖，也不用处理命名空间（GPX 2.0/1.0 字段名是一样的）。
 */
export function parseGpx(xml: string): GpxTrack | null {
  const pts: { lat: number; lon: number; ele: number; time?: string }[] = [];

  const re = /<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>([\s\S]*?)(?=<trkpt|<\/trk>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const body = m[3];
    const ele = Number(body.match(/<ele>([-\d.]+)<\/ele>/)?.[1]);
    const time = body.match(/<time>(.*?)<\/time>/)?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(ele)) continue;
    pts.push({ lat, lon, ele, time });
  }

  // 有些 GPX 只含 <rtept>（路线而非轨迹），一并接受
  if (pts.length === 0) {
    const re2 = /<rtept\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>([\s\S]*?)(?=<rtept|<\/rte>|$)/g;
    while ((m = re2.exec(xml)) !== null) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      const ele = Number(m[3].match(/<ele>([-\d.]+)<\/ele>/)?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(ele)) continue;
      pts.push({ lat, lon, ele, time: m[3].match(/<time>(.*?)<\/time>/)?.[1] });
    }
  }

  if (pts.length < 2) return null;

  const eles = pts.map((p) => p.ele);
  const smoothed = smooth(eles, 7);
  const { gain, loss } = accumulateElevation(smoothed, 0.5);

  // 逐段距离
  let dist = 0;
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    dist += d;
    if (d > 0.5 && d < 500) gaps.push(d);
  }
  gaps.sort((a, b) => a - b);

  return {
    points: pts,
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    eleMin: Math.min(...eles),
    eleMax: Math.max(...eles),
    distanceM: Math.round(dist),
    sampleSpacingM: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : 0,
  };
}

/**
 * 按等距离抽稀，保留爬升形态的同时把点数压到可管理规模。
 * 画剖面图不需要每米一个点 —— 每 50m 一个足够还原坡度。
 */
export function downsample(track: GpxTrack, targetCount = 900): GpxTrack {
  if (track.points.length <= targetCount) return track;

  const step = track.points.length / targetCount;
  const picked: GpxTrack["points"] = [];
  for (let i = 0; i < targetCount; i++) {
    picked.push(track.points[Math.floor(i * step)]);
  }
  // 保证终点被保留，否则剖面图会在终点前截断
  const last = track.points[track.points.length - 1];
  if (picked[picked.length - 1] !== last) picked.push(last);

  const eles = picked.map((p) => p.ele);
  const { gain, loss } = accumulateElevation(smooth(eles, 5), 0.5);

  let dist = 0;
  for (let i = 1; i < picked.length; i++) {
    dist += haversineM(picked[i - 1].lat, picked[i - 1].lon, picked[i].lat, picked[i].lon);
  }

  return {
    ...track,
    points: picked,
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    eleMin: Math.min(...eles),
    eleMax: Math.max(...eles),
    distanceM: Math.round(dist),
  };
}