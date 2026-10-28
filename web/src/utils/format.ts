/**
 * 跑者数据统一格式化工具库
 */

/**
 * 格式化跑步配速（秒/公里 -> "M:SS" 或 "M′SS″"）
 * 包含秒数舍入与进位处理，杜绝 "4:60" 等非法展示。
 */
export function formatPace(
  sec: number | null | undefined,
  style: "colon" | "quote" = "colon"
): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";

  let m = Math.floor(sec / 60);
  let s = Math.round(sec % 60);
  if (s >= 60) {
    m += 1;
    s -= 60;
  }

  const sStr = String(s).padStart(2, "0");
  return style === "quote" ? `${m}′${sStr}″` : `${m}:${sStr}`;
}

/**
 * 格式化用时/时长（秒 -> "H:MM:SS" 或 "MM:SS"）
 * @param sec 总秒数
 * @param forceHours 是否强制展示小时位（即使为 0 小时）
 */
export function formatDuration(
  sec: number | null | undefined,
  forceHours = false
): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";

  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = Math.round(sec % 60);

  if (s >= 60) {
    m += 1;
    s -= 60;
  }
  if (m >= 60) {
    h += 1;
    m -= 60;
  }

  const mStr = String(m).padStart(2, "0");
  const sStr = String(s).padStart(2, "0");

  if (h > 0 || forceHours) {
    return `${h}:${mStr}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

/**
 * 格式化已过去的时间（如同步耗时：“28 秒”、“2 分钟 15 秒”、“1 小时 5 分钟 2 秒”）
 * @param startedAt 毫秒级时间戳
 */
export function formatElapsed(startedAt: number | null | undefined): string {
  if (!startedAt) return "";
  const totalSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) {
    return `${m} 分钟 ${s} 秒`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h} 小时 ${remM} 分钟 ${s} 秒`;
}

/**
 * 格式化跑步距离（米或公里 -> 保留小数位的字符串）
 */
export function formatDistance(
  val: number | null | undefined,
  fromUnit: "km" | "m" = "km",
  decimals = 2
): string {
  if (val == null || !Number.isFinite(val)) return "—";
  const km = fromUnit === "m" ? val / 1000 : val;
  return km.toFixed(decimals);
}

/**
 * 简化日期展示（如 "2026-10-28" -> "10-28"）
 */
export function formatDateShort(d: string | null | undefined): string {
  if (!d) return "—";
  return d.length > 5 ? d.slice(5) : d;
}

// 兼容 charts.tsx 与服务端 prediction 同名简称别名
export const fmtPace = formatPace;
export const fmtDur = formatDuration;
export const fmtDate = formatDateShort;
export const fmtT = formatDuration;
export const fmtP = formatPace;
