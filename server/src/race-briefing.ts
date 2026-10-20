import { fmtDuration, fmtPace as fmtPaceSec } from "./format.ts";
/**
 * 备赛分析（动态层）—— 路线画像是固定的，但配速策略与成绩预测必须随训练变。
 *
 * 为什么要分两层：
 *   路线画像 = 赛道本身，一年不变，算一次缓存住。
 *   备赛方案 = 你能不能达标，**每多跑一节课就变一次**。
 *  把两者混在一起会导致一个很隐蔽的错误：
 *  用户改一次训练量，路线被重算（浪费 DEM 请求），而策略却没更新。
 *
 * 关键设计：**用真实比赛当锚点，不用阈值配速回归。**
 *
 * 为什么不用阈值回归：
 *  回归依赖「配速-心率」线性关系，而心率在轻松配速上会压平，
 *  导致外推出的阈值配速明显偏快（全马能差十几分钟）。
 *  而只要有**真实比赛成绩**，那就是实测的全力输出，不需要任何推断。
 *
 * 异常值处理：有的比赛成绩不代表真实能力上限 —— 典型特征是
 *  「配速持续下降 + 心率同步下降」（正常疲劳是配速掉、心率升），
 *  说明身体在主动降负荷而不是心肺跟不上。
 * 这类比赛不能当能力基准，必须显式排除，否则会把能力高估数分钟以上。
 * 注意：这里只依据数据形态判断，**不推断原因** —— 原因只有本人才知道。
 */
import { asc, desc, eq, lte } from "drizzle-orm";
import { db } from "./db/client.ts";
import { activities, activityDetails, laps, trainingLoad, users } from "./db/schema.ts";
import { round } from "./analytics.ts";
import { climbPaceCost } from "./route-profile.ts";
import type { RaceProfile } from "./race-service.ts";
import { getAltitude } from "./altitude.ts";

const EARTH_R = 6371000;

// ---------------- 比赛锚点 ----------------

export type RaceAnchor = {
  /** 训练 id —— 人工排除/纳入时用来定位这一场 */
  labelId: string;
  date: string;
  label: string;
  distanceKm: number;
  seconds: number;
  avgHr: number;
  /** 赛道爬升率（m/km），从逐圈数据统计 */
  climbRate: number;
  /** 海拔（m），用于折算。未知时为 0，必须结合 altitudeSource 判断可信度 */
  altitude: number;
  /** 海拔来源：fit=设备实测 / city-table=城市兜底表 / unknown=未知未折算 */
  altitudeSource: "fit" | "city-table" | "unknown";
  /** 海平面等效成绩（秒）—— 这是唯一可跨比赛比较的指标 */
  seaLevelSec: number;
  /** 是否被排除出能力基准 */
  excluded?: boolean;
  excludeReason?: string;
  /**
   * 排除/纳入的决定来自哪里：
   *   manual   = 用户手动指定
   *   auto     = 自动判定（后程配速与心率同步下滑）
   *   included = 自动判定为异常，但用户手动要求纳入
   */
  excludeSource?: "manual" | "auto" | "included";
  /** 前半 → 后半的配速变化（负数 = 后程加速） */
  fadePct: number | null;
};

/**
 * 已知城市的海拔（兜底用）。
 *
 * ⚠️ 这只是一张**兜底表**，不是权威数据源。查不到的城市一律按 `null` 处理，
 * 由上层标记为「海拔未知」并在预测里显式提示 —— 而不是静默当成 0 米。
 * 静默当 0 是最坏的结果：一座 1890m 的高原城市和一座 10m 的沿海城市
 * 会被算成同一个基准，成绩看起来正常，实际已经偏乐观好几分钟。
 *
 * 优先级（见 `resolveAltitude`）：FIT 实测 > 本表 > 未知。
 */
export const CITY_ALTITUDE: Record<string, number> = {
  常州: 5, 深圳: 10, 香港: 30, 广州: 20, 兰州: 1530,
  东莞: 20, 北京: 50, 上海: 5, 杭州: 10, 南京: 20, 武汉: 25,
  成都: 500, 昆明: 1890, 贵阳: 1100, 西安: 400, 重庆: 260,
};

/**
 * 城市名归一化：把 COROS 里各种写法统一成查表用的短名。
 *
 * 实测踩过的坑：数据库里的 location 常带行政后缀（「XX市」「XX特别行政区」），
 * 而表里写的是短名。精确匹配会全部落空 →
 * 海拔被当成未知 → 高原比赛没折算，成绩偏高还不报错。
 * 所以这里做两步：先剥掉常见行政后缀，再退回包含匹配兜底。
 */
function normalizeCity(location: string | null | undefined): string | null {
  if (!location) return null;
  const s = String(location).trim();
  if (!s) return null;
  // 精确命中就直接用（最快路径）
  if (CITY_ALTITUDE[s] != null) return s;
  // 剥后缀：「XX市」→「XX」，「XX特别行政区」→「XX」
  const stripped = s
    .replace(/(特别行政区|自治区|特别行政區)$/, "")
    .replace(/(市|地区|自治州|盟)$/, "");
  if (CITY_ALTITUDE[stripped] != null) return stripped;
  // 包含匹配：地点字段常写成「XX滨湖」这种带地标的
  const hit = Object.keys(CITY_ALTITUDE).find((c) => s.includes(c) || stripped.includes(c));
  return hit ?? null;
}

