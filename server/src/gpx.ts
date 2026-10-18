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
 *
 * 这层要伺候的是**别人导出的文件**，不只是自己设备导的那一种。
 * 各家导出器（两步路 / Strava / Garmin / 高驰 / Strava 手机版）的写法差异比想象中大：
 * 属性顺序、命名空间前缀、自闭合标签、`<ele>` 的数值形态都变过。
 * 早期版本把正则写死成 `lat` 在前且其后紧跟 `>`，结果第三方文件一个都读不出来 ——
 * 而"读不出来"对用户来说是"功能坏了"，不是"换个导出格式就好了"。
 * 所以下面一律按「先定位标签、再取属性、再读子元素」的方式解析。
 */

/** 轨迹点 */
export type GpxTrackPoint = {
  lat: number;
  lon: number;
  /**
   * 实测海拔（米）。文件里没带 `<ele>` 的点是 null。
   *
   * 为什么不用 0 顶替：0 是个**看起来很可信的假数字**，
   * 会让剖面图变成一条贴地的直线、爬升算成 0，用户还以为这条路是真平的。
   * 宁可显式说"这份文件没有高程"，也不要给一个看着对的错答案。
   */
  ele: number | null;
  time?: string;
  /**
   * 第几个 `<trkseg>`。
   * 段与段之间是**自动暂停**：记录仪暂停后会新开一段，
   * 而两段的起点可能在几百米外（甚至另一个街区）。
   * 段间那一跳如果照常累加，会凭空多出几百米甚至几公里距离。
   */
  seg: number;
};

/** GPX 解析结果 */
export type GpxTrack = {
  points: GpxTrackPoint[];
  /**
   * 这个文件是否带高程。
   *
   * false 时 gainM / lossM / eleMin / eleMax 一律是 0 ——
   * **那不表示路面是平的，只表示没数据**。调用方必须据此报错或走 DEM 回退，
   * 绝不允许把 0 当成爬升答案往下游传。
   */
  hasElevation: boolean;
  /** 从 GPX 直接累加的爬升（已做阈值滤波） */
  gainM: number;
  lossM: number;
  eleMin: number;
  eleMax: number;
  /** 累计距离（米），按 haversine 逐段累加（trkseg 之间的跳跃不计） */
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

/** 数值形态：负号、小数、科学计数都收。用循环而不是 Math.min(...arr) —— 点数上万时展开参数会爆栈 */
function minMax(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 0];
  return [lo, hi];
}

/** 坐标/高程的数值形态：[负]号 + 数字（可含小数点与指数） */
const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";

/** 解析中间态：还没算爬升的点序列 */
export type RawPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time?: string;
  seg: number;
};

/**
 * 从标签的属性串里取值。
 *
 * 不用 `<tag lat="x" lon="y">` 这种整体正则，而是先取出标签的整段属性文本再逐个找 ——
 * 因为属性顺序不固定（`<trkpt lon=.. lat=..>` 在 Garmin 导出里很常见），
 * 还可能有额外属性（两步路会加 `<TrackTypeId>` 之类）。
 */
