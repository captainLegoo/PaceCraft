/**
 * 疲劳指数（Fatigue Index）
 *
 * 目的：把「现在累不累」量化成一个 0–100 的分数，回答训练负荷数据回答不了的问题 ——
 * 同样的训练量，在睡眠充足、压力低的时候和熬夜赶赛之后，含义完全不同。
 *
 * ── 口径变更（2026-10）────────────────────────────────
 * 原实现用 COROS `short_load` 当负荷源，实测这个信号不可用：
 * 34 天取值范围 72–130，没有一天是 0，即**休息日在数据里不存在**；
 * 一次 21.14km / 92min 的长距离只被记成 97，与其 28 天中位基线 95.5 几乎相同。
 * 后果是三个分量同时塌成 0，分数恒等于 4，却因为「行数够」给出「可信度 高」。
 * 现在负荷改由 `dailyLoad.ts` 从 activities 原始活动自算（Edwards TRIMP），
 * 三个分量和可信度判定全部重做，详见各段注释。
 *
 * ── 三个分量 ─────────────────────────────────────────────
 * ① 负荷累积（权重 55%，缺失时动态补权重）
 *    先算「衰减累积负荷」：今天的有效负荷 = 当日负荷 + 昨日有效负荷 × 衰减系数。
 *    这一步同时解决了旧实现的两个问题：
 *      · 7 天加权平均会把单次 21K 摊平（一次长跑只占 1/7，摊完 ≈ 基线，
 *        刚跑完长距离反而显示在恢复）；
 *      · 直接取 7 天窗口峰值又太黏 —— 一次 31K 会霸占整个窗口，
 *        之后 4 天全部顶到 100 饱和。
 *    衰减累积让单次冲击既不被摊平、又会随时间合理回落。
 *    再把「累积负荷 vs 28 天基线」映射成分数。
 *
 * ② 恢复不足（权重 25%，无区分度时权重转给①）
 *    静息心率相对 28 天基线的抬升。**必须先过区分度体检**：
 *    实测中常见一种恒定序列（整段只有一两个取值、cv 极低），
 *    那通常是腕表没戴稳或没采到，而不是恢复好 ——
 *    这种序列不能当「恢复良好」的证据。不可用时此项退出，权重按比例分给①③。
 *
 * ③ 累积压力（权重 20%，同样动态）
 *    连续高负荷天数（超过基线 1.15 倍）。休息日在新口径下真实存在（load=0），
 *    所以这个维度才第一次有了意义。
 *
 * ── 分数映射 ─────────────────────────────────────────────
 * 0–100 分，方向是「越高越累」。
 */

import { assessSignal, type DailyLoad, type SignalQuality } from "./dailyLoad.ts";

export type FatigueComponent = {
  key: string;
  label: string;
  /** 分量原始值 */
  raw: number;
  /** 归一化到 0–1 */
  normalized: number;
  weight: number;
  /** 该分量是否参与了计算（false = 数据不可用，权重已转移） */
  active: boolean;
  note: string;
};

export type FatigueIndex = {
  /** 0–100，越高越累 */
  score: number;
  /** 1–10 分，越高越累 */
  level: number;
  label: string;
  levelLabel: string;
  /** 颜色语义：good / warn / bad */
  tone: "good" | "warn" | "bad";
  components: FatigueComponent[];
  summary: string;
  /** 数据是否足够支撑结论 */
  reliability: "高" | "中" | "低";
  reliabilityNote: string;
  /** 供前端画趋势用 */
  series: { date: string; score: number; load: number }[];
};

const LOAD_WEIGHT = 0.55;
const RHR_WEIGHT = 0.25;
const STRAIN_WEIGHT = 0.2;

/** 线性映射到 0–1 并夹取。lo 对应 0，hi 对应 1。 */
function ramp(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  return Math.min(Math.max((v - lo) / (hi - lo), 0), 1);
}