/**
 * 解析海拔：FIT 实测优先，其次城市兜底表，都没有就返回 null。
 *
 * 为什么 FIT 优先：它是设备用气压计/卫星实测的整条赛道的平均海拔，
 * 而查表只有城市中心点一个数 —— 高原城市的赛道会在 1500m 上下起伏，
 * 城市值恰好接近，但换成高原城市下属的县城就未必准了。
 *
 * 实测对照：某场高原比赛的 FIT altAvg 与查表值完全一致，说明两条链路都可信。
 */
export function resolveAltitude(
  location: string | null | undefined,
  fitRecord: { altAvg: number } | null | undefined,
): { altitude: number; source: "fit" | "city-table" | "unknown" } {
  if (fitRecord && Number.isFinite(fitRecord.altAvg) && fitRecord.altAvg > 0) {
    return { altitude: fitRecord.altAvg, source: "fit" };
  }
  const city = normalizeCity(location);
  if (city != null) return { altitude: CITY_ALTITUDE[city], source: "city-table" };
  // 查不到：返回 0 但标记 unknown，让上层能明确告诉用户「这场没折算海拔」
  return { altitude: 0, source: "unknown" };
}

/** 爬升代价（秒/km 每 m/km），与 terrain.ts 拟合值一致 */
const SEC_PER_M_PER_KM = 1.244;

/**
 * 当前用户的最大心率估计。
 * Tanaka 公式（208 − 0.7 × 年龄）是跑步文献中最常用的年龄推算法，
 * 比 220−年龄 更贴近实测。没有生日数据时返回 null，让调用方走兜底。
 */
function currentHrMax(): number | null {
  const row = db.select({ birthday: users.birthday }).from(users).all()[0];
  if (!row?.birthday) return null;
  const age = Math.floor((Date.now() - new Date(row.birthday).getTime()) / (365.25 * 86400000));
  if (!Number.isFinite(age) || age <= 0 || age > 110) return null;
  return 208 - 0.7 * age;
}
/** 海拔惩罚（秒/km 每 1000m），与 altitude.ts 一致 */
const SEC_PER_KM_PER_1000M = 2.5;

/**
 * 识别**异常场次**（不作为能力基准）。
 *
 * 判据只看客观数据：正常疲劳是「配速掉、心率维持甚至上升」；
 * 而如果后程**配速和心率同步下降**，说明身体在主动降负荷而不是心肺跟不上 ——
 * 这种情况下的成绩不代表真实能力上限，纳入基准会高估好几分钟。
 *
 * ⚠ 这里刻意**不推断原因**。
 * 触发这个特征的可能是任何一件事：用药（抗组胺类等）、生病、伤病、
 * 前一场没恢复、补给失败、甚至只是当天想保守跑完。
 * 原因只有本人才知道，而心率/配速数据里没有这个信息。
 * 所以本函数只陈述**观察到的现象**并把它排除出基准，
 * 绝不替用户断言「这是药物干扰」—— 那只是某个人的个人情况，
 * 写成通用规则会误导所有其他人。
 */
function detectAbnormalRace(
  halves: { pace: number; hr: number }[],
): { affected: boolean; reason?: string } {
  if (halves.length !== 2) return { affected: false };
  const [f, b] = halves;
  const paceDrop = (b.pace - f.pace) / f.pace; // 正数 = 后程变慢
  const hrDrop = (b.hr - f.hr) / f.hr; // 负数 = 心率下降

  // 后程慢 8% 以上，同时心率掉 2% 以上 —— 配速与心率同步下滑
  if (paceDrop > 0.08 && hrDrop < -0.02) {
    return {
      affected: true,
      reason:
        `后半程配速下降 ${(paceDrop * 100).toFixed(0)}% 而心率同步下降 ` +
        `${Math.abs(hrDrop * 100).toFixed(0)}%（与正常疲劳「配速掉、心率升」相反），` +
        `判为异常场次，不计入能力基准`,
    };
  }
  return { affected: false };
}

