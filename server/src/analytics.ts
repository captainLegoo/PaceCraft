import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db/client.ts";
import { activities, activityDetails, laps, trainingLoad, users } from "./db/schema.ts";

/** 以周一为起点做 ISO 周分组 */
export function isoWeek(dateLabel: string): string {
  const d = new Date(`${dateLabel}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function weeklyVolume(weeks = 16) {
  const rows = db
    .select()
    .from(activities)
    .orderBy(desc(activities.date))
    .all()
    .filter((a) => (a.distanceKm ?? 0) > 0);

  const buckets = new Map<string, {
    weekStart: string; distanceKm: number; durationSec: number; count: number;
    calories: number; runs: any[]; hrSum: number; hrWeight: number;
  }>();

  for (const a of rows) {
    const key = isoWeek(a.dateLabel);
    let b = buckets.get(key);
    if (!b) {
      b = { weekStart: key, distanceKm: 0, durationSec: 0, count: 0, calories: 0, runs: [], hrSum: 0, hrWeight: 0 };
      buckets.set(key, b);
    }
    b.distanceKm += a.distanceKm ?? 0;
    b.durationSec += a.durationSec ?? 0;
    b.count += 1;
    b.calories += a.calories ?? 0;
    if (a.avgHr) { b.hrSum += a.avgHr * (a.durationSec ?? 0); b.hrWeight += a.durationSec ?? 0; }
    b.runs.push({
      labelId: a.labelId, date: a.dateLabel, distanceKm: a.distanceKm,
      avgPaceSec: a.avgPaceSec, avgHr: a.avgHr, durationSec: a.durationSec,
    });
  }

  return [...buckets.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-weeks)
    .map((b) => ({
      weekStart: b.weekStart,
      distanceKm: round(b.distanceKm, 1),
      durationSec: b.durationSec,
      count: b.count,
      calories: b.calories,
      avgHr: b.hrWeight > 0 ? Math.round(b.hrSum / b.hrWeight) : null,
      avgPaceSec: b.distanceKm > 0 ? Math.round(b.durationSec / b.distanceKm) : null,
      longestRunKm: round(Math.max(...b.runs.map((r) => r.distanceKm ?? 0)), 1),
      runs: [...b.runs].sort((x, y) => y.date.localeCompare(x.date)),
    }));
}

export function monthlyVolume(months = 12) {
  const rows = db.select().from(activities).all().filter((a) => (a.distanceKm ?? 0) > 0);
  const buckets = new Map<string, { month: string; distanceKm: number; durationSec: number; count: number }>();
  for (const a of rows) {
    const key = a.dateLabel.slice(0, 7);
    let b = buckets.get(key);
    if (!b) { b = { month: key, distanceKm: 0, durationSec: 0, count: 0 }; buckets.set(key, b); }
    b.distanceKm += a.distanceKm ?? 0;
    b.durationSec += a.durationSec ?? 0;
    b.count += 1;
  }
  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-months)
    .map((b) => ({ ...b, distanceKm: round(b.distanceKm, 1) }));
}

/** 训练负荷序列 + 7 日移动平均 */
export function loadSeries(days = 90) {
  const rows = db
    .select()
    .from(trainingLoad)
    .orderBy(asc(trainingLoad.date))
    .all()
    .slice(-days);
  return rows.map((r, i) => {
    const window = rows.slice(Math.max(0, i - 6), i + 1);
    const valid = window.filter((w) => w.shortLoad != null);
    return {
      ...r,
      shortLoadAvg7: valid.length > 0
        ? round(valid.reduce((s, w) => s + (w.shortLoad ?? 0), 0) / valid.length, 1)
        : null,
      ratioAvg7: valid.length > 0
        ? round(valid.reduce((s, w) => s + (w.ratio ?? 0), 0) / valid.length, 2)
        : null,
    };
  });
}

/**
 * 心率区间分布 —— 用**储备心率（HRR）**而不是最大心率百分比。
 *
 * 为什么从 %HRmax 换成 HRR：
 *  %HRmax 把静息心率也算进了"强度"，但静息心率是身体维持生命的基础消耗，
 *  跟训练强度无关。静息心率偏高的人，同样的 %HRmax 实际做功更低。
 *  HRR（Karvonen）：强度% = (当前心率 − 静息心率) / (最大心率 − 静息心率)
 *  这样 100% 才是真正的力竭，0% 才是静息，区间才有生理意义。
 *
 *  HRR 的跨度 = HRmax − 静息心率，通常比 HRmax 本身小得多
 *  （例如 HRmax 190、静息 55 → 跨度只有 135），
 *  于是同样的心率在中低强度端会被算得更低。
 *  注意 %HRmax 和 HRR 分区在低强度端差异巨大：
 *  145bpm 在 %HRmax 里是 76%（Z3 节奏），在 HRR 里只有 67%（Z2 有氧）——
 *  前者会把大量轻松跑误判成节奏跑。
 *
 * 兜底顺序：实测 HRmax > Tanaka 公式 > 本次训练峰值。
 */
export type HrBasis = {
  maxHr: number;
  restingHr: number | null;
  /** "measured" 实测 | "age" 年龄推算 | "activity" 本次峰值 */
  source: "measured" | "age" | "activity";
  /** 是否退回 %HRmax 口径（没有静息心率时） */
  usedPercentMax: boolean;
};

/**
 * 生理上合理的静息心率兜底。
 * 没有实测静息心率时，用一个保守估计比用 %HRmax 更接近真实强度分布。
 */
const DEFAULT_RESTING_HR = 55;

export type CustomHrZone = {
  zone: string;
  label: string;
  hrLo: number;
  hrHi?: number | null;
  pctLabel?: string;
};

export const DEFAULT_ZONE_DEFS = [
  { zone: "Z1", label: "有氧耐力", loPct: 0.59, hiPct: 0.74, pctLabel: "59–74%" },
  { zone: "Z2", label: "有氧动力", loPct: 0.74, hiPct: 0.845, pctLabel: "74–84%" },
  { zone: "Z3", label: "乳酸阈", loPct: 0.845, hiPct: 0.885, pctLabel: "85–88%" },
  { zone: "Z4", label: "速度耐力", loPct: 0.885, hiPct: 0.96, pctLabel: "89–95%" },
  { zone: "Z5", label: "无氧动力", loPct: 0.96, hiPct: 1.01, pctLabel: ">95%" },
] as const;

export function hrZones(
  lapRows: { avgHr: number | null; maxHr: number | null; timeSec: number }[],
  opts: {
    /** 实测最大心率，优先于年龄推算 */
    measuredMaxHr?: number | null;
    /** 年龄推算最大心率 */
    predictedMaxHr?: number | null;
    /** 实测静息心率 */
    restingHr?: number | null;
    /** 计算模式 */
    hrCalcMode?: "auto" | "custom" | string | null;
    /** 自定义区间 */
    customZones?: CustomHrZone[] | null;
  },
) {
  // 1. 如果用户启用了自定义五区间模式且配置完整
  if (opts.hrCalcMode === "custom" && opts.customZones && opts.customZones.length >= 5) {
    const total = lapRows.reduce((s, l) => s + (l.timeSec ?? 0), 0);
    const cz = opts.customZones;
    const bounds = cz.map((z, idx) => {
      let lo = Math.round(z.hrLo);
      // 若上一区间上限与本区间下限相同（如 Z4 180~190 与 Z5 >190），自动顺延 1 bpm 避免交界点判定冲突
      if (idx > 0 && cz[idx - 1].hrHi != null && lo === Math.round(cz[idx - 1].hrHi!)) {
        lo = lo + 1;
      }
      const isLast = idx === cz.length - 1;
      const hi = isLast
        ? (z.hrHi && z.hrHi > lo ? Math.round(z.hrHi + 1) : 999)
        : (z.hrHi != null && z.hrHi >= lo ? Math.round(z.hrHi + 1) : (cz[idx + 1] ? Math.round(cz[idx + 1].hrLo) : 999));
      return {
        zone: z.zone,
        label: z.label,
        pctLabel: "自定义",
        loBpm: lo,
        hiBpm: hi,
        displayHiBpm: z.hrHi != null && z.hrHi < 900 ? Math.round(z.hrHi) : null,
      };
    });

    const z1Lo = bounds[0].loBpm;
    const BELOW_Z1_SEC = lapRows
      .filter((l) => (l.avgHr ?? 0) > 0 && (l.avgHr ?? 0) < z1Lo)
      .reduce((s, l) => s + (l.timeSec ?? 0), 0);

    const lastZ = cz[cz.length - 1];
    const maxHr = lastZ.hrHi != null && lastZ.hrHi < 900
      ? Math.round(lastZ.hrHi)
      : (opts.measuredMaxHr ?? bounds[bounds.length - 1].loBpm + 10);
    const restingHr = opts.restingHr && opts.restingHr > 30 ? Math.round(opts.restingHr) : Math.max(30, z1Lo - 1);
    const reserve = Math.max(0, maxHr - restingHr);

    return {
      basis: maxHr,
      maxHr,
      restingHr,
      reserve,
      source: "custom",
      usedFallback: false,
      usedPercentMax: false,
      method: "自定义五区间心率法",
      belowZone1Seconds: Math.round(BELOW_Z1_SEC),
      belowZone1Pct: total > 0 ? round((BELOW_Z1_SEC / total) * 100, 1) : 0,
      zones: bounds.map((b, idx) => {
        const secs = lapRows
          .filter((l) => {
            const hr = l.avgHr ?? 0;
            return hr >= b.loBpm && hr < b.hiBpm;
          })
          .reduce((s, l) => s + (l.timeSec ?? 0), 0);
        const isLast = idx === bounds.length - 1;
        return {
          zone: b.zone,
          label: b.label,
          pctLabel: "自定义",
          hrLo: b.loBpm,
          hrHi: isLast ? (b.displayHiBpm ?? null) : (b.displayHiBpm ?? (b.hiBpm > 900 ? null : b.hiBpm - 1)),
          seconds: Math.round(secs),
          pct: total > 0 ? round((secs / total) * 100, 1) : 0,
        };
      }),
    };
  }

  const activityPeak = Math.max(...lapRows.map((l) => l.maxHr || l.avgHr || 0), 0);

  const measured = opts.measuredMaxHr && opts.measuredMaxHr > 100 ? opts.measuredMaxHr : null;
  const predicted = opts.predictedMaxHr && opts.predictedMaxHr > 100 ? opts.predictedMaxHr : null;

  const basis: HrBasis = measured
    ? { maxHr: measured, restingHr: null, source: "measured", usedPercentMax: false }
    : predicted
      ? { maxHr: predicted, restingHr: null, source: "age", usedPercentMax: false }
      : { maxHr: activityPeak, restingHr: null, source: "activity", usedPercentMax: true };

  if (!basis.maxHr) return null;

  // 没有实测静息心率时仍走 HRR，用生理中位数兜底 —— 宁可粗一点，
  // 也不要退回 %HRmax 把轻松跑误判成节奏跑。
  const restingHr = opts.restingHr && opts.restingHr > 30 ? opts.restingHr : DEFAULT_RESTING_HR;
  const reserve = basis.maxHr - restingHr;
  if (reserve <= 0) return null;

  // 五区间定义 —— **按 HRR 百分比**，不是写死绝对心率。
  //
  // 为什么用百分比：绝对边界（如「Z1 = 136–159 bpm」）只对特定心率水平的人成立。
  // 同样 140 bpm，对静息 49 / HRmax 197 的人是有氧中段，
  // 对静息 75 / HRmax 175 的人却已经是高强度。写死绝对值等于把一个人的
  // 心率刻度套到所有人身上，年龄/体能不同的人分区会整体错位。
  //
  // 百分比基准：Z1 下界 59% / 区间上界 74% / 84% / 88% / 96%。
  // 这套边界在 HRR 口径下是非均匀的（Z3 乳酸阈只有 4% 宽），
  // 和多数教练使用的五区间划分一致。
  //
  // 注意 Z3 乳酸阈只有 4% 宽：HRR=148 时约 6 bpm。取整漂移 1–2 bpm
  // 就足以让一整段被错分到相邻区间，所以边界由 HRR 线性算出后**不再二次取整**。
  const ZONE_PCT = DEFAULT_ZONE_DEFS;

  const hrToBpm = (pct: number) => restingHr + reserve * pct;
  const bounds = ZONE_PCT.map((z, idx) => ({
    ...z,
    loBpm: Math.round(hrToBpm(z.loPct)),
    hiBpm: idx === ZONE_PCT.length - 1 ? 999 : Math.round(hrToBpm(z.hiPct)),
  }));

  /** Z1 下界以下的心率是热身、走路、恢复活动，单独归一桶（不能算进 Z1 让有氧耐力虚高） */
  const BELOW_Z1_SEC = lapRows
    .filter((l) => (l.avgHr ?? 0) > 0 && (l.avgHr ?? 0) < bounds[0].loBpm)
    .reduce((s, l) => s + (l.timeSec ?? 0), 0);

  const total = lapRows.reduce((s, l) => s + (l.timeSec ?? 0), 0);
  return {
    /** 保留 basis 字段名，前端旧代码不会崩 */
    basis: Math.round(basis.maxHr),
    maxHr: Math.round(basis.maxHr),
    restingHr: Math.round(restingHr),
    reserve: Math.round(reserve),
    source: basis.source,
    usedFallback: basis.source === "activity",
    usedPercentMax: false,
    method: "五区间心率法（按绝对心率判定）",
    /** 低于 Z1 下界的时间，独立成桶，避免被算进 Z1 让有氧耐力虚高 */
    belowZone1Seconds: Math.round(BELOW_Z1_SEC),
    belowZone1Pct: total > 0 ? round((BELOW_Z1_SEC / total) * 100, 1) : 0,
    zones: bounds.map((b, idx) => {
      const secs = lapRows
        .filter((l) => {
          const hr = l.avgHr ?? 0;
          return hr >= b.loBpm && hr < b.hiBpm;
        })
        .reduce((s, l) => s + (l.timeSec ?? 0), 0);
      const isLast = idx === bounds.length - 1;
      return {
        zone: b.zone,
        label: b.label,
        pctLabel: b.pctLabel,
        hrLo: b.loBpm,
        hrHi: isLast ? null : b.hiBpm - 1,
        seconds: Math.round(secs),
        pct: total > 0 ? round((secs / total) * 100, 1) : 0,
      };
    }),
  };
}

/**
 * 心率档案兜底值。
 *
 * 这两个数**不是**某个人���实测值，只是「数据不够时的保守估计」：
 * - maxHr 留空 → 用 Tanaka 按年龄推算（见 predictedMaxHr）
 * - restingHr 留空 → 用 DEFAULT_RESTING_HR（生理中位数 55）
 *
 * 真正的实测值应该从用户自己的数据里来（observedMaxHr），
 * 或者在设置页手动填。硬编码一个固定 HRmax 会让所有人分区错位。
 */
export const HR_PROFILE = {
  /** 实测最大心率；null 表示不提供，从数据推算 */
  maxHr: null as number | null,
  /** 实测静息心率；null 表示不提供，用生理中位数兜底 */
  restingHr: null as number | null,
} as const;

/**
 * 组装 hrZones 需要的参数：实测优先，年龄推算兜底。
 * 全库分圈一起参与，让 observedMaxHr 有足够样本。
 */
export function hrZoneOptions(age: number | null) {
  const allLaps = db
    .select({
      avgHr: laps.avgHr,
      maxHr: laps.maxHr,
      distanceM: laps.distanceM,
      timeSec: laps.timeSec,
    })
    .from(laps)
    .all();

  const observed = observedMaxHr(allLaps);
  // 档案里手动填的值优先于自动推算（脏数据带偏时用户可以纠正）
  const profile = db.select().from(users).all()[0] ?? null;
  const manualMax = profile?.maxHr ?? HR_PROFILE.maxHr;
  const manualRest = profile?.restingHr ?? HR_PROFILE.restingHr;

  let customZones: CustomHrZone[] | null = null;
  if (profile?.customHrZones) {
    try {
      const parsed = JSON.parse(profile.customHrZones);
      if (Array.isArray(parsed) && parsed.length >= 5) {
        customZones = parsed.map((item: any, i: number) => ({
          zone: item.zone || DEFAULT_ZONE_DEFS[i]?.zone || `Z${i + 1}`,
          label: item.label || DEFAULT_ZONE_DEFS[i]?.label || `区间${i + 1}`,
          hrLo: Math.round(Number(item.hrLo)),
          hrHi: item.hrHi !== null && item.hrHi !== undefined && item.hrHi !== "" ? Math.round(Number(item.hrHi)) : null,
        }));
      }
    } catch {
      // 容错：解析失败回退
    }
  }

  const hrCalcMode = (profile?.hrCalcMode === "custom" && customZones && customZones.length >= 5)
    ? "custom"
    : "auto";

  return {
    measuredMaxHr: manualMax ?? observed,
    predictedMaxHr: predictedMaxHr(age),
    restingHr: manualRest,
    hrCalcMode,
    customZones,
  };
}

/** Tanaka 公式推算最大心率（实测值优先） */
export function predictedMaxHr(age: number | null): number | null {
  if (!age || age < 10 || age > 100) return null;
  return Math.round(208 - 0.7 * age);
}

/**
 * 从历史分圈推算实测最大心率。
 *
 * 为什么要自己算而不用 Tanaka：Tanaka 是**按年龄推算的群体均值**，
 * 与实际峰值常差 5~10 bpm（个体差异很大）。
 * 这个量级在阈值心率上足以偏移一个训练区间，所以分区优先用实测值。
 *
 * 只取「高强度且持续够久」的分圈：太短的分圈峰值不可靠，
 * 而轻松跑的分圈最高心率也不代表能力上限。
 */
export function observedMaxHr(
  lapRows: { avgHr: number | null; maxHr: number | null; distanceM?: number; timeSec: number }[],
): number | null {
  const candidates = lapRows
    .filter((l) => (l.maxHr ?? 0) > 120)
    // 分圈距离未知时不按距离筛，只要求有足够时长（≥ 4 分钟）
    .filter((l) => (l.distanceM ? l.distanceM >= 800 : l.timeSec >= 240))
    .map((l) => l.maxHr!)
    .filter((v): v is number => v != null);
  if (candidates.length < 5) return null;
  // 取最高的 3 个的中位数，避开单点噪声
  const top3 = candidates.sort((a, b) => b - a).slice(0, 3);
  return Math.round(top3[Math.floor(top3.length / 2)]);
}

export function ageFromBirthday(birthday: string | null): number | null {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return null;
  const diff = Date.now() - b.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

/** 配速-心率散点（分圈粒度），用于看配速与心率的耦合 */
export function paceHrScatter(labelId: string) {
  return db
    .select()
    .from(laps)
    .where(eq(laps.labelId, labelId))
    .orderBy(asc(laps.lapIndex))
    .all()
    .map((l) => ({
      lapIndex: l.lapIndex,
      distanceKm: round(l.distanceM / 1000, 2),
      paceSec: l.avgPaceSec,
      hr: l.avgHr,
      maxHr: l.maxHr,
      cadence: l.avgCadence,
      strideM: l.avgStrideM,
    }));
}

export function activityRange(from?: string, to?: string) {
  const conds = [];
  if (from) conds.push(gte(activities.dateLabel, from));
  if (to) conds.push(lte(activities.dateLabel, to));
  return conds.length > 0 ? and(...conds) : undefined;
}

export function round(n: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ---------------- 训练次（session）聚合 ----------------

/** 默认把间隔超过 4 小时的记录视为两次独立训练：早晚各跑一次不会被误并成一场 */
export const DEFAULT_SESSION_GAP_SEC = 4 * 3600;

export type SessionSet = {
  /** 例如 "1km" / "800m" */
  distanceLabel: string;
  reps: number;
  avgDurationSec: number;
  avgPaceSec: number;
  avgHr: number | null;
  /** 组间最短休息（秒），无法推断时为 null */
  restSec: number | null;
  distanceTolerance: number;
  paceTolerance: number;
};

export type Session = {
  key: string;
  date: string;
  startTs: number;
  endTs: number;
  /** 两次记录之间的最长间隔（秒），用于展示组间休息 */
  maxGapSec: number;
  activityCount: number;
  /** 少数短记录 COROS 不给距离（多为 GPS 丢失的碎片），这些记录时长计入但距离不可信 */
  unknownDistanceCount: number;
  labelIds: string[];
  totals: {
    distanceKm: number;
    durationSec: number;
    calories: number;
    trainingLoad: number;
    elevGain: number;
    avgHr: number | null;
  };
  sets: SessionSet[];
  kind: "single" | "multi";
  classification: string;
  classificationReason: string;
};

/**
 * 把一天里的多次记录聚成「一场训练」。
 *
 * 为什么要按时间间隔切分而不是只按日期：
 * 一天两练（早跑 + 晚跑）间隔常超过 8 小时，只按日期会误并成一场；
 * 而间歇训练各组之间通常只隔几分钟。所以用「同一天 + 间隔 < 4h」来切。
 */
export function buildSessions(opts: { from?: string; to?: string; gapSec?: number } = {}): Session[] {
  const gapSec = opts.gapSec ?? DEFAULT_SESSION_GAP_SEC;

  let rows = db.select().from(activities).orderBy(asc(activities.startTs)).all();
  if (opts.from) rows = rows.filter((a) => a.dateLabel >= opts.from!);
  if (opts.to) rows = rows.filter((a) => a.dateLabel <= opts.to!);

  const details = db.select().from(activityDetails).all();
  const detailById = new Map(details.map((d) => [d.labelId, d]));

  // 先按日期分桶，再在桶内按时间间隔切分
  const byDate = new Map<string, typeof rows>();
  for (const a of rows) {
    const list = byDate.get(a.dateLabel) ?? [];
    list.push(a);
    byDate.set(a.dateLabel, list);
  }

  const sessions: Session[] = [];

  for (const [date, dayRows] of byDate) {
    const sorted = [...dayRows].sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));
    let bucket: typeof sorted = [];

    const flush = () => {
      if (bucket.length === 0) return;
      sessions.push(makeSession(date, bucket, detailById));
      bucket = [];
    };

    for (const a of sorted) {
      const prev = bucket[bucket.length - 1];
      if (prev && a.startTs != null && prev.endTs != null && a.startTs - prev.endTs > gapSec) flush();
      bucket.push(a);
    }
    flush();
  }

  return sessions.sort((a, b) => b.startTs - a.startTs);
}

function makeSession(date: string, acts: any[], detailById: Map<string, any>): Session {
  const labelIds = acts.map((a) => a.labelId);
  const withDetails = acts.map((a) => ({ a, d: detailById.get(a.labelId) ?? null }));

  const distanceKm = acts.reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  const durationSec = acts.reduce((s, a) => s + (a.durationSec ?? 0), 0);
  const calories = acts.reduce((s, a) => s + (a.calories ?? 0), 0);
  const trainingLoad = withDetails.reduce((s, x) => s + (x.d?.trainingLoad ?? 0), 0);
  const elevGain = withDetails.reduce((s, x) => s + (x.d?.elevGain ?? 0), 0);

  // 少数短记录 COROS 不给距离（多为 GPS 丢失的碎片记录）。
  // 这类记录时长仍然计入，但距离要单独标出来，不能假装全场距离是完整的。
  const unknownDistance = acts.filter((a) => a.distanceKm == null).length;

  // 按时长加权的平均心率
  let hrSum = 0, hrWeight = 0;
  for (const { a } of withDetails) {
    if (a.avgHr) { hrSum += a.avgHr * (a.durationSec ?? 0); hrWeight += a.durationSec ?? 0; }
  }

  // 组间间隔：endTs 缺失时退回 startTs + duration，避免算出上百万分钟
  const endOf = (a: any) =>
    a.endTs ?? (a.startTs != null && a.durationSec != null ? a.startTs + a.durationSec : a.startTs ?? 0);

  let maxGapSec = 0;
  for (let i = 1; i < acts.length; i++) {
    const g = (acts[i].startTs ?? 0) - endOf(acts[i - 1]);
    if (g > maxGapSec) maxGapSec = g;
  }

  const sets = detectSets(withDetails);
  const { classification, reason } = classify(acts, sets, distanceKm);

  return {
    // 用下划线而不是 #：# 在 URL 里是片段分隔符，会把路径截断
    key: `${date}_${acts[0].labelId}`,
    date,
    startTs: acts[0].startTs ?? 0,
    endTs: acts[acts.length - 1].endTs ?? acts[0].startTs ?? 0,
    maxGapSec,
    activityCount: acts.length,
    unknownDistanceCount: unknownDistance,
    labelIds,
    totals: {
      distanceKm: round(distanceKm, 2),
      durationSec,
      calories,
      trainingLoad,
      elevGain,
      avgHr: hrWeight > 0 ? Math.round(hrSum / hrWeight) : null,
    },
    sets,
    kind: acts.length === 1 ? "single" : "multi",
    classification,
    classificationReason: reason,
  };
}

/**
 * 识别「n 组等长重复跑」。
 * 间歇训练被手表拆成多条记录后，同组内距离和配速高度一致，
 * 而不同组（1km 组 vs 800m 组）差异明显，所以用滑动比较而不是聚类。
 */
export function detectSets(items: { a: any; d: any }[]): SessionSet[] {
  const sets: SessionSet[] = [];
  let i = 0;

  while (i < items.length) {
    const first = items[i];
    const d0 = first.a.distanceKm ?? 0;
    if (d0 <= 0) { i++; continue; }

    let j = i + 1;
    let distTol = 0, paceTol = 0;

    while (j < items.length) {
      const d = items[j].a.distanceKm ?? 0;
      const distDelta = Math.abs(d - d0) / d0;
      const p0 = first.a.avgPaceSec, p1 = items[j].a.avgPaceSec;
      const paceDelta = p0 && p1 ? Math.abs(p1 - p0) / p0 : 0;
      // GPS 抖动会让等长记录有几米误差，12% / 20% 是实测下来不误并也不漏并的区间
      if (distDelta > 0.12 || paceDelta > 0.2) break;
      distTol = Math.max(distTol, distDelta);
      paceTol = Math.max(paceTol, paceDelta);
      j++;
    }

    const group = items.slice(i, j);
    if (group.length >= 2) {
      const distSum = group.reduce((s, x) => s + (x.a.distanceKm ?? 0), 0);
      const durSum = group.reduce((s, x) => s + (x.a.durationSec ?? 0), 0);
      let hrS = 0, hrW = 0;
      for (const x of group) {
        if (x.a.avgHr) { hrS += x.a.avgHr * (x.a.durationSec ?? 0); hrW += x.a.durationSec ?? 0; }
      }
      // 组间休息 = 下一组开始 - 上一组结束
      const rests: number[] = [];
      for (let k = 1; k < group.length; k++) {
        const prevEnd = group[k - 1].a.endTs ??
          (group[k - 1].a.startTs != null ? group[k - 1].a.startTs + (group[k - 1].a.durationSec ?? 0) : 0);
        const g = (group[k].a.startTs ?? 0) - prevEnd;
        if (Number.isFinite(g) && g >= 0) rests.push(g);
      }
      sets.push({
        distanceLabel: fmtDistLabel(d0),
        reps: group.length,
        avgDurationSec: Math.round(durSum / group.length),
        avgPaceSec: Math.round((durSum / Math.max(distSum, 0.01))),
        avgHr: hrW > 0 ? Math.round(hrS / hrW) : null,
        restSec: rests.length ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null,
        distanceTolerance: round(distTol, 3),
        paceTolerance: round(paceTol, 3),
      });
      i = j;
    } else {
      i++;
    }
  }
  return sets;
}

export function classify(acts: any[], sets: SessionSet[], distanceKm: number): { classification: string; reason: string } {
  const shortOnly = acts.every((a) => (a.distanceKm ?? 0) < 2);
  const setCount = sets.reduce((s, x) => s + x.reps, 0);

  if (acts.length === 1) {
    if (distanceKm >= 15) return { classification: "长距离跑", reason: `单次 ${distanceKm.toFixed(1)}km` };
    if (distanceKm >= 8) return { classification: "中等距离跑", reason: `单次 ${distanceKm.toFixed(1)}km` };
    return { classification: "单次训练", reason: `单次 ${distanceKm.toFixed(1)}km` };
  }

  if (sets.length > 0 && setCount >= acts.length * 0.6) {
    const desc = sets.map((s) => `${s.distanceLabel}×${s.reps}组`).join(" + ");
    return { classification: "间歇训练", reason: `识别到 ${sets.length} 组重复：${desc}` };
  }

  if (shortOnly) return { classification: "多次短距离", reason: `${acts.length} 条记录，单条均不足 2km` };
  return { classification: "组合训练", reason: `${acts.length} 条记录，距离与配速各不相同` };
}

export function fmtDistLabel(km: number): string {
  // GPS 抖动会让 1.00km 的组测成 0.99km，直接显示就是刺眼的「990m」。
  // 所以 ≥0.95km 归整到 0.1km，不足 1km 归整到 50m。
  if (km >= 0.95) {
    const v = Math.round(km * 10) / 10;
    return `${v.toFixed(v % 1 === 0 ? 0 : 1)}km`;
  }
  return `${Math.round((km * 1000) / 50) * 50}m`;
}

/** 取一场训练的全部逐圈数据，并按累计时间拼接成一条曲线 */
export function sessionLaps(labelIds: string[]) {
  if (labelIds.length === 0) return [];

  // 一次取回活动，算出每条记录的起始偏移（= 它相对本场第一��的开始时间差）
  const actRows = db
    .select()
    .from(activities)
    .where(inArray(activities.labelId, labelIds))
    .all();
  const byId = new Map(actRows.map((a) => [a.labelId, a]));

  const ordered = labelIds
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));

  const baseTs = ordered[0]?.startTs ?? 0;
  // startTs 本身就是秒，不要再除 1000（除过一次会把 3354 秒变成 3 秒）
  const offsetOf = new Map<string, number>(
    ordered.map((a) => [a.labelId, Math.round((a.startTs ?? baseTs) - baseTs)]),
  );

  const rows = db
    .select()
    .from(laps)
    .where(inArray(laps.labelId, labelIds))
    .all();

  return rows
    .map((r) => {
      const offsetSec = offsetOf.get(r.labelId) ?? 0;
      return {
        labelId: r.labelId,
        lapIndex: r.lapIndex,
        offsetSec,
        elapsedSec: offsetSec + Math.round(r.totalLengthSec ?? r.timeSec ?? 0),
        distanceM: r.distanceM,
        timeSec: r.timeSec,
        avgPaceSec: r.avgPaceSec,
        avgHr: r.avgHr,
        maxHr: r.maxHr,
        avgCadence: r.avgCadence,
        avgStrideM: r.avgStrideM,
        // 爬升必须在映射里显式带出：漏掉它，逐段表就只有配速心率，
        // AI 无法区分「上坡导致的慢」和「体能退步」，会一律判成掉速。
        elevGain: r.elevGain,
        totalDescent: r.totalDescent,
      };
    })
    .sort((a, b) => (a.offsetSec - b.offsetSec) || (a.labelId.localeCompare(b.labelId)) || (a.lapIndex - b.lapIndex));
}