/** 中位数 */
function med(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 衰减累积负荷：carry[i] = load[i] + carry[i-1] × DECAY。
 *
 * 选这个形状是因为疲劳的物理性质：负荷有「残留」但会衰减。
 * DECAY=0.7 意味着昨天的负荷今天还剩 70%，三天后剩 34%，一周后剩 8%。
 * 对照一组典型数值：一次长距离跑当天累积负荷 ≈ 990，
 * 次日休息仍 ≈ 690（分数自然偏高但不至于饱和），一周后回落到 ≈ 145。
 * 相比之下取 7 天窗口最大值会在整周内一直卡着 100，那是窗口效应不是疲劳。
 */
const DECAY = 0.7;

/**
 * 比值 → 0–1 的映射区间，依据实测标定而非拍脑袋。
 *
 * 比值的真实跨度通常只有 1.0–1.5 这个量级：
 *   日常跑 ≈ 1.0    长距离 ≈ 1.2    大长距离 ≥ 1.4
 * 所以区间取 0.85–1.50，让 1.17（长距离）落在中段、1.45（大长距离）接近满格，
 * 而日常训练仍留在低分段。取 0.85–1.75 会把整个区间压在下半段，
 * 区分度不够。
 */
const RATIO_LO = 0.85;
const RATIO_HI = 1.5;

/** 由日负荷序列算出衰减累积负荷序列 */
function carryLoads(days: DailyLoad[]): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const d of days) {
    carry = d.load + carry * DECAY;
    out.push(carry);
  }
  return out;
}

