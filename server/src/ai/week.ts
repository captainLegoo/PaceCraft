import { db } from "../db/client.ts";
import {
  ageFromBirthday,
  buildSessions,
  hrZoneOptions,
  hrZones,
  isoWeek,
  sessionLaps,
  weeklyVolume,
  type Session,
} from "../analytics.ts";
import {
  activities,
  activityDetails,
  aiWeekReports,
  dailyHealth,
  sleep,
  stress,
  trainingLoad,
  users,
} from "../db/schema.ts";
import { classifySession, thresholdHrLine, QUALITY_MIN_SEC, type SessionFocus } from "../training-focus.ts";
import type { Threshold } from "../prediction/engine.ts";
import { buildReport } from "../prediction/pipeline.ts";
import { classifyTerrain, climbRate, TERRAIN_LABEL } from "../terrain.ts";
import {
  AiError,
  buildClimbContext,
  callModel,
  fitnessAsOf,
  fmtDur,
  fmtPace,
  getAiConfig,
  hrZonePrompt,
  recoveryAsOf,
} from "./provider.ts";
import { and, asc, eq, gte, lte } from "drizzle-orm";

// ---------------------------------------------------------------------------
// 周级 AI 训练分析
//
// 为什么要单独写一个模块，而不是复用场次分析：
//
// 场次分析的对象是「某一天这一场」，回答"这场训练本身说明了什么"，
// 因此它**刻意不带**任何其它日期的数据（见 provider.ts 里的说明）。
// 周级分析的对象是「周一到周日这一周」，要回答的恰恰是跨场次的问题
// （这周比上周是多是少、强度课落在哪天、主课表比上周快还是慢），
// 所以历史趋势是**必须给**的，不是污染。
//
// 第二个区别是粒度。周级绝不能把一周的全部分圈数据丢给模型 ——
// 实测一周的分圈段数通常在 100 上下（满周可到 150 段），
// 而其中大部分（热身、普通有氧跑的分圈）根本没有解读价值。
// 所以这里的做法是：**只发训练块，不发原始分段**，
// 并且只对「主课表」块展开内部结构（组 / 四分位），次课表一行带过。
//
// 第三个区别是主次课表。一场组合训练里，热身 2km 会把场均配速拉慢 40 秒，
// 主课表又会把场均心率拉高十几下 —— 场次级的任何均值都是混合值。
// 只发均值，模型必然写"这堂课偏轻松"，而真实情况是 5 组 1km 跑在阈值以下
// 且配速没掉。这在实测数据上反复出现过，不是假设。
// ---------------------------------------------------------------------------

/** 训练块角色 */
export type BlockRole = "主课表·强度" | "主课表·耐力" | "次课表" | "热身";

/** 强度课里的一个工作组 */
type WorkSet = {
  index: number;
  distanceLabel: string;
  paceSec: number;
  avgHr: number | null;
  maxHr: number | null;
  timeSec: number;
};

/** 长距离跑的四分位 */
type Quartile = {
  fromKm: number;
  toKm: number;
  paceSec: number | null;
  avgHr: number | null;
  elevGain: number;
};

export type WeekBlock = {
  labelId: string;
  sessionKey: string;
  date: string;
  role: BlockRole;
  /** 角色判定依据，直接给模型看，避免它自己猜 */
  roleReason: string;
  activity: any;
  detail: any;
  laps: any[];
  focus: SessionFocus | null;
  /** 主课表·强度 才有：组结构 */
  sets: WorkSet[] | null;
  setRestSec: number | null;
  /** 主课表·耐力 才有：四分位 */
  quartiles: Quartile[] | null;
  /** 本块是否可能内含热身但未做段内切分 */
  mayMixWarmup: boolean;
};

export function weekEndOf(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 86400_000).toISOString().slice(0, 10);
}

/** 本周最长的一场 → 长距离主课表 */
function pickLsdSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  // 间歇 / 组合训练本身就是主课表，即使它恰好是本周最长的，也按强度课处理，
  // 不能再标成「长距离」—— 两套解读规则混在一起会互相干扰。
  const endurance = sessions.filter((s) => !/间歇|组合|多次短距离/.test(s.classification));
  const pool = endurance.length > 0 ? endurance : sessions;
  return pool.reduce((a, b) => (a.totals.distanceKm >= b.totals.distanceKm ? a : b));
}

/**
 * 把一条记录里的分圈归并成「工作组」。
 *
 * 为什么要单独归并：间歇课一条记录里就包含「跑组 + 组间慢跑」两类分圈，
 * 慢跑那段只有 100～200m，直接铺开会让模型把休息算成掉速。
 *
 * 距离字段的坑（实测 4 场强度课的分圈距离全部记 0，见 prep.ts 注释）：
 * 距离不可用时退回「每个分圈 = 一组」，组距离由总距离除以组数推算，
 * 并在输出里标明是推算值，不能让模型以为是表头读数。
 */