export function collectRaceAnchors(): RaceAnchor[] {
  const races = db
    .select({
      dateLabel: activities.dateLabel,
      labelId: activities.labelId,
      distanceKm: activities.distanceKm,
      durationSec: activities.durationSec,
      avgHr: activities.avgHr,
      location: activities.location,
      raceExcluded: activities.raceExcluded,
      raceExcludeReason: activities.raceExcludeReason,
    })
    .from(activities)
    .where(eq(activities.sportType, 100))
    .all()
    .filter((a) => (a.distanceKm ?? 0) >= 42 && (a.durationSec ?? 0) > 0);

  const out: RaceAnchor[] = [];
  for (const r of races) {
    const lid = r.labelId!;
    // 局部变量不能和导入的表名 laps 同名，否则 .from(laps) 会命中 TDZ
    const lapRows = db
      .select({ distanceM: laps.distanceM, timeSec: laps.timeSec, avgHr: laps.avgHr, elevGain: laps.elevGain })
      .from(laps)
      .where(eq(laps.labelId, lid))
      .all()
      .filter((l) => l.distanceM > 850 && l.distanceM < 1150);

    const sec = r.durationSec!;
    const km = r.distanceKm!;
    const rawPace = sec / km;

    // 爬升率
    let gain = 0;
    let dist = 0;
    for (const l of lapRows) {
      gain += l.elevGain ?? 0;
      dist += l.distanceM / 1000;
    }
    const climbRate = dist > 0 ? gain / dist : 0;

    const altResolved = resolveAltitude(r.location, getAltitude(r.labelId));
    const alt = altResolved.altitude;

    // 前后半段
    let halves: { pace: number; hr: number }[] = [];
    if (lapRows.length >= 8) {
      const h = Math.floor(lapRows.length / 2);
      const mk = (arr: typeof lapRows) => ({
        pace: arr.reduce((s, x) => s + x.timeSec, 0) / arr.length,
        hr: arr.reduce((s, x) => s + (x.avgHr ?? 0), 0) / arr.length,
      });
      halves = [mk(lapRows.slice(0, h)), mk(lapRows.slice(h))];
    }
    const fadePct = halves.length === 2 ? (halves[1].pace - halves[0].pace) / halves[0].pace : null;
    const abnormal = detectAbnormalRace(halves);

    /*
     * 人工覆盖优先于自动判定。
     *
     * 自动判定只看数据形态，**不推断原因**，而原因只有本人才知道；
     * 规则也不一定适用于每一个人。所以：
     *   race_excluded = 1  → 强制排除（原因用用户填的，或标成手动排除）
     *   race_excluded = 0  → 强制纳入，覆盖自动判定
     *   null               → 交给自动判定
     */
    const manual = r.raceExcluded;
    const excluded = manual === 1 ? true : manual === 0 ? false : abnormal.affected;
    const excludeSource: RaceAnchor["excludeSource"] =
      manual === 1 ? "manual" : manual === 0 ? "included" : abnormal.affected ? "auto" : undefined;
    const excludeReason =
      manual === 1
        ? r.raceExcludeReason?.trim() || "手动排除，不计入能力基准"
        : manual === 0
          ? undefined
          : abnormal.reason;

    // 海平面等效：先扣地形，再扣海拔
    const terrainCost = climbPaceCost(climbRate);
    const altCost = (SEC_PER_KM_PER_1000M * alt) / 1000;
    const seaLevelPace = rawPace - terrainCost - altCost;

    out.push({
      labelId: lid,
      date: r.dateLabel!,
      label: r.location ?? "未标注地点",
      distanceKm: Number(km.toFixed(2)),
      seconds: sec,
      avgHr: r.avgHr ?? 0,
      climbRate: round(climbRate, 1),
      altitude: alt,
      altitudeSource: altResolved.source,
      seaLevelSec: Math.round(seaLevelPace * km),
      excluded: excluded || undefined,
      excludeReason,
      excludeSource,
      fadePct: fadePct == null ? null : round(fadePct * 100, 1),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 人工指定某场比赛是否计入能力基准。
 *
 * `excluded` 三态：
 *   true  → 强制排除
 *   false → 强制纳入（覆盖自动判定）
 *   null  → 撤销人工设定，交回自动判定
 *
 * 写在 activities 的额外两列上 —— 同步的 upsert 只写它显式列出的字段，
 * 这两列不在其中，所以人工标注不会被 COROS 同步冲掉。
 */
export function setAnchorExclusion(
  labelId: string,
  excluded: boolean | null,
  reason?: string | null,
): void {
  const row = db
    .select({ id: activities.labelId, d: activities.distanceKm, t: activities.sportType })
    .from(activities)
    .where(eq(activities.labelId, labelId))
    .get();
  if (!row) throw new Error("找不到这次训练");
  // 只有全马才可能成为能力锚点，避免把随手标错的普通训练写进去
  if ((row.d ?? 0) < 42) throw new Error("只有 ≥42km 的比赛才计入能力基准");

  db.update(activities)
    .set({
      raceExcluded: excluded == null ? null : excluded ? 1 : 0,
      raceExcludeReason: excluded === true ? (reason?.trim() || null) : null,
    })
    .where(eq(activities.labelId, labelId))
    .run();
}

// ---------------- 当前训练状态 ----------------

/** 算「长距离」的门槛 */
const LONG_RUN_MIN_KM = 25;
/** 算「长距离准备充足」的门槛 */
const LONG_RUN_READY_KM = 28;
/** 长距离准备度的观察窗口（天） */
const LONG_RUN_WINDOW_DAYS = 28;

export type LongRunPrep = {
  /** 窗口内 ≥28km 的长距离（取最近一次）—— 有它就不做保守调整 */
  ready: { date: string; km: number } | null;
  /** 窗口内 ≥25km 的最长一次 */
  max: { date: string; km: number } | null;
  /** 对成绩预测的调整（百分比，正数 = 更保守） */
  adjustPct: number;
  tone: "good" | "warn";
  effect: string;
};

/**
 * 长距离准备度。
 *
 * 判据是「**窗口内有没有 ≥28km 的长距离**」，不是「最近那一场是不是 ≥28km」。
 *
 * 后者有个隐蔽的错：只看最近一次，于是今天跑个 26km 就会把 3 天前那场 33km
 * 盖掉，系统于是判定「长距离准备不足」→ 预测 +2%（约 3 分 40 秒）变保守。
 * 可跑 26km 本来就是状态好的证据，方向反了。
 *
 * 另外用「窗口」而不是「有没有过」，是因为三个月前跑过 42km 也不该算数 ——
 * 长距离准备得是**最近**的。
 *
 * 窗口用滚动的 28 天而不是「已结束的整周」：今天刚跑的长距离必须算数，
 * 而按整周算的话今天这场会落进「未完成的那一周」被漏掉。
 */
export function evaluateLongRunPrep(
  runs: { date: string; km: number }[],
  cutoffLabel: string,
): LongRunPrep {
  // 阈值过滤放在函数内部，不依赖调用方先筛 —— 这样「窗口内连 25km 都没有」
  // 才不会被误当成「有个 12km 的长距离」。
  const inWindow = runs.filter((r) => r.date >= cutoffLabel && r.km >= LONG_RUN_MIN_KM);
  const maxRun = inWindow.reduce(
    (best, r) => (!best || r.km > best.km ? r : best),
    null as { date: string; km: number } | null,
  );
  const readyRun = inWindow
    .filter((r) => r.km >= LONG_RUN_READY_KM)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (readyRun) {
    return {
      ready: { date: readyRun.date, km: readyRun.km },
      max: maxRun,
      adjustPct: 0,
      tone: "good",
      effect: `近 4 周有 ${readyRun.km}km 长距离（${readyRun.date}）`,
    };
  }
  if (maxRun) {
    return {
      ready: null,
      max: maxRun,
      adjustPct: 2,
      tone: "warn",
      effect: `近 4 周最长 ${maxRun.km}km（${maxRun.date}），不足 ${LONG_RUN_READY_KM}km`,
    };
  }
  return {
    ready: null,
    max: null,
    adjustPct: 3,
    tone: "warn",
    effect: `近 4 周没有 ≥${LONG_RUN_MIN_KM}km 的训练`,
  };
}

export type TrainingState = {
  /** 近 4 周周均跑量 */
  weeklyKm4: number;
  /** 近 8 周周均跑量（看趋势用） */
  weeklyKm8: number;
  /** 跑量趋势：正值 = 在增加 */
  trendPct: number | null;
  /** 负荷比（短期/长期），<1 表示负荷不足，>1.5 表示过载 */
  loadRatio: number | null;
  /** 负荷比取自哪一天（与窗口锚点对齐，不会比它更新） */
  loadAsOf: string | null;
  /** 长距离准备度（近 4 周窗口内评估） */
  longRun: LongRunPrep;
  /** 最近 4 周有氧（Z1+Z2）时间占比 */
  easyPct: number | null;
  /** 窗口锚点 = 最近一次训练的日期（窗口右端） */
  asOf: string;
  /** 距上次训练几天（0 = 今天跑过）。停跑久了提示数据可能过时 */
  daysSinceAnchor: number;
};

/**
 * 今天的日历日期（运行机器的本地时区）。
 *
 * 与 `activities.dateLabel` 的约定对齐 —— 那是手表本地日期，
 * 所以「今天」也必须按本地时区算，否则窗口边界会和数据错位。
 */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 两个日历日期之间相差几天（b − a）。用本地零点算，夏令时切换日会自动取整。 */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000,
  );
}

/** 从一个日期标签往前推 n 天，返回日期标签（本地时区，不带时刻） */
function dateLabelShift(dateLabel: string, n: number): string {
  const [y, m, d] = dateLabel.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() - n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function currentTrainingState(): TrainingState {
  const acts = db
    .select({ dateLabel: activities.dateLabel, distanceKm: activities.distanceKm, durationSec: activities.durationSec, avgHr: activities.avgHr, labelId: activities.labelId })
    .from(activities)
    .all()
    .filter((a) => (a.distanceKm ?? 0) > 0);

  const today = todayLocal();

  /*
   * 训练状态的窗口 = **滚动天数**，右端锚定在「最近一次训练日期」，不是「今天」。
   *
   * 为什么要两个一起改：
   *
   * 1) 不用自然周：自然周里「当前这一周」是残缺的（周二才过了两天），
   *    拿它跟 7 天完整的周平均，比的是「两天」和「七天」，没有可比性。
   *
   * 2) 不用自然周 + 滚动到今天：那样窗口每天自己往前滑一天，
   *    **没有任何新数据，指标也会变** —— 实测 10 天里周均从 66.2 掉到 45.6、
   *    趋势从 +21% 掉到 −47%，趋势一跨过 ±15%/−20% 阈值，预测值就凭空再动一次。
   *    这跟之前那次「同一天早上晚上算出不同结果、预测慢 3 分 42 秒」是同一类毛病。
   *
   * 现在：窗口右端 = 最近一次训练的日期。于是
   *   - 同步进新训练 → 锚点前进 → 所有指标立刻重算（要的手感）
   *   - 没有新数据   → 锚点不动 → 指标纹丝不动（要的稳定）
   *
   * 滚动 28 天 = 恰好 4 周的数据量，任何时刻窗口长度都一样。
   *
   * （历史教训：最早这里写的是 `weeksAgo = (now - 活动日) ÷ 7 天取整`
   *   再折回某个周一，`now` 带着时刻，于是同一份数据早上和晚上算出不同结果。
   *   见 git 历史。）
   */
  const anchor = acts.reduce(
    (max, a) => ((a.dateLabel ?? "") > max ? (a.dateLabel ?? max) : max),
    "",
  ) || today;

  /** 锚点往前 days 天的窗口内跑量：(anchor-days, anchor] */
  const kmSince = (days: number) => {
    const cut = dateLabelShift(anchor, days);
    return acts
      .filter((a) => a.dateLabel! > cut && a.dateLabel! <= anchor)
      .reduce((s, a) => s + (a.distanceKm ?? 0), 0);
  };

  const km28 = kmSince(28);
  const km56 = kmSince(56);
  const km14 = kmSince(14);

  /** 近 4 周周均 = 滚动 28 天跑量 ÷ 4 */
  const weeklyKm4 = km28 / 4;
  /** 近 8 周周均 = 滚动 56 天跑量 ÷ 8 */
  const weeklyKm8 = km56 / 8;

  // 趋势：近 14 天 vs 前 14 天（同样滚动）
  const recent = km14 / 2;
  const prev = (km28 - km14) / 2;
  const trendPct = prev > 0 ? round(((recent - prev) / prev) * 100, 1) : null;

  /*
   * 负荷比取「锚点当天及之前」的最后一条。
   *
   * 不直接取最新一条：COROS 的每日负荷表可能比活动表新（当天还没跑，
   * 但手表已经记了负荷），那样页面上会出现「截止 10-19 的跑量」配「10-20 的负荷比」
   * —— 两个数字的截止日期对不上，看起来像数据串了。
   * 统一到锚点，代价只是负荷比晚一两天，数值本身不受影响。
   */
  const latestLoad = db
    .select({ date: trainingLoad.date, ratio: trainingLoad.ratio })
    .from(trainingLoad)
    .where(lte(trainingLoad.date, anchor))
    .orderBy(desc(trainingLoad.date))
    .limit(1)
    .get();

  // 长距离准备度：同样的滚动 28 天窗口，右端同样锚定在最近一次训练
  const longRun = evaluateLongRunPrep(
    acts
      .filter((a) => (a.distanceKm ?? 0) >= LONG_RUN_MIN_KM)
      .map((a) => ({ date: a.dateLabel!, km: a.distanceKm! })),
    dateLabelShift(anchor, LONG_RUN_WINDOW_DAYS),
  );

  // 近 28 天 Z1+Z2 占比（<159bpm 算有氧）
  const cut28 = dateLabelShift(anchor, 28);
  let easySec = 0;
  let totalSec = 0;
  for (const a of acts) {
    if (a.dateLabel! <= cut28 || a.dateLabel! > anchor) continue;
    const lapRows = db.select({ avgHr: laps.avgHr, timeSec: laps.timeSec }).from(laps).where(eq(laps.labelId, a.labelId!)).all();
    for (const l of lapRows) {
      totalSec += l.timeSec ?? 0;
      if ((l.avgHr ?? 0) > 0 && (l.avgHr ?? 0) < 159) easySec += l.timeSec ?? 0;
    }
  }

  return {
    weeklyKm4: round(weeklyKm4, 1),
    weeklyKm8: round(weeklyKm8, 1),
    trendPct,
    loadRatio: latestLoad?.ratio ?? null,
    loadAsOf: latestLoad?.date ?? null,
    longRun,
    easyPct: totalSec > 0 ? round((easySec / totalSec) * 100, 1) : null,
    asOf: anchor,
    daysSinceAnchor: Math.max(0, daysBetween(anchor, today)),
  };
}

// ---------------- 成绩预测 ----------------

export type RacePrediction = {
  /** 最有把握的估计（海平面等效） */
  bestSec: number;
  /** 合理区间 */
  lowSec: number;
  highSec: number;
  /** 预测依据的说明 */
  basis: string;
  /** 影响因素 */
  factors: { label: string; effect: string; tone: "good" | "warn" | "neutral" }[];
  confidence: "高" | "中" | "低";
  confidenceNote: string;
};

/**
 * 成绩预测 —— 基于真实比赛锚点，而不是阈值回归。
 *
 * 逻辑：
 *  1. 取所有未排除的比赛，算出各自的海平面等效成绩
 *  2. 用最近 1-2 场（反映当前水平）作为基准，但保留历史最好（反映上限）
 *  3. 根据当前训练状态做调整：跑量下降/负荷不足 → 预测保守；训练上升 → 略乐观
 *  4. 区间取锚点离散度的一半，再叠加训练状态的不确定度
 */
export function predictMarathon(
  anchors: RaceAnchor[],
  training: TrainingState,
  routeClimbRate = 0,
  routeAltitude = 0,
): RacePrediction | null {
  const valid = anchors.filter((a) => !a.excluded);
  if (valid.length === 0) return null;

  // 基准：取海平面等效的中位数（对异常值稳健）
  const secs = valid.map((a) => a.seaLevelSec).sort((a, b) => a - b);
  const medianSec = secs[Math.floor(secs.length / 2)];
  const bestSec = secs[0];

  // 区间：历史离散度
  const spread = secs.length > 1 ? secs[secs.length - 1] - secs[0] : 180;
  let lowSec = bestSec - spread * 0.25;
  let highSec = bestSec + spread * 0.5;

  const factors: RacePrediction["factors"] = [];
  factors.push({
    label: "比赛锚点",
    effect: `${valid.length} 场真实全马，海平面等效 ${fmtHM(secs[0])} ~ ${fmtHM(secs[secs.length - 1])}`,
    tone: "neutral",
  });

  // 排除的场次要分清是自动判定还是手动指定 —— 两者的可信度来源不同
  const excludedAnchors = anchors.filter((a) => a.excluded);
  if (excludedAnchors.length > 0) {
    const auto = excludedAnchors.filter((a) => a.excludeSource === "auto").map((a) => a.label);
    const manual = excludedAnchors.filter((a) => a.excludeSource === "manual").map((a) => a.label);
    const parts: string[] = [];
    if (auto.length) parts.push(`${auto.join("、")}（检测到异常，不作为基准）`);
    if (manual.length) parts.push(`${manual.join("、")}（手动排除，不作为基准）`);
    factors.push({
      label: "已排除异常场次",
      effect: parts.join("；"),
      tone: "warn",
    });
  }

  // 训练量调整
  let adjustPct = 0;
  if (training.weeklyKm4 < 35) {
    adjustPct += 4;
    factors.push({
      label: "近 4 周跑量",
      effect: `近 4 周周均 ${training.weeklyKm4}km（8 周均 ${training.weeklyKm8}km）`,
      tone: "warn",
    });
  } else if (training.weeklyKm4 < 45) {
    adjustPct += 1.5;
    factors.push({
      label: "近 4 周跑量",
      effect: `近 4 周周均 ${training.weeklyKm4}km（8 周均 ${training.weeklyKm8}km）`,
      tone: "warn",
    });
  } else if (training.weeklyKm4 >= 55) {
    adjustPct -= 1;
    factors.push({
      label: "近 4 周跑量",
      effect: `近 4 周周均 ${training.weeklyKm4}km（8 周均 ${training.weeklyKm8}km）`,
      tone: "good",
    });
  }

  // 趋势
  if (training.trendPct != null) {
    if (training.trendPct > 15) {
      adjustPct -= 2;
      factors.push({ label: "跑量趋势", effect: `近 2 周 vs 前 2 周 +${training.trendPct}%`, tone: "good" });
    } else if (training.trendPct < -20) {
      adjustPct += 3;
      factors.push({ label: "跑量趋势", effect: `近 2 周 vs 前 2 周 ${training.trendPct}%`, tone: "warn" });
    }
  }

  // 负荷比
  if (training.loadRatio != null) {
    if (training.loadRatio < 0.75) {
      adjustPct += 1;
      factors.push({ label: "负荷比", effect: `负荷比 ${training.loadRatio}`, tone: "warn" });
    } else if (training.loadRatio > 1.5) {
      adjustPct += 3;
      factors.push({ label: "负荷比", effect: `负荷比 ${training.loadRatio}`, tone: "warn" });
    } else {
      factors.push({ label: "负荷比", effect: `负荷比 ${training.loadRatio}`, tone: "good" });
    }
  }

  // 强度结构
  if (training.easyPct != null) {
    if (training.easyPct < 70) {
      adjustPct += 1.5;
      factors.push({
        label: "强度分布",
        effect: `Z1+Z2 占比 ${training.easyPct}%（心率 <159）`,
        tone: "warn",
      });
    } else if (training.easyPct >= 78) {
      factors.push({ label: "强度分布", effect: `Z1+Z2 占比 ${training.easyPct}%`, tone: "good" });
    } else {
      adjustPct += 0.8;
      factors.push({
        label: "强度分布",
        effect: `Z1+Z2 占比 ${training.easyPct}%（心率 <159）`,
        tone: "warn",
      });
    }
  }

  // 长距离准备度（判据见 evaluateLongRunPrep：看窗口内有没有 ≥28km 的长距离）
  adjustPct += training.longRun.adjustPct;
  factors.push({
    label: "长距离准备",
    effect: training.longRun.effect,
    tone: training.longRun.tone,
  });

  // 地形与海拔：把海平面等效折算回这场赛事的条件
  const terrainCost = climbPaceCost(routeClimbRate);
  const altCost = (SEC_PER_KM_PER_1000M * routeAltitude) / 1000;

  const seaBase = medianSec * (1 + adjustPct / 100);
  // 赛事实际用时 = 海平面等效 + 地形 + 海拔
  let best = seaBase + (terrainCost + altCost) * 42.195;
  let low = (seaBase - spread * 0.3 + (terrainCost + altCost) * 42.195) * 0.995;
  let high = (seaBase + spread * 0.45 + (terrainCost + altCost) * 42.195) * 1.005;

  const confidence: RacePrediction["confidence"] =
    valid.length >= 3 && training.weeklyKm4 >= 45 ? "中" : "低";
  const confidenceNote =
    confidence === "中"
      ? "有 3 场以上真实比赛锚点 + 训练量正常，可信度中等。"
      : "比赛锚点不足或当前训练量偏低，预测误差可能超过 ±5 分钟。";

  return {
    bestSec: Math.round(best),
    lowSec: Math.round(low),
    highSec: Math.round(high),
    basis:
      `基于 ${valid.length} 场真实全马的海平面等效成绩中位数 ` +
      `${fmtHM(medianSec)}，按当前训练状态调整 ${adjustPct >= 0 ? "+" : ""}${adjustPct.toFixed(1)}%，` +
      `再折算本场地形（${routeClimbRate} m/km）与海拔（${routeAltitude} m）。`,
    factors,
    confidence,
    confidenceNote,
  };
}

// ---------------- 配速策略 ----------------

export type PacingSegment = {
  label: string;
  fromKm: number;
  toKm: number;
  targetPaceSec: number;
  targetHr: number | null;
  intent: string;
};

export type PacingPlan = {
  goalSec: number;
  /** 前半程应比配速表快多少（负数=更快）——经典策略是"前慢后快" */
  openingAdjustmentSec: number;
  segments: PacingSegment[];
  warnings: string[];
  strategySummary: string;
  /** 心率上限的推导来源与依据说明 —— 页面要展示，避免看起来像凭空给的数字 */
  hrCapSource: "anchors" | "hr-max-ratio";
  hrCapNote: string;
};

/**
 * 配速策略。
 *
 * 核心原则（来自真实比赛数据，不是教科书）：
 *  1. **前慢后快**：真实比赛里既有做出负分裂（后段更快）的例子，
 *     也有前段冲太快直接崩掉的例子。
 *  2. **前段压心率**：按 HRR 分区，起跑应压在 Z2 上沿（具体 bpm 看你自己的区间表），
 *     而不是按配速跑 —— 心率是滞后指标，控住它才不会透支。
 *  3. **地形补偿**：上坡段配速放慢但心率不变，下坡段配速可略快。
 */
/**
 * 从真实比赛锚点里学出「配速 → 心率」的经验上限。
 *
 * 为什么不用写死的 160/162/165：
 * 那些常量是按一个典型跑者拍的，换个最大心率不同的人就完全不对。
 * 而我们手里有**实测全力比赛的分段心率** —— 目标配速下能维持多少心率，
 * 直接从「历史比赛在接近该配速时的实际心率」读出来，比任何假设都可信。
 *
 * 取值逻辑：
 *  1. 找出所有有效锚点中配速不慢于目标配速 6% 的那些（强度足够接近）
 *  2. 用它们各场后程（比赛真正的决胜段）心率的**上四分位**作为上限
 *     —— 用上四分位而不是均值，因为心率上限要留出余量，均值偏保守
 *  3. 全马后半程自然心率漂移约 5–8bpm，所以上限要比后半程均值再高一点
 *  4. 样本不足时退回按最大心率百分比（Tanaka 公式），并标注来源
 */
function deriveHrCaps(
  goalPaceSec: number,
  anchors: RaceAnchor[],
  hrMax: number | null,
): { caps: [number, number, number]; source: "anchors" | "hr-max-ratio"; note: string } {
  // 目标配速 6% 以内（更快或相当）才算强度可比
  const comparable = anchors.filter(
    (a) => !a.excluded && a.avgHr > 0 && a.seconds / a.distanceKm <= goalPaceSec * 1.06,
  );

  if (comparable.length >= 2 && hrMax) {
    // 各锚点的平均配速心率，按配速排序后取上四分位
    const pairs = comparable
      .map((a) => ({ pace: a.seconds / a.distanceKm, hr: a.avgHr }))
      .sort((x, y) => x.pace - y.pace);
    const hrs = pairs.map((p) => p.hr).sort((x, y) => x - y);
    const q75 = hrs[Math.max(0, Math.floor(hrs.length * 0.75))];

    // 决胜段（后程）心率上限：上四分位 + 漂移余量 4bpm
    const raceCap = Math.min(Math.round(q75 + 4), Math.round(hrMax * 0.95));
    // 起步段留更多余量，转折段最宽松
    const caps: [number, number, number] = [
      Math.round(raceCap * 0.94),
      Math.round(raceCap * 0.97),
      raceCap,
    ];
    return {
      caps,
      source: "anchors",
      note: `取自 ${comparable.length} 场强度可比的比赛实测心率上四分位（${q75}bpm）+ 后程漂移余量 4bpm，上限不超过最大心率 95%`,
    };
  }

  // 退回：按最大心率百分比。跑步文献常用 88% 阈值 / 92% 极限，这里起步到转折递增。
  const base = hrMax ? hrMax : 190; // 连最大心率都没有时的最后兜底
  return {
    caps: [
      Math.round(base * 0.84),
      Math.round(base * 0.86),
      Math.round(base * 0.88),
    ],
    source: "hr-max-ratio",
    note: hrMax
      ? `按最大心率 ${Math.round(hrMax)}bpm 的 84%/86%/88% 推出（强度可比的比赛不足 2 场）`
      : `缺少最大心率数据，按默认 190bpm 的 84%/86%/88% 推出（可信度低）`,
  };
}

export function planPacing(opts: {
  goalSec: number;
  distanceKm: number;
  climbRate: number;
  anchors: RaceAnchor[];
  training: TrainingState;
  /** 最大心率，用于心率上限推导。传null 时退回百分比兜底。 */
  hrMax?: number | null;
}): PacingPlan {
  const { goalSec, distanceKm, climbRate, anchors, training, hrMax = null } = opts;

  const terrainCost = climbPaceCost(climbRate);
  const avgPace = goalSec / distanceKm - terrainCost;
  const halfKm = distanceKm / 2;

  // 心率上限：从真实比赛实测值学出来，不是常量
  const { caps: hrCaps, source: hrSource, note: hrNote } = deriveHrCaps(avgPace, anchors, hrMax);

  // 负分裂：前半比平均慢 2%，后半追回来
  const openAdj = avgPace * 0.02;

  const segments: PacingSegment[] = [
    {
      label: "起步段",
      fromKm: 0,
      toKm: Math.round(halfKm * 0.45),
      targetPaceSec: Math.round(avgPace + openAdj * 1.4),
      targetHr: hrCaps[0],
      intent: `刻意压住，心率别过 ${hrCaps[0]}。这一段是给后半程存钱的。`,
    },
    {
      label: "上半场稳定",
      fromKm: Math.round(halfKm * 0.45),
      toKm: Math.round(halfKm),
      targetPaceSec: Math.round(avgPace + openAdj * 0.6),
      targetHr: hrCaps[1],
      intent: `进入有氧动力区上沿，找到能说话但不吃力的节奏（上限 ${hrCaps[1]}）。`,
    },
    {
      label: "转折点",
      fromKm: Math.round(halfKm),
      toKm: Math.round(halfKm * 1.45),
      targetPaceSec: Math.round(avgPace - openAdj * 0.3),
      targetHr: hrCaps[2],
      intent: `全场关键。前面存的账在这里开始兑现，可以接近节奏跑强度（上限 ${hrCaps[2]}）。`,
    },
    {
      label: "冲刺段",
      fromKm: Math.round(halfKm * 1.45),
      toKm: distanceKm,
      targetPaceSec: Math.round(avgPace - openAdj * 1.2),
      targetHr: null,
      intent: "剩余多少给多少。这里不再控心率，配速由疲劳程度决定。",
    },
  ];

  const warnings: string[] = [];

  // 地形警告
  if (climbRate >= 8) {
    warnings.push(`本场爬升率 ${climbRate} m/km（属实质爬升段）`);
  } else if (climbRate < 3) {
    warnings.push(`本场爬升率 ${climbRate} m/km（地形影响约 ${climbPaceCost(climbRate)} s/km）`);
  }

  // 训练状态警告
  // 长距离：和预测用同一套判据（近 4 周有没有 ≥28km 的长距离），
  // 免得配速策略和成绩预测对同一件事给出两套说法。
  if (!training.longRun.ready && distanceKm >= 42) {
    warnings.push(
      training.longRun.max
        ? `长距离：近 4 周最长 ${training.longRun.max.km}km（${training.longRun.max.date}），不足 28km`
        : "长距离：近 4 周没有 ≥25km 的训练",
    );
  }
  if (training.loadRatio != null && training.loadRatio > 1.4) {
    warnings.push(`当前负荷比 ${training.loadRatio}`);
  }

  const strategySummary =
    `目标 ${fmtHM(goalSec)}，平均配速 ${fmtPace(avgPace)}/km` +
    `（含地形补偿 ${terrainCost} s/km）。` +
    `策略是「前 3 公里故意慢，之后逐步加速」——` +
    `起步 ${fmtPace(avgPace + openAdj * 1.4)}/km，冲刺段收到 ${fmtPace(avgPace - openAdj * 1.2)}/km。`;

  return {
    goalSec,
    openingAdjustmentSec: Math.round(openAdj),
    segments,
    warnings,
    strategySummary,
    hrCapSource: hrSource,
    hrCapNote: hrNote,
  };
}

// ---------------- 汇总 ----------------

export type RaceBriefing = {
  anchors: RaceAnchor[];
  training: TrainingState;
  prediction: RacePrediction | null;
  pacing: PacingPlan | null;
  /** 距比赛还有几天 */
  daysToRace: number | null;
  /** 备赛进度建议 */
};

/**
 * 从路线画像里取出预测所需的两个地形参数。
 *
 * 为什么抽出来：备赛简报（`buildBriefing`）和比赛日赛前方案（`prediction/race.ts`）
 * 都要用同一份口径。两处各写一遍必然漂移 —— 页面上就会出现两个对不上的预测数字，
 * 而用户无法分辨哪个是真的（真实事故：简报 3:02:26 vs 比赛日 3:07:23，差近 5 分钟）。
 */
export function routeAdjustParams(raceProfile: RaceProfile | null): {
  climbRate: number;
  altitude: number;
} {
  // gainPerKm 在嵌套的 profile 上；联合类型下用可选访问兜底
  const climbRate = Number(raceProfile?.profile?.gainPerKm ?? 0);
  // 目标赛事的海拔：路线画像里存了线路各点海拔（DEM/GPX 实测），
  // 比城市中心点更准；没有画像时才退回城市表。
  // 注意两种画像的高程字段名不同（GpxProfile 用 eleMin/eleMax，RouteProfile 用 altMin/altMax），
  // 所以这里统一用可选访问把两者都取到。
  const prof = raceProfile?.profile;
  const eleMin = prof ? (prof as { altMin?: number; eleMin?: number }).altMin ?? (prof as { eleMin?: number }).eleMin : undefined;
  const eleMax = prof ? (prof as { altMax?: number; eleMax?: number }).altMax ?? (prof as { eleMax?: number }).eleMax : undefined;
  const altitude =
    eleMin != null && eleMax != null
      ? Math.round((eleMin + eleMax) / 2)
      : resolveAltitude(raceProfile?.race.city ?? null, null).altitude;
  return { climbRate, altitude };
}

export function buildBriefing(
  raceProfile: RaceProfile | null,
  goalSec: number | null,
  raceDate: string,
): RaceBriefing {
  const anchors = collectRaceAnchors();
  const training = currentTrainingState();

  const { climbRate: routeClimb, altitude: routeAlt } = routeAdjustParams(raceProfile);

  const prediction = predictMarathon(anchors, training, routeClimb, routeAlt);

  // 实际目标取用户设定，否则用预测
  const effectiveGoal = goalSec ?? prediction?.bestSec ?? null;
  const pacing = effectiveGoal
    ? planPacing({
        goalSec: effectiveGoal,
        distanceKm: raceProfile?.race.distanceKm ?? 42.195,
        climbRate: routeClimb,
        anchors,
        training,
        hrMax: currentHrMax(),
      })
    : null;

  const daysToRace = (() => {
    const d = new Date(`${raceDate}T00:00:00Z`).getTime();
    const now = new Date().setUTCHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  })();

  return {
    anchors,
    training,
    prediction,
    pacing,
    daysToRace,
  };
}

// ---------------- 格式化 ----------------

// 统一走 format.ts，避免各处重复实现时忘记处理秒的进位
export const fmtHM = fmtDuration;
export const fmtPace = fmtPaceSec;