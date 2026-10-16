import { db, sqlite } from "../db/client.ts";
import {
  activityDetails,
  activities,
  aiReports,
  dailyHealth,
  fitness,
  fitQuota,
  heartRate,
  laps,
  recovery,
  sleep,
  stress,
  syncLog,
  trainingLoad,
  users,
} from "../db/schema.ts";
import { callTool } from "../coros/mcp.ts";
import { loadSportTypeCodes } from "../coros/sport-types.ts";
import {
  parseActivityDetail,
  parseAvgHeartRate,
  parseDailyHealth,
  parseFitness,
  parseLapData,
  parseRecovery,
  parseSleep,
  parseSportRecords,
  parseStressLevel,
  parseTrainingLoad,
  type SportRecord,
} from "../coros/parse.ts";
import { FIT_DAILY_LIMIT } from "../config.ts";

/**
 * 同步哪些运动类型由用户在设置页勾选，落在 sync_settings 表里。
 * 见 coros/sport-types.ts —— 那里有完整的 COROS 编码表和默认值。
 *
 * 以前这里是写死的 RUN_SPORT_CODES / RUN_CODES 两份数组，
 * 结果室内有氧（400）这类训练在过滤环节就被丢掉了，
 * 而 COROS 那边其实一直有数据。
 */