function readAttr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*["']([^"']*)["']`));
  return m?.[1];
}

/**
 * 抽出一个标签集合里的所有点（`<trkpt>` 或 `<rtept>`）。
 *
 * 三个容易踩的点，都在下面注释里了：
 *  1. 属性顺序 / 命名空间前缀 / 多余属性 / 自闭合，都必须能吃下；
 *  2. `<wpt>`（兴趣点）**必须忽略** —— 两步路导出的 GPX 里会混进十几个
 *     地标/补给点，混进轨迹就会连出跨越大半个城市的直线；
 *  3. 正文范围要截到"下一个同类标签或段落结束"为止，否则会把后一个点的
 *     `<ele>` 算到前一个头上。
 */
function readPoints(xml: string, tag: "trkpt" | "rtept"): RawPoint[] {
  // <trkseg> 的起始位置，用来给每个点打段号
  const segStarts: number[] = [];
  const segRe = /<(?:[\w.-]+:)?trkseg\b/g;
  let sm: RegExpExecArray | null;
  while ((sm = segRe.exec(xml)) !== null) segStarts.push(sm.index);

  /** 二分：位置 pos 落在第几个 trkseg（0 = 第一个段或不在任何段内） */
  const segAt = (pos: number): number => {
    let lo = 0;
    let hi = segStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segStarts[mid] <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const openRe = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b([^>]*?)(/?)>`, "g");
  // 正文可能结束于：自己的闭合标签、段落结束、或轨迹结束
  const closeRe = new RegExp(`</(?:[\\w.-]+:)?(?:${tag}|trkseg|trk|rte)\\s*>`, "g");
  const opens: { idx: number; attrs: string; selfClosed: boolean; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) {
    opens.push({ idx: m.index, attrs: m[1], selfClosed: m[2] === "/", end: m.index + m[0].length });
  }

  const pts: RawPoint[] = [];
  for (let i = 0; i < opens.length; i++) {
    const cur = opens[i];
    const lat = Number(readAttr(cur.attrs, "lat"));
    const lon = Number(readAttr(cur.attrs, "lon"));
    // 坐标不合法就整点丢弃 —— 缺经纬度的点没法算距离，留着只会污染剖面
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let ele: number | null = null;
    let time: string | undefined;

    // 自闭合标签没有正文（也就没有高程），这是合法形态，不算错误
    if (!cur.selfClosed) {
      // 正文上限：下一个同类标签的起点（两个点之间不会有别的 trkpt）
      const limit = i + 1 < opens.length ? opens[i + 1].idx : xml.length;
      closeRe.lastIndex = cur.end;
      const cm = closeRe.exec(xml);
      const end = cm && cm.index < limit ? cm.index : limit;
      const body = xml.slice(cur.end, end);
      const em = body.match(new RegExp(`<(?:[\\w.-]+:)?ele\\b[^>]*>\\s*(${NUM})`));
      if (em) {
        const v = Number(em[1]);
        if (Number.isFinite(v)) ele = v;
      }
      const tm = body.match(new RegExp(`<(?:[\\w.-]+:)?time\\b[^>]*>([^<]*)<`));
      const t = tm?.[1]?.trim();
      if (t) time = t;
    }

    pts.push({ lat, lon, ele, time, seg: tag === "trkpt" ? segAt(cur.idx) : 0 });
  }
  return pts;
}

/**
 * 补齐零星空缺的高程：相邻两个已知点之间线性插值。
 *
 * 只在**文件整体带高程**时调用（见 summarizeTrack 的 hasElevation 判定），
 * 所以这里插出来的值完全落在真实采样点之间，不会凭空造出额外的爬升：
 * 插值是单调的，阈值滤波也不会因为插值多累加任何高差。
 */
