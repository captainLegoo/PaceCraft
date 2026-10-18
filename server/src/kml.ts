/**
 * KML 轨迹解析 —— 产出与 parseGpx **完全同形状**的 GpxTrack。
 *
 * 为什么要支持 KML：
 *  两步路导出轨迹有四种格式，GPX 之外最常见的就是「KML格式（轨迹）」。
 *  有人手里只有那一份 KML，不让他导入等于逼他回去重导一遍。
 *
 * 与 GPX 的两处硬差异，写错就是错到另一个城市：
 *  1. **KML 是「经度, 纬度, 高度」，GPX 是「纬度 经度」**（lat/lon 是分开的属性）。
 *     写反了剖面图看着还挺像，但完全是另一个地方 —— 所以测试里必须显式断言第一个点。
 *  2. 分隔符不同：`<gx:coord>` 用**空格**分三个值，`<coordinates>` 用**逗号**分、
 *     元组之间用任意空白（含换行和 tab）。
 *
 * 另一类「KML格式（路径）」是规划出来的路线（贴路网），坡度被抹平、爬升明显偏小，
 * 拿它当实测用是自欺。但它仍然是合法输入 —— 解析层面照收，在 sourceNote 里如实标注来源，
 * 由用户自己判断。（标签本身不声明来源，没法在解析层区分「轨迹」和「路径」。）
 *
 * 不引 XML 库，理由同 gpx.ts：KML 的这两种几何结构也是规整的，
 * 正则足以覆盖，少一个依赖就少一处版本风险。
 */
import { summarizeTrack, type GpxTrack, type RawPoint } from "./gpx.ts";

/**
 * 高程是否可信。
 *
 * `<altitudeMode>clampToGround</altitudeMode>` 的意思是"高度由客户端贴地填充"——
 * 导出工具通常直接填 0。那样的高度是假的（看着像数据，其实不是），
 * 必须当成"没有高程"处理，而不是拿 0 去算爬升。
 * relativeToGround 同理（离地高度，不是海拔）。
 */
function altitudeTrusted(xml: string): boolean {
  const modes = [...xml.matchAll(/<altitudeMode[^>]*>\s*([A-Za-z]+)\s*</g)].map((m) =>
    m[1].toLowerCase(),
  );
  // 没声明就按可信处理（Google Earth 的默认是 absolute）
  if (modes.length === 0) return true;
  return !modes.some((m) => m === "clamptoground" || m === "relativetoground");
}

/** 一个元组是否合法：至少两个数，且都在合理范围内 */
function toPoint(values: (string | undefined)[], trusted: boolean): RawPoint | null {
  const lon = Number(values[0]);
  const lat = Number(values[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // 经纬度要有意义：|lat| > 90 或 |lon| > 180 一定是解析错位了，丢掉
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let ele: number | null = null;
  if (trusted && values[2] !== undefined) {
    const v = Number(values[2]);
    if (Number.isFinite(v)) ele = v;
  }
  // 注意顺序：KML 是「经度 纬度」，与 GPX 的 lat/lon 属性正好相反
  return { lat, lon, ele, seg: 0 };
}

/**
 * 把一段坐标文本切成点。
 *
 * **不能用一个正则去匹配整个元组**，这是实测踩到的坑：
 * KML 允许两种元组，`lon,lat`（两值）和 `lon,lat,ele`（三值），
 * 而元组之间是**空白**。写 `NUM(\s*[, ]\s*NUM)?(\s*[, ]\s*NUM)?` 这种正则时，
 * 遇到两值元组它会"顺手当作分隔符"把**下一个元组的第一个数**吃掉当高程 ——
 * 结果整条轨迹的经纬度全部错位一格，而点数看起来完全正常，最难发现。
 *
 * 正确做法：元组内部不可能有空白（规范如此），
 * 所以先按空白切成 token，再由**首个 token 的逗号个数**定下元组宽度，
 * 然后按固定宽度消费。这样两值/三值都不会跨界。
 *
 * `commaSep` 为真表示元组内部用逗号（`<coordinates>`），
 * 为假表示纯空白分隔（`<gx:coord>`，形如 `经度 纬度 高度`）。
 */
function splitCoords(text: string, commaSep: boolean, trusted: boolean): RawPoint[] {
  // KML 规范：坐标是一串元组，**元组之间用空白分隔，元组内部用逗号分隔**。
  // 所以两种形态的切法正好相反：
  //  - `<coordinates>lon,lat,ele lon,lat,ele</coordinates>` → 每个空白分隔项就是**一个**元组
  //  - `<gx:coord>经度 纬度 高度</gx:coord>` → 整个元素就是**一个**元组，值之间是空白
  //
  // 因为元组宽度（2 值还是 3 值）可以逐个不同（只要不是一半一半），
  // 按 token 独立解析比"先定宽度再批量消费"更不容易跨界出错。
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const tuples = commaSep ? tokens : [tokens.join(" ")];

  const pts: RawPoint[] = [];
  for (const tuple of tuples) {
    const nums = tuple.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (nums.length < 2) continue;
    const p = toPoint(nums, trusted);
    if (p) pts.push(p);
  }
  return pts;
}

/** `<gx:Track>`：`<gx:coord>经度 纬度 高度</gx:coord>`，逐点一个元素 */
function readGxTrack(block: string, trusted: boolean): RawPoint[] {
  const pts: RawPoint[] = [];
  const re = /<(?:[\w.-]+:)?coord\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?coord\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    pts.push(...splitCoords(m[1], false, trusted));
  }
  return pts;
}

/** `<LineString>`：`<coordinates>lon,lat[,ele] lon,lat[,ele]</coordinates>`，元组间任意空白 */
function readLineString(block: string, trusted: boolean): RawPoint[] {
  const cm = block.match(
    /<(?:[\w.-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?coordinates\s*>/i,
  );
  if (!cm) return [];
  return splitCoords(cm[1], true, trusted);
}

/**
 * 解析 KML 文本。
 *
 * 只取**点数最多**的那一段几何。
 *
 * 这一步不是洁癖，是硬需求：轨迹文件里会混进兴趣点 —— 两步路导出的 KML 里
 * 有二十来个 `<Point>` 地标（补给点、拍照点、折返点）。
 * 一旦把它们当成轨迹点混进去，就会连出跨越大半个城市的直线，距离和爬升全错。
 * 与 GPX 侧"只认 `<trkpt>`"天然避开不同，KML 侧必须显式挑最大段。
 *
 * 同时支持 `<gx:Track>`（导出工具的"轨迹"）与 `<LineString>`（"路径"），
 * 两者可能出现在同一份文件的 `<MultiGeometry>` 里。
 */
export function parseKml(xml: string): GpxTrack | null {
  const trusted = altitudeTrusted(xml);
  const candidates: RawPoint[][] = [];

  const trackRe = /<(?:[\w.-]+:)?Track\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Track\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = trackRe.exec(xml)) !== null) {
    const pts = readGxTrack(m[1], trusted);
    if (pts.length > 0) candidates.push(pts);
  }

  const lsRe = /<(?:[\w.-]+:)?LineString\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?LineString\s*>/g;
  while ((m = lsRe.exec(xml)) !== null) {
    const pts = readLineString(m[1], trusted);
    if (pts.length > 0) candidates.push(pts);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.length - a.length);
  return summarizeTrack(candidates[0]);
}