function summarizeWorkSets(activity: any, laps: any[]): { sets: WorkSet[]; restSec: number | null } | null {
  if (laps.length < 2) return null;
  const usable = laps.filter((l) => (l.distanceM ?? 0) > 0);
  const medianDist = usable.length > 0 ? medianOf(usable.map((l) => l.distanceM)) : 0;

  let reps: any[][] = [];
  let inferred = false;

  if (medianDist > 0 && usable.length >= Math.max(3, laps.length * 0.5)) {
    // 必须**按原始顺序**扫，不能先把慢跑段滤掉再分组：
    // 5×1km + 5 段组间慢跑，滤掉慢跑后 5 个 1km 会紧挨着，
    // 「与上一组距离接近就并入同一组」会把它们全并成 1 组（实测踩过）。
    // 正确做法是遇到非跑组就关闭当前组。
    let cur: any[] = [];
    for (const l of laps) {
      const isWork = (l.distanceM ?? 0) >= medianDist * 0.5;
      if (!isWork) {
        if (cur.length > 0) reps.push(cur);
        cur = [];
        continue;
      }
      const head = cur[0];
      if (head && Math.abs((l.distanceM ?? 0) - head.distanceM) / Math.max(head.distanceM, 1) <= 0.15) {
        cur.push(l);
      } else {
        if (cur.length > 0) reps.push(cur);
        cur = [l];
      }
    }
    if (cur.length > 0) reps.push(cur);
  }

  if (reps.length < 2) {
    // 距离不可用（COROS 对间歇课常记 0）：直接按分圈分组
    inferred = true;
    reps = laps.map((l) => [l]);
  }
  if (reps.length < 2) return null;

  const perRepKm = (activity.distanceKm ?? 0) / reps.length;
  const sets: WorkSet[] = reps.map((g, i) => {
    const distSum = g.reduce((s, l) => s + (l.distanceM ?? 0), 0);
    const distKm = inferred ? perRepKm : distSum / 1000;
    const timeSec = g.reduce((s, l) => s + (l.timeSec ?? 0), 0);
    let hrS = 0, hrW = 0, peak = 0;
    for (const l of g) {
      if ((l.avgHr ?? 0) > 0) { hrS += l.avgHr! * (l.timeSec ?? 0); hrW += l.timeSec ?? 0; }
      peak = Math.max(peak, l.maxHr ?? 0);
    }
    return {
      index: i + 1,
      distanceLabel: fmtKm(distKm) + (inferred ? "*" : ""),
      paceSec: distKm > 0 ? Math.round(timeSec / distKm) : 0,
      avgHr: hrW > 0 ? Math.round(hrS / hrW) : null,
      maxHr: peak > 0 ? peak : null,
      timeSec,
    };
  });

  // 组间休息 = 相邻两组之间的短分圈耗时
  const rests: number[] = [];
  if (!inferred && medianDist > 0) {
    for (const l of laps) {
      if ((l.distanceM ?? 0) < medianDist * 0.5 && (l.timeSec ?? 0) > 0) rests.push(l.timeSec);
    }
  }
  const restSec = rests.length > 0 ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null;
  return { sets, restSec };
}

/** 长距离跑按里程四分位，替代逐段表判断"掉速"还是"负分段" */
function quartilesOf(activity: any, laps: any[]): Quartile[] | null {
  const usable = laps.filter((l) => (l.distanceM ?? 0) > 0 && (l.timeSec ?? 0) > 0);
  if (usable.length < 4) return null;
  const totalKm = activity.distanceKm ?? 0;
  if (totalKm <= 0) return null;

  // 每个分圈的中点里程必须**先算好一次**再分桶，两个坑都在这：
  // ① 拿 fromKm 当基准会让每个分圈的中点落在第 q 段的同一相对位置，
  //    21 段被同时塞进全部 4 个四分位，输出四个一模一样的数字；
  // ② 在 filter 回调里累加游标，第二个四分位会从「已走完全程」的游标继续。
  let cumM = 0;
  const withMid = usable.map((l) => {
    const midKm = (cumM + (l.distanceM ?? 0) / 2) / 1000;
    cumM += l.distanceM ?? 0;
    return { l, midKm };
  });

  const out: Quartile[] = [];
  for (let q = 0; q < 4; q++) {
    const fromKm = (totalKm * q) / 4;
    const toKm = (totalKm * (q + 1)) / 4;
    const inQ = withMid.filter((x) => x.midKm >= fromKm && x.midKm < toKm).map((x) => x.l);
    if (inQ.length === 0) continue;
    const distKm = inQ.reduce((s, l) => s + (l.distanceM ?? 0), 0) / 1000;
    const timeSec = inQ.reduce((s, l) => s + (l.timeSec ?? 0), 0);
    let hrS = 0, hrW = 0;
    for (const l of inQ) {
      if ((l.avgHr ?? 0) > 0) { hrS += l.avgHr! * (l.timeSec ?? 0); hrW += l.timeSec ?? 0; }
    }
    out.push({
      fromKm, toKm,
      paceSec: distKm > 0 ? Math.round(timeSec / distKm) : null,
      avgHr: hrW > 0 ? Math.round(hrS / hrW) : null,
      elevGain: inQ.reduce((s, l) => s + (l.elevGain ?? 0), 0),
    });
  }
  return out.length >= 2 ? out : null;
}

/**
 * 廉价判断一个块是否"可能内含热身但我们没切"。
 *
 * 现状（**不做段内切分**）：实测中，热身恰好是独立记录的场合，
 * 按记录切就够用；真正的段内切分需要在分圈里找强度跃迁，
 * 对渐进热身（心率慢慢爬）很不稳，误切的风险比收益大。
 * 所以这里只做一个**标记**，提示模型该块的均值是混合值 —— 宁可说可能，
 * 也不要让模型拿一个含热身的均值当强度判据。
 */
function mayMixWarmup(laps: any[]): boolean {
  const usable = laps.filter((l) => (l.distanceM ?? 0) > 500 && (l.avgHr ?? 0) > 0 && (l.avgPaceSec ?? 0) > 0);
  if (usable.length < 6) return false;
  const head = usable.slice(0, Math.ceil(usable.length / 3));
  const tail = usable.slice(-Math.ceil(usable.length / 3));
  const avg = (xs: any[], f: (l: any) => number) => xs.reduce((s, l) => s + f(l), 0) / xs.length;
  // 阈值故意定得很高（30 s/km + 8 bpm）：普通渐进跑的前三段通常也比后三段慢十几秒，
  // 门槛一松就会在几乎每一场有氧跑上触发，这个标记就成了噪音、反而没人当真。
  // 只有真的存在一段明显独立的慢速热身时才提示。
  return avg(head, (l) => l.avgPaceSec) - avg(tail, (l) => l.avgPaceSec) >= 30
      && avg(tail, (l) => l.avgHr) - avg(head, (l) => l.avgHr) >= 8;
}

