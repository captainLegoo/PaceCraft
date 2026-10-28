import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../db/client.ts";
import { getFitDir } from "../altitude.ts";
import { getGarminMultiAuthStatus } from "./auth.ts";
import { downloadGarminFit, fetchAllGarminActivities } from "./client.ts";
import type { GarminActivitySummary, GarminRegion } from "./types.ts";

const PY_LAP_DECODER = `
import sys, json
from fitparse import FitFile

try:
    fit = FitFile(sys.argv[1])
    laps = []
    idx = 1
    cum_time = 0.0
    for m in fit.get_messages("lap"):
        d = {f.name: f.value for f in m}
        dist = d.get("total_distance")
        time = d.get("total_timer_time") or d.get("total_elapsed_time")
        if dist is None or time is None or time <= 0:
            continue
        dist_f = float(dist)
        time_f = float(time)
        cum_time += time_f
        avg_speed = d.get("avg_speed")
        cadence = d.get("avg_cadence") or d.get("avg_running_cadence")
        if cadence is not None and cadence < 120:
            cadence = cadence * 2
        max_cadence = d.get("max_cadence")
        if max_cadence is not None and max_cadence < 120:
            max_cadence = max_cadence * 2
        
        stride = d.get("avg_stride_length")
        if stride is not None:
            stride = float(stride)
        elif cadence and cadence > 0 and time_f > 0 and dist_f > 0:
            total_steps = cadence * (time_f / 60.0)
            if total_steps > 0:
                stride = round(dist_f / total_steps, 2)

        laps.append({
            "lapIndex": idx,
            "distanceM": dist_f,
            "timeSec": time_f,
            "totalLengthSec": round(cum_time, 2),
            "avgPaceSec": round(time_f / (dist_f / 1000.0), 2) if dist_f > 0 else None,
            "avgSpeedRaw": float(avg_speed) if avg_speed else None,
            "avgPower": d.get("avg_power"),
            "avgHr": d.get("avg_heart_rate"),
            "maxHr": d.get("max_heart_rate"),
            "avgCadence": cadence,
            "maxCadence": max_cadence,
            "avgStrideM": stride,
            "elevGain": d.get("total_ascent"),
            "totalDescent": d.get("total_descent"),
        })
        idx += 1
    print(json.dumps(laps))
except Exception:
    print("[]")
`;

export function parseLapsFromFit(fitPath: string): any[] {
  try {
    const raw = execFileSync("python3", ["-c", PY_LAP_DECODER, fitPath], { encoding: "utf8" });
    return JSON.parse(raw.trim());
  } catch {
    return [];
  }
}

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

function mapSportType(typeKey: string = "", sportTypeId?: number): { code: number; label: string } {
  const key = typeKey.toLowerCase();
  if (key === "running" || sportTypeId === 1) return { code: 100, label: "户外跑" };
  if (key === "treadmill_running") return { code: 101, label: "室内跑" };
  if (key === "trail_running") return { code: 102, label: "越野跑" };
  if (key === "track_running") return { code: 103, label: "场地跑" };
  if (key.includes("cycling") || key.includes("biking")) return { code: 200, label: "骑行" };
  if (key.includes("swimming")) return { code: 300, label: "游泳" };
  if (key.includes("hiking") || key.includes("walking")) return { code: 104, label: "徒步" };
  return { code: 100, label: "跑步" };
}

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

      let regionNewCount = 0;
      sqlite.transaction(() => {
        for (const act of activities) {
          const labelId = `garmin_${act.activityId}`;
          const existing = sqlite.query("SELECT 1 FROM activities WHERE label_id = ?").get(labelId);
          if (!existing) regionNewCount++;

          const sport = mapSportType(act.activityType?.typeKey, act.sportTypeId);
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
          const avgCadence = act.averageRunningCadenceInStepsPerMinute
            ? Math.round(act.averageRunningCadenceInStepsPerMinute)
            : null;
          const avgStrideM = act.avgStrideLength ? +(act.avgStrideLength / 100).toFixed(2) : null;
          const elevGain = act.elevationGain ? Math.round(act.elevationGain) : null;
          const elevLoss = act.elevationLoss ? Math.round(act.elevationLoss) : null;
          const rawJson = JSON.stringify(act);

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
            null,
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

      // 接下来只下载并解析缺失 .FIT 或缺失分圈的活动
      const pendingFitList = activities.filter((act) => {
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
                const laps = parseLapsFromFit(fitPath);
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

    updateProgress({
      active: false,
      phase: "done",
      current: totalSyncedCount,
      total: totalSyncedCount,
      percent: 100,
      message: `Garmin 同步完成！共拉取 ${totalSyncedCount} 条记录，新增 ${totalNewActivities} 条，下载 .FIT 文件 ${totalFitDownloaded} 份。`,
    });

    return {
      syncedCount: totalSyncedCount,
      fitDownloaded: totalFitDownloaded,
      newActivities: totalNewActivities,
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