export function computeFatigue(opts: {
  /** 由 dailyLoad.ts 从 activities 自算的日负荷，含 load=0 的休息日 */
  loads: DailyLoad[];
  /** 按日期升序的每日健康数据 */
  health: { dateLabel: string; restingHr: number | null; stressAvg: number | null; hrvBaseline: number | null }[];
  /** 今天日期 */
  today: string;
}): FatigueIndex {
  const { loads, health, today } = opts;

  const series: FatigueIndex["series"] = [];
  const notes: string[] = [];

  const days = [...loads].sort((a, b) => a.date.localeCompare(b.date));
  // 活动日：有活动记录的日子。load>0 的活动日在新口径下天然成立
  const activeDays = days.filter((d) => d.activities > 0);
  const restDays = days.filter((d) => d.activities === 0);

  // ── 数据充分性 ────────────────────────────────────────
  if (activeDays.length < 14) {
    notes.push(`有效活动日只有 ${activeDays.length} 天（需≥14 天）`);
  }
  if (restDays.length === 0) {
    notes.push("日历里没有休息日，活动记录可能不完整");
  }

  // ── 信号区分度体检 ────────────────────────────────────
  // 只看行数会给假的高可信度：恒定序列行数再多也没有信息量
  const rhrQuality: SignalQuality = assessSignal(
    health.map((h) => h.restingHr),
    { minDays: 14, label: "静息心率" },
  );
  if (!rhrQuality.usable) notes.push(rhrQuality.note);

  if (activeDays.length < 7) {
    return {
      score: 0,
      level: 5,
      label: "数据不足",
      levelLabel: "无法评估",
      tone: "warn",
      components: [],
      summary: "有效活动日不足 7 天，无法计算疲劳指数。请同步更多训练记录。",
      reliability: "低",
      reliabilityNote: notes.join("；") || "数据不足",
      series,
    };
  }

  // ── 基线：最近 28 个活动日的中位数（抗异常日）──
  const baselineWindow = activeDays.slice(-28);
  // 先算出全序列的衰减累积负荷，后面基线和当前值都从这条序列取，
  // 保证「今天的分」和「趋势曲线」用的是同一条刻度（否则两条线对不上）
  const carry = carryLoads(days);
  const carryByDate = new Map(days.map((d, i) => [d.date, carry[i]]));
  const loadBaseline = med(baselineWindow.map((d) => carryByDate.get(d.date) ?? 0));
  // 基线不能落在 0 上，否则比值会除出 Infinity
  const base = loadBaseline > 0 ? loadBaseline : 1;

  // ── ① 负荷累积：衰减累积负荷 vs 基线 ────────────────
  // 累积值本身已经含了「单次冲击不被摊平」和「冲击会衰减」两个性质，
  // 不需要再叠加权平均或窗口峰值
  const carryNow = carry.length ? carry[carry.length - 1] : 0;
  const loadRatio = carryNow / base;
  const loadNorm = ramp(loadRatio, RATIO_LO, RATIO_HI);

  // ── ② 恢复不足：静息心率相对基线抬升 ────────────────
  // 体检不通过就不参与计分：恒定的 66 不是「恢复良好」的证据
  const rhrSeries = health.filter((h) => h.restingHr != null);
  const rhrBaseline = rhrQuality.usable ? med(rhrSeries.slice(-28).map((h) => h.restingHr!)) : 0;
  const rhrNow = rhrQuality.usable ? med(rhrSeries.slice(-3).map((h) => h.restingHr!)) : 0;
  const rhrDelta = rhrQuality.usable ? rhrNow - rhrBaseline : 0;
  // +3bpm 开始有感觉，+10bpm 已经很累了
  const rhrNorm = rhrQuality.usable ? ramp(rhrDelta, 3, 10) : 0;

  // ── ③ 累积压力：连续高负荷天数 ───────────────────────
  // 「高负荷」= 超过基线 1.15 倍。休息日 load=0 会自然打断连续计数，
  // 这一点在旧口径（short_load 恒 >0）下是不可能的。
  const hiThreshold = base * 1.15;
  let consecutiveHi = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].load > hiThreshold) consecutiveHi++;
    else break;
  }
  const strainNorm = ramp(consecutiveHi, 0, 4);

  // ── 权重动态分配：不可用的分量把权重按比例分给剩下的 ──
  const active: Array<[number, number]> = [[LOAD_WEIGHT, loadNorm]];
  if (rhrQuality.usable) active.push([RHR_WEIGHT, rhrNorm]);
  active.push([STRAIN_WEIGHT, strainNorm]);
  const activeWeightSum = active.reduce((s, [w]) => s + w, 0);
  const normOf = (w: number, n: number) => (w / activeWeightSum) * n;

  const score = Math.round(
    (loadNorm * normOf(LOAD_WEIGHT, 1) + rhrNorm * normOf(RHR_WEIGHT, 1) + strainNorm * normOf(STRAIN_WEIGHT, 1)) * 100,
  );

  // ── 分档 ──────────────────────────────────────────────
  const level = Math.min(Math.max(Math.ceil(score / 10), 1), 10);
  const band =
    score < 25 ? "fresh" : score < 45 ? "normal" : score < 65 ? "loaded" : score < 82 ? "high" : "overreach";
  const BAND = {
    fresh: { label: "状态充沛", tone: "good" as const, levelLabel: "疲劳很低" },
    normal: { label: "状态正常", tone: "good" as const, levelLabel: "正常区间" },
    loaded: { label: "有累积疲劳", tone: "warn" as const, levelLabel: "中等疲劳" },
    high: { label: "疲劳偏高", tone: "warn" as const, levelLabel: "较高疲劳" },
    overreach: { label: "过度负荷", tone: "bad" as const, levelLabel: "极高疲劳" },
  };
  const b = BAND[band];

  const components: FatigueComponent[] = [
    {
      key: "load",
      label: "负荷累积",
      raw: loadRatio,
      normalized: loadNorm,
      weight: normOf(LOAD_WEIGHT, 1),
      active: true,
      note:
        `累积负荷 ${carryNow.toFixed(0)} 对 28 天活动日基线 ${base.toFixed(0)}` +
        `（${loadRatio >= 1 ? "+" : ""}${((loadRatio - 1) * 100).toFixed(0)}%），` +
        `当日负荷 ${(days[days.length - 1]?.load ?? 0).toFixed(0)}`,
    },
    {
      key: "rhr",
      label: "恢复不足",
      raw: rhrDelta,
      normalized: rhrNorm,
      weight: rhrQuality.usable ? normOf(RHR_WEIGHT, 1) : 0,
      active: rhrQuality.usable,
      note: rhrQuality.usable
        ? `近 3 天静息心率中位 ${rhrNow.toFixed(0)}bpm，基线 ${rhrBaseline.toFixed(0)}bpm（${rhrDelta >= 0 ? "+" : ""}${rhrDelta.toFixed(0)}）`
        : rhrQuality.note,
    },
    {
      key: "strain",
      label: "累积压力",
      raw: consecutiveHi,
      normalized: strainNorm,
      weight: normOf(STRAIN_WEIGHT, 1),
      active: true,
      note:
        consecutiveHi === 0
          ? `最近没有连续高负荷（阈值 ${hiThreshold.toFixed(0)}）`
          : `已连续 ${consecutiveHi} 天高负荷（>基线 15%，即 >${hiThreshold.toFixed(0)}），没有插入恢复日`,
    },
  ];

  // ── 趋势序列（近 14 个日历日）────────────────────────
  // 用与当前分完全相同的公式重算每一天（同一份 carry 序列、同一条基线），
  // 否则曲线是另一把尺子，跟头部的数字对不上
  for (let i = Math.max(0, days.length - 14); i < days.length; i++) {
    series.push({
      date: days[i].date,
      score: Math.round(ramp(carry[i] / base, RATIO_LO, RATIO_HI) * 100),
      load: Math.round(days[i].load),
    });
  }

  // ── 摘要 ──────────────────────────────────────────────
  const parts: string[] = [];
  if (score >= 65) {
    parts.push("当前负荷累积明显高于个人基线，这是最容易出现非疲劳性掉速的状态。");
  } else if (score >= 45) {
    parts.push("有可察觉的累积疲劳，但仍属可控范围。");
  } else if (loadRatio >= 1.15) {
    // 总分还够不上「有累积疲劳」，但累积负荷已超基线，说明在往上走
    parts.push(
      `累积负荷已达基线的 ${loadRatio.toFixed(2)} 倍，虽未超载但正在累积，需要留出恢复时间。`,
    );
  } else {
    parts.push("负荷与恢复处于平衡状态。");
  }
  if (consecutiveHi >= 3) parts.push(`已连续 ${consecutiveHi} 天高负荷。`);
  if (rhrQuality.usable && rhrDelta >= 5) {
    parts.push(`静息心率比基线高 ${rhrDelta.toFixed(0)}bpm，说明恢复确实落后于消耗。`);
  }

  // ── 可信度：看区分度，不只看行数 ─────────────────────
  // 旧逻辑 valid.length>=28 && rhrCount>=14 就给「高」，恒定序列照样拿高分。
  // 现在要求：活动日够、休息日存在（证明日历完整）、至少一个恢复信号可用。
  const reliability: FatigueIndex["reliability"] =
    activeDays.length >= 28 && restDays.length >= 5 && rhrQuality.usable
      ? "高"
      : activeDays.length >= 14
        ? "中"
        : "低";

  const covBits = [`活动 ${activeDays.length} 天 / 休息 ${restDays.length} 天`];
  if (rhrQuality.usable) covBits.push(`静息心率 ${rhrQuality.days} 天（${rhrQuality.distinct} 个取值）`);
  else covBits.push(`静息心率不可用（${rhrQuality.distinct} 个取值）`);

  return {
    score,
    level,
    label: b.label,
    levelLabel: b.levelLabel,
    tone: b.tone,
    components,
    summary: parts.join(""),
    reliability,
    reliabilityNote: notes.length ? `${covBits.join("，")}。${notes.join("；")}。` : `${covBits.join("，")}，覆盖充分。`,
    series,
  };
}

/** 便于调用方拿到自算负荷的静息心率基线（dailyLoad 的强度因子要用） */
export function restingHrBaseline(health: { restingHr: number | null }[]): number | null {
  const xs = health.map((h) => h.restingHr).filter((v): v is number => v != null);
  if (xs.length < 7) return null;
  return med(xs.slice(-28));
}