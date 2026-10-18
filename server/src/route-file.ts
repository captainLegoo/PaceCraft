/**
 * 轨迹文件入口 —— 判断"这是什么文件"，再交给对应的解析器。
 *
 * 为什么要单独一层：用户手里是什么文件不由他决定。
 * 两步路导出有四种格式，Strava / Garmin / 高驰各有自己的默认格式与后缀，
 * 他只会照着 App 里看到的选项点。所以"选错格式"是常态，不是异常 ——
 * 这一层的职责就是把常见错误**翻译成人能照做的下一步**，
 * 而不是甩一句"解析失败"。
 *
 * 错误文案是这一层最重要的产出。用户不该在填完整张表之后才知道自己导错了格式，
 * 更不该拿到"GPX 解析失败"这种要他去猜的句子。
 */
import { parseGpx } from "./gpx.ts";
import { parseKml } from "./kml.ts";
import type { GpxTrack } from "./gpx.ts";

export type RouteFileKind = "gpx" | "kml" | "kmz" | "unknown";

/** 前端可以显式指定格式，但默认按内容嗅探 —— 后缀名会骗人（.gpx 里装 KML 的情况真实存在） */
export type RouteFileHint = "auto" | "gpx" | "kml";

/** 单文件上限。原始 GPX 动辄几 MB，20MB 已经远超一场全马的正常体积 */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 按内容嗅探文件类型。
 *
 * 顺序有讲究：KMZ 是 zip（二进制），必须**在读文本之前**先判掉，
 * 否则 zlib 头会被 UTF-8 解码成一堆替换字符，后面什么也认不出来。
 */
export function sniffRouteFile(text: string): RouteFileKind {
  // zip 本地文件头：PK\x03\x04
  if (text.startsWith("PK\u0003\u0004")) return "kmz";
  if (/<gpx[\s>]/i.test(text)) return "gpx";
  if (/<kml[\s>]/i.test(text) || /<gx:track[\s>]/i.test(text) || /<linestring[\s>]/i.test(text)) {
    return "kml";
  }
  return "unknown";
}

export type ParsedRouteFile = {
  track: GpxTrack | null;
  kind: RouteFileKind;
  /** 轨迹是否自带高程。false 时爬升字段全是 0，不能当答案用 */
  hasElevation: boolean;
  /** 面向用户的可读原因；解析成功时为 null */
  error: string | null;
};

/**
 * 解析一份轨迹文件文本。
 *
 * 无论成功失败都返回结构完整的结果，让调用方不必区分"抛异常"和"返回错误文案" ——
 * 这条路径上所有失败都是**用户输入问题**，不是服务端故障，
 * 所以统一用 error 承载，一路带到 UI 上。
 */
export function parseRouteFile(text: string, hint: RouteFileHint = "auto"): ParsedRouteFile {
  const fail = (kind: RouteFileKind, error: string): ParsedRouteFile => ({
    track: null,
    kind,
    hasElevation: false,
    error,
  });

  const raw = text ?? "";
  if (raw.trim().length === 0) {
    return fail("unknown", "文件是空的，没有读到内容。请确认导出成功、并且选中的是轨迹文件本身。");
  }
  if (raw.length > MAX_BYTES) {
    return fail(
      "unknown",
      `文件太大（${(raw.length / 1024 / 1024).toFixed(1)}MB，上限 20MB）。` +
        `多半是选错了导出项 —— 请只导出「轨迹」本身，别把地图瓦片之类的一起打包。`,
    );
  }

  const sniffed = sniffRouteFile(raw);
  // 嗅探不出来但前端显式声明了格式：仍然试一次。
  // 有些导出器会在 XML 声明之前塞一段 BOM 或版权注释，嗅探可能失手，
  // 而"用户说是 GPX/KML"比"我们自己没认出来"更值得信。
  const kind: RouteFileKind =
    sniffed !== "unknown" ? sniffed : hint === "kml" ? "kml" : hint === "gpx" ? "gpx" : "unknown";

  if (kind === "kmz") {
    return fail(
      "kmz",
      "这是 KMZ 文件，本质是个压缩包，服务端读不了里面的内容。\n" +
        "两条路：在两步路导出时改选「**GPX格式**」（推荐，自带实测海拔，爬升最准）；" +
        "或者先用系统解压工具把 .kmz 解压，取出里面的 .kml 再上传。",
    );
  }
  if (kind === "unknown") {
    return fail(
      "unknown",
      "认不出这个文件的格式。现在支持两种：\n" +
        "· **GPX**（推荐）—— 两步路 / Strava / Garmin 导出时选「GPX格式」；\n" +
        "· **KML** —— 选「KML格式（轨迹）」。\n" +
        "注意别选「路径」（那是规划出来的路线，没有实测海拔，坡度也被抹平了），也别选 KMZ（压缩包）。",
    );
  }

  const track = kind === "gpx" ? parseGpx(raw) : parseKml(raw);

  if (!track) {
    return fail(
      kind,
      kind === "gpx"
        ? "文件里没找到可用的轨迹点。GPX 里轨迹点在 `<trkpt>`（或路线点 `<rtept>`）里 —— " +
            "确认导出时勾的是「轨迹/GPS 记录」而不是只有路线的文件。"
        : "文件里没找到可用的轨迹。KML 里轨迹在 `<gx:Track>` 或 `<LineString>` 里 —— " +
            "确认导出时选的是「KML格式（轨迹）」而不是「路径」。",
    );
  }

  if (!track.hasElevation) {
    return fail(
      kind,
      `这份文件里没有高程数据，算不出爬升。\n` +
        `原因通常是导出时没带海拔。请在两步路导出选项里选「**GPX格式**」—— ` +
        `它每个轨迹点都带实测海拔，是最准的一种。` +
        `（「KML格式（路径）」本来就没有高度，属于正常现象。）`,
    );
  }

  return { track, kind, hasElevation: true, error: null };
}

/**
 * 给 sourceNote 用的一句来源说明。
 *
 * 写进数据库、UI 上长期展示，所以必须区分"实测"与"可能只是规划路线"，
 * 也不能让用户以为爬升是精确值 —— GPS 海拔本身就有 ±5-10m。
 */
export function routeSourceNote(kind: RouteFileKind, fileName?: string | null): string {
  const from = fileName ? `｜来自 ${fileName}` : "";
  if (kind === "kml") {
    return `KML 轨迹海拔（已阈值滤波，误差 ±5-10m）${from}`;
  }
  return `GPX 实测海拔（已阈值滤波，误差 ±5-10m）${from}`;
}
