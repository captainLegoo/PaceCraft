/**
 * 训练海拔记录 —— 从 COROS FIT 文件提取绝对海拔。
 *
 * 为什么要单独做这一层：
 *
 *  1. MCP 的 `getActivityDetail` 只给「爬升/下降」，没有绝对海拔。
 *     没有绝对海拔就无法判断「这次训练是在平原还是在高原」，
 *     也就无法对配速做海拔修正 —— 而海拔对耐力运动的影响是实打实的
 *     （Wehrlin & Hallén 2006：每升高 1000m，VO₂max 下降约 6.3%）。
 *
 *  2. 但 FIT 文件里有：`altitude` / `enhanced_altitude` /
 *     `position_lat` / `position_long`，每秒一个采样点。
 *     这是唯一可靠的绝对海拔来源。
 *
 *  3. 实测数据里两种情况都出现过：平原城市的训练全程在 20–80m（海拔影响 <1%），
 *     高原城市的比赛在 1500m 上下。两者不能直接比配速。
 *
 * 注意 FIT 下载限额：官方 50 个 / 24 小时（下载 + 查询链接共用同一额度）。
 * 所以 altitude 是「按需拉取并缓存」的设计，不是每次同步都重下。
 */

export type AltitudeBand = "sea_level" | "rolling" | "plateau";

export type AltitudeRecord = {
  labelId: string;
  dateLabel: string;
  /** FIT 采样点数（通常 = 跑步秒数） */
  samples: number;
  altMin: number;
  altMax: number;
  /** 全程海拔的算术平均，比 min/max 更能代表「这场训练在什么高度」 */
  altAvg: number;
  /** 全程累计爬升（从 FIT 重新累加，可与 COROS 的 elevGain 交叉校验） */
  gainFromFit: number;
  lat: number;
  lon: number;
  band: AltitudeBand;
  bandLabel: string;
};

export const ALTITUDE_BAND_LABEL: Record<AltitudeBand, string> = {
  sea_level: "海平面",
  rolling: "丘陵",
  plateau: "高原",
};

/**
 * 海拔分档。
 * 阈值不是随便定的：1000m 以下 VO₂max 的下降在 6.3%/1000m 的线性关系里
 * 已经可以忽略（<0.3%），所以 200m 以下一律视为「不需要海拔修正」。
 */
export function classifyAltitude(altAvg: number): AltitudeBand {
  if (altAvg >= 1000) return "plateau";
  if (altAvg >= 200) return "rolling";
  return "sea_level";
}

/**
 * 海拔对配速的修正系数（秒/km，每 1000m）。
 *
 * 依据：Wehrlin & Hallén (2006) 报告 VO₂max 每升高 1000m 下降约 6.3%；
 * 但跑步经济性变化较小，实测配速损失约为 VO₂max 损失的一半左右
 * （Breno Melo 的高原配速换算表：1500ft 马拉松约慢 4%，5280ft 约慢 8%）。
 * 两者结合，取每 1000m 约 2–3 秒/km 作为工作值。
 */
export const SEC_PER_KM_PER_1000M = 2.5;

/**
 * 把高原成绩折算回海平面（或反过来）。
 *
 * 注意：这个修正只在**同一场比赛/同一组对比**里用。
 * 拿「高原比赛成绩」去和「平原训练配速」直接比是没意义的 ——
 * 必须先把这个人的高原成绩折算成海平面等效值。
 */
export function altitudeAdjustPace(paceSec: number, altAvg: number): number {
  if (altAvg < 200) return paceSec;
  return paceSec - SEC_PER_KM_PER_1000M * (altAvg / 1000);
}

/** 反向：海平面配速 → 该海拔下预期能跑多快 */
export function seaLevelToAltitudePace(seaPaceSec: number, altAvg: number): number {
  if (altAvg < 200) return seaPaceSec;
  return seaPaceSec + SEC_PER_KM_PER_1000M * (altAvg / 1000);
}

/** FIT 的 semicircle 编码 → 十进制度 */
export function semicircleToDegrees(v: number): number {
  return v * (180 / 2 ** 31);
}

/**
 * 解析 Python 解析器输出的 FIT 海拔摘要。
 * 之所以让 Python 负责二进制解码：FIT 是变长二进制 + 压缩时间戳，
 * 手写解析器很容易在 message definition 上出错（实测踩过坑）。
 */
