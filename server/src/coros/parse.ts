/**
 * COROS MCP 的返回格式是混合的：
 *  - 概览类工具（querySportRecords / getActivityDetail / queryTrainingLoadAssessment ...）返回人类可读文本
 *  - 时序类工具（queryActivityLapData / queryCustomActivityLapData）返回真 JSON
 * 这一层负责把两者都收敛成结构化对象。
 */

export function unescape(raw: string): string {
  // 文本型工具返回的是被 JSON 字符串包裹的内容（外层带引号、内部 \n 转义）
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"')) return raw;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
}

/** "12:34" -> 754；"1:02:03" -> 3723；"5:06" -> 306 */
export function parseDuration(input: string | null | undefined): number | null {
  if (!input) return null;
  const parts = input.trim().split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function num(input: string | undefined): number | null {
  if (input === undefined) return null;
  const cleaned = input.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 在给定 key 里取值，容忍 "Short-Term Load" / "shortTermLoad" 之类差异 */
function pick(source: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (source[k] !== undefined) return source[k];
    const hit = Object.keys(source).find((s) => s.toLowerCase().replace(/[\s_-]/g, "") === k.toLowerCase().replace(/[\s_-]/g, ""));
    if (hit) return source[hit];
  }
  return undefined;
}

/** 从任意文本里抠出 "4:54" / "1:29:47" 这类时长 */
export function durFrom(text: string | null | undefined): number | null {
  if (!text) return null;
  return parseDuration(text.match(/\d+(?::\d+)+/)?.[0]);
}

function toRecord(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    // 同一行可能有多个字段，用 " | " 分隔：
    //   "Average Pace: 4:54 /km | Avg HR: 145 bpm | Calories: 708 kcal"
    // 注意不能按「空白+大写」切 —— "Start Coordinates" 这类多词 key 会被切碎。
    for (const part of line.split(/\s*\|\s*/)) {
      const m = part.match(/^\s*([^:]+):\s*(.*)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    }
  }
  return out;
}

// ---------------- querySportRecords ----------------

export type SportRecord = {
  labelId: string;
  sportType: number;
  sportName: string;
  date: string; // yyyyMMdd
  dateLabel: string; // yyyy-mm-dd
  location: string | null;
  lat: number | null;
  lon: number | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
  durationSec: number | null;
  distanceKm: number | null;
  avgPaceSec: number | null;
  avgHr: number | null;
  calories: number | null;
};

export function parseSportRecords(raw: string): SportRecord[] {
  const text = unescape(raw);
  // 每个活动块以 "N. <SportName> — yyyy-mm-dd" 开头
  const blocks = text.split(/\n(?=\d+\.\s)/).filter((b) => /^\d+\.\s/.test(b.trim()));
  const out: SportRecord[] = [];

  for (const block of blocks) {
    const rec = toRecord(block);
    const header = block.match(/^\d+\.\s*(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})/);
    if (!header) continue;

    // 时间戳直接从整块文本里抓：toRecord 会按 " | " 切分，
    // 而 "endTimestamp=xxx" 落在没有冒号的那个片段里，靠 record 取会丢掉。
    const startTimestamp = num(block.match(/startTimestamp=(\d+)/)?.[1]);
    let endTimestamp = num(block.match(/endTimestamp=(\d+)/)?.[1]);
    // 少数记录 COROS 不给 endTimestamp，用 start + duration 补上，
    // 否则后面算组间间隔会得到荒谬的巨大值。
    const durationSec = parseDuration((rec["Duration"] ?? "").split("|")[0].trim());
    if (endTimestamp == null && startTimestamp != null && durationSec != null) {
      endTimestamp = startTimestamp + durationSec;
    }

    const labelId = (rec["LabelId"] ?? "").split("|")[0].trim();
    const sportType = num((rec["SportType"] ?? "").split("|")[0].trim());
    const coords = (rec["Start Coordinates"] ?? "").split(",").map((s) => num(s));
    const dateLabel = header[2];

    out.push({
      labelId,
      sportType: sportType ?? -1,
      sportName: header[1].trim(),
      date: dateLabel.replace(/-/g, ""),
      dateLabel,
      location: rec["Location"] && rec["Location"] !== "N/A" ? rec["Location"] : null,
      lat: coords[0] ?? null,
      lon: coords[1] ?? null,
      startTimestamp,
      endTimestamp,
      durationSec,
      distanceKm: num((rec["Distance"] ?? "").match(/([\d.]+)\s*km/)?.[1]),
      avgPaceSec: durFrom(rec["Average Pace"]),
      avgHr: num((rec["Avg HR"] ?? "").match(/(\d+)/)?.[1]),
      calories: num((rec["Calories"] ?? "").match(/(\d+)/)?.[1]),
    });
  }
  return out;
}

