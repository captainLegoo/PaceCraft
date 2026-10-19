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
 *  - 平滑窗口按**物理长度**（默认 28m）而不是点数定义，滤掉单点抖动但保留真实坡度
 *  - 采样间隔太稀的源（手表 25s 一条常见）算出来的爬升会偏低，
 *    靠算法补不回来 —— 只能如实告诉用户"这份文件采样较稀"
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
  /** 采样点间隔（米）的中位数，用来判断这份文件本身够不够细 */
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
 *
 * `seg` 必须传：段边界是记录仪的**自动暂停**，前后两点可能隔了几百米
 * （地下通道、隧道出口、被楼挡住重定位）。两段之间的高程不连续，
 * 把这一跳当成爬升累加进去，凭空多出几十米 —— 实测人为在段间抬 50m，
 * 爬升就正好虚增 50m。跨段时重置锚点即可。
 */
export function accumulateElevation(
  eles: number[],
  threshold = 0.5,
  seg?: number[],
): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let anchor = eles[0] ?? 0;
  for (let i = 1; i < eles.length; i++) {
    if (seg && seg[i] !== seg[i - 1]) {
      // 段边界：重新起锚，不把这一跳算进爬升
      anchor = eles[i];
      continue;
    }
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

/**
 * 按**物理距离**做滑动平均平滑 —— 把海拔当作「沿轨迹距离变化的曲线」，
 * 在距离域上取一个定长窗口做积分平均。
 *
 * ## 两种实现不是一回事
 *
 *  - **A：按距离选点，再对点做等权算术平均**
 *  - **B：按距离对海拔曲线做积分平均**（本实现）
 *
 * 两者只在「窗口取到哪些点」上相同，**权重完全不同**。
 * 间距均匀时两者等价 —— 每个点代表同样的距离，加权方式自然一样。
 * 分水岭在**速度变化**上：GPS 按时间间隔记录，跑得慢的单位距离内点更多
 * （上坡、拥堵、步行段天然更密）。A 让这些区段在平均里占更大权重，
 * 于是同一条路只是"哪一段跑得慢"不同，爬升就跟着变。
 *
 * 实测：同一条海拔-距离曲线，把 10-20km 那一段的采样密度改 5 倍
 *   全段匀速        A 614m    B 614m
 *   跑慢（点密 5×）  A 615m    B 614m
 *   跑快（点稀 5×）  A 592m    B 613m   ← A 光因速度就掉了 3.6%
 *
 * 在实测赛道（4m 间隔）上按不同密度重采样（窗口 28m）：
 *    8m     A 193m    B 191m
 *   30m     A 153m    B 193m   ← A 掉 21%
 *   47m     A 127m    B 189m
 *
 * 「跑得慢」和「在爬坡」是强相关的，所以 A 等于给山额外加权。
 * B 不受采样密度影响 —— 这正是一个空间滤波器该有的性质，
 * 顺带让 ELEV_WINDOW_M 不再是个需要精确标定的参数。
 *
 * ## 边界条件
 *  - **不跨 trkseg**：段边界是自动暂停，前后两点可能隔了几百米，
 *    高程不连续，平均进去毫无意义。
 *  - **窗口至少覆盖到左右各 1 个点**（对称扩展）：点间距超过窗口一半时
 *    （粗采样源，手表 25s 一条常见）纯距离窗口会退化成单点、完全不平滑，
 *    噪声全额灌进爬升。宁可窗口物理长度超标，也要有得平均。
 *
 * 已知且可接受的性质：**会系统性低估单调爬坡**。序列两端只有单侧数据，
 * 首尾被邻居拉低（5 个点的 8m 爬坡 → 6m）。
 * 真实轨迹上可忽略：10000 点、40km 的单调上升，平滑前后都是 9.5m。
 */
export function smoothByDistance(
  eles: number[],
  cumDistM: number[],
  seg: number[],
  windowM: number,
): number[] {
  const n = eles.length;
  if (n < 3) return eles;

  // 梯形面积前缀和：area[j] = 从起点到 cumDistM[j] 的累计面积
  const area = new Array<number>(n);
  area[0] = 0;
  for (let j = 0; j + 1 < n; j++) {
    area[j + 1] = area[j] + ((eles[j] + eles[j + 1]) / 2) * (cumDistM[j + 1] - cumDistM[j]);
  }

  // 每点所在段的起止下标（窗口不跨段）
  const segStart = new Array<number>(n);
  const segEnd = new Array<number>(n);
  for (let i = 0; i < n; i++) segStart[i] = i > 0 && seg[i] !== seg[i - 1] ? i : segStart[i - 1] ?? i;
  for (let i = n - 1; i >= 0; i--) segEnd[i] = i + 1 < n && seg[i + 1] === seg[i] ? segEnd[i + 1] : i;

  /** cum[j] <= x <= cum[j+1] 处的线性插值海拔 */
  const eleAt = (x: number, j: number): number => {
    const d = cumDistM[j + 1] - cumDistM[j];
    return d > 0 ? eles[j] + ((eles[j + 1] - eles[j]) * (x - cumDistM[j])) / d : eles[j];
  };
  /** x 落在哪个区间。hint 是上一轮的答案，指针单调前进，整体 O(n) */
  const idxAt = (x: number, hint: number): number => {
    let j = hint;
    while (j > 0 && cumDistM[j] > x) j--;
    while (j + 2 < n && cumDistM[j + 1] <= x) j++;
    return j;
  };
  /** 从段起点到 x 的累计面积 */
  const areaTo = (x: number, j: number): number =>
    area[j] + (x > cumDistM[j] ? ((eles[j] + eleAt(x, j)) / 2) * (x - cumDistM[j]) : 0);

  const half = windowM / 2;
  const out = new Array<number>(n);
  let h0 = 0;
  let h1 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = segStart[i];
    const s1 = segEnd[i];
    let x0 = cumDistM[i] - half;
    let x1 = cumDistM[i] + half;
    // 至少覆盖到左右各 1 个点，且**对称**扩展，窗口始终以本点为中心
    if (i > s0 && x0 < cumDistM[i - 1]) {
      const grow = cumDistM[i - 1] - x0;
      x0 = cumDistM[i - 1];
      x1 += grow;
    }
    if (i < s1 && x1 > cumDistM[i + 1]) {
      const shrink = x1 - cumDistM[i + 1];
      x1 = cumDistM[i + 1];
      x0 -= shrink;
    }
    x0 = Math.max(x0, cumDistM[s0]);
    x1 = Math.min(x1, cumDistM[s1]);
    const j0 = idxAt(x0, h0);
    const j1 = idxAt(x1, Math.max(j0, h1));
    h0 = j0;
    h1 = j1;
    const w = x1 - x0;
    out[i] = w > 1e-9 ? (areaTo(x1, j1) - areaTo(x0, j0)) / w : eles[i];
  }
  return out;
}