function fmtKm(km: number): string {
  if (km >= 0.95) return `${(Math.round(km * 10) / 10).toFixed(1)}km`;
  return `${Math.round(km * 1000 / 50) * 50}m`;
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 历史某一周的主课表块（用于同类块跨周对比） */
export type HistWeekBlock = { weekStart: string; block: WeekBlock };

/** 历史某一周的整周心率区间占比（%），用于回答「本周强度结构相对前几周变了没有」 */
export type HistWeekZones = { weekStart: string; z1: number | null; z2: number | null; z3plus: number | null };

export type WeekCtx = {
  weekStart: string;
  weekEnd: string;
  sessions: Session[];
  blocks: WeekBlock[];
  weekLaps: any[];
  userRow: any;
  fitnessRow: any;
  recoveryRow: any;
  loadRows: any[];
  healthRows: any[];
  sleepRows: any[];
  stressRows: any[];
  trendRows: any[];
  age: number | null;
  /** 本周口径的阈值线，历史周也用它判定（见 buildWeekContext 里的说明） */
  thresholdLine: number;
  histMainBlocks: HistWeekBlock[];
  histZones: HistWeekZones[];
};

/**
 * 把一周的记录切成训练块并标注主/次课表。
 *
 * 抽成独立函数是为了让**历史周走同一套判定**：
 * 跨周对比要求口径一致，若历史周用另一套规则挑"长距离"，
 * 拿出来的对比就是假的（实测同一套规则下每周都能稳定挑出主课表）。
 */
function collectWeekBlocks(
  sessions: Session[],
  lapsByLabel: Map<string, any[]>,
  threshold: Threshold,
  line: number,
): WeekBlock[] {
  const lsd = pickLsdSession(sessions);
  const blocks: WeekBlock[] = [];

  for (const s of sessions) {
    const isInterval = /间歇|组合|多次短距离/.test(s.classification);
    const isLsd = lsd != null && s.key === lsd.key;

    for (const id of s.labelIds) {
      const act = db.select().from(activities).where(eq(activities.labelId, id)).get();
      const laps = lapsByLabel.get(id) ?? [];
      if (!act) continue;
      // 强度课判定只看时间 + 心率，与距离无关 —— 间歇课的分圈距离常记 0，
      // 按距离过滤会恰好把最该算的强度课滤掉（实测 4 场如此）。
      const focus = classifySession(
        laps.map((l) => ({ distanceM: l.distanceM, timeSec: l.timeSec, avgHr: l.avgHr, maxHr: l.maxHr })),
        threshold,
      );
      let role: BlockRole;
      let roleReason: string;
      let sets: WorkSet[] | null = null;
      let setRestSec: number | null = null;
      let quartiles: Quartile[] | null = null;

      if (isLsd) {
        role = "主课表·耐力";
        roleReason = `本周最长的一场（${s.totals.distanceKm}km，其余场次更短）`;
        quartiles = quartilesOf(act, laps);
      } else if (isInterval && focus.usable && focus.isQuality) {
        role = "主课表·强度";
        roleReason = `阈值区累计 ${fmtDur(focus.thresholdSec)}（判定线 ${Math.round(line)} bpm，门槛 ${fmtDur(QUALITY_MIN_SEC)}）`;
        const sum = summarizeWorkSets(act, laps);
        sets = sum?.sets ?? null;
        setRestSec = sum?.restSec ?? null;
      } else if (isInterval && (focus.peakLapHr ?? 0) >= line && (focus.peakLapHr ?? 0) > 0) {
        // 组合训练里的主课表块常常不到 20 分钟（例如 10×300m 只有十二三分钟），
        // classifySession 的 20 分钟下限会让它直接返回 usable:false 而拿不到判定。
        // 但峰值圈均心率已经越过阈值线时，它就是主课表，与时长无关 —— 用这条兜底。
        role = "主课表·强度";
        roleReason = `峰值圈均心率 ${focus.peakLapHr} bpm 已越过阈值线 ${Math.round(line)} bpm（时长不足以计入 10 分钟门槛）`;
        const sum = summarizeWorkSets(act, laps);
        sets = sum?.sets ?? null;
        setRestSec = sum?.restSec ?? null;
      } else if (isInterval && (focus.peakLapHr ?? 0) > 0) {
        role = "热身";
        roleReason = `属于组合训练但全场峰值圈均心率 ${focus.peakLapHr} bpm 未触及阈值线 ${Math.round(line)} bpm`;
      } else if (isInterval) {
        role = "次课表";
        roleReason = `属于组合训练，但分圈数据不足以判定强度（${focus.evidence}）`;
      } else {
        role = "次课表";
        roleReason = s.classification === "长距离跑"
          ? "长距离跑但非本周最长场次"
          : `${s.classification}，不属于间歇/组合训练，且非本周最长场次`;
      }

      const detail = db.select().from(activityDetails).where(eq(activityDetails.labelId, id)).get() ?? null;
      blocks.push({
        labelId: id,
        sessionKey: s.key,
        date: s.date,
        role,
        roleReason,
        activity: act,
        detail,
        laps,
        focus,
        sets,
        setRestSec,
        quartiles,
        mayMixWarmup: role === "次课表" && mayMixWarmup(laps),
      });
    }
  }
  return blocks;
}

/** 按周起始日切出这一周的记录 */
function sessionsInWeek(all: Session[], weekStart: string, weekEnd: string): Session[] {
  return all.filter((s) => s.date >= weekStart && s.date <= weekEnd).sort((a, b) => a.startTs - b.startTs);
}

/** 某一周的分圈，按 labelId 归拢 */
function lapsByLabelFor(sessions: Session[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const l of sessionLaps(sessions.flatMap((s) => s.labelIds))) {
    const arr = map.get(l.labelId) ?? [];
    arr.push(l);
    map.set(l.labelId, arr);
  }
  return map;
}

export function buildWeekContext(weekStart: string): WeekCtx | null {
  const weekEnd = weekEndOf(weekStart);
  const allSessions = buildSessions();
  const sessions = sessionsInWeek(allSessions, weekStart, weekEnd);
  if (sessions.length === 0) return null;

  const report = buildReport();
  const threshold = report.threshold;
  const line = thresholdHrLine(threshold);

  const userRow = db.select().from(users).all()[0] ?? null;
  const age = ageFromBirthday(userRow?.birthday ?? null);

  const blocks = collectWeekBlocks(sessions, lapsByLabelFor(sessions), threshold, line);

  const loadRows = db
    .select()
    .from(trainingLoad)
    .where(and(gte(trainingLoad.date, weekStart), lte(trainingLoad.date, weekEnd)))
    .orderBy(asc(trainingLoad.date))
    .all();

  const inWeek = (label: string) => label >= weekStart && label <= weekEnd;
  const healthRows = db.select().from(dailyHealth).all().filter((r) => inWeek(r.dateLabel));
  const sleepRows = db.select().from(sleep).all().filter((r) => inWeek(r.date));
  const stressRows = db.select().from(stress).all().filter((r) => inWeek(r.date));

  // 必须严格小于本周：把本周自己放进趋势表，末尾那条就不是「上周」，
  // 而「本周 vs 上周」会变成自己跟自己比（输出会完全相同、差异 0%，
  // 是模型自己发现这个数对不上才提出来的）。
  const trendRows = weeklyVolume(10).filter((w) => w.weekStart < weekStart).slice(-6);

  // ---- 历史主课表 + 历史周心率分布：补上「同类块跨周对比」这个缺口 ----
  //
  // 之前只给周级均值，模型每次都只能写"缺前几周主课表明细，无法跨周对比"，
  // 而实测每周都能用同一套规则稳定挑出主课表（长距离必出，间歇多半出），
  // 数据一直都在库里，只是没送进去。
  //
  // 只送主课表，不送历史周的全部块：历史周一律最多 6 周 × 3-4 块，
  // 铺开会顶掉本周的细节预算，而跨周对比真正需要的只有主课表。
  //
  // 阈值线用本周的 line 统一判定历史周，不回算历史阈值 ——
  // 回算等于给模型两套口径，它会拿两个口径的数字直接相减。
  // 这个口径必须写进 prompt 让模型知道。
  const histWeeks = trendRows.map((w) => w.weekStart);
  const histMainBlocks: HistWeekBlock[] = [];
  const histZones: HistWeekZones[] = [];
  for (const hw of histWeeks) {
    const hs = sessionsInWeek(allSessions, hw, weekEndOf(hw));
    if (hs.length === 0) continue;
    const byLabel = lapsByLabelFor(hs);
    for (const b of collectWeekBlocks(hs, byLabel, threshold, line)) {
      if (!b.role.startsWith("主课表")) continue;
      histMainBlocks.push({ weekStart: hw, block: b });
    }
    const weekLaps = sessionLaps(hs.flatMap((s) => s.labelIds));
    const z = hrZonePrompt(weekLaps, age);
    // 注意 hrZonePrompt().zones 是 hrZones() 的**整个返回对象**，区间数组在里面再一层 .zones
    const zb = z?.zones?.zones;
    if (zb) {
      histZones.push({
        weekStart: hw,
        z1: zb[0]?.pct ?? null,
        z2: zb[1]?.pct ?? null,
        z3plus: zb.slice(2).reduce((s, x) => s + (x.pct ?? 0), 0),
      });
    }
  }

  return {
    weekStart, weekEnd, sessions, blocks,
    weekLaps: sessionLaps(sessions.flatMap((s) => s.labelIds)),
    userRow, fitnessRow: fitnessAsOf(weekEnd), recoveryRow: recoveryAsOf(weekEnd),
    loadRows, healthRows, sleepRows, stressRows, trendRows, age,
    thresholdLine: line,
    histMainBlocks, histZones,
  };
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

export const WEEK_SYSTEM_PROMPT = `你是一位资深跑步教练，专精马拉松备赛与耐力运动表现分析。

这次分析的对象是**一整周（周一至周日）的训练**，不是某一场。
系统会给你：本周的训练块（已按主/次课表标注）、整周心率区间分布、
**前 6 周的主课表明细**、各周整周强度结构、前 6 周的趋势对比、
以及本周的恢复与生活数据。

⚠ 日期与星期（先看这条，错一整份报告就废了）：
文首有一张「本周日历」对照表，**星期已经在那里算好了**。
每个日期后也都直接标了星期（如 \`10-17 周六\`）。
**照抄，绝不自己按 MM-DD 心算** —— 实测模型会整体偏移一天，
把周六的 33km 长距离写成"周日主课表"，还会在同一份报告里同时写出
"周日负荷比 1.25"和"周六负荷比 0.94"，前后自相矛盾。
报告里提到某一天时一律写成「周六(10-17)」这种带日期的形式，便于核对。

⚠ 主次课表怎么读（最重要，先读这三条，读错了整份报告就是错的）：

1. **场次级的合计值是混合值，不能当强度判据。**
   一场组合训练里，热身会把场均配速拉慢、主课表会把场均心率拉高。
   实测案例：某场距离不长的组合训练，合计配速被热身段拉慢到 5 分出头，
   但拆开后主课表却跑在 3:40/km 上下 —— 差了近一分钟。
   **判断强度只能看标了「主课表」的块。**

2. **次课表和热身块不做强度评价。**
   热身跑得慢、几乎全程 Z1、负荷低，都是**正常且应该如此**。
   不要写成"强度不足""有氧基础差"。
   次课表只用来回答**完成度**：该跑的跑了没有、跑了多少、在周内怎么分布。

3. **主课表之间不能互比配速。**
   间歇的 3:38/km 和长距离的 5:48/km 本就不同量级，比没有意义。
   要比的是**同类块跨周的变化**：「这周 5×1km 比上周快了 3s/km 且心率低 2bpm」。

⚠ 职责边界（同样重要）：
  使用者有专职教练负责训练计划。**你只负责解读数据，不要出训练计划。**
  禁止：安排下周跑量、规定强度课组数/配速、建议减量节奏、指示"该练什么"。
  允许：陈述周内规律（"强度课落在周五，长距离落在周三，两次间隔 3 天"）、
        与历史基线和前几周的偏离、指出数据缺口。
  需要提建议时，表述成「这个数据供教练参考」，而不是下指令。

分析要求：
1. **先给结论**：这一周的整体状态（负荷是否合理、强度刺激够不够、主次课表安排得如何分布）。
2. **必须引用具体数字**（周跑量、各主课表块的配速/心率/负荷、负荷比、周环比），不要写空话。
3. **必须分别评价主课表和次课表**，不能只盯着总跑量。
4. 重点看**周内的分布**：主课表之间间隔几天、有没有堆在同一天、
   长距离和强度课挨得近不近（恢复窗口够不够）。
5. 有对比才下判断：给了前 6 周数据就要用它；
   "强度够不够"这类问题必须落到"比前几周是多是少"，不要凭绝对印象。
   **每个主课表块都必须至少做一次同类块跨周对比**（长距离比长距离、间歇比间歇），
   并引用「前 N 周主课表对照」里的具体行（日期 + 数字）。
   不要拿周级均配速代替块级对比 —— 周均值是混合值；
   不要凭"这周配速比上周快"就下结论，先比爬升率是否可比。
   某一周缺某类型的主课表时如实说"那周没有可比块"，不要用别的类型顶替。
6. 说某天"训练了/休息了"只能以「训练块明细」为准，不要凭印象：
   表里没有的日期才算休息。写完分布描述后自查一遍有没有和明细表冲突。
7. 心率区间用**五区间心率法（HRR 口径）**：Z0 积极恢复 < 59%｜Z1 59–74%｜Z2 74–84%｜Z3 85–88%（**仅 4% 宽**）｜
   Z4 89–95%｜Z5 >95%。低于 Z1 下界自动归入 Z0 积极恢复（用于观察热身/散步充分度）。
   **具体 bpm 边界以数据里给出的区间表为准**，不要用记忆里的数字。
   静息心率低的人 Z1 占多数是正常的，不要说成强度不足。
8. 如果数据不足以支撑某个判断，直接说明缺什么，不要臆测。
   区分"系统没给这项数据"和"你没看这张表"。
9. 用 Markdown 组织，控制在 900 字以内。

地形判读（重要）：
- 每个块都标了地形和爬升率。同一心率下爬升路段配速天然更慢，**不是退步**。
- 起伏场的配速只能与起伏场比，平路场与平路场比，跨地形直接比会得出错误结论。
- **爬升 0 m 是有意义的结论，不是缺数据**（田径场/操场就是 0），
  此时直接按平路场分析，不要因为"爬升 0"就打折扣或说地形数据不可信。
- 若标注了**海拔**，按 2.5 s/km 每 1000m 做高原折算后再比较。`;

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * prompt 里的日期一律走这里，必须带上星期。
 *
 * 只给 "10-17" 的话，星期得由模型自己推算 —— 它会推错，而且推错之后
 * 报告里会出现自相矛盾的说法（实测把周六的 33km 长距离写成"周日主课表"，
 * 另一处又写"周六（主课表日）负荷比跳升"，同一段里两个星期并存）。
 * 星期是确定性事实，算出来喂进去，不要让模型算。
 */
function md(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return `${date.slice(5)} ${WEEKDAY_CN[d.getUTCDay()]}`;
}

/** 一个训练块里所有分圈的峰值心率 */
function peakHrOf(b: WeekBlock): number | null {
  const peak = b.laps.reduce((m, l) => Math.max(m, l.maxHr ?? 0), 0);
  return peak || null;
}

export function buildWeekUserPrompt(ctx: WeekCtx): string {
  const { blocks, sessions, weekStart, weekEnd, weekLaps, userRow, fitnessRow, recoveryRow,
    loadRows, healthRows, sleepRows, stressRows, trendRows, age,
    thresholdLine, histMainBlocks, histZones } = ctx;
  const p: string[] = [];

  // ---- 档案 ----
  p.push("## 运动员档案");
  if (userRow) {
    const a = ageFromBirthday(userRow.birthday ?? null);
    p.push(`- 昵称：${userRow.nickname ?? "—"}｜性别：${userRow.gender ?? "—"}｜年龄：${a ?? "—"} 岁`);
    p.push(`- 身高：${userRow.heightCm ?? "—"} cm｜体重：${userRow.weightKg ?? "—"} kg`);
  } else {
    p.push("- （无档案数据）");
  }

  // ---- 本周日历：星期是确定性事实，先给一张对照表，别让模型自己心算 ----
  //
  // 只在各表里附上星期是不够的：实测模型会整体偏移一天，把周六的 33km 长距离
  // 写成"周日主课表"，而且同一份报告里"周日负荷比 1.25"和"周六负荷比 0.94"
  // 互相打架 —— 说明它根本没在查表，是自己按 MM-DD 脑补的。
  // 所以这里给出完整日期 + 星期 + 本周第几天的三列对照，写在所有数据之前。
  p.push(`\n## 本周日历（星期已核算，直接照抄，不要自己按日期推算）`);
  p.push("| 本周第几天 | 完整日期 | 星期 |");
  p.push("|---|---|---|");
  for (let i = 0; i < 7; i++) {
    const d = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + i * 86400_000)
      .toISOString().slice(0, 10);
    p.push(`| 第 ${i + 1} 天 | ${d} | ${WEEKDAY_CN[new Date(`${d}T00:00:00Z`).getUTCDay()]} |`);
  }

  // ---- 本周合计 ----
  const totalKm = sessions.reduce((s, x) => s + x.totals.distanceKm, 0);
  const totalSec = sessions.reduce((s, x) => s + x.totals.durationSec, 0);
  const totalLoad = sessions.reduce((s, x) => s + (x.totals.trainingLoad || 0), 0);
  const totalGain = sessions.reduce((s, x) => s + (x.totals.elevGain || 0), 0);
  const mainBlocks = blocks.filter((b) => b.role.startsWith("主课表"));

  p.push(`\n## 本周合计（${md(weekStart)} ~ ${md(weekEnd)}）`);
  p.push(`- 训练场次：${sessions.length} 场，共 ${blocks.length} 个训练块（其中主课表 ${mainBlocks.length} 个）`);
  p.push(`- 总跑量 ${totalKm.toFixed(1)} km ／ ${fmtDur(totalSec)} ／ 累计爬升 ${Math.round(totalGain)} m ／ 负荷合计 ${totalLoad}`);
  p.push(`- ⚠ **以上是混合值**：跑量时长是各块直接相加，但配速和心率不能作为强度判据，原因见文首规则 1。`);

  // ---- 心率区间（整周）----
  const z = hrZonePrompt(weekLaps, age);
  if (z) p.push(`\n${z.text}`);
  if (recoveryRow) p.push(`\n## 周末恢复状态：${recoveryRow.recoveryPct ?? "—"}%（${recoveryRow.level ?? "—"}）`);

  // ---- 训练块明细 ----
  p.push(`\n## 训练块明细（共 ${blocks.length} 个）`);
  p.push("| # | 日期 | 角色 | 距离 | 用时 | 配速 | 均心 | 单圈峰值(参考) | 负荷 | 地形 |");
  p.push("|---|---|---|---|---|---|---|---|---|---|");
  p.push("> ⚠ 「单圈峰值」是分圈里最高的**瞬时**心率，只作参考。");
  p.push("> 判定有没有上阈值看的是「峰值**圈均**心率」，在下面主课表内部结构里给，两者不是一回事，别混用。");
  blocks.forEach((b, i) => {
    const a = b.activity;
    const d = b.detail;
    const rate = climbRate(d?.elevGain, a.distanceKm);
    p.push(
      `| ${i + 1} | ${md(b.date)} | ${b.role} | ${(a.distanceKm ?? 0).toFixed(2)}km | ${fmtDur(a.durationSec)} | ${fmtPace(a.avgPaceSec)} | ${a.avgHr ?? "—"} | ${peakHrOf(b) ?? "—"} | ${d?.trainingLoad ?? "—"} | ${TERRAIN_LABEL[classifyTerrain(rate)]} |`,
    );
  });

  // ---- 角色判定依据：让模型知道主次不是随手贴的标签 ----
  p.push(`\n## 主次课表判定依据`);
  for (const b of blocks) {
    p.push(`- ${md(b.date)} ${b.activity.distanceKm ?? 0}km → **${b.role}**：${b.roleReason}`);
  }

  // ---- 只对主课表展开内部结构 ----
  p.push(`\n## 主课表内部结构（仅 ${mainBlocks.length} 个主课表块，次课表不展开）`);
  for (const [i, b] of mainBlocks.entries()) {
    p.push(`\n### 主课表 ${i + 1}：${md(b.date)} ${b.activity.distanceKm ?? 0}km（${b.role}）`);

    if (b.role === "主课表·强度" && b.sets) {
      const rest = b.setRestSec != null ? `，组间休息约 ${fmtDur(b.setRestSec)}` : "";
      p.push(`- 结构：${b.sets.map((s) => s.distanceLabel).join(" + ")}${rest}`);
      p.push(`- ${"组".padEnd(4)} | ${"单组用时".padEnd(7)} | ${"配速/km".padEnd(8)} | 平均心率 | 峰值心率`);
      for (const s of b.sets) {
        p.push(`| 第${s.index}组 | ${fmtDur(s.timeSec)} | ${fmtPace(s.paceSec)} | ${s.avgHr ?? "—"} | ${s.maxHr ?? "—"} |`);
      }
      if (b.sets.some((s) => s.distanceLabel.endsWith("*"))) {
        p.push(`> 带 * 的组距离是**推算值**（本场分圈距离记 0，由总距离 ÷ 组数得到），不是表头读数。`);
      }
      const first = b.sets[0], last = b.sets[b.sets.length - 1];
      if (b.sets.length >= 3 && first.avgHr != null && last.avgHr != null) {
        p.push(
          `- 首末对比：配速 ${fmtPace(first.paceSec)} → ${fmtPace(last.paceSec)}，` +
          `组均心率 ${first.avgHr} → ${last.avgHr}（漂移 ${last.avgHr - first.avgHr >= 0 ? "+" : ""}${last.avgHr - first.avgHr} bpm）`,
        );
        p.push(`> 判断"抗疲劳"只看这行：配速没掉而心率上去了，和配速掉了但心率没上去，含义完全不同。`);
      }
    }

    if (b.role === "主课表·耐力" && b.quartiles) {
      p.push(`- 按里程四分位（替代逐段数据）：`);
      p.push(`| 区段 | 配速/km | 平均心率 | 爬升 |`);
      p.push(`|---|---|---|---|`);
      for (const q of b.quartiles) {
        p.push(`| ${q.fromKm.toFixed(1)}–${q.toKm.toFixed(1)}km | ${fmtPace(q.paceSec)} | ${q.avgHr ?? "—"} | ${Math.round(q.elevGain)}m |`);
      }
      p.push(`> 四分位是给"后半程掉速还是负分段"用的。比较配速前先看该段的爬升。`);
    }

    if (b.focus) {
      p.push(`- 阈值区累计 ${fmtDur(b.focus.thresholdSec)}｜峰值圈均心率 ${b.focus.peakLapHr ?? "—"} bpm（判定线 ${b.focus.thresholdHr} bpm）`);
    }
  }

  // ---- 历史主课表：让「同类块跨周对比」有数据可做 ----
  if (histMainBlocks.length > 0) {
    p.push(`\n## 前 ${trendRows.length} 周主课表对照（与本周同一套判定口径）`);
    p.push(
      `> 历史块**统一按本周的阈值线 ${Math.round(thresholdLine)} bpm 判定**，没有回算各周当时的阈值 —— 口径必须一致，` +
      `否则你拿到的两组数字不可直接相减。注意阈值线本身会随体能漂移，跨周解读时留出余量。`,
    );
    p.push("| 周起始 | 日期 | 角色 | 距离 | 配速 | 均心 | 单圈峰值(参考) | 负荷 | 爬升 | 爬升率 |");
    p.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const h of histMainBlocks) {
      const b = h.block;
      const a = b.activity;
      const gain = b.detail?.elevGain ?? 0;
      p.push(
        `| ${md(h.weekStart)} | ${md(b.date)} | ${b.role} | ${(a.distanceKm ?? 0).toFixed(2)}km | ${fmtPace(a.avgPaceSec)} | ${a.avgHr ?? "—"} | ${peakHrOf(b)} | ${b.detail?.trainingLoad ?? "—"} | ${Math.round(gain)}m | ${climbRate(gain, a.distanceKm).toFixed(1)} |`,
      );
    }
    p.push(
      `> 这张表存在的意义就是回答"本周这块比上周同类块更快/更稳还是退步了"。` +
      `比较配速前先比爬升率：起伏场和平路场不能直接比。` +
      `某一周没有长距离块、或没有强度块，那一周在该类型上就是空缺，不要拿另一类型顶替。`,
    );
  }

  // ---- 历史周强度结构：回答「本周强度占比相对前几周变了没有」 ----
  if (histZones.length > 0) {
    p.push(`\n## 各周整周心率区间占比（第一行为本周）`);
    p.push("| 周起始 | Z1 | Z2 | Z3 及以上 |");
    p.push("|---|---|---|---|");
    const cur = z?.zones?.zones;
    if (cur) {
      p.push(
        `| **${md(weekStart)}（本周）** | ${cur[0]?.pct ?? "—"}% | ${cur[1]?.pct ?? "—"}% | ${cur.slice(2).reduce((s, x) => s + (x.pct ?? 0), 0)}% |`,
      );
    }
    for (const h of histZones) {
      p.push(`| ${md(h.weekStart)} | ${h.z1 ?? "—"}% | ${h.z2 ?? "—"}% | ${h.z3plus ?? "—"}% |`);
    }
    p.push(`> 这是整周（含主次课表）的强度结构，用于回答"这周的强度刺激比前几周多是少"，不是用来评价单块强度。`);
  }


  // ---- 次课表只给完成度 ----
  const sideBlocks = blocks.filter((b) => b.role === "次课表" || b.role === "热身");
  if (sideBlocks.length > 0) {
    const sideKm = sideBlocks.reduce((s, b) => s + (b.activity.distanceKm ?? 0), 0);
    p.push(`\n## 次课表 / 热身（仅完成度，共 ${sideKm.toFixed(1)} km）`);
    for (const b of sideBlocks) {
      const a = b.activity;
      const w = b.mayMixWarmup ? " ⚠该记录内可能含热身，均值为混合值，勿作强度判据" : "";
      p.push(`- ${md(b.date)} ${b.role}：${(a.distanceKm ?? 0).toFixed(2)}km / ${fmtPace(a.avgPaceSec)} / ${a.avgHr ?? "—"} bpm${w}`);
    }
  }

  // ---- 训练负荷 ----
  if (loadRows.length > 0) {
    p.push(`\n## 本周每日训练负荷`);
    for (const l of loadRows) {
      p.push(`- ${md(l.date)}：短期 ${l.shortLoad ?? "—"}｜长期 ${l.longLoad ?? "—"}｜负荷比 ${l.ratio ?? "—"}｜${l.comment ?? ""}`);
    }
  }

  // ---- 恢复与生活 ----
  if (healthRows.length > 0 || sleepRows.length > 0 || stressRows.length > 0) {
    p.push(`\n## 本周恢复与生活数据（缺失日期即为无数据）`);
    p.push(`| 日期 | 睡眠分 | 静息心率 | HRV基线 | 压力 | 步数 |`);
    p.push(`|---|---|---|---|---|---|`);
    // 睡眠表里有大量 score=0 / available=0 的占位行，直接显示成 "0" 会让模型
    // 以为每天睡眠质量极差并据此大做文章。不可用一律当缺数据（—）。
    const sleepBy = new Map(sleepRows.map((r) => [r.date, r.available && r.score ? r.score : "—"]));
    const stressBy = new Map(stressRows.map((r) => [r.date, r.avgStress ?? "—"]));
    const healthBy = new Map(healthRows.map((r) => [r.dateLabel, r]));
    for (let i = 0; i < 7; i++) {
      const d = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + i * 86400_000).toISOString().slice(0, 10);
      const h = healthBy.get(d);
      p.push(`| ${md(d)} | ${sleepBy.get(d) ?? "—"} | ${h?.restingHr ?? "—"} | ${h?.hrvBaseline ?? "—"} | ${stressBy.get(d) ?? "—"} | ${h?.steps ?? "—"} |`);
    }
    if ([...sleepBy.values()].every((v) => v === "—")) {
      p.push(`> 本周没有可用的睡眠数据，不要据此推断睡眠质量。`);
    }
  }

  // ---- 趋势 ----
  if (trendRows.length > 0) {
    p.push(`\n## 前 ${trendRows.length} 周趋势（供本周对照，均为本周之前的周）`);
    p.push(`| 周起始 | 跑量 | 记录数 | 最长单跑 | 均配速 | 均心率 |`);
    p.push(`|---|---|---|---|---|---|`);
    for (const w of trendRows) {
      p.push(`| ${md(w.weekStart)} | ${w.distanceKm}km | ${w.count} | ${w.longestRunKm}km | ${fmtPace(w.avgPaceSec)} | ${w.avgHr ?? "—"} |`);
    }
    const prev = trendRows[trendRows.length - 1];
    if (prev) {
      const delta = prev.distanceKm > 0 ? ((totalKm - prev.distanceKm) / prev.distanceKm) * 100 : null;
      p.push(
        `- 本周 ${totalKm.toFixed(1)}km vs 上周 ${prev.distanceKm}km` +
        (delta != null ? `（${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%）` : "") +
        `；最长单跑 ${prev.longestRunKm}km → ${sessions.length ? Math.max(...sessions.map((s) => s.totals.distanceKm)).toFixed(1) : "—"}km`,
      );
    }
  }

  if (fitnessRow) {
    p.push(`\n## 周末体能基线`);
    p.push(`- VO₂max：${fitnessRow.vo2max ?? "—"}｜跑步等级：${fitnessRow.runningLevel ?? "—"}`);
    p.push(`- 阈值配速：${fmtPace(fitnessRow.thresholdPaceSec)} /km`);
    p.push(`- 成绩预测：5K ${fmtDur(fitnessRow.pred5kSec)}｜10K ${fmtDur(fitnessRow.pred10kSec)}｜半马 ${fmtDur(fitnessRow.predHalfSec)}｜全马 ${fmtDur(fitnessRow.predMarathonSec)}`);
  }

  try {
    const climbCtx = buildClimbContext();
    if (climbCtx) {
      p.push(`\n## 爬升能力基线`);
      p.push(`- ${climbCtx.note}`);
      p.push(`- 爬升代价系数 ${climbCtx.model.costSecPerRate.toFixed(2)} s/(m/km)`);
    }
  } catch {
    // 拟合失败不该拖垮整份周报，缺数据就当没有这一段
  }

  p.push(`\n---\n请开始分析这一周。记住：主课表才谈强度，次课表只谈完成度，全程不给训练计划。`);
  return p.join("\n");
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function analyzeWeek(opts: {
  weekStart: string;
  focus?: string | null;
}): Promise<{ report: string; provider: string; model: string; weekStart: string; blockCount: number }> {
  const cfg = getAiConfig();
  if (!cfg) throw new AiError("尚未配置 AI 模型，请先在设置页填写");

  const ctx = buildWeekContext(opts.weekStart);
  if (!ctx) throw new AiError(`${opts.weekStart} 这一周没有训练记录，先同步一下`);

  const focusLine = opts.focus ? `\n\n## 本次分析重点\n${opts.focus}\n` : "";
  const report = await callModel(cfg, WEEK_SYSTEM_PROMPT, buildWeekUserPrompt(ctx) + focusLine);

  db.delete(aiWeekReports)
    .where(and(eq(aiWeekReports.weekStart, opts.weekStart), eq(aiWeekReports.focus, opts.focus ?? "")))
    .run();
  db.insert(aiWeekReports)
    .values({
      weekStart: ctx.weekStart,
      weekEnd: ctx.weekEnd,
      sessionCount: ctx.sessions.length,
      blockCount: ctx.blocks.length,
      provider: cfg.provider,
      model: cfg.model,
      // 必须存空串而不是 null：SQLite 的唯一索引把多个 NULL 视为互不相同，
      // 存 null 的话 uq_ai_week_focus 形同虚设，同一周会攒出一串重复报告
      // （而上面的 delete 用的是空串，null 也永远匹配不上，删不掉）。
      focus: opts.focus ?? "",
      report,
    })
    .run();

  return { report, provider: cfg.provider, model: cfg.model, weekStart: ctx.weekStart, blockCount: ctx.blocks.length };
}

/** 校验并归一化传入的 weekStart；非法值直接拒绝，避免拼出错误区间 */
export function normalizeWeekStart(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return isoWeek(v);
}