export function parseAltitudeSummary(
  labelId: string,
  dateLabel: string,
  summary: {
    samples: number;
    altMin: number;
    altMax: number;
    altAvg: number;
    gainFromFit: number;
    latSemicircle: number;
    lonSemicircle: number;
  },
): AltitudeRecord {
  const band = classifyAltitude(summary.altAvg);
  return {
    labelId,
    dateLabel,
    samples: summary.samples,
    altMin: summary.altMin,
    altMax: summary.altMax,
    altAvg: summary.altAvg,
    gainFromFit: summary.gainFromFit,
    lat: semicircleToDegrees(summary.latSemicircle),
    lon: semicircleToDegrees(summary.lonSemicircle),
    band,
    bandLabel: ALTITUDE_BAND_LABEL[band],
  };
}

/** 人类可读的一句话描述 */
export function describeAltitude(r: AltitudeRecord | null | undefined): string {
  if (!r) return "海拔未知（未拉取 FIT）";
  if (r.samples === 0) return "海拔未知（FIT 无高程采样）";
  const gainNote = r.gainFromFit > 0 ? `｜爬升 ${Math.round(r.gainFromFit)} m` : "";
  // altitudeAdjustPace(pace, alt) 把高原配速折算回海平面，
  // 海拔越高扣得越多，所以高原时它是负数 —— 取绝对值才是"慢了多少"。
  const penalty = Math.abs(altitudeAdjustPace(0, r.altAvg));
  const adjNote = penalty < 0.5 ? "" : `｜高原惩罚 ${penalty.toFixed(1)} s/km`;
  return `${r.bandLabel}｜${Math.round(r.altMin)}–${Math.round(r.altMax)} m（均值 ${Math.round(r.altAvg)} m）${gainNote}${adjNote}`;
}

// ---------------- FIT 海拔的读写 ----------------

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./config.ts";

/** altitude CLI 的输出目录；跟随当前跑友 Profile 隔离 */
export const getFitDir = () => process.env.COROS_FIT_DIR ?? join(getDataDir(), "fit");
export const FIT_DIR = {
  toString: () => getFitDir(),
  [Symbol.toPrimitive]: () => getFitDir(),
} as unknown as string;

let cache: Map<string, AltitudeRecord> | null = null;
let cacheMtime = 0;
let cachedFitDir = "";

export function getAltitude(labelId: string): AltitudeRecord | null {
  const dir = getFitDir();
  const path = `${dir}/altitude.json`;
  try {
    const mtime = statSync(path).mtimeMs;
    if (!cache || cacheMtime !== mtime || cachedFitDir !== dir) {
      const rows = JSON.parse(readFileSync(path, "utf8")) as AltitudeRecord[];
      cache = new Map(rows.map((r) => [r.labelId, r]));
      cacheMtime = mtime;
      cachedFitDir = dir;
    }
    return cache.get(labelId) ?? null;
  } catch {
    return null;
  }
}

/** 把新的海拔记录并入缓存文件（CLI 与同步共用） */
export function appendAltitudeRecords(records: AltitudeRecord[]): number {
  if (records.length === 0) return 0;
  const dir = getFitDir();
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/altitude.json`;

  const existing: AltitudeRecord[] = (() => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as AltitudeRecord[];
    } catch {
      return [];
    }
  })();

  const byId = new Map(existing.map((r) => [r.labelId, r]));
  let added = 0;
  for (const r of records) {
    if (!byId.has(r.labelId)) added++;
    byId.set(r.labelId, r);
  }
  const all = [...byId.values()].sort((a, b) => a.dateLabel.localeCompare(b.dateLabel));
  writeFileSync(path, JSON.stringify(all, null, 2));
  cache = null; // 强制下次读盘
  cacheMtime = 0;
  return added;
}

/** 已经拉过 FIT 的活动 id */
export function haveAltitudeFit(labelIds: string[]): Set<string> {
  const path = `${getFitDir()}/altitude.json`;
  try {
    const rows = JSON.parse(readFileSync(path, "utf8")) as AltitudeRecord[];
    return new Set(rows.map((r) => r.labelId));
  } catch {
    return new Set();
  }
}