/**
 * 平滑窗口的目标物理长度（米）。
 *
 * 为什么不能写成「7 个点」：同样是 7 个点，4m 间隔的表是 28m 窗口，
 * 而手表按 25s 记一条、跑步速度下常在 30m 上下间隔 —— 那就是 **210m 窗口**，
 * 会把这条赛道 60~150m 波段的真实起伏整段抹平（实测同一条赛道少算 40%）。
 * 窗口必须用长度表达，点数只是它的实现细节。
 *
 * 28m 的依据：在实测的全分辨率轨迹上扫物理窗口，12~36m 区间内爬升稳定在
 * 180~197m（28m 处 181m），45m 往下就开始明显削掉真实坡度，8m 以内则滤不掉噪声
 * （4m 窗口给出 231m，虚增约 28%）。28 取这段平台的中点。
 */
export const ELEV_WINDOW_M = 28;

/**
 * 采样间隔超过这个值（米），算出来的爬升就不可信了。
 *
 * 不是算法能补救的问题：采样点之间的起伏已经丢失。实测同一条赛道
 * （真值 181m），按 15m 间隔重采样后还能给出 182m，30m 就掉到 162m，47m 只剩 136m。
 * 这种文件要如实告诉用户，而不是让一个偏低的数字看起来很可信。
 */
export const COARSE_SPACING_M = 20;

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

  // 逐点距离。**段间不累加**：自动暂停造成的跳跃不是跑出来的距离
  let dist = 0;
  const gaps: number[] = [];
  // 逐点累计距离，平滑窗口按它取（而不是按点数）
  const cumDistM: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    let d = 0;
    if (points[i - 1].seg === points[i].seg) {
      d = haversineM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
      dist += d;
      if (d > 0.5 && d < 500) gaps.push(d);
    }
    cumDistM.push(dist);
  }
  gaps.sort((a, b) => a - b);
  // 采样间隔要先算出来：它决定这份文件本身够不够细（粗采样要提示用户）
  const spacingM = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  let gain = 0;
  let loss = 0;
  let eleMin = 0;
  let eleMax = 0;
  if (hasElevation) {
    const eles = points.map((p) => p.ele as number);
    const segs = points.map((p) => p.seg);
    const smoothed = smoothByDistance(eles, cumDistM, segs, ELEV_WINDOW_M);
    const acc = accumulateElevation(smoothed, 0.5, segs);
    gain = Math.round(acc.gain);
    loss = Math.round(acc.loss);
    [eleMin, eleMax] = minMax(eles);
  }

  return {
    points,
    hasElevation,
    gainM: gain,
    lossM: loss,
    eleMin: Math.round(eleMin),
    eleMax: Math.round(eleMax),
    distanceM: Math.round(dist),
    sampleSpacingM: Math.round(spacingM),
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
 * 按等距离抽稀，**只用于画图**。
 *
 * ⚠️ 返回的是一串点，不是 GpxTrack —— 这是故意的。
 * 早期版本在这里重新调 summarizeTrack，于是平滑窗口（按点数算）
 * 在稀 12 倍的数组上又跑了一遍，真实的上下坡被抹平：
 * 同一条赛道爬升从 181m 掉到 91m，而页面上显示的正是那个偏小的数。
 * 抽稀是有损的，损失在离开这一步的那一刻就发生了，没有任何算法能恢复。
 * 所以它的返回值在类型上就不该能喂回任何计算。
 *
 * 目标点数怎么定：剖面图是 720px 宽、坐标只保留 0.1px 精度的 SVG，
 * 900 个点 ≈ 每像素 1.25 个，正好是折线抗锯齿需要的过采样量。
 * 给再多画不出区别（10504 点时相邻两点 x 只差 0.068px，会四舍五入到同一坐标），
 * 给少了曲线会看出折角。
 *
 * 展示序列**不得回流到任何计算**：将来若做分段坡度、按公里切分的爬升，
 * 必须重新从完整轨迹取数 —— 47m 间隔上的分段坡度会把桥和立交整段抹平，
 * 而且剖面图看上去还是那条曲线，肉眼完全发现不了。
 */
export function pickForDisplay(points: GpxTrackPoint[], targetCount = 900): GpxTrackPoint[] {
  if (points.length <= targetCount) return points;

  const step = points.length / targetCount;
  const picked: GpxTrackPoint[] = [];
  for (let i = 0; i < targetCount; i++) {
    picked.push(points[Math.floor(i * step)]);
  }
  // 保证终点被保留，否则剖面图会在终点前截断
  const last = points[points.length - 1];
  if (picked[picked.length - 1] !== last) picked.push(last);
  return picked;
}