// ---------------- getActivityDetail ----------------

export type ActivityDetail = {
  labelId: string;
  sportName: string;
  durationSec: number | null;
  distanceKm: number | null;
  avgPaceSec: number | null;
  movingPaceSec: number | null;
  adjustedPaceSec: number | null;
  bestKmSec: number | null;
  avgHr: number | null;
  avgCadence: number | null;
  avgStrideM: number | null;
  avgPower: number | null;
  elevGain: number | null;
  elevLoss: number | null;
  calories: number | null;
  trainingLoad: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  trainingFocus: string | null;
  performance: string | null;
};

export function parseActivityDetail(raw: string, labelId: string): ActivityDetail | null {
  const rec = toRecord(unescape(raw));
  if (Object.keys(rec).length === 0) return null;
  const title = unescape(raw).match(/^\S+\s+(.+?)\s+Activity Details/m)?.[1] ?? null;

  const d = durFrom;
  return {
    labelId,
    sportName: title ?? "",
    durationSec: d(rec["Workout Time"]),
    distanceKm: num(rec["Distance"]?.match(/([\d.]+)/)?.[1]),
    avgPaceSec: d(rec["Average Pace"]),
    movingPaceSec: d(rec["Moving Average Pace"]),
    adjustedPaceSec: d(rec["Adjusted Pace"]),
    bestKmSec: d(rec["Best Kilometer"]),
    avgHr: num(rec["Average Heart Rate"]?.match(/(\d+)/)?.[1]),
    avgCadence: num(rec["Average Cadence"]?.match(/(\d+)/)?.[1]),
    avgStrideM: num(rec["Average Stride Length"]?.match(/([\d.]+)/)?.[1]),
    avgPower: num(rec["Average Power"]?.match(/(\d+)/)?.[1]),
    elevGain: num((rec["Elevation Gain / Loss"] ?? "").match(/([\d.]+)\s*m\s*\//)?.[1]),
    elevLoss: num((rec["Elevation Gain / Loss"] ?? "").match(/\/\s*([\d.]+)\s*m/)?.[1]),
    calories: num(rec["Calories"]?.match(/(\d+)/)?.[1]),
    trainingLoad: num(rec["Training Load"]),
    aerobicTe: num(rec["Aerobic TE"]),
    anaerobicTe: num(rec["Anaerobic TE"]),
    trainingFocus: rec["Training Focus"] ?? null,
    performance: rec["Performance"] ?? null,
  };
}

// ---------------- queryTrainingLoadAssessment ----------------

export type LoadPoint = {
  date: string; // yyyy-mm-dd
  comment: string | null;
  shortLoad: number | null;
  longLoad: number | null;
  ratio: number | null;
};

export function parseTrainingLoad(raw: string): LoadPoint[] {
  const text = unescape(raw);
  const blocks = text.split(/\n(?=\d{4}-\d{2}-\d{2}\n)/).filter((b) => /^\d{4}-\d{2}-\d{2}/.test(b.trim()));
  return blocks.map((block) => {
    const rec = toRecord(block);
    return {
      date: block.trim().split("\n")[0].trim(),
      comment: pick(rec, "Comment") ?? null,
      shortLoad: num(pick(rec, "Short-Term Load", "ShortTermLoad")),
      longLoad: num(pick(rec, "Long-Term Load", "LongTermLoad")),
      ratio: num(pick(rec, "Load Ratio")),
    };
  });
}

// ---------------- queryFitnessAssessmentOverview ----------------

export type Fitness = {
  vo2max: number | null;
  runningLevel: number | null;
  thresholdPaceSec: number | null;
  pred5kSec: number | null;
  pred10kSec: number | null;
  predHalfSec: number | null;
  predMarathonSec: number | null;
};

export function parseFitness(raw: string): Fitness {
  const rec = toRecord(unescape(raw));
  return {
    vo2max: num(rec["VO2max"]),
    runningLevel: num(rec["Running Level"]),
    thresholdPaceSec: durFrom(rec["Threshold Pace"]),
    pred5kSec: parseDuration(rec["5 km Prediction"]),
    pred10kSec: parseDuration(rec["10 km Prediction"]),
    predHalfSec: parseDuration(rec["Half Marathon Prediction"]),
    predMarathonSec: parseDuration(rec["Marathon Prediction"]),
  };
}

// ---------------- queryRecoveryStatus ----------------

export type Recovery = {
  recoveryPct: number | null;
  level: string | null;
  fullRecoveryHours: number | null;
};

export function parseRecovery(raw: string): Recovery {
  const rec = toRecord(unescape(raw));
  return {
    recoveryPct: num(rec["Recovery"]?.match(/(\d+)/)?.[1]),
    level: rec["Level"] ?? null,
    fullRecoveryHours: num(rec["Estimated Full Recovery"]?.match(/(\d+)/)?.[1]),
  };
}

// ---------------- queryDailyHealthData ----------------

export type DailyHealth = {
  date: string; // yyyyMMdd
  steps: number | null;
  calories: number | null;
  exerciseMin: number | null;
  stressAvg: number | null;
  restingHr: number | null;
  hrvBaseline: number | null;
};

export function parseDailyHealth(raw: string): DailyHealth[] {
  const text = unescape(raw);
  const header = text.match(/Resting HR:\s*(\d+)/);
  const hrv = text.match(/HRV Baseline:\s*(\d+)/);
  const blocks = text.split(/---\s*(\d{8})\s*---/).slice(1);
  const out: DailyHealth[] = [];

  for (let i = 0; i < blocks.length; i += 2) {
    const date = blocks[i];
    const body = blocks[i + 1] ?? "";
    const rec = toRecord(body);
    const stressLine = body.match(/Stress:\s*Avg\s*(\d+)/);
    out.push({
      date,
      steps: num(rec["Steps"]?.match(/([\d,]+)/)?.[1]),
      calories: num(rec["Calories"]?.match(/(\d+)/)?.[1]),
      exerciseMin: num(rec["Exercise"]?.match(/(\d+)/)?.[1]),
      stressAvg: num(stressLine?.[1]),
      restingHr: num(header?.[1]),
      hrvBaseline: num(hrv?.[1]),
    });
  }
  return out;
}

// ---------------- querySleepOverview ----------------

export type SleepPoint = {
  date: string;
  sleepScore: number | null;
  available: boolean;
  raw: string;
};

export function parseSleep(raw: string): SleepPoint[] {
  const text = unescape(raw);
  const blocks = text.split(/\n(?=\d{4}-\d{2}-\d{2}\n)/).filter((b) => /^\d{4}-\d{2}-\d{2}/.test(b.trim()));
  return blocks.map((block) => {
    const rec = toRecord(block);
    const score = num(rec["Sleep Score"]);
    return {
      date: block.trim().split("\n")[0].trim(),
      sleepScore: score,
      available: !/not available/i.test(block),
      raw: block.trim(),
    };
  });
}

// ---------------- 心率 / 压力序列 ----------------

export type HrPoint = {
  date: string;
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
};

/** "2026-01-01: 119 bpm (Min: 58, Max: 148)"；无数据时该行为 "2026-01-01: No data" */
export function parseAvgHeartRate(raw: string): HrPoint[] {
  const text = unescape(raw);
  const out: HrPoint[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/(\d{4}-\d{2}-\d{2}):\s*(\d+)\s*bpm/i);
    if (!m) continue;
    out.push({
      date: m[1],
      avgHr: Number(m[2]),
      minHr: num(line.match(/Min:\s*(\d+)/i)?.[1]),
      maxHr: num(line.match(/Max:\s*(\d+)/i)?.[1]),
    });
  }
  return out;
}

export type StressPoint = { date: string; avgStress: number | null; level: string | null };

/**
 * "2026-01-01:\nAverage Stress: 73 (Medium)\nRelaxed: No data..."
 * 分区（Relaxed/Low/Medium/High）在未开启全天压力采样的账号上全部无数据，只有均值可用。
 */
export function parseStressLevel(raw: string): StressPoint[] {
  const text = unescape(raw);
  const out: StressPoint[] = [];
  for (const m of text.matchAll(/(\d{4}-\d{2}-\d{2}):\s*\n\s*Average Stress:\s*(\d+)\s*(?:\((\w+)\))?/g)) {
    out.push({ date: m[1], avgStress: Number(m[2]), level: m[3] ?? null });
  }
  return out;
}

// ---------------- lap data (JSON) ----------------

export type LapRow = {
  lapIndex: number;
  distanceM: number;
  timeSec: number;
  totalLengthSec: number;
  avgPaceSec: number;
  avgSpeedRaw: number;
  avgPower: number;
  avgHr: number;
  maxHr: number;
  avgCadence: number;
  maxCadence: number;
  avgStrideM: number;
  elevGain: number;
  totalDescent: number;
  adjustedPaceSec: number;
};

export type LapData = {
  labelId: string;
  sportType: number;
  columns: { name: string; label: string }[];
  laps: LapRow[];
  /** 选中分组的标称圈距（米） */
  lapDistanceM: number | null;
  /** 该分组的 type，用于在 UI 上标注粒度 */
  lapGroupType: number | null;
  raw: unknown;
};

/**
 * COROS 的 lapGroups 是**同一活动的多种粒度**并存：
 * 观察到 type=11 / 12 / 2 / -1 分别对应 5km、10km、1km 与整段汇总，
 * 各组的 distance 合计都等于总距离。
 * 取「圈数最多」的那一组 = 最细可用粒度；type=-1 是整段汇总，只有 1 圈，自动被排除。
 */
export function parseLapData(raw: string): LapData | null {
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const groups = Array.isArray(payload.lapGroups) ? payload.lapGroups.filter((g: any) => Array.isArray(g.laps)) : [];
  const flat = Array.isArray(payload.laps) ? payload.laps : [];
  if (groups.length === 0 && flat.length === 0) return null;

  const chosen =
    groups.length > 0
      ? [...groups].sort((a: any, b: any) => b.laps.length - a.laps.length)[0]
      : null;
  const source = chosen ? chosen.laps : flat;

  // 原始单位是厘米：/100000 才得到公里。已在多次活动上与 COROS 记录的总距离交叉验证一致，
  // 这里刻意不写某一次的具体数字 —— 那是作者自己数据集里的值，换个使用者就既不适用也不该留。
  return {
    labelId: String(payload.labelId ?? ""),
    sportType: Number(payload.sportType ?? -1),
    columns: Array.isArray(payload.columns) ? payload.columns : [],
    lapDistanceM: chosen ? (Number(chosen.lapDistance ?? 0) || null) / 100 : null,
    lapGroupType: chosen ? Number(chosen.type) : null,
    laps: source.map((l: any) => ({
      lapIndex: Number(l.lapIndex ?? 0),
      distanceM: Number(l.distance ?? 0) / 100,
      timeSec: Number(l.time ?? 0),
      totalLengthSec: Number(l.totalLength ?? 0),
      avgPaceSec: Number(l.avgPace ?? 0),
      avgSpeedRaw: Number(l.avgSpeedV2 ?? 0),
      avgPower: Number(l.avgPower ?? 0),
      avgHr: Number(l.avgHr ?? 0),
      maxHr: Number(l.maxHr ?? 0),
      avgCadence: Number(l.avgCadence ?? 0),
      maxCadence: Number(l.maxCadence ?? 0),
      avgStrideM: Number(l.avgStrideLength ?? 0) / 100, // 同样是厘米：109cm ≈ 1.09m
      elevGain: Number(l.elevGain ?? 0),
      totalDescent: Number(l.totalDescent ?? 0),
      adjustedPaceSec: Number(l.adjustedPace ?? 0),
    })),
    raw: payload,
  };
}
