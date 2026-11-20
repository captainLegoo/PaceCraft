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
export function formatElapsed(startedAt: number | null | undefined, isZh = true): string {
  if (!startedAt) return "";
  const totalSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (totalSeconds < 60) {
    return isZh ? `${totalSeconds} 秒` : `${totalSeconds}s`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) {
    return isZh ? `${m} 分钟 ${s} 秒` : `${m}m ${s}s`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return isZh ? `${h} 小时 ${remM} 分钟 ${s} 秒` : `${h}h ${remM}m ${s}s`;
}

/**
 * 将后台推送的同步进度中文文本转译为英文
 */
export function formatSyncMessage(msg: string | null | undefined, isZh = true): string {
  if (!msg) return "";
  if (isZh) return msg;

  let m = msg.match(/正在拉取训练详情与逐圈数据\s*\(([^)]+)\)\.\.\./);
  if (m) {
    return `Fetching workout details & lap splits (${m[1]})...`;
  }
  if (msg.includes("已有训练详情与逐圈数据全部最新，跳过拉取")) {
    return "Workout details & lap splits are up to date, skipping download";
  }

  m = msg.match(/正在扫描历史训练列表[（(]共\s*(\d+)\s*个时间窗口[)）]\.\.\./);
  if (m) {
    return `Scanning workout history (${m[1]} time windows)...`;
  }
  m = msg.match(/正在扫描训练记录\s*\(([^)]+)\s*时间段\)\s*·\s*已发现\s*(\d+)\s*条\.\.\./);
  if (m) {
    return `Scanning workouts (${m[1]} periods) · Found ${m[2]} records...`;
  }

  if (msg.includes("正在同步每日健康与睡眠数据") || msg.includes("正在同步健康与体征数据")) {
    return "Syncing daily recovery, sleep & HRV biometrics...";
  }
  m = msg.match(/正在拉取夜间睡眠分期与日间体征\s*\(([^)]+)\)\.\.\./);
  if (m) {
    return `Fetching sleep stages & biometrics (${m[1]})...`;
  }

  if (msg.includes("正在同步训练负荷与 ACWR 指标")) {
    return "Syncing training load & ACWR metrics...";
  }
  if (msg.includes("正在同步体能状态与恢复快照")) {
    return "Syncing stamina & recovery snapshot...";
  }

  m = msg.match(/正在拉取活动 FIT 文件与精确轨迹\s*\(([^)]+)\)\.\.\./);
  if (m) {
    return `Fetching activity FIT files & GPS tracks (${m[1]})...`;
  }

  if (msg.includes("训练与生理数据同步完成，正在执行自动化分析工作流") || msg.includes("正在执行自动化分析工作流")) {
    return "Data sync complete. Running automated analysis workflows...";
  }
  if (msg.includes("正在计算疲劳指数与备赛预测模型")) {
    return "Computing fatigue index & race prediction models...";
  }

  if (msg.includes("正在连接高驰服务")) {
    return "Connecting to COROS service...";
  }
  if (msg.includes("正在连接 Garmin")) {
    return msg.replace("正在连接 Garmin", "Connecting to Garmin").replace("检查最新训练...", "checking latest workouts...");
  }
  m = msg.match(/Garmin\s*\(([^)]+)\):\s*已扫描到\s*(\d+)\s*条记录\.\.\./);
  if (m) {
    return `Garmin (${m[1]}): Scanned ${m[2]} records...`;
  }
  if (msg.includes("历史分圈与 .FIT 已全部最新，跳过下载")) {
    return msg.replace("历史分圈与 .FIT 已全部最新，跳过下载", "Splits & .FIT files up to date, skipping");
  }
  m = msg.match(/Garmin\s*\(([^)]+)\):\s*高速并发下载并解析分圈\s*\(([^)]+)\):\s*(.*)/);
  if (m) {
    return `Garmin (${m[1]}): Downloading & parsing splits (${m[2]}): ${m[3]}`;
  }
  if (msg.includes("正在同步 Garmin 睡眠、夜间 HRV 与身体电量指标")) {
    return "Syncing Garmin sleep, overnight HRV & Body Battery...";
  }
  m = msg.match(/高驰云端数据拉取完毕，共\s*(\d+)\s*次训练/);
  if (m) {
    return `COROS sync complete: ${m[1]} activities fetched`;
  }
  m = msg.match(/同步完成[：:]\s*(\d+)\s*次活动[、,]\s*(\d+)\s*条详情/);
  if (m) {
    return `Sync complete: ${m[1]} activities, ${m[2]} details`;
  }
  if (msg === "空闲") return "Idle";

  return msg;
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