function fillElevation(points: GpxTrackPoint[]): void {
  const n = points.length;
  let i = 0;
  while (i < n) {
    if (points[i].ele !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && points[j].ele === null) j++;
    const before = i > 0 ? (points[i - 1].ele as number) : null;
    const after = j < n ? (points[j].ele as number) : null;
    for (let k = i; k < j; k++) {
      if (before === null) points[k].ele = after as number;
      else if (after === null) points[k].ele = before;
      else points[k].ele = before + ((after - before) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
}

/**
 * 把点序列算成 GpxTrack：判断有没有高程、算爬升、算距离、算采样间隔。
 *
 * GPX 与 KML 两条解析路径共用这一步，保证两者产出的形状完全一致，
 * 下游（route-profile / race-service）不需要知道来源格式。
 *
 * `forceHasElevation` 给抽稀用：抽稀后点的分布变了，
 * 「过半有点带高程」这个比例判定可能翻车，但原文件明明是带高程的，
 * 这时不应该反过来把结论改成"没高程"。
 */
export function summarizeTrack(
  raw: RawPoint[],
  opts?: { forceHasElevation?: boolean },
): GpxTrack | null {
  // 少于 2 个点连不成线，距离与剖面都无从谈起
  if (raw.length < 2) return null;

  const withEle = raw.reduce((n, p) => (p.ele === null ? n : n + 1), 0);
  // 过半有点带高程才认为"这个文件带高程"。
  // 门槛不能是"有 1 个 <ele> 就算" —— 那种文件里其余点全是空的，
  // 补出来的插值高度是假的，比老实说"没高程"更坏。
  const hasElevation =
    opts?.forceHasElevation ?? (withEle >= 2 && withEle * 2 >= raw.length);

  const points: GpxTrackPoint[] = raw.map((p) => ({ ...p }));
  if (hasElevation) fillElevation(points);

  let gain = 0;
  let loss = 0;
  let eleMin = 0;
  let eleMax = 0;
  if (hasElevation) {
    const eles = points.map((p) => p.ele as number);
    const acc = accumulateElevation(smooth(eles, 7), 0.5);
    gain = Math.round(acc.gain);
    loss = Math.round(acc.loss);
    [eleMin, eleMax] = minMax(eles);
  }

  // 逐点距离。**段间不累加**：自动暂停造成的跳跃不是跑出来的距离
  let dist = 0;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].seg !== points[i].seg) continue;
    const d = haversineM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    dist += d;
    if (d > 0.5 && d < 500) gaps.push(d);
  }
  gaps.sort((a, b) => a - b);

  return {
    points,
    hasElevation,
    gainM: gain,
    lossM: loss,
    eleMin: Math.round(eleMin),
    eleMax: Math.round(eleMax),
    distanceM: Math.round(dist),
    sampleSpacingM: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : 0,
  };
}

/**
 * 解析 GPX 文本。
 *
 * 不引第三方 XML 库：GPX 的 trackpoint 结构很规整，
 * 用正则定位标签 + 取属性就够，少一个依赖。
 *
 * 返回 null 只有一种情况：可用轨迹点少于 2 个。
 * 「没有高程」不再返回 null —— 那是**另一种问题**（能读出路线但算不出爬升），
 * 由 hasElevation 表达，交给调用方决定报错还是走 DEM。
 */
export function parseGpx(xml: string): GpxTrack | null {
  const fromTrack = summarizeTrack(readPoints(xml, "trkpt"));
  if (fromTrack) return fromTrack;
  // 有些 GPX 只含 <rtept>（路线而非轨迹），一并接受
  return summarizeTrack(readPoints(xml, "rtept"));
}

/**
 * 这条轨迹能不能用来画剖面。
 *
 * 存在库里的历史数据是旧结构（没有 hasElevation、没有 seg），
 * 所以这里不信任 hasElevation 字段，直接验每个点的高程是不是有限数 ——
 * 让新代码对老数据也安全。
 */
export function usableForProfile(track: GpxTrack | null | undefined): track is GpxTrack {
  if (!track || !Array.isArray(track.points) || track.points.length < 2) return false;
  return track.points.every((p) => Number.isFinite(p.ele as number));
}

/**
 * 按等距离抽稀，保留爬升形态的同时把点数压到可管理规模。
 * 画剖面图不需要每米一个点 —— 每 50m 一个足够还原坡度。
 */
export function downsample(track: GpxTrack, targetCount = 900): GpxTrack {
  if (track.points.length <= targetCount) return track;

  const step = track.points.length / targetCount;
  const picked: RawPoint[] = [];
  for (let i = 0; i < targetCount; i++) {
    picked.push(track.points[Math.floor(i * step)]);
  }
  // 保证终点被保留，否则剖面图会在终点前截断
  const last = track.points[track.points.length - 1];
  if (picked[picked.length - 1] !== last) picked.push(last);

  // 抽稀后所有派生数字都要重算（爬升、距离、海拔极值），
  // 否则会留着按原始点数算出来的旧值 —— 那正是抽稀最容易被忽略的 bug
  const next = summarizeTrack(picked, { forceHasElevation: track.hasElevation });
  if (!next) return track;
  return { ...next, sampleSpacingM: track.sampleSpacingM };
}
