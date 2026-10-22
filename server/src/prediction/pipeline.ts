import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { activities, activityDetails, dailyHealth, fitness, laps, trainingLoad, users } from "../db/schema.ts";
import { round } from "../analytics.ts";
import {
  climbAbility,
  classifyTerrain,
  climbRate,
  flatEquivalentPace,
  fitClimbModel,
  TERRAIN_LABEL,
  type ClimbSample,
  type Terrain,
} from "../terrain.ts";
import {
  bestContinuousEffort,
  estimateThreshold,
  fitPersonalExponent,
  predictAll,
  sanitizeLaps,
  trainingZones,
  type Effort,
  type Prediction,
  type Threshold,
} from "./engine.ts";
import { computeFatigue, restingHrBaseline } from "./fatigue.ts";
import { computeDailyLoads } from "./dailyLoad.ts";

/** Tanaka 公式：最大心率 = 208 - 0.7 × 年龄 */
export const tanakaMaxHr = (age: number) => 208 - 0.7 * age;

/** 需要提取最佳成绩的目标距离 */
const EFFORT_TARGETS = [1, 3, 5, 8, 10, 12, 15, 21.0975, 30, 42.195];

/**
 * 近 N 周平均周跑量（公里/周）。
 *
 * 周划分用周一为起点（ISO），并按周对齐而不是滚动 56 天 ——
 * 滚动窗口会把边界的一周算成半周，导致短周期训练期被低估。
 */
