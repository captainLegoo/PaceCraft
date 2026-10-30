import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../db/client.ts";
import { getFitDir } from "../altitude.ts";
import { parseLapsFromFit } from "../fit-parser.ts";
import { computeUnifiedTrimp, detectActivityConflicts } from "../conflicts.ts";
import { loadSportTypeCodes, mapGarminSportType } from "../sports/types.ts";
import { getGarminMultiAuthStatus } from "./auth.ts";
import { downloadGarminFit, fetchAllGarminActivities } from "./client.ts";
import { syncGarminHealth } from "./health.ts";
import type { GarminActivitySummary, GarminRegion } from "./types.ts";

export { parseLapsFromFit };

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type GarminSyncProgress = {
  active: boolean;
  phase: "idle" | "list" | "fit" | "done" | "error";
  current: number;
  total: number;
  percent: number;
  message: string;
  updatedAt: number;
};

let syncInFlight = false;
let garminSyncProgress: GarminSyncProgress = {
  active: false,
  phase: "idle",
  current: 0,
  total: 0,
  percent: 0,
  message: "空闲",
  updatedAt: Date.now(),
};

export function getGarminSyncProgress(): GarminSyncProgress {
  return garminSyncProgress;
}

function updateProgress(patch: Partial<GarminSyncProgress>) {
  garminSyncProgress = {
    ...garminSyncProgress,
    ...patch,
    updatedAt: Date.now(),
  };
}

// mapSportType 已收拢至 ../sports/types.ts 中的 mapGarminSportType 统一基准

export type SyncGarminOptions = {
  region?: GarminRegion | "all";
  limit?: number;
};

