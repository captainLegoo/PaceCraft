/**
 * 时间格式化 —— 全项目唯一实现。
 *
 * 为什么要专门建这个文件：
 *  「秒 → m:ss」在项目里有 15+ 处重复实现，其中一半忘了处理进位。
 *  底层返回的是浮点秒（比如阈值配速 239.9），
 *  Math.round(239.9 % 60) = Math.round(59.9) = 60
 *  于是拼出来就是非法的 "3:60"。
 *
 * 这个 bug 特别阴险：显示出来的配速比真实值快了整整 40 秒，
 * 而页面上看不出任何异常。所以必须集中到一处。
 */

/** 秒 → m:ss（配速）。自动处理进位与溢出。 */
export function fmtPace(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  let m = Math.floor(sec / 60);
  let s = Math.round(sec - m * 60);
  if (s >= 60) { m += 1; s -= 60; }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 秒 → h:mm:ss（时长）。逐级进位。 */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec - h * 3600) / 60);
  let s = Math.round(sec - h * 3600 - m * 60);
  if (s >= 60) { m += 1; s -= 60; }
  if (m >= 60) { h += 1; m -= 60; }
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** 时长的简短形式（用于表格列宽紧张处） */
export function fmtDurationShort(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}′${String(Math.round(sec % 60)).padStart(2, "0")}″`;
}

/**
 * 解析用户输入的比赛成绩。
 *
 * 支持：
 *   "3:00"     → 3 小时（按 h:mm 理解）
 *   "3:05:37"  → 3 小时 5 分 37 秒
 *   "185:37"   → 185 分 37 秒 = 3:05:37（按 m:ss 理解）
 *   "10800"    → 纯数字按秒
 *
 * `M:SS` 和 `H:MM` 在文本上完全一样，这是个真实的歧义：
 * 用户输入 "3:00" 想表达 3 小时，如果按 m:ss 解析会得到 180 秒 ——
 * 算出来平均配速 0:02/km，明显荒谬但不会报错。
 *
 * 所以按「第一个数字是否超过 24」来判别：
 * 超过 24 的一定是分钟（3 小时 05 分 = 185:37 这类写法），
 * 不超过 24 的按小时理解（3:00、4:15 这类写法）。
 *
 * @param expectedKm 赛段距离（km），用于把结果限制在合理区间
 */
export function parseDuration(input: string, expectedKm?: number): number | null {
  const v = input.trim().replace(/：/g, ":");
  if (!v) return null;

  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n > 60 ? n : null;
  }

  const parts = v.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;

  let sec: number;
  if (parts.length === 3) {
    sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // 歧义消解：见上面的注释
    sec = parts[0] > 24 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60;
  } else {
    return null;
  }

  // 合理性校验：按常见配速区间反推可能的成绩范围。
  // 宁可返回 null 让用户重填，也不要存进去算出一个荒谬的配速。
  if (expectedKm && expectedKm > 0) {
    const lo = expectedKm * 2.5 * 60;  // 2:30/km（世界级）——不可能更快
    const hi = expectedKm * 9.0 * 60;  // 9:00/km（走路速度）
    if (sec < lo || sec > hi) return null;
  }
  if (sec <= 0 || sec > 24 * 3600) return null;

  return Math.round(sec);
}

/** 每公里配速（秒/km）→ m:ss（距离型格式化，语义不同但结果一样） */
export function fmtPacePerKm(secPerKm: number | null | undefined): string {
  return fmtPace(secPerKm);
}