export function averageWeeklyKm(
  runs: { dateLabel: string; distanceKm: number | null }[],
  latestDate: string,
  weeks: number,
): number {
  const weekly = new Map<string, number>();
  for (const r of runs) {
    const km = r.distanceKm ?? 0;
    if (km < 1) continue; // 忽略 <1km 的零散记录
    const d = new Date(`${r.dateLabel}T00:00:00Z`);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weekly.set(key, (weekly.get(key) ?? 0) + km);
  }
  const sorted = [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const recent = sorted.slice(-weeks);
  if (recent.length === 0) return 0;
  return recent.reduce((s, [, v]) => s + v, 0) / recent.length;
}

export type PredictionReport = ReturnType<typeof buildReport>;

export function buildReport() {
  const profile = db.select().from(users).all()[0] ?? null;

  // 周跑量与「实际跑过的最长距离」需要完整的活动摘要（不只分圈）
  const allActivities = db
    .select({
      dateLabel: activities.dateLabel,
      distanceKm: activities.distanceKm,
      durationSec: activities.durationSec,
    })
    .from(activities)
    .orderBy(desc(activities.dateLabel))
    .all();

  const age = profile?.birthday
    ? Math.floor((Date.now() - new Date(profile.birthday).getTime()) / (365.25 * 86400000))
    : 30;
  const hrMax = tanakaMaxHr(age);

  // ---- 拉全部分圈（join 出日期与开始时间），脏数据统一在这里过滤 ----
  const rawLaps = db
    .select({
      labelId: laps.labelId,
      date: activities.dateLabel,
      startTs: activities.startTs,
      lapIndex: laps.lapIndex,
      distanceM: laps.distanceM,
      timeSec: laps.timeSec,
      avgHr: laps.avgHr,
      // 爬升与距离一起带出来：逐圈的爬升率是拟合爬升代价模型的原料
      elevGain: laps.elevGain,
    })
    .from(laps)
    .innerJoin(activities, eq(laps.labelId, activities.labelId))
    .orderBy(asc(activities.startTs), asc(laps.labelId), asc(laps.lapIndex))
    .all();

  const clean = sanitizeLaps(rawLaps as any[]);

  // ---- 拟合爬升代价模型（用全部分圈，不只 1km）----
  // 只用 1km 分圈会让样本里几乎没有短距离段，爬升率的取值范围变窄；
  // 全部分圈里 400m~1km 各种圈距都有，爬升率分布更完整。
  const modelSamples: ClimbSample[] = clean
    .filter((l) => l.distanceM > 300 && l.avgHr > 60)
    .map((l) => ({
      paceSec: l.timeSec / (l.distanceM / 1000),
      hr: l.avgHr,
      rate: climbRate(l.elevGain, l.distanceM / 1000),
    }));

  const climbModel = fitClimbModel(modelSamples);

  // ---- 给每个分圈算平路等效配速（GAP）----
  // 后续所有能力计算都用 GAP，地形才不会污染阈值和成绩外推。
  for (const l of clean) {
    l.climbRate = climbRate(l.elevGain, l.distanceM / 1000);
    l.gapPaceSec = flatEquivalentPace(l.timeSec / (l.distanceM / 1000), l.climbRate, climbModel);
  }

  // ---- 阈值配速：只在有氧区间做回归，且用平路等效配速 ----
  const paceHrSamples = clean
    .filter((l) => l.distanceM > 850 && l.distanceM < 1150 && l.avgHr > 90)
    .map((l) => ({ paceSec: l.gapPaceSec, hr: l.avgHr }));

  const slowestPaceSeen = clean.length
    ? Math.max(...clean.map((l) => l.gapPaceSec))
    : 300;

  const threshold: Threshold = estimateThreshold(paceHrSamples, { hrMax, slowestPaceSeen });

  // ---- 每个目标距离的最佳连续成绩 ----
  const byAct = new Map<string, typeof clean>();
  for (const l of clean) {
    const arr = byAct.get(l.labelId) ?? [];
    arr.push(l);
    byAct.set(l.labelId, arr);
  }

  const loadMap = new Map<string, number>();
  for (const l of db.select().from(trainingLoad).all()) loadMap.set(l.date, l.shortLoad ?? 0);

  const efforts: Effort[] = [];
  for (const lapsOfAct of byAct.values()) {
    if (lapsOfAct.length < 2) continue;
    for (const km of EFFORT_TARGETS) {
      const e = bestContinuousEffort(lapsOfAct, km);
      if (e) efforts.push({ ...e, loadThatDay: loadMap.get(e.date) ?? null });
    }
  }

  // ---- 个人 Riegel 指数：只用每个距离的最佳锚点，避免重复/次优成绩污染 ----
  const bestOne = new Map<number, Effort>();
  for (const e of efforts) {
    const cur = bestOne.get(e.targetKm);
    if (!cur || e.paceSec < cur.paceSec) bestOne.set(e.targetKm, e);
  }
  const anchors = [...bestOne.values()];
  const exponent = fitPersonalExponent(anchors, threshold.paceSec);

  // ---- 官方预测用于对照 ----
  const fitRow = db.select().from(fitness).orderBy(desc(fitness.capturedAt)).limit(1).get();
  const official: Record<number, number | null> = fitRow
    ? {
        5: fitRow.pred5kSec,
        10: fitRow.pred10kSec,
        15: null,
        21.0975: fitRow.predHalfSec,
        42.195: fitRow.predMarathonSec,
      }
    : {};

  const latestRow = db
    .select({ d: activities.dateLabel })
    .from(activities)
    .orderBy(desc(activities.dateLabel))
    .limit(1)
    .get();
  const latestDate = latestRow?.d ?? new Date().toISOString().slice(0, 10);

  // ---- 近 8 周平均周跑量（Vickers 周跑量修正用）----
  // Vickers & Vertosick(2016) 证明周跑量是解释全马预测误差的唯一显著变量：
  // 周跑量越高，全马的实际疲劳衰减越小。系数按「每 10 英里」标定。
  const weeklyKm = averageWeeklyKm(allActivities, latestDate, 8);

  // ---- 最能代表比赛强度的长距离实跑 ----
  // 选「跑得快」而不是「跑得远」或「跑得新」：
  //  · 跑得远（31km 那次）常是慢速有氧长跑，299s/km 完全不是比赛强度
  //  · 跑得新但慢，同上
  //  · 跑得最快的那次又可能是半年前的，recency 一衰减就失效
  // 所以按「距离 ≥ 40km」先过滤，再在其中取配速最快的一次 ——
  // 这个距离下配速快才说明是接近比赛强度的长跑。
  const marathonPace = allActivities
    .filter((a): a is typeof a & { distanceKm: number; durationSec: number } =>
      a.distanceKm != null && a.durationSec != null && a.distanceKm >= 40 && a.durationSec > 0,
    )
    .map((a) => ({ dateLabel: a.dateLabel, distanceKm: a.distanceKm, durationSec: a.durationSec }))
    // 距离归一化后再比配速，避免 40.1km 天然快于 42.7km
    .sort((a, b) => a.durationSec / a.distanceKm - b.durationSec / b.distanceKm);
  const longestActual = marathonPace.length ? marathonPace[0] : null;

  const predictions: Prediction[] = predictAll({
    efforts,
    threshold,
    k: exponent.k,
    official,
    latestDate,
    weeklyKm,
    longestActual: longestActual
      ? {
          km: longestActual.distanceKm!,
          sec: longestActual.durationSec!,
          date: longestActual.dateLabel,
        }
      : null,
  });
  const zones = trainingZones(threshold, predictions);

  // ---- 疲劳指数：负荷累积 + 恢复不足 + 连续高负荷 ----
  // 单独一个模块，因为它回答的是另一个问题：
  // 预测回答「能力上限在哪」，疲劳指数回答「现在离上限有多远」。
  //
  // 负荷源用 activities 自算，不用 training_load.short_load：
  // 后者实测没有一天是 0，是 COROS 的衰减存量而非当日负荷，
  // 休息日不存在、单次长距离被摊平，导致三个分量同时塌成 0。
  const healthRows = db
    .select({
      dateLabel: dailyHealth.dateLabel,
      restingHr: dailyHealth.restingHr,
      stressAvg: dailyHealth.stressAvg,
      hrvBaseline: dailyHealth.hrvBaseline,
    })
    .from(dailyHealth)
    .orderBy(asc(dailyHealth.dateLabel))
    .all();

  // 强度因子要用静息心率做 HRR 的下界，优先取设置或实测基线
  const restHrForLoad = profile?.restingHr ?? restingHrBaseline(healthRows) ?? 55;

  const dailyLoads = computeDailyLoads(
    db
      .select({
        date: activities.dateLabel,
        sportType: activities.sportType,
        durationSec: activities.durationSec,
        avgHr: activities.avgHr,
        distanceKm: activities.distanceKm,
      })
      .from(activities)
      .orderBy(asc(activities.dateLabel))
      .all(),
    { hrmax: tanakaMaxHr(age), restHr: restHrForLoad },
  );

  const fatigue = computeFatigue({
    loads: dailyLoads,
    health: healthRows,
    today: latestDate,
  });

  // ---- 爬升能力：独立于配速的一项能力 ----
  const climb = climbAbility(modelSamples, climbModel);

  // ---- 训练量按地形拆分 ----
  // 光看总跑量不知道其中有多少是在起伏路上完成的，
  // 而这直接决定阈值配速的可信度（平路样本越多越可信）。
  const terrainRows = db
    .select({
      distanceKm: activities.distanceKm,
      durationSec: activities.durationSec,
      elevGain: activityDetails.elevGain,
    })
    .from(activities)
    .leftJoin(activityDetails, eq(activities.labelId, activityDetails.labelId))
    .orderBy(desc(activities.dateLabel))
    .all();

  const terrainBuckets: Record<Terrain, { count: number; distanceKm: number; durationSec: number; elevGain: number }> = {
    flat: { count: 0, distanceKm: 0, durationSec: 0, elevGain: 0 },
    rolling: { count: 0, distanceKm: 0, durationSec: 0, elevGain: 0 },
  };
  for (const r of terrainRows) {
    if ((r.distanceKm ?? 0) <= 0) continue;
    const rate = climbRate(r.elevGain, r.distanceKm);
    const b = terrainBuckets[classifyTerrain(rate)];
    b.count += 1;
    b.distanceKm += r.distanceKm ?? 0;
    b.durationSec += r.durationSec ?? 0;
    b.elevGain += r.elevGain ?? 0;
  }
  const totalDist = terrainBuckets.flat.distanceKm + terrainBuckets.rolling.distanceKm;

  const terrainSplit = (Object.keys(terrainBuckets) as Terrain[]).map((t) => {
    const b = terrainBuckets[t];
    return {
      terrain: t,
      label: TERRAIN_LABEL[t],
      count: b.count,
      distanceKm: round(b.distanceKm, 1),
      durationSec: b.durationSec,
      elevGain: b.elevGain,
      sharePct: totalDist > 0 ? round((b.distanceKm / totalDist) * 100, 1) : 0,
      avgClimbRate:
        b.count > 0 ? round(b.elevGain / b.distanceKm, 1) : 0,
    };
  });

  const comparison = predictions
    .filter((p) => p.officialSeconds != null)
    .map((p) => {
      const off = p.officialSeconds!;
      return {
        distanceKm: p.distanceKm,
        name: p.name,
        mine: p.seconds,
        official: off,
        deltaSec: p.seconds - off,
        deltaPct: ((p.seconds - off) / off) * 100,
      };
    });

  const dates = clean.map((l) => l.date).sort();

  return {
    generatedAt: Math.floor(Date.now() / 1000),
    age,
    hrMax,
    threshold,
    exponent,
    anchors,
    weeklyKm: round(weeklyKm, 1),
    fatigue,
    longestActual: longestActual
      ? {
          km: longestActual.distanceKm!,
          sec: longestActual.durationSec!,
          date: longestActual.dateLabel,
          paceSec: Math.round(longestActual.durationSec! / longestActual.distanceKm!),
        }
      : null,
    // 爬升相关：代价模型 + 爬升能力 + 训练量地形分布
    climb,
    terrainSplit,
    // 只回传最佳锚点（10 条），完整明细留在服务端，避免 127KB 的载荷
    efforts: [...bestOne.values()].sort((a, b) => a.targetKm - b.targetKm),
    candidateCounts: Object.fromEntries(
      EFFORT_TARGETS.map((km) => [km, efforts.filter((e) => e.targetKm === km).length]),
    ),
    predictions,
    zones,
    comparison,
    official: {
      vo2max: fitRow?.vo2max ?? null,
      runningLevel: fitRow?.runningLevel ?? null,
      thresholdPaceSec: fitRow?.thresholdPaceSec ?? null,
      pred5kSec: fitRow?.pred5kSec ?? null,
      pred10kSec: fitRow?.pred10kSec ?? null,
      predHalfSec: fitRow?.predHalfSec ?? null,
      predMarathonSec: fitRow?.predMarathonSec ?? null,
    },
    meta: {
      activitiesAnalyzed: byAct.size,
      lapsAnalyzed: clean.length,
      lapsDropped: rawLaps.length - clean.length,
      dateRange: dates.length ? ([dates[0], dates[dates.length - 1]] as [string, string]) : null,
      anchorCount: anchors.length,
    },
  };
}