export async function syncGarminActivities(opts?: number | SyncGarminOptions): Promise<{
  syncedCount: number;
  fitDownloaded: number;
  newActivities: number;
}> {
  if (syncInFlight) {
    throw new Error("Garmin 同步任务正在进行中，请稍后再试");
  }

  const options: SyncGarminOptions = typeof opts === "number" ? { limit: opts } : opts || {};
  const targetRegion = options.region ?? "all";
  const limit = options.limit ?? 100;

  const multi = getGarminMultiAuthStatus();
  const regionsToSync: GarminRegion[] = [];
  if (targetRegion === "all") {
    if (multi.cn.connected) regionsToSync.push("cn");
    if (multi.global.connected) regionsToSync.push("global");
    if (regionsToSync.length === 0) {
      throw new Error("尚未连接任何 Garmin 账号");
    }
  } else {
    if (!multi[targetRegion].connected) {
      throw new Error(`Garmin (${targetRegion === "cn" ? "中国区" : "国际区"}) 账号未连接`);
    }
    regionsToSync.push(targetRegion);
  }

  syncInFlight = true;
  updateProgress({
    active: true,
    phase: "list",
    current: 0,
    total: 0,
    percent: 5,
    message: "正在连接 Garmin API...",
  });

  const upsertActivity = sqlite.query(`
    INSERT INTO activities (label_id, sport_type, sport_name, date, date_label, start_ts, end_ts,
      location, lat, lon, duration_sec, distance_km, avg_pace_sec, avg_hr, calories, raw, source, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'garmin', unixepoch())
    ON CONFLICT(label_id) DO UPDATE SET
      sport_type=excluded.sport_type, sport_name=excluded.sport_name, date=excluded.date,
      date_label=excluded.date_label, start_ts=excluded.start_ts, end_ts=excluded.end_ts,
      location=excluded.location, lat=excluded.lat, lon=excluded.lon, duration_sec=excluded.duration_sec,
      distance_km=excluded.distance_km, avg_pace_sec=excluded.avg_pace_sec, avg_hr=excluded.avg_hr,
      calories=excluded.calories, raw=excluded.raw, source='garmin', synced_at=unixepoch()
  `);

  const upsertDetail = sqlite.query(`
    INSERT INTO activity_details (label_id, sport_name, duration_sec, distance_km, avg_pace_sec,
      moving_pace_sec, adjusted_pace_sec, best_km_sec, avg_hr, avg_cadence, avg_stride_m, avg_power,
      elev_gain, elev_loss, calories, training_load, aerobic_te, anaerobic_te, training_focus, performance, raw)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(label_id) DO UPDATE SET
      distance_km=excluded.distance_km, avg_pace_sec=excluded.avg_pace_sec, avg_hr=excluded.avg_hr,
      avg_cadence=excluded.avg_cadence, avg_power=excluded.avg_power, training_load=excluded.training_load,
      performance=excluded.performance, raw=excluded.raw
  `);

  const upsertLap = sqlite.query(`
    INSERT INTO laps (label_id, lap_index, distance_m, time_sec, total_length_sec, avg_pace_sec,
      adjusted_pace_sec, avg_speed_raw, avg_power, avg_hr, max_hr, avg_cadence, max_cadence,
      avg_stride_m, elev_gain, total_descent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(label_id, lap_index) DO UPDATE SET
      distance_m=excluded.distance_m, time_sec=excluded.time_sec, avg_pace_sec=excluded.avg_pace_sec,
      avg_hr=excluded.avg_hr, max_hr=excluded.max_hr, avg_cadence=excluded.avg_cadence,
      avg_stride_m=excluded.avg_stride_m
  `);

  const fitDir = getFitDir();
  if (!existsSync(fitDir)) mkdirSync(fitDir, { recursive: true, mode: 0o700 });

  let totalSyncedCount = 0;
  let totalFitDownloaded = 0;
  let totalNewActivities = 0;

  try {
    for (const region of regionsToSync) {
      const regionLabel = region === "cn" ? "中国区" : "国际区";

      // 智能早停检测器：如果数据库中已存在该活动，增量同步时直接停止后续翻页
      const hasGarminHistory = Boolean(
        sqlite.query("SELECT 1 FROM activities WHERE source = 'garmin' LIMIT 1").get()
      );

      updateProgress({
        phase: "list",
        percent: 10,
        message: `正在连接 Garmin (${regionLabel}) 检查最新训练...`,
      });

      const activities = await fetchAllGarminActivities({
        region,
        maxTotal: limit,
        onBatch: (count) => {
          updateProgress({
            phase: "list",
            current: count,
            total: count,
            percent: Math.min(30, Math.round((count / limit) * 30)),
            message: `Garmin (${regionLabel}): 已扫描到 ${count} 条记录...`,
          });
        },
        stopWhenExists: hasGarminHistory
          ? (actId) => Boolean(sqlite.query("SELECT 1 FROM activities WHERE label_id = ?").get(`garmin_${actId}`))
          : undefined,
      });

      const sportTypeCodes = loadSportTypeCodes();
      const allowedSportCodes = new Set(sportTypeCodes);

      let regionNewCount = 0;
      sqlite.transaction(() => {
        for (const act of activities) {
          const sport = mapGarminSportType(act.activityType?.typeKey, act.sportTypeId);
          // 运动类型白名单过滤：如果该类型未在设置中勾选，则跳过同步入库
          if (!allowedSportCodes.has(sport.code)) {
            continue;
          }

          const labelId = `garmin_${act.activityId}`;
          const existing = sqlite.query("SELECT 1 FROM activities WHERE label_id = ?").get(labelId);
          if (!existing) regionNewCount++;
          const dateLabel = act.startTimeLocal ? act.startTimeLocal.slice(0, 10) : new Date().toISOString().slice(0, 10);
          const date = dateLabel.replace(/-/g, "");
          const startTs = act.beginTimestamp ? Math.floor(act.beginTimestamp / 1000) : null;
          const durationSec = act.duration ? Math.round(act.duration) : 0;
          const endTs = startTs ? startTs + durationSec : null;
          const distanceKm = act.distance ? +(act.distance / 1000).toFixed(3) : 0;
          const avgPaceSec = distanceKm > 0 && durationSec > 0 ? Math.round(durationSec / distanceKm) : null;
          const movingPaceSec =
            distanceKm > 0 && act.movingDuration && act.movingDuration > 0
              ? Math.round(act.movingDuration / distanceKm)
              : avgPaceSec;
          const avgHr = act.averageHR ? Math.round(act.averageHR) : null;
          const calories = act.calories ? Math.round(act.calories) : null;
          let avgCadence = act.averageRunningCadenceInStepsPerMinute
            ? Math.round(act.averageRunningCadenceInStepsPerMinute)
            : null;
          if (avgCadence && avgCadence > 0 && avgCadence < 120) {
            avgCadence = avgCadence * 2; // 单脚 rpm 自动归一化为双脚 spm
          }

          let avgStrideM = act.avgStrideLength ? +(act.avgStrideLength / 100).toFixed(2) : null;
          if (!avgStrideM && avgCadence && avgCadence > 0 && durationSec > 0 && distanceKm > 0) {
            const steps = avgCadence * (durationSec / 60);
            if (steps > 0) {
              avgStrideM = +((distanceKm * 1000) / steps).toFixed(2);
            }
          }

          const elevGain = act.elevationGain ? Math.round(act.elevationGain) : null;
          const elevLoss = act.elevationLoss ? Math.round(act.elevationLoss) : null;
          const rawJson = JSON.stringify(act);
          const unifiedLoad = computeUnifiedTrimp(durationSec, avgHr);

          upsertActivity.run(
            labelId,
            sport.code,
            act.activityName || sport.label,
            date,
            dateLabel,
            startTs,
            endTs,
            act.locationName || null,
            act.startLatitude || null,
            act.startLongitude || null,
            durationSec,
            distanceKm,
            avgPaceSec,
            avgHr,
            calories,
            rawJson,
          );

          upsertDetail.run(
            labelId,
            act.activityName || sport.label,
            durationSec,
            distanceKm,
            avgPaceSec,
            movingPaceSec,
            null,
            null,
            avgHr,
            avgCadence,
            avgStrideM,
            null,
            elevGain,
            elevLoss,
            calories,
            unifiedLoad,
            act.aerobicTrainingEffect || null,
            null,
            null,
            null,
            rawJson,
          );
        }
      })();

      totalSyncedCount += activities.length;
      totalNewActivities += regionNewCount;

      // 接下来只对符合类型白名单且缺失 .FIT 或分圈的活动下载解析
      const pendingFitList = activities.filter((act) => {
        const sport = mapGarminSportType(act.activityType?.typeKey, act.sportTypeId);
        if (!allowedSportCodes.has(sport.code)) return false;

        const labelId = `garmin_${act.activityId}`;
        const fitPath = join(fitDir, `${labelId}.fit`);
        const hasFit = existsSync(fitPath);
        const hasLaps = Boolean(sqlite.query("SELECT 1 FROM laps WHERE label_id = ? LIMIT 1").get(labelId));
        return !hasFit || !hasLaps;
      });

      if (pendingFitList.length === 0) {
        updateProgress({
          phase: "fit",
          percent: 90,
          message: `Garmin (${regionLabel}): 历史分圈与 .FIT 已全部最新，跳过下载`,
        });
      } else {
        let fitDownloaded = 0;
        let finishedCount = 0;

        await mapConcurrent(pendingFitList, 4, async (act) => {
          const labelId = `garmin_${act.activityId}`;
          const fitPath = join(fitDir, `${labelId}.fit`);

          if (!existsSync(fitPath)) {
            try {
              const fitBuf = await downloadGarminFit(act.activityId, region);
              if (fitBuf && fitBuf.length > 0) {
                writeFileSync(fitPath, fitBuf);
                fitDownloaded++;
              }
            } catch (e) {
              console.warn(`下载 Garmin FIT 失败 (${act.activityId}):`, e);
            }
          }

          if (existsSync(fitPath)) {
            const hasLaps = sqlite.query("SELECT 1 FROM laps WHERE label_id = ? LIMIT 1").get(labelId);
            if (!hasLaps) {
              try {
                const laps = await parseLapsFromFit(fitPath);
                if (laps.length > 0) {
                  sqlite.transaction(() => {
                    for (const l of laps) {
                      upsertLap.run(
                        labelId,
                        l.lapIndex,
                        l.distanceM,
                        l.timeSec,
                        l.totalLengthSec,
                        l.avgPaceSec,
                        null,
                        l.avgSpeedRaw,
                        l.avgPower,
                        l.avgHr,
                        l.maxHr,
                        l.avgCadence,
                        l.maxCadence,
                        l.avgStrideM,
                        l.elevGain,
                        l.totalDescent
                      );
                    }
                  })();
                }
              } catch (e) {
                console.warn(`解析 Garmin FIT 分圈失败 (${labelId}):`, e);
              }
            }
          }

          finishedCount++;
          updateProgress({
            phase: "fit",
            current: finishedCount,
            total: pendingFitList.length,
            percent: Math.round(30 + (finishedCount / pendingFitList.length) * 65),
            message: `Garmin (${regionLabel}): 高速并发下载并解析分圈 (${finishedCount}/${pendingFitList.length}): ${act.activityName || act.activityId}...`,
          });
        });

        totalFitDownloaded += fitDownloaded;
      }
    }

    // 同步每日健康与睡眠指标（HRV, Sleep, Body Battery, RHR）
    try {
      updateProgress({
        phase: "fit",
        percent: 94,
        message: "正在同步 Garmin 睡眠、夜间 HRV 与身体电量指标...",
      });
      await syncGarminHealth(14);
    } catch (e) {
      console.warn("[Garmin Health] 健康指标同步异常，跳过继续完成活动:", e);
    }

    // 自动触发跨品牌活动智能去重
    let dedupResult = { detectedPairs: 0, resolved: 0 };
    try {
      dedupResult = detectActivityConflicts({ primaryBrand: "coros" });
      if (dedupResult.detectedPairs > 0) {
        console.log(`[Deduplication] 智能去重：检测到 ${dedupResult.detectedPairs} 对重叠活动，自动归档 ${dedupResult.resolved} 条对比样本`);
      }
    } catch (e) {
      console.warn("[Deduplication] 智能去重检测失败:", e);
    }

    const dedupSummary = dedupResult.detectedPairs > 0 ? `，识别并去重 ${dedupResult.resolved} 对同场记录` : "";
    updateProgress({
      active: false,
      phase: "done",
      current: totalSyncedCount,
      total: totalSyncedCount,
      percent: 100,
      message: `Garmin 同步完成！共拉取 ${totalSyncedCount} 条记录，新增 ${totalNewActivities} 条，解析 FIT 文件 ${totalFitDownloaded} 份${dedupSummary}。`,
    });

    return {
      syncedCount: totalSyncedCount,
      fitDownloaded: totalFitDownloaded,
      newActivities: totalNewActivities,
      conflictsDetected: dedupResult.detectedPairs,
      conflictsResolved: dedupResult.resolved,
    };
  } catch (err) {
    updateProgress({
      active: false,
      phase: "error",
      current: 0,
      total: 0,
      percent: 0,
      message: `Garmin 同步失败: ${(err as Error).message}`,
    });
    throw err;
  } finally {
    syncInFlight = false;
  }
}