const WINDOW_DAYS = 30;

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ymd(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export type SyncResult = {
  startedAt: number;
  finishedAt: number;
  activities: number;
  details: number;
  lapRows: number;
  loadDays: number;
  healthDays: number;
  sleepDays: number;
  errors: string[];
  /** FIT 配额是共享的，这里如实报告剩余额度 */
  fitQuotaLeft: number;
};

export async function syncAll(opts: { days?: number; withLaps?: boolean } = {}): Promise<SyncResult> {
  const days = opts.days ?? 120;
  const withLaps = opts.withLaps ?? true;
  const startedAt = Math.floor(Date.now() / 1000);
  const errors: string[] = [];

  sqlite.query("INSERT INTO sync_log (started_at, status) VALUES (?, 'running')").run(startedAt);

  // ---- 1. 活动摘要：从今天往回按 30 天不重叠切窗 ----
  // 旧写法是 [now-offset, now] 再用 min(offset, 30) 截断，结果每个窗口都等于"最近 30 天"，
  // 回溯天数完全失效（180 天的同步实际只拿到 30 天的数据）。
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const windows: { from: Date; to: Date }[] = [];
  {
    let to = new Date();
    while (to.getTime() > cutoff.getTime()) {
      const from = new Date(to);
      from.setDate(from.getDate() - WINDOW_DAYS);
      windows.push({ from: from < cutoff ? cutoff : from, to });
      to = from;
    }
  }

  const records: SportRecord[] = [];
  // 在循环外读一次：读的是本机 SQLite 的单行配置，不存在循环内变化的可能，
  // 而且万一读失败也不至于让整个同步在中途分叉成两种白名单。
  const sportTypeCodes = loadSportTypeCodes();
  for (const w of windows) {
    try {
      const raw = await callTool("querySportRecords", {
        startDate: ymd(w.from),
        endDate: ymd(w.to),
        sportTypeCodes,
        minDistanceKm: null,
        maxDistanceKm: null,
        minDurationMinutes: null,
        maxDurationMinutes: null,
        maxAveragePace: null,
        locationKeyword: null,
        limit: 300,
      });
      const parsed = parseSportRecords(raw);
      records.push(...parsed);
      console.log(`    窗口 ${ymd(w.from)}~${ymd(w.to)} → ${parsed.length} 条`);
    } catch (e) {
      errors.push(`querySportRecords ${ymd(w.from)}~${ymd(w.to)}: ${(e as Error).message}`);
    }
    await sleepMs(150);
  }

  // 去重（同一天可能有多条，按 labelId 唯一）
  const byId = new Map(records.map((r) => [r.labelId, r]));

  const upsertActivity = sqlite.query(`
    INSERT INTO activities (label_id, sport_type, sport_name, date, date_label, start_ts, end_ts,
      location, lat, lon, duration_sec, distance_km, avg_pace_sec, avg_hr, calories, raw, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, unixepoch())
    ON CONFLICT(label_id) DO UPDATE SET
      sport_type=excluded.sport_type, sport_name=excluded.sport_name, date=excluded.date,
      date_label=excluded.date_label, start_ts=excluded.start_ts, end_ts=excluded.end_ts,
      location=excluded.location, lat=excluded.lat, lon=excluded.lon, duration_sec=excluded.duration_sec,
      distance_km=excluded.distance_km, avg_pace_sec=excluded.avg_pace_sec, avg_hr=excluded.avg_hr,
      calories=excluded.calories, raw=excluded.raw, synced_at=unixepoch()
  `);

  for (const r of byId.values()) {
    upsertActivity.run(
      r.labelId, r.sportType, r.sportName, r.date, r.dateLabel, r.startTimestamp, r.endTimestamp,
      r.location, r.lat, r.lon, r.durationSec, r.distanceKm, r.avgPaceSec, r.avgHr, r.calories,
      JSON.stringify(r),
    );
  }

  // ---- 2. 单次详情 + 分圈 ----
  let detailCount = 0;
  let lapRowCount = 0;
  const haveDetail = new Set(
    (sqlite.query("SELECT label_id FROM activity_details").all() as { label_id: string }[]).map((r) => r.label_id),
  );

  for (const r of byId.values()) {
    // 这里曾经有一道 RUN_CODES 白名单，只给跑步类拉详情和分圈。
    // 去掉是有意的：既然用户勾选的就是「我要同步的运动类型」，
    // 详情和分圈理应对所有勾选的类型一视同仁。
    // 实测室内有氧（400）的 getActivityDetail 和 queryActivityLapData
    // 都有正常数据（Training Load / TE / 每组心率），没有理由区别对待。
    if (!haveDetail.has(r.labelId)) {
      try {
        const raw = await callTool("getActivityDetail", { labelId: r.labelId, sportType: r.sportType });
        const d = parseActivityDetail(raw, r.labelId);
        if (d) {
          sqlite.query(`
            INSERT INTO activity_details (label_id, sport_name, duration_sec, distance_km, avg_pace_sec,
              moving_pace_sec, adjusted_pace_sec, best_km_sec, avg_hr, avg_cadence, avg_stride_m, avg_power,
              elev_gain, elev_loss, calories, training_load, aerobic_te, anaerobic_te, training_focus, performance, raw)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(label_id) DO UPDATE SET
              distance_km=excluded.distance_km, avg_pace_sec=excluded.avg_pace_sec, avg_hr=excluded.avg_hr,
              avg_cadence=excluded.avg_cadence, avg_power=excluded.avg_power, training_load=excluded.training_load,
              performance=excluded.performance, raw=excluded.raw
          `).run(
            d.labelId, d.sportName, d.durationSec, d.distanceKm, d.avgPaceSec, d.movingPaceSec, d.adjustedPaceSec,
            d.bestKmSec, d.avgHr, d.avgCadence, d.avgStrideM, d.avgPower, d.elevGain, d.elevLoss, d.calories,
            d.trainingLoad, d.aerobicTe, d.anaerobicTe, d.trainingFocus, d.performance, raw,
          );
          detailCount++;
        }
        await sleepMs(120);
      } catch (e) {
        errors.push(`getActivityDetail ${r.labelId}: ${(e as Error).message}`);
      }
    }

    if (withLaps) {
      const hasLaps = sqlite.query("SELECT 1 FROM laps WHERE label_id = ? LIMIT 1").get(r.labelId);
      if (!hasLaps) {
        try {
          const raw = await callTool("queryActivityLapData", { labelId: r.labelId, sportType: r.sportType });
          const lap = parseLapData(raw);
          if (lap && lap.laps.length > 0) {
            const ins = sqlite.query(`
              INSERT INTO laps (label_id, lap_index, distance_m, time_sec, total_length_sec, avg_pace_sec,
                adjusted_pace_sec, avg_speed_raw, avg_power, avg_hr, max_hr, avg_cadence, max_cadence,
                avg_stride_m, elev_gain, total_descent)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `);
            sqlite.transaction(() => {
              sqlite.query("DELETE FROM laps WHERE label_id = ?").run(r.labelId);
              for (const l of lap.laps) {
                ins.run(
                  r.labelId, l.lapIndex, l.distanceM, l.timeSec, l.totalLengthSec, l.avgPaceSec,
                  l.adjustedPaceSec, l.avgSpeedRaw, l.avgPower, l.avgHr, l.maxHr, l.avgCadence,
                  l.maxCadence, l.avgStrideM, l.elevGain, l.totalDescent,
                );
              }
            })();
            lapRowCount += lap.laps.length;
          }
          await sleepMs(120);
        } catch (e) {
          errors.push(`queryActivityLapData ${r.labelId}: ${(e as Error).message}`);
        }
      }
    }
  }

  // ---- 3. 训练负荷 ----
  let loadDays = 0;
  try {
    const raw = await callTool("queryTrainingLoadAssessment", { days: Math.min(days, 90) });
    const ins = sqlite.query(`
      INSERT INTO training_load (date, comment, short_load, long_load, ratio) VALUES (?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET comment=excluded.comment, short_load=excluded.short_load,
        long_load=excluded.long_load, ratio=excluded.ratio
    `);
    for (const p of parseTrainingLoad(raw)) ins.run(p.date, p.comment, p.shortLoad, p.longLoad, p.ratio);
    loadDays = parseTrainingLoad(raw).length;
  } catch (e) {
    errors.push(`queryTrainingLoadAssessment: ${(e as Error).message}`);
  }
  await sleepMs(150);

  // ---- 4. 每日健康 ----
  let healthDays = 0;
  try {
    const raw = await callTool("queryDailyHealthData", { days: Math.min(days, 60) });
    const ins = sqlite.query(`
      INSERT INTO daily_health (date, date_label, steps, calories, exercise_min, stress_avg, resting_hr, hrv_baseline)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET steps=excluded.steps, calories=excluded.calories,
        exercise_min=excluded.exercise_min, stress_avg=excluded.stress_avg, resting_hr=excluded.resting_hr,
        hrv_baseline=excluded.hrv_baseline
    `);
    const parsed = parseDailyHealth(raw);
    for (const h of parsed) {
      ins.run(
        h.date, `${h.date.slice(0, 4)}-${h.date.slice(4, 6)}-${h.date.slice(6, 8)}`,
        h.steps, h.calories, h.exerciseMin, h.stressAvg, h.restingHr, h.hrvBaseline,
      );
    }
    healthDays = parsed.length;
  } catch (e) {
    errors.push(`queryDailyHealthData: ${(e as Error).message}`);
  }
  await sleepMs(150);

  // ---- 5. 睡眠 ----
  let sleepDays = 0;
  try {
    const raw = await callTool("querySleepOverview", { days: Math.min(days, 60) });
    const ins = sqlite.query(`
      INSERT INTO sleep (date, score, available, raw) VALUES (?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET score=excluded.score, available=excluded.available, raw=excluded.raw
    `);
    const parsed = parseSleep(raw);
    for (const s of parsed) ins.run(s.date, s.sleepScore, s.available ? 1 : 0, s.raw);
    sleepDays = parsed.length;
  } catch (e) {
    errors.push(`querySleepOverview: ${(e as Error).message}`);
  }
  await sleepMs(150);

  // ---- 6. 心率 + 压力趋势 ----
  // 注意：queryRestingHeartRate 在多数账号上返回 "No data"（未戴表睡觉就没有静息心率），
  // 所以这里只拉平均心率，静息心率退回到 queryDailyHealthData 头部带的单点值。
  try {
    const raw = await callTool("queryAvgHeartRate", { days: Math.min(days, 60) });
    for (const r of parseAvgHeartRate(raw)) {
      sqlite.query(`
        INSERT INTO heart_rate (date, avg_hr, min_hr, max_hr) VALUES (?,?,?,?)
        ON CONFLICT(date) DO UPDATE SET avg_hr=excluded.avg_hr, min_hr=excluded.min_hr, max_hr=excluded.max_hr
      `).run(r.date, r.avgHr, r.minHr, r.maxHr);
    }
  } catch (e) {
    errors.push(`queryAvgHeartRate: ${(e as Error).message}`);
  }
  await sleepMs(150);

  try {
    const raw = await callTool("queryStressLevel", { days: Math.min(days, 60) });
    for (const r of parseStressLevel(raw)) {
      sqlite.query(`
        INSERT INTO stress (date, avg_stress, level) VALUES (?,?,?)
        ON CONFLICT(date) DO UPDATE SET avg_stress=excluded.avg_stress, level=excluded.level
      `).run(r.date, r.avgStress, r.level);
    }
  } catch (e) {
    errors.push(`queryStressLevel: ${(e as Error).message}`);
  }

  // ---- 7. 体能 + 恢复快照（每天只留最后一条）----
  try {
    const f = parseFitness(await callTool("queryFitnessAssessmentOverview", {}));
    const sameDay = sqlite
      .query("SELECT id FROM fitness WHERE captured_at >= unixepoch() - 86400 LIMIT 1")
      .get() as { id: number } | undefined;
    if (sameDay) {
      sqlite.query(`UPDATE fitness SET vo2max=?, running_level=?, threshold_pace_sec=?, pred5k_sec=?,
        pred10k_sec=?, pred_half_sec=?, pred_marathon_sec=? WHERE id=?`).run(
        f.vo2max, f.runningLevel, f.thresholdPaceSec, f.pred5kSec, f.pred10kSec, f.predHalfSec, f.predMarathonSec, sameDay.id,
      );
    } else {
      sqlite.query(`INSERT INTO fitness (captured_at, vo2max, running_level, threshold_pace_sec, pred5k_sec,
        pred10k_sec, pred_half_sec, pred_marathon_sec) VALUES (unixepoch(),?,?,?,?,?,?,?)`).run(
        f.vo2max, f.runningLevel, f.thresholdPaceSec, f.pred5kSec, f.pred10kSec, f.predHalfSec, f.predMarathonSec,
      );
    }
  } catch (e) {
    errors.push(`queryFitnessAssessmentOverview: ${(e as Error).message}`);
  }
  await sleepMs(150);

  try {
    const r = parseRecovery(await callTool("queryRecoveryStatus", {}));
    // 必须按**日历日**去重，不能用「最近 24 小时」。
    // 24 小时窗口会把 10-05 23:00 和 10-06 01:00 这两次同步并成一行，
    // 于是 recovery 历史出现莫名其妙的缺口。
    //
    // ⚠️ JS 侧必须自己拼本地日期，不能用 toISOString()：
    // toISOString() 给的是 UTC 日期，东八区凌晨 0–8 点会得到「昨天」，
    // 而下面 SQL 用的是 'localtime'（本地日期）—— 两侧口径不一致，
    // 早上同步会误把昨天那一行当成今天��� UPDATE。
    const now = new Date();
    const localToday =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const sameDay = sqlite
      .query(
        `SELECT id FROM recovery
         WHERE date(captured_at, 'unixepoch', 'localtime') = ?
         ORDER BY captured_at DESC LIMIT 1`,
      )
      .get(localToday) as { id: number } | undefined;
    if (sameDay) {
      // ⚠️ 更新时必须同时刷新 captured_at。
      // 原先只改数值不动时间戳，导致：(1) 页面显示的时间是「当天第一次同步」
      // 而不是「最新一次」；(2) 跨天更新旧行时，它的 captured_at 仍排在
      // 昨天那行之后，`orderBy(capturedAt)` 取到的「最新」其实是旧数据。
      sqlite.query(
        "UPDATE recovery SET captured_at=unixepoch(), recovery_pct=?, level=?, full_recovery_hours=? WHERE id=?",
      ).run(
        r.recoveryPct, r.level, r.fullRecoveryHours, sameDay.id,
      );
    } else {
      sqlite.query("INSERT INTO recovery (captured_at, recovery_pct, level, full_recovery_hours) VALUES (unixepoch(),?,?,?)").run(
        r.recoveryPct, r.level, r.fullRecoveryHours,
      );
    }
  } catch (e) {
    errors.push(`queryRecoveryStatus: ${(e as Error).message}`);
  }

  // ---- 8. 用户档案 ----
  //
  // 语义是**单行 upsert**：COROS 只对应一个账号，users 表应该永远只有一行。
  //
  // 之前写的是 INSERT + ON CONFLICT(rowid) DO NOTHING —— rowid 对新插入的行
  // 不冲突，于是每次同步都新增一行（实测几十次同步后就攒下一堆重复档案）。
  // 之所以没暴露问题：所有读取都取 all()[0]，重复行不影响结果，纯属数据污染。
  //
  // max_hr / resting_hr 是用户手动填的，不能被 COROS 同步覆盖，所以不在更新列里。
  try {
    const raw = await callTool("queryUserInfo", {});
    const num = (re: RegExp) => Number(raw.match(re)?.[1] ?? NaN);
    sqlite.query(`
      INSERT INTO users (height_cm, weight_kg, birthday, gender, nickname, raw)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(nickname) DO UPDATE SET
        height_cm = excluded.height_cm,
        weight_kg = excluded.weight_kg,
        birthday  = excluded.birthday,
        gender    = excluded.gender,
        raw       = excluded.raw
    `).run(
      num(/Height:\s*([\d.]+)/), num(/Weight:\s*([\d.]+)/),
      raw.match(/Birthday:\s*(\S+)/)?.[1] ?? null,
      raw.match(/Gender:\s*(\w+)/)?.[1] ?? null,
      // queryUserInfo 的返回是 JSON 转义过的文本，Nickname 末尾会残留一个引号
      (raw.match(/Nickname:\s*(.+)/)?.[1] ?? "").replace(/["'\s]+"?\s*$/, "") || null,
      raw,
    );
  } catch (e) {
    errors.push(`queryUserInfo: ${(e as Error).message}`);
  }

  const finishedAt = Math.floor(Date.now() / 1000);
  sqlite.query("UPDATE sync_log SET finished_at=?, status=?, detail=? WHERE started_at=? AND finished_at IS NULL").run(
    finishedAt, errors.length === 0 ? "ok" : "error",
    JSON.stringify({ activities: byId.size, details: detailCount, laps: lapRowCount, errors }),
    startedAt,
  );

  const today = new Date().toISOString().slice(0, 10);
  const quota = sqlite.query("SELECT used FROM fit_quota WHERE day=?").get(today) as { used: number } | undefined;

  return {
    startedAt, finishedAt,
    activities: byId.size, details: detailCount, lapRows: lapRowCount,
    loadDays, healthDays, sleepDays, errors,
    fitQuotaLeft: FIT_DAILY_LIMIT - (quota?.used ?? 0),
  };
}

export { db, activities, activityDetails, laps, trainingLoad, dailyHealth, sleep, heartRate, stress, fitness, recovery, aiReports, fitQuota, syncLog, users };
