/**
 * 训练性质判定 —— 用本项目自己的引擎判断，不采信 COROS 的 `trainingFocus` 标签。
 *
 * 为什么不信 COROS 标签：
 *   实测下来，COROS 标成「强度课」的场次里有相当大比例是误判 ——
 *   那些场次全场最高圈均心率只到 Z2 上沿（一百六十出头），从未真正进入阈值区。
 *   典型的是 8km 左右的轻松跑也被标成 Tempo。标签按「末段瞬时心率」判定，
 *   对渐进跑和高强度间歇都会误判。
 *
 * 判定线怎么来的（**不写死某个数值**）：
 *   直接用预测引擎拟合出的「配速 → 心率」回归，在阈值配速处取值。
 *   这条线随每个人的回归而变，不需要也不应该硬编码。
 *
 *   为什么不能用 `hrZones()` 那套 Z1–Z5 绝对分区：
 *   `laps.avgHr` 是**整圈平均值**。阈值课在阈值上下震荡，平均值会落在 Z2 上沿
 *   （实测强度课的圈均峰值普遍只有 169–177，而 Z3 下界是 174），
 *   于是「avgHr ≥ 174 的时长」在强度课里的中位数是 **0 秒** —— 这条信号完全失效。
 *   改用回归线 + 时长累积，才是稳定的判据。
 */

import type { Threshold } from "./prediction/engine.ts";

/** 累计处于阈值区多少秒才算一节强度课（低于此值视为「有氧课上到了阈值」，不算专门强度课） */
export const QUALITY_MIN_SEC = 10 * 60;

/** 判定线容差：回归心率往下让 2bpm，抵消心率滞后与逐圈平均的平滑效应 */
const HR_TOLERANCE = 2;

export type SessionFocus = {
  isQuality: boolean;
  /** 处于阈值区的累计时长（秒） */
  thresholdSec: number;
  /** 进入阈值区的圈数 */
  thresholdLaps: number;
  /** 全场最高圈均心率 */
  peakLapHr: number;
  /** 本次使用的判定线（bpm） */
  thresholdHr: number;
  /** 圈数据是否足以判定（总时长太短或缺心率时为 false） */
  usable: boolean;
  /** 人类可读的依据，前端直接展示 */
  evidence: string;
};

export type SessionLap = {
  distanceM: number;
  timeSec: number;
  avgHr: number | null;
  maxHr: number | null;
};

/** 由回归 + 阈值配速推出「阈值心率」判定线 */
export function thresholdHrLine(threshold: Threshold): number {
  if (!threshold.a || !threshold.b) return 0;
  return threshold.a + threshold.b * threshold.paceSec - HR_TOLERANCE;
}

export function classifySession(laps: SessionLap[], threshold: Threshold): SessionFocus {
  const line = thresholdHrLine(threshold);
  const valid = laps.filter((l) => l.timeSec > 0 && (l.avgHr ?? 0) > 0);

  if (line <= 0 || valid.length < 3) {
    return {
      isQuality: false, thresholdSec: 0, thresholdLaps: 0, peakLapHr: 0,
      thresholdHr: Math.round(line), usable: false,
      evidence: "缺少配速-心率回归或有效分圈，无法判定",
    };
  }

  const totalSec = valid.reduce((s, l) => s + l.timeSec, 0);
  if (totalSec < 20 * 60) {
    return {
      isQuality: false, thresholdSec: 0, thresholdLaps: 0,
      peakLapHr: Math.max(...valid.map((l) => l.avgHr ?? 0)),
      thresholdHr: Math.round(line), usable: false,
      evidence: `总时长不足 20 分钟（${Math.round(totalSec / 60)} 分钟），不参与强度课统计`,
    };
  }

  const inZone = valid.filter((l) => (l.avgHr ?? 0) >= line);
  const thresholdSec = inZone.reduce((s, l) => s + l.timeSec, 0);
  const peakLapHr = Math.max(...valid.map((l) => l.avgHr ?? 0));
  const isQuality = thresholdSec >= QUALITY_MIN_SEC;

  return {
    isQuality,
    thresholdSec,
    thresholdLaps: inZone.length,
    peakLapHr,
    thresholdHr: Math.round(line),
    usable: true,
    evidence:
      `阈值区（圈均心率 ≥${Math.round(line)} bpm）累计 ${Math.round(thresholdSec / 60)} 分钟 / ` +
      `${inZone.length} 圈，全场峰值圈均 ${peakLapHr} bpm` +
      (isQuality ? "，达到强度课标准（≥10 分钟）" : "，未达强度课标准（需 ≥10 分钟）"),
  };
}

/** COROS 标签里的强度关键词，仅用于「引擎判定 vs 官方标签」的交叉展示 */
export const COROS_QUALITY = /threshold|tempo|vo2|max|间歇|阈值|节奏/i;
