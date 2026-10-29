import { sqlite } from "../db/client.ts";
import { garminFetch } from "./client.ts";
import { loadGarminTokens } from "./auth.ts";
import type { GarminRegion } from "./types.ts";

/**
 * 确保 garmin_daily_health 表存在
 */
export function initGarminHealthTable() {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS garmin_daily_health (
      date TEXT PRIMARY KEY,
      calendar_date TEXT NOT NULL,
      hrv_weekly_avg INTEGER,
      hrv_last_night_avg INTEGER,
      hrv_status TEXT,
      hrv_feedback TEXT,
      hrv_baseline_low INTEGER,
      hrv_baseline_high INTEGER,
      sleep_score INTEGER,
      sleep_quality TEXT,
      sleep_duration_sec INTEGER,
      deep_sleep_sec INTEGER,
      light_sleep_sec INTEGER,
      rem_sleep_sec INTEGER,
      awake_sleep_sec INTEGER,
      avg_sleep_hr INTEGER,
      avg_sleep_spo2 INTEGER,
      avg_respiration REAL,
      body_battery_high INTEGER,
      body_battery_low INTEGER,
      body_battery_recent INTEGER,
      body_battery_charged INTEGER,
      body_battery_drained INTEGER,
      avg_stress INTEGER,
      max_stress INTEGER,
      stress_qualifier TEXT,
      resting_hr INTEGER,
      min_hr INTEGER,
      max_hr INTEGER,
      total_steps INTEGER,
      active_calories INTEGER,
      total_calories INTEGER,
      raw TEXT,
      updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
    );
  `);
}

// 模块初始化时建表
initGarminHealthTable();

export type GarminHealthRecord = {
  date: string;
  calendarDate: string;
  hrvWeeklyAvg?: number | null;
  hrvLastNightAvg?: number | null;
  hrvStatus?: string | null;
  hrvFeedback?: string | null;
  hrvBaselineLow?: number | null;
  hrvBaselineHigh?: number | null;
  sleepScore?: number | null;
  sleepQuality?: string | null;
  sleepDurationSec?: number | null;
  deepSleepSec?: number | null;
  lightSleepSec?: number | null;
  remSleepSec?: number | null;
  awakeSleepSec?: number | null;
  avgSleepHr?: number | null;
  avgSleepSpo2?: number | null;
  avgRespiration?: number | null;
  bodyBatteryHigh?: number | null;
  bodyBatteryLow?: number | null;
  bodyBatteryRecent?: number | null;
  bodyBatteryCharged?: number | null;
  bodyBatteryDrained?: number | null;
  avgStress?: number | null;
  maxStress?: number | null;
  stressQualifier?: string | null;
  restingHr?: number | null;
  minHr?: number | null;
  maxHr?: number | null;
  totalSteps?: number | null;
  activeCalories?: number | null;
  totalCalories?: number | null;
  raw?: string | null;
  updatedAt?: number;
};

/**
 * 从 Garmin Personal API 拉取睡眠数据
 */
export async function fetchGarminSleepSummaries(
  startDate: string,
  endDate: string,
  region?: GarminRegion,
): Promise<any[]> {
  try {
    const res = await garminFetch(
      `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${startDate}&endDate=${endDate}`,
      {},
      region,
    );
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn("[Garmin Health] 睡眠数据获取跳过:", e);
    return [];
  }
}

/**
 * 从 Garmin Personal API 拉取夜间 HRV 数据
 */
export async function fetchGarminHrvSummaries(
  startDate: string,
  endDate: string,
  region?: GarminRegion,
): Promise<any[]> {
  try {
    const res = await garminFetch(
      `/hrv-service/hrv/daily/${startDate}/${endDate}`,
      {},
      region,
    );
    if (!res.ok || res.status === 204) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn("[Garmin Health] HRV 数据获取跳过:", e);
    return [];
  }
}

/**
 * 从 Garmin Personal API 拉取单日全天概要（静息心率、身体电量、日间压力、步数）
 */
export async function fetchGarminDailySummary(
  calendarDate: string,
  region?: GarminRegion,
): Promise<any | null> {
  try {
    const res = await garminFetch(
      `/usersummary-service/usersummary/daily?calendarDate=${calendarDate}`,
      {},
      region,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const upsertHealthStmt = sqlite.query(`
  INSERT INTO garmin_daily_health (
    date, calendar_date,
    hrv_weekly_avg, hrv_last_night_avg, hrv_status, hrv_feedback, hrv_baseline_low, hrv_baseline_high,
    sleep_score, sleep_quality, sleep_duration_sec, deep_sleep_sec, light_sleep_sec, rem_sleep_sec, awake_sleep_sec, avg_sleep_hr, avg_sleep_spo2, avg_respiration,
    body_battery_high, body_battery_low, body_battery_recent, body_battery_charged, body_battery_drained,
    avg_stress, max_stress, stress_qualifier,
    resting_hr, min_hr, max_hr,
    total_steps, active_calories, total_calories,
    raw, updated_at
  ) VALUES (
    ?,?,
    ?,?,?,?,?,?,
    ?,?,?,?,?,?,?,?,?,?,
    ?,?,?,?,?,
    ?,?,?,
    ?,?,?,
    ?,?,?,
    ?,unixepoch()
  )
  ON CONFLICT(date) DO UPDATE SET
    calendar_date = excluded.calendar_date,
    hrv_weekly_avg = coalesce(excluded.hrv_weekly_avg, garmin_daily_health.hrv_weekly_avg),
    hrv_last_night_avg = coalesce(excluded.hrv_last_night_avg, garmin_daily_health.hrv_last_night_avg),
    hrv_status = coalesce(excluded.hrv_status, garmin_daily_health.hrv_status),
    hrv_feedback = coalesce(excluded.hrv_feedback, garmin_daily_health.hrv_feedback),
    hrv_baseline_low = coalesce(excluded.hrv_baseline_low, garmin_daily_health.hrv_baseline_low),
    hrv_baseline_high = coalesce(excluded.hrv_baseline_high, garmin_daily_health.hrv_baseline_high),
    sleep_score = coalesce(excluded.sleep_score, garmin_daily_health.sleep_score),
    sleep_quality = coalesce(excluded.sleep_quality, garmin_daily_health.sleep_quality),
    sleep_duration_sec = coalesce(excluded.sleep_duration_sec, garmin_daily_health.sleep_duration_sec),
    deep_sleep_sec = coalesce(excluded.deep_sleep_sec, garmin_daily_health.deep_sleep_sec),
    light_sleep_sec = coalesce(excluded.light_sleep_sec, garmin_daily_health.light_sleep_sec),
    rem_sleep_sec = coalesce(excluded.rem_sleep_sec, garmin_daily_health.rem_sleep_sec),
    awake_sleep_sec = coalesce(excluded.awake_sleep_sec, garmin_daily_health.awake_sleep_sec),
    avg_sleep_hr = coalesce(excluded.avg_sleep_hr, garmin_daily_health.avg_sleep_hr),
    avg_sleep_spo2 = coalesce(excluded.avg_sleep_spo2, garmin_daily_health.avg_sleep_spo2),
    avg_respiration = coalesce(excluded.avg_respiration, garmin_daily_health.avg_respiration),
    body_battery_high = coalesce(excluded.body_battery_high, garmin_daily_health.body_battery_high),
    body_battery_low = coalesce(excluded.body_battery_low, garmin_daily_health.body_battery_low),
    body_battery_recent = coalesce(excluded.body_battery_recent, garmin_daily_health.body_battery_recent),
    body_battery_charged = coalesce(excluded.body_battery_charged, garmin_daily_health.body_battery_charged),
    body_battery_drained = coalesce(excluded.body_battery_drained, garmin_daily_health.body_battery_drained),
    avg_stress = coalesce(excluded.avg_stress, garmin_daily_health.avg_stress),
    max_stress = coalesce(excluded.max_stress, garmin_daily_health.max_stress),
    stress_qualifier = coalesce(excluded.stress_qualifier, garmin_daily_health.stress_qualifier),
    resting_hr = coalesce(excluded.resting_hr, garmin_daily_health.resting_hr),
    min_hr = coalesce(excluded.min_hr, garmin_daily_health.min_hr),
    max_hr = coalesce(excluded.max_hr, garmin_daily_health.max_hr),
    total_steps = coalesce(excluded.total_steps, garmin_daily_health.total_steps),
    active_calories = coalesce(excluded.active_calories, garmin_daily_health.active_calories),
    total_calories = coalesce(excluded.total_calories, garmin_daily_health.total_calories),
    raw = coalesce(excluded.raw, garmin_daily_health.raw),
    updated_at = unixepoch()
`);

/**
 * 同步佳明健康指标（HRV, 睡眠, 身体电量, 压力, 静息心率）
 */
export async function syncGarminHealth(days = 14, preferredRegion?: GarminRegion): Promise<{ syncedDays: number }> {
  initGarminHealthTable();

  const regions: GarminRegion[] = preferredRegion
    ? [preferredRegion]
    : [
        ...(loadGarminTokens("cn") ? (["cn"] as GarminRegion[]) : []),
        ...(loadGarminTokens("global") ? (["global"] as GarminRegion[]) : []),
      ];

  if (regions.length === 0) return { syncedDays: 0 };

  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startDateObj = new Date(now.getTime() - days * 86400000);
  const startDate = startDateObj.toISOString().slice(0, 10);

  let totalUpdated = 0;

  for (const reg of regions) {
    // 1. 获取睡眠数据
    const sleeps = await fetchGarminSleepSummaries(startDate, endDate, reg);
    // 2. 获取 HRV 数据
    const hrvs = await fetchGarminHrvSummaries(startDate, endDate, reg);

    // 按日期聚合成 Map
    const recordsMap = new Map<string, Partial<GarminHealthRecord>>();

    for (const s of sleeps) {
      const d = s.calendarDate || s.date;
      if (!d) continue;
      const rec = recordsMap.get(d) || { date: d, calendarDate: d };
      rec.sleepScore = s.sleepScores?.overall?.value ?? s.sleepScore ?? null;
      rec.sleepQuality = s.sleepScores?.overall?.qualifierKey ?? s.sleepQuality ?? null;
      rec.sleepDurationSec = s.sleepTimeSeconds ?? null;
      rec.deepSleepSec = s.deepSleepSeconds ?? null;
      rec.lightSleepSec = s.lightSleepSeconds ?? null;
      rec.remSleepSec = s.remSleepSeconds ?? null;
      rec.awakeSleepSec = s.awakeSleepSeconds ?? null;
      rec.avgSleepHr = s.averageSpO2Value ? Math.round(s.averageSpO2Value) : null;
      rec.avgSleepSpo2 = s.averageSpO2Value ? Math.round(s.averageSpO2Value) : null;
      rec.avgRespiration = s.averageRespirationValue ?? null;
      recordsMap.set(d, rec);
    }

    for (const h of hrvs) {
      const d = h.calendarDate || h.date;
      if (!d) continue;
      const rec = recordsMap.get(d) || { date: d, calendarDate: d };
      rec.hrvWeeklyAvg = h.weeklyAvg ?? null;
      rec.hrvLastNightAvg = h.lastNightAvg ?? null;
      rec.hrvStatus = h.status ?? null;
      rec.hrvFeedback = h.feedbackPhrase ?? null;
      rec.hrvBaselineLow = h.baseline?.balancedLow ?? null;
      rec.hrvBaselineHigh = h.baseline?.balancedUpper ?? null;
      recordsMap.set(d, rec);
    }

    // 针对近 7 天尝试获取身体电量与静息心率概要
    const checkDays = Math.min(days, 7);
    for (let i = 0; i < checkDays; i++) {
      const dateStr = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
      const sum = await fetchGarminDailySummary(dateStr, reg);
      if (sum && (sum.restingHeartRate || sum.bodyBatteryHighestValue || sum.totalSteps)) {
        const rec = recordsMap.get(dateStr) || { date: dateStr, calendarDate: dateStr };
        rec.restingHr = sum.restingHeartRate ?? null;
        rec.minHr = sum.minHeartRate ?? null;
        rec.maxHr = sum.maxHeartRate ?? null;
        rec.bodyBatteryHigh = sum.bodyBatteryHighestValue ?? null;
        rec.bodyBatteryLow = sum.bodyBatteryLowestValue ?? null;
        rec.bodyBatteryRecent = sum.bodyBatteryMostRecentValue ?? null;
        rec.bodyBatteryCharged = sum.bodyBatteryChargedValue ?? null;
        rec.bodyBatteryDrained = sum.bodyBatteryDrainedValue ?? null;
        rec.avgStress = sum.averageStressLevel ?? null;
        rec.maxStress = sum.maxStressLevel ?? null;
        rec.stressQualifier = sum.stressQualifier ?? null;
        rec.totalSteps = sum.totalSteps ?? null;
        rec.activeCalories = sum.activeKilocalories ?? null;
        rec.totalCalories = sum.totalKilocalories ?? null;
        recordsMap.set(dateStr, rec);
      }
    }

    // 写入数据库
    sqlite.transaction(() => {
      for (const [date, rec] of recordsMap) {
        upsertHealthStmt.run(
          rec.date, rec.calendarDate || rec.date,
          rec.hrvWeeklyAvg ?? null, rec.hrvLastNightAvg ?? null, rec.hrvStatus ?? null, rec.hrvFeedback ?? null, rec.hrvBaselineLow ?? null, rec.hrvBaselineHigh ?? null,
          rec.sleepScore ?? null, rec.sleepQuality ?? null, rec.sleepDurationSec ?? null, rec.deepSleepSec ?? null, rec.lightSleepSec ?? null, rec.remSleepSec ?? null, rec.awakeSleepSec ?? null, rec.avgSleepHr ?? null, rec.avgSleepSpo2 ?? null, rec.avgRespiration ?? null,
          rec.bodyBatteryHigh ?? null, rec.bodyBatteryLow ?? null, rec.bodyBatteryRecent ?? null, rec.bodyBatteryCharged ?? null, rec.bodyBatteryDrained ?? null,
          rec.avgStress ?? null, rec.maxStress ?? null, rec.stressQualifier ?? null,
          rec.restingHr ?? null, rec.minHr ?? null, rec.maxHr ?? null,
          rec.totalSteps ?? null, rec.activeCalories ?? null, rec.totalCalories ?? null,
          rec.raw ? JSON.stringify(rec.raw) : null,
        );
        totalUpdated++;
      }
    })();
  }

  return { syncedDays: totalUpdated };
}

/**
 * 查询佳明健康数据列表
 */
export function getGarminHealthList(days = 60): GarminHealthRecord[] {
  initGarminHealthTable();
  const rows = sqlite.query(`
    SELECT
      date,
      calendar_date as calendarDate,
      hrv_weekly_avg as hrvWeeklyAvg,
      hrv_last_night_avg as hrvLastNightAvg,
      hrv_status as hrvStatus,
      hrv_feedback as hrvFeedback,
      hrv_baseline_low as hrvBaselineLow,
      hrv_baseline_high as hrvBaselineHigh,
      sleep_score as sleepScore,
      sleep_quality as sleepQuality,
      sleep_duration_sec as sleepDurationSec,
      deep_sleep_sec as deepSleepSec,
      light_sleep_sec as lightSleepSec,
      rem_sleep_sec as remSleepSec,
      awake_sleep_sec as awakeSleepSec,
      avg_sleep_hr as avgSleepHr,
      avg_sleep_spo2 as avgSleepSpo2,
      avg_respiration as avgRespiration,
      body_battery_high as bodyBatteryHigh,
      body_battery_low as bodyBatteryLow,
      body_battery_recent as bodyBatteryRecent,
      body_battery_charged as bodyBatteryCharged,
      body_battery_drained as bodyBatteryDrained,
      avg_stress as avgStress,
      max_stress as maxStress,
      stress_qualifier as stressQualifier,
      resting_hr as restingHr,
      min_hr as minHr,
      max_hr as maxHr,
      total_steps as totalSteps,
      active_calories as activeCalories,
      total_calories as totalCalories,
      updated_at as updatedAt
    FROM garmin_daily_health
    ORDER BY date ASC
    LIMIT ?
  `).all(days) as GarminHealthRecord[];

  return rows;
}

/**
 * 生成真实的 Garmin 模拟健康数据（当用户尚未佩戴 Garmin 睡觉时提供高可读性示范数据）
 */
export function seedMockGarminHealthData(): number {
  initGarminHealthTable();
  const count = sqlite.query("SELECT COUNT(*) as c FROM garmin_daily_health").get() as { c: number };
  if (count && count.c > 0) {
    return count.c; // 已有数据，无需覆盖
  }

  const mockDays = 14;
  const now = new Date("2026-10-29T12:00:00Z");

  const records: GarminHealthRecord[] = [];
  for (let i = mockDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);

    // 围绕真实生理指标模拟微小波动
    const isHardTrainingDay = (i === 2); // 10-27 强训日
    const hrvLastNight = isHardTrainingDay ? 49 : 56 + Math.round((Math.sin(i * 1.2) * 5));
    const hrvWeekly = 57;
    const hrvStatus = hrvLastNight < 50 ? "UNBALANCED" : "BALANCED";

    const sleepScore = isHardTrainingDay ? 74 : 84 + Math.round((Math.cos(i * 0.8) * 6));
    const sleepDurationSec = (7 * 3600 + Math.round(Math.random() * 50) * 60);
    const deepSleepSec = Math.round(sleepDurationSec * 0.22);
    const remSleepSec = Math.round(sleepDurationSec * 0.24);
    const awakeSleepSec = Math.round(1800 + Math.random() * 600);
    const lightSleepSec = sleepDurationSec - deepSleepSec - remSleepSec - awakeSleepSec;

    const restingHr = isHardTrainingDay ? 53 : 48 + (i % 3);
    const bbHigh = isHardTrainingDay ? 78 : 92 - (i % 5);
    const bbLow = isHardTrainingDay ? 18 : 24 + (i % 6);
    const bbRecent = 68;

    records.push({
      date: dateStr,
      calendarDate: dateStr,
      hrvWeeklyAvg: hrvWeekly,
      hrvLastNightAvg: hrvLastNight,
      hrvStatus,
      hrvFeedback: hrvStatus === "BALANCED" ? "您的夜间 HRV 处于均衡状态，身体已适应近期负荷" : "HRV 略有下降，提示肌肉处于重度修复期",
      hrvBaselineLow: 52,
      hrvBaselineHigh: 63,
      sleepScore,
      sleepQuality: sleepScore >= 80 ? "良好" : "一般",
      sleepDurationSec,
      deepSleepSec,
      lightSleepSec,
      remSleepSec,
      awakeSleepSec,
      avgSleepHr: restingHr + 4,
      avgSleepSpo2: 97,
      avgRespiration: 14.5,
      bodyBatteryHigh: bbHigh,
      bodyBatteryLow: bbLow,
      bodyBatteryRecent: bbRecent,
      bodyBatteryCharged: bbHigh - bbLow,
      bodyBatteryDrained: Math.round((bbHigh - bbLow) * 0.85),
      avgStress: isHardTrainingDay ? 36 : 24 + (i % 5),
      maxStress: isHardTrainingDay ? 72 : 58,
      stressQualifier: isHardTrainingDay ? "MEDIUM" : "LOW",
      restingHr,
      minHr: restingHr - 2,
      maxHr: 145 + (i * 2),
      totalSteps: 9800 + (i * 350),
      activeCalories: 450 + (i * 40),
      totalCalories: 2150 + (i * 30),
      raw: JSON.stringify({ simulated: true, brand: "garmin" }),
    });
  }

  sqlite.transaction(() => {
    for (const rec of records) {
      upsertHealthStmt.run(
        rec.date, rec.calendarDate,
        rec.hrvWeeklyAvg ?? null, rec.hrvLastNightAvg ?? null, rec.hrvStatus ?? null, rec.hrvFeedback ?? null, rec.hrvBaselineLow ?? null, rec.hrvBaselineHigh ?? null,
        rec.sleepScore ?? null, rec.sleepQuality ?? null, rec.sleepDurationSec ?? null, rec.deepSleepSec ?? null, rec.lightSleepSec ?? null, rec.remSleepSec ?? null, rec.awakeSleepSec ?? null, rec.avgSleepHr ?? null, rec.avgSleepSpo2 ?? null, rec.avgRespiration ?? null,
        rec.bodyBatteryHigh ?? null, rec.bodyBatteryLow ?? null, rec.bodyBatteryRecent ?? null, rec.bodyBatteryCharged ?? null, rec.bodyBatteryDrained ?? null,
        rec.avgStress ?? null, rec.maxStress ?? null, rec.stressQualifier ?? null,
        rec.restingHr ?? null, rec.minHr ?? null, rec.maxHr ?? null,
        rec.totalSteps ?? null, rec.activeCalories ?? null, rec.totalCalories ?? null,
        rec.raw,
      );
    }
  })();

  return records.length;
}
