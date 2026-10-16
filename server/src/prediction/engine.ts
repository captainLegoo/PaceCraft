/**
 * 自建成绩预测引擎。
 *
 * 与 COROS 官方预测的区别：官方是通用模型（只吃当前体能指标），
 * 这里完全基于使用者自己的训练数据 —— 从中提取「最佳连续成绩」作为锚点，
 * 拟合出属于他自己的 Riegel 指数和阈值配速，再做多模型集成。
 */

export type Effort = {
  date: string;
  startTs: number;
  targetKm: number;
  actualKm: number;
  seconds: number;
  /** **平路等效配速**（秒/km，已扣除爬升代价），用于阈值回归与成绩外推 */
  paceSec: number;
  /** 实跑配速（秒/km，原始值），仅用于展示 */
  rawPaceSec: number;
  /** 这段路的平均爬升率（m/km），0 表示平路 */
  climbRate: number;
  avgHr: number;
  fromLap: number;
  toLap: number;
  /** 该次训练当日的负荷，0 表示当天没有负荷数据 */
  loadThatDay: number | null;
};

export type Threshold = {
  paceSec: number;
  hr: number;
  hrMax: number;
  /** 回归系数：心率 = a + b × 配速秒，用来把任意配速换算成心率 */
  a: number;
  b: number;
  /** 拟合质量：样本量与相关系数 */
  samples: number;
  r2: number;
  method: string;
};

// ---------------- 基础统计 ----------------

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

function linreg(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { a: 0, b: 0, r2: 0, n };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2, n };
}

// ---------------- 1. 最佳连续成绩 ----------------

export type LapInput = {
  labelId: string;
  date: string;
  startTs: number;
  lapIndex: number;
  distanceM: number;
  timeSec: number;
  avgHr: number;
  /** 该圈累计爬升（m），用于算爬升率 */
  elevGain: number;
  /** 该圈爬升率（m/km） */
  climbRate: number;
  /** 平路等效配速（秒/km）。爬升代价无法拟合时等于实跑配速。 */
  gapPaceSec: number;
};

/**
 * 在一次训练内部找「连续若干段」中累计距离达标的最快窗口。
 *
 * 必须连续：间歇训练里 1km×10 组各自很快，但拼起来不是一次有效成绩，
 * 所以只允许在同一次训练的连续分圈内滑动。
 *
 * 比较窗口快慢时一律用 gapPaceSec（平路等效配速）而不是实跑配速：
 * 否则「最快 10 公里」很可能选中的是山路里一段下坡，
 * 拿它去外推全马会系统性偏乐观。
 */
export function bestContinuousEffort(laps: LapInput[], targetKm: number): Effort | null {
  let best: Effort | null = null;

  for (let i = 0; i < laps.length; i++) {
    let dist = 0, time = 0, gapAcc = 0, hrAcc = 0, hrW = 0, rateAcc = 0;
    for (let j = i; j < laps.length; j++) {
      dist += laps[j].distanceM / 1000;
      time += laps[j].timeSec;
      gapAcc += laps[j].gapPaceSec * (laps[j].distanceM / 1000);
      rateAcc += laps[j].climbRate * (laps[j].distanceM / 1000);
      hrAcc += (laps[j].avgHr || 0) * laps[j].timeSec;
      hrW += laps[j].timeSec;
      if (dist < targetKm) continue;

      const candidate: Effort = {
        date: laps[i].date,
        startTs: laps[i].startTs,
        targetKm,
        actualKm: dist,
        seconds: time,
        paceSec: gapAcc / dist,
        rawPaceSec: time / dist,
        climbRate: rateAcc / dist,
        avgHr: hrW > 0 ? hrAcc / hrW : 0,
        fromLap: laps[i].lapIndex,
        toLap: laps[j].lapIndex,
        loadThatDay: null,
      };
      if (!best || candidate.paceSec < best.paceSec) best = candidate;
      break;
    }
  }
  return best;
}

/** 过滤掉 GPS 丢失产生的垃圾段 */
export function sanitizeLaps(rows: any[]): LapInput[] {
  return rows
    .filter((r) => r.distanceM > 0 && r.timeSec > 0)
    // 按配速判断合理性：2:00/km ~ 15:00/km 之外都是噪声。
    // （早先写成 r.distanceM < 2500 ? true : ...，结果 1km 的段直接放行、
    //   反而绕过了时长检查，用时 90 分钟的段没被滤掉。）
    .filter((r) => {
      const pace = r.timeSec / (r.distanceM / 1000);
      return pace >= 120 && pace <= 900;
    })
    .map((r) => ({
      labelId: r.labelId,
      date: r.date,
      startTs: r.startTs ?? 0,
      lapIndex: r.lapIndex,
      distanceM: r.distanceM,
      timeSec: r.timeSec,
      avgHr: r.avgHr ?? 0,
      elevGain: r.elevGain ?? 0,
      climbRate: r.climbRate ?? 0,
      gapPaceSec: r.gapPaceSec ?? r.timeSec / (r.distanceM / 1000),
    }));
}

// ---------------- 2. 阈值配速 ----------------

/**
 * 阈值配速不能直接对「配速-心率」做全区间线性回归：
 * 心率在轻松配速上会压平（约 145bpm 就到底了），把轻松段算进去会把斜率压歪。
 *
 * 做法：只用有氧区间（配速 3:40–5:05）做稳健回归，
 * 再用「实测跑过的最长配速」做下限约束，避免外推出不现实的阈值。
 */
export type ThresholdOptions = {
  hrMax: number;
  /** 回归区间下界（快于此配速的数据太少，不可靠） */
  minPace?: number;
  /** 回归区间上界（慢于此配速心率已压平，会压歪斜率） */
  maxPace?: number;
  /** 实测跑过的最慢配速，用来给阈值配速兜底 */
  slowestPaceSeen: number;
};

export function estimateThreshold(
  samples: { paceSec: number; hr: number }[],
  opts: ThresholdOptions,
): Threshold {
  const minPace = opts.minPace ?? 220;
  const maxPace = opts.maxPace ?? 305;
  const inRange = samples.filter(
    (s) => s.paceSec >= minPace && s.paceSec <= maxPace && s.hr > 0,
  );

  if (inRange.length < 20) {
    // 样本不够，退回「阈值心率 / 实测最慢配速」的经验兜底
    const thrHr = opts.hrMax * 0.885;
    return {
      paceSec: Math.max(opts.slowestPaceSeen, 250), hr: thrHr, hrMax: opts.hrMax,
      a: 0, b: 0, samples: inRange.length, r2: 0, method: "兜底（样本不足）",
    };
  }

  const { a, b, r2, n } = linreg(inRange.map((s) => s.paceSec), inRange.map((s) => s.hr));

  // 阈值心率取 88.5% 最大心率（跑步文献常用区间 88–92% 的中值）
  const thrHr = opts.hrMax * 0.885;
  let pace = b !== 0 ? (thrHr - a) / b : opts.slowestPaceSeen;

  // 约束：阈值配速不应该快过 3:35，也不应该慢过实测跑过的最慢配速
  pace = Math.min(Math.max(pace, 215), Math.max(opts.slowestPaceSeen, 250));

  return {
    paceSec: pace,
    hr: thrHr,
    hrMax: opts.hrMax,
    a, b,
    samples: n,
    r2,
    method: `有氧区间稳健回归（配速 ${fmtP(minPace)}–${fmtP(maxPace)}，n=${n}，R²=${r2.toFixed(3)}）`,
  };
}

// ---------------- 3. 个人 Riegel 指数 ----------------

/**
 * 理论上 Riegel 指数是 1.06，但那是「两场全力比赛」的关系。
 * 训练场上取到的「最佳连续段」强度不一致：5km 最佳往往来自强度课（很拼），
 * 长距离最佳来自稳态跑（保守），直接混在一起拟合会得到偏差很大的 k。
 *
 * 所以：先按强度把成绩分层，只在「同一层」内部两两配对求 k。
 */
export function fitPersonalExponent(efforts: Effort[], thresholdPaceSec: number): {
  k: number;
  spread: number;
  pairs: number;
  note: string;
} {
  const ratio = efforts.map((e) => e.paceSec / thresholdPaceSec);

  const ks: number[] = [];
  for (let i = 0; i < efforts.length; i++) {
    for (let j = i + 1; j < efforts.length; j++) {
      const a = efforts[i], b = efforts[j];
      // 强度层级差太远的不参与：短距离冲刺课 vs 长距离稳态跑之间没有可比性
      if (Math.abs(ratio[i] - ratio[j]) > 0.22) continue;
      if (b.seconds <= a.seconds) continue;
      ks.push(Math.log(b.seconds / a.seconds) / Math.log(b.actualKm / a.actualKm));
    }
  }

  if (ks.length < 3) {
    return { k: 1.06, spread: 0, pairs: 0, note: "可用配对不足，回退到理论值 1.06" };
  }

  const k = median(ks);
  const spread = quantile(ks, 0.75) - quantile(ks, 0.25);
  const clamped = Math.min(Math.max(k, 1.00), 1.20);
  return {
    k: clamped,
    spread,
    pairs: ks.length,
    note:
      Math.abs(clamped - 1.06) < 0.015
        ? `同强度层内 ${ks.length} 组配对，中位 k=${clamped.toFixed(4)}，与理论 1.06 几乎一致`
        : `同强度层内 ${ks.length} 组配对，中位 k=${clamped.toFixed(4)}（四分位宽 ${spread.toFixed(3)}），偏离理论 1.06 ${(clamped > 1.06 ? "+" : "") + ((clamped - 1.06) * 100).toFixed(1)}%`,
  };
}

// ---------------- 4. 单项外推模型 ----------------

/**
 * Riegel 疲劳指数。
 *
 * 1.06 是 Riegel(1981) 从「世界纪录」拟合出来的，对业余跑者偏乐观。
 * Vickers & Vertosick(2016, n=2303) 发现用 1.07 校准更好：他们对比全马时
 * 用的正是 k=1.07。本项目自己的回测（12 次长距离跑）也显示 1.07 的
 * 平均偏差小于 1.06。
 */
export const RIEGEL_THEORY = 1.07;

export function riegel(from: { km: number; sec: number }, toKm: number, k: number): number {
  return from.sec * Math.pow(toKm / from.km, k);
}

/**
 * 周跑量修正（Vickers & Vertosick 2016 的核心发现）。
 *
 * Riegel 到半马都校准良好，但全马会系统性偏快 —— 论文里一半的跑者被预测快
 * 10 分钟以上。作者发现唯一能解释这个误差的变量是**周训练量**：
 * 周跑量越高，全马的实际疲劳衰减越小。
 *
 * 论文原式（k 全马）：
 *   k₁₂ = ln(t₂/t₁) / ln(d₂/d₁)
 *   k_全马 = 1.4510756 − 0.23797948·k₁₂ − 0.01410023·(周跑量/10)
 *
 * ⚠️ 系数口径：原论文问卷来自英美跑者，周跑量按**英里**计。直接套用会让
 * 同一份训练量算出更大的 k（全马更慢）。这里保留英里口径以忠实于原文，
 * 由调用方负责换算。若要按公里理解，把 `MILE_KM` 传进来即可。
 */
export const VICKERS_K_BASE = 1.4510756;
export const VICKERS_K_K12 = 0.23797948;
export const VICKERS_K_MILEAGE = 0.01410023;

export function weeklyMileageExponent(
  k12: number,
  weeklyKm: number,
  /** 把公里换算成论文口径的英里（默认 true = 忠实原文）。传 false 则直接用公里。 */
  convertToMiles = true,
): number {
  const miles = convertToMiles ? weeklyKm / 1.609344 : weeklyKm;
  return (
    VICKERS_K_BASE -
    VICKERS_K_K12 * k12 -
    VICKERS_K_MILEAGE * (miles / 10)
  );
}

/** 两点之间的个人疲劳指数 */
export function exponentBetween(a: { km: number; sec: number }, b: { km: number; sec: number }): number {
  return Math.log(b.sec / a.sec) / Math.log(b.km / a.km);
}

/**
 * Daniels & Gilbert (1979) 的两条生理方程 —— 直接求解，不再查表。
 *
 * 为什么必须改：原来的 VDOT_TABLE 是错的。表里每一行的 5K 成绩都比
 * Daniels 官方表快 4–10 个 VDOT 点（例如表标称 VDOT 50 的 5K 是 17:10，
 * 官方 VDOT 50 其实是 19:56），导致这个模型一路给出偏乐观的预测，
 * 而且表尾只到 54，稍微强一点就撞上限被钳住。
 *
 * ① 跑步氧耗（v 单位 m/min，输出 ml/kg/min）：
 *      VO₂ = −4.60 + 0.182258·v + 0.000104·v²
 * ② 比赛中能维持的 VO₂max 比例（t 单位分钟）：
 *      %max = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)
 *    VDOT = VO₂ ÷ %max
 */

/** 由成绩反推 VDOT（dist 单位 km，sec 单位秒） */
export function vdotOf(distKm: number, sec: number): number {
  const v = (distKm * 1000) / (sec / 60); // m/min
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const t = sec / 60;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}

/**
 * 由 VDOT 反推目标距离成绩。
 * 对 t 二分：t 越大 → 速度越小 → VDOT 越小，单调，可二分。
 */
export function vdotPredict(vdot: number, toKm: number): number | null {
  if (!(vdot > 0)) return null;
  let lo = 1, hi = 480;
  for (let i = 0; i < 200; i++) {
    const t = (lo + hi) / 2; // 分钟
    const v = (toKm * 1000) / t;
    const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
    const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    const cur = vo2 / pct;
    if (cur > vdot) lo = t; else hi = t;
  }
  return ((lo + hi) / 2) * 60;
}

/**
 * 由任意距离成绩 + 目标距离做 VDOT 外推。
 * 任一距离都可以当锚点，不必非得是 5K（原来只认 5K，是选锚点错误）。
 */
export function danielsPredict(anchor: { km: number; sec: number }, toKm: number): number | null {
  return vdotPredict(vdotOf(anchor.km, anchor.sec), toKm);
}

// ---------------- 5. 集成预测 ----------------

export type ModelPrediction = {
  model: string;
  label: string;
  seconds: number;
  weight: number;
  basis: string;
  /** 锚点可信度分层 */
  tier: "A" | "B" | "C";
  caveat?: string;
};

export type Prediction = {
  distanceKm: number;
  name: string;
  seconds: number;
  paceSec: number;
  low: number;
  high: number;
  officialSeconds: number | null;
  deltaVsOfficial: number | null;
  models: ModelPrediction[];
  /** 与真实长距离跑的对照 —— 比任何公式都硬的证据 */
  groundTruth: {
    actualKm: number;
    actualSec: number;
    date: string;
    /** 按实测配速折算到目标距离的用时 */
    impliedSec: number;
    /** 预测相对实测的偏差，负数 = 预测更乐观 */
    deltaPct: number;
  } | null;
  confidence: "高" | "中" | "低";
  confidenceNote: string;
};

const TARGETS: { km: number; name: string }[] = [
  { km: 5, name: "5 公里" },
  { km: 10, name: "10 公里" },
  { km: 15, name: "15 公里" },
  { km: 21.0975, name: "半程马拉松" },
  { km: 42.195, name: "全程马拉松" },
];

/**
 * 锚点可信度分层 —— 这是整个算法最关键的判断。
 *
 * 训练场上「最快的那 5 公里」几乎从来不是全力 5 公里：它常常是间歇课里的一组，
 * 跑完还有余力。而「最快的那 30 公里」和比赛强度非常接近。
 * 所以同样叫「最佳成绩」，能外推的距离完全不同。
 */
export function anchorTier(km: number): "A" | "B" | "C" {
  if (km >= 15) return "A";
  if (km >= 8) return "B";
  return "C";
}

export const TIER_LABEL: Record<"A" | "B" | "C", string> = {
  A: "长距离锚点：训练强度≈比赛强度，外推最可信",
  B: "中等距离锚点：中等可信",
  C: "短距离锚点：训练中的短距离几乎不是全力，系统性偏保守",
};

export function predictAll(opts: {
  efforts: Effort[];
  threshold: Threshold;
  k: number;
  official: Record<number, number | null>;
  latestDate: string;
  /** 近 8 周平均周跑量（公里）。用于 Vickers 周跑量修正。 */
  weeklyKm?: number;
  /**
   * 实际跑过的最长距离成绩（真实跑出来的，不是公式推的）。
   * 这是比任何公式都硬的证据 —— 优先用于长距离锚定与交叉校验。
   */
  longestActual?: { km: number; sec: number; date: string } | null;
}): Prediction[] {
  const { efforts, threshold, k, official, latestDate, weeklyKm = 0 } = opts;

  const bestFor = (km: number) => {
    const l = efforts.filter((e) => e.targetKm === km);
    return l.length ? l.reduce((a, b) => (a.paceSec <= b.paceSec ? a : b)) : null;
  };

  const best5 = bestFor(5);
  const best10 = bestFor(10);
  const best15 = bestFor(15);
  const bestHm = bestFor(21.0975);
  const bestFm = bestFor(42.195);

  /**
   * 锚点新鲜度。长距离锚点衰减更慢 —— 半马/全马体能不会 4 个月就掉光，
   * 而短距离成绩只反映当天的状态，衰减快。
   */
  const recency = (date: string, halfLifeDays: number) =>
    Math.pow(0.5, Math.max(0, daysBetween(date, opts.latestDate)) / halfLifeDays);

  /**
   * 实跑锚点的等效置信度。
   *
   * recency 的半衰期给长距离留得很长（240 天），但实测锚点会「老到失去话语权」：
   * 317 天前的 42km 虽然配速很快，权重衰减后只剩 0.12，压不住其它模型。
   * 长距离体能不会 4 个月掉光，但也不至于 10 个月不变，所以这里给一个下限 ——
   * 真实跑出来的成绩比任何外推都可信，不该被衰减到近乎无效。
   */
  const actualAnchorWeight = (date: string, base: number) =>
    base * Math.max(0.55, recency(date, 240));

  // 阈值锚定的 Riegel：
  // 乳酸阈值配速 ≈ 30 分钟全力跑（这是跑步生理里的标准对应关系），
  // 于是先算出「阈值配速下的 30 分钟等效成绩」，再用 Riegel 外推。
  // 比按距离硬编码衰减系数更稳，也不会出现「5K 比赛比阈值还慢」这种方向性错误。
  const eq30Km = 1800 / threshold.paceSec;
  const eq30Sec = 1800;
  const fromThreshold = (km: number, kk: number) => eq30Sec * Math.pow(km / eq30Km, kk);

  /**
   * 周跑量修正后的全马指数。
   *
   * ⚠️ 重要限制：这个修正只在锚点是**比赛级成绩**时成立。
   * Vickers 的 k₁₂ 由两场真实比赛拟合而来；训练场的「最佳连续段」强度
   * 与比赛不同（短距离常是间歇组、长距离常是保守稳态），直接代入会得到
   * 偏大的 k₁₂ → k 全马过大 → 预测过度保守。
   *
   * 训练段口径拟合出的 k₁₂ 常常偏大（例如 1.12 上下），若再叠周跑量修正，
   * k 会接近 1.14，全马预测被压得过慢，与实跑记录明显不符。
   * 因此这里只做温和夹取：允许周跑量在 [k 基准−0.02, k 基准+0.04] 内浮动。
   */
  const K_BASE = RIEGEL_THEORY; // 1.07
  const K_MIN = K_BASE - 0.02;
  const K_MAX = K_BASE + 0.04;
  let kMarathon = RIEGEL_THEORY;
  let mileageNote: string | null = null;
  const hm = bestHm, ten = best10;
  if (weeklyKm > 0 && hm && ten) {
    const k12 = exponentBetween(
      { km: ten.actualKm, sec: ten.seconds },
      { km: hm.actualKm, sec: hm.seconds },
    );
    if (k12 > 1 && k12 < 1.6) {
      const raw = weeklyMileageExponent(k12, weeklyKm);
      kMarathon = Math.min(Math.max(raw, K_MIN), K_MAX);
      mileageNote =
        `周跑量 ${weeklyKm.toFixed(0)}km/周 → 原始 k=${raw.toFixed(4)}，` +
        (raw !== kMarathon ? `夹取到 ${kMarathon.toFixed(4)}` : `采用 k=${kMarathon.toFixed(4)}`) +
        `（k₁₂=${k12.toFixed(4)} 为训练段口径，仅作方向性参考）`;
    }
  }
  // 长距离才应用周跑量修正：≤21km 时文献显示 Riegel 本身就校准良好
  const kFor = (km: number) => (km >= 42.195 ? kMarathon : RIEGEL_THEORY);

  return TARGETS.map((t) => {
    const models: ModelPrediction[] = [];

    // ---- 模型 A：阈值锚定 Riegel ----
    models.push({
      model: "threshold-riiegel",
      label: `阈值配定 30 分钟等效 + Riegel(${RIEGEL_THEORY})`,
      seconds: fromThreshold(t.km, kFor(t.km)),
      weight: t.km <= 10 ? 0.34 : t.km <= 21.0975 ? 0.28 : 0.14,
      tier: "B",
      basis: `阈值配速 ${fmtP(threshold.paceSec)}/km ≈ 30 分钟跑 ${eq30Km.toFixed(2)}km`,
      caveat: "阈值配速由配速-心率回归推得，训练状态越好这个锚点越乐观",
    });

    // ---- 模型 A2：实际长距离跑外推（全马最强证据，权重最高）----
    // 文献反复强调锚点要选「最接近目标距离的真实成绩」。
    // 训练场上 42km 的连续跑，强度本来就接近比赛，比任何公式外推都可信。
    // ⚠️ 距离比较必须留 GPS 误差余量。手表/GPS 记录的全马几乎总是略短于
    // 官方 42.195km（常见短记 0.25% 左右），因为计圈和
    // 配速门都按实际跑过的轨迹算。原先用 `la.km >= t.km` 严格比较，
    // 导致这个「全马最强证据」模型在全马档被静默跳过（约 42.09 < 42.195），
    // 权重最高（0.42）的锚点整场缺席，预测被 Riegel 外推和阈值回归拖慢 8 分钟。
    // 放 1% 余量既能接住 GPS 短记，又不会让 40km 的训练跑冒充全马。
    const GPS_TOLERANCE = 0.01;
    const la = opts.longestActual;
    if (la && la.km >= t.km * (1 - GPS_TOLERANCE) && t.km >= 15) {
      models.push({
        model: "longest-actual",
        label: `实际跑过的 ${la.km.toFixed(1)}km 外推`,
        seconds: riegel({ km: la.km, sec: la.sec }, t.km, kFor(t.km)),
        weight: actualAnchorWeight(la.date, t.km >= 42.195 ? 0.42 : 0.26),
        tier: "A",
        basis: `实测 ${la.km.toFixed(2)}km 用时 ${fmtT(la.sec)}（${la.date}）`,
        caveat: t.km >= 42.195 ? "训练长距离跑不是比赛，补给/战术/赛道都不同" : undefined,
      });
    }

    // ---- 模型 B：个人 k 从最佳半马外推（仅长距离）----
    if (hm && t.km >= 15) {
      models.push({
        model: "riiegel-khm",
        label: `Riegel(k=${kFor(t.km).toFixed(4)}) 从半马最佳外推`,
        seconds: riegel({ km: hm.actualKm, sec: hm.seconds }, t.km, kFor(t.km)),
        weight: (t.km >= 21.0975 ? 0.30 : 0.18) * recency(hm.date, 240),
        tier: anchorTier(hm.actualKm),
        basis: `半马最佳 ${fmtT(hm.seconds)} @ ${hm.paceSec.toFixed(0)}s/km（${hm.date}，HR${hm.avgHr.toFixed(0)}）`,
        caveat: mileageNote ?? undefined,
      });
    }

    // ---- 模型 C：VDOT 外推（任一距离锚点，不再强制用 5K）----
    // 原来的实现只接受 5K 锚点，且查表值本身偏乐观；现在任一距离都能当锚。
    {
      const anchor = t.km <= 5 ? (best5 ?? best10) : t.km <= 10 ? (best10 ?? best5) : (hm ?? best10);
      if (anchor) {
        const sec = danielsPredict({ km: anchor.actualKm, sec: anchor.seconds }, t.km);
        if (sec != null) {
          models.push({
            model: "daniels-vdot",
            label: `Daniels VDOT（${anchor.actualKm.toFixed(0)}km 锚点，VDOT ${vdotOf(anchor.actualKm, anchor.seconds).toFixed(1)}）`,
            seconds: sec,
            weight: (t.km <= 10 ? 0.16 : 0.12) * recency(anchor.date, anchor.targetKm >= 15 ? 240 : 120),
            tier: anchorTier(anchor.actualKm),
            basis: `锚点 ${fmtT(anchor.seconds)} @ ${anchor.actualKm.toFixed(2)}km（${anchor.date}）`,
            caveat:
              anchor.targetKm < 8
                ? "训练中的短距离不是全力成绩，此模型会明显偏保守"
                : undefined,
          });
        }
      }
    }

    // ---- 模型 D：长距离锚点线性折算（目标更短时用，表示"至少能跑这个速度"）----
    if (bestFm && t.km < 42.195) {
      models.push({
        model: "longrun-linear",
        label: "长距离最佳线性折算",
        seconds: (bestFm.seconds / bestFm.actualKm) * t.km,
        weight: (t.km >= 15 ? 0.18 : 0.08) * recency(bestFm.date, 240),
        tier: "A",
        basis: `42.5K 最佳 ${fmtT(bestFm.seconds)} @ ${bestFm.paceSec.toFixed(0)}s/km（${bestFm.date}，HR${bestFm.avgHr.toFixed(0)}）`,
        caveat: t.km <= 10 ? "从 42km 折算到 5/10K 极不可靠，权重已压低" : undefined,
      });
    }

    // ---- 模型 E：最近长距离实跑的线性折算（唯一「无公式」的锚点）----
    // 他真的用这个配速跑过这么远。预测值不应该比它更乐观，
    // 否则等于预测了一个他从未达到过的水平 —— RQ 的 3:00:17 正是这么来的。
    const la2 = opts.longestActual;
    if (la2) {
      const linear = (la2.sec / la2.km) * t.km;
      models.push({
        model: "longest-linear",
        label: `${la2.km.toFixed(1)}km 实跑配速线性折算`,
        seconds: linear,
        weight: actualAnchorWeight(la2.date, t.km >= 42.195 ? 0.30 : t.km >= 15 ? 0.16 : 0.06),
        tier: "A",
        basis: `实测 ${la2.km.toFixed(2)}km 用时 ${fmtT(la2.sec)} → ${(la2.sec / la2.km).toFixed(0)}s/km（${la2.date}）`,
        caveat:
          t.km >= 42.195
            ? "训练长距离跑不是比赛：补给、战术、赛道都不同，比赛通常更快"
            : t.km <= 10
              ? "从 40km+ 折算到 5/10K 极不可靠，仅作下界参考"
              : undefined,
      });
    }

    const central = weightedMedian(models);
    // 区间按权重算，而不是按模型个数：
    // ① C 层（短距离锚点）系统性偏保守，不参与定区间；
    // ② 权重过低的模型也不该定义边界（它只起交叉校验作用）。
    const maxW = Math.max(...models.map((m) => m.weight));
    const basis = models
      .filter((m) => m.tier !== "C" && m.weight >= maxW * 0.4)
      .map((m) => ({ seconds: m.seconds, weight: m.weight }))
      .sort((a, b) => a.seconds - b.seconds);
    const pool = basis.length >= 2 ? basis : models.map((m) => ({ seconds: m.seconds, weight: m.weight }));
    let lo = weightedQuantile(pool, 0.25);
    let hi = weightedQuantile(pool, 0.75);

    // 模型之间的离散度不等于真实世界的不确定性。
    //
    // 下限不是拍脑袋定的，而是从长距离跑的留出回测标出来的：
    // 原来全马用 ±3.5%，但真实结果落在区间内的比例明显偏低 —— 区间偏窄，
    // 等于给了一个「看起来精确但经常兜不住」的保证。现按实测残差幅度重标，
    // 目标覆盖率 ~70%（即 10 次里能兜住 7 次）。
    const floorPct = t.km <= 10 ? 0.035 : t.km <= 21.0975 ? 0.05 : 0.075;
    const minSpread = central * floorPct;
    if (hi - lo < minSpread) {
      lo = central - minSpread / 2;
      hi = central + minSpread / 2;
    }
    // 区间上界不该超过「实测配速线性折算」太多：
    // 那个数字是真实跑出来的，任何公式都比它更不确定。
    if (la2 && t.km >= 15) {
      const linear = (la2.sec / la2.km) * t.km;
      if (hi > linear * 1.06) hi = linear * 1.06;
      if (lo < linear * 0.94) lo = linear * 0.94;
    }

    const off = official[t.km] ?? null;

    /**
     * 实测交叉校验：如果真的跑过 ≥ 目标距离，比较预测与实测配速。
     * 预测比实测更乐观 = 预测了一个没达到过的水平，这是最值得警惕的信号。
     */
    const la3 = opts.longestActual;
    let groundTruth: Prediction["groundTruth"] = null;
    // 只在锚点距离与目标接近时对照：42K 配速折算到 5K 差 2 分钟以上是必然的，
    // 那不是「预测偏乐观」，而是两个不同性质的强度，拿来报警只会误导。
    if (la3 && t.km >= 15 && la3.km / t.km <= 2.5) {
      const actualSec = (la3.sec / la3.km) * t.km;
      groundTruth = {
        actualKm: la3.km,
        actualSec: Math.round(la3.sec),
        date: la3.date,
        impliedSec: Math.round(actualSec),
        deltaPct: ((central - actualSec) / actualSec) * 100,
      };
    }

    return {
      distanceKm: t.km,
      name: t.name,
      seconds: Math.round(central),
      paceSec: central / t.km,
      low: Math.round(lo),
      high: Math.round(hi),
      officialSeconds: off,
      deltaVsOfficial: off ? central - off : null,
      models: models.sort((a, b) => b.weight - a.weight),
      groundTruth,
      confidence: assessConfidence(models, hi - lo, t.km, groundTruth),
      confidenceNote: buildConfidenceNote(models, hi - lo, t.km, groundTruth, mileageNote),
    };
  });
}

/** 加权分位数：权重低的模型不该把边界拉走 */
function weightedQuantile(points: { seconds: number; weight: number }[], q: number): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.seconds - b.seconds);
  const total = sorted.reduce((s, p) => s + p.weight, 0) || 1;
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = acc;
    acc += sorted[i].weight;
    if (acc >= target) {
      // 在当前点内部线性插值，避免出现台阶式边界
      const span = sorted[i].weight;
      if (span <= 0) return sorted[i].seconds;
      const frac = (target - prev) / span;
      const next = sorted[i + 1];
      if (next) return sorted[i].seconds + (next.seconds - sorted[i].seconds) * frac;
      return sorted[i].seconds;
    }
  }
  return sorted[sorted.length - 1].seconds;
}

function weightedMedian(models: ModelPrediction[]): number {
  const total = models.reduce((s, m) => s + m.weight, 0) || 1;
  const sorted = [...models].sort((a, b) => a.seconds - b.seconds);
  let acc = 0;
  for (const m of sorted) {
    acc += m.weight;
    if (acc >= total / 2) return m.seconds;
  }
  return sorted[sorted.length - 1].seconds;
}

function assessConfidence(
  all: ModelPrediction[],
  spread: number,
  km: number,
  gt: Prediction["groundTruth"] = null,
): "高" | "中" | "低" {
  if (all.length < 2) return "低";
  const central = weightedMedian(all);
  const relative = spread / (central || 1);

  // 有实测对照时，置信度应该由「预测 vs 实测」决定，而不是模型之间的离散度。
  // 三个模型挤在一起 ≠ 预测是对的。
  if (gt) {
    const err = Math.abs(gt.deltaPct);
    if (err < 3) return "高";
    if (err < 6) return "中";
    return "低";
  }

  if (km <= 10) return relative < 0.05 ? "中" : "低";
  if (km <= 21.0975) return relative < 0.07 ? "中" : "低";
  return "低";
}

function buildConfidenceNote(
  all: ModelPrediction[],
  spread: number,
  km: number,
  gt: Prediction["groundTruth"] = null,
  mileageNote: string | null = null,
): string {
  const central = weightedMedian(all);
  const pct = (spread / (central || 1)) * 100;
  const tierA = all.filter((m) => m.tier === "A").length;
  const parts: string[] = [];

  if (gt) {
    const d = gt.deltaPct;
    parts.push(
      `已用实测 ${gt.actualKm.toFixed(1)}km（${gt.date}，${fmtT(gt.actualSec)}）交叉校验：` +
        `按该配速折算 ${fmtT(gt.impliedSec)}，本模型预测${d < 0 ? "快" : "慢"} ${Math.abs(d).toFixed(1)}%。`,
    );
    if (d < -5) {
      parts.push("⚠ 预测明显优于已实测水平，属于未经验证的乐观估计，建议按实测配速规划。");
    } else if (d > 5) {
      parts.push("预测慢于实测，可能受疲劳/状态影响，实际表现可能好于预测。");
    }
  }

  parts.push(`${all.length} 个模型合成（其中 ${tierA} 个来自 A 级长距离锚点），区间 ±${(pct / 2).toFixed(1)}%。`);
  if (mileageNote) parts.push(`${mileageNote}。`);

  if (km <= 10) {
    parts.push("短距离只能靠阈值锚定反推，因为你训练里的短距离不是全力成绩，实际比赛大概率比这个数字快。");
  } else if (km >= 42.195) {
    parts.push("全马对训练量、天气、补给、赛道极度敏感，这是参考区间不是承诺。");
  } else {
    parts.push("半马以上误差主要来自「训练强度 ≠ 比赛强度」。");
  }
  return parts.join("");
}

// ---------------- 6. 训练区间反推 ----------------

export type TrainingZone = {
  name: string;
  purpose: string;
  paceSec: number;
  hr: number;
  range: string;
  /**
   * CSS 变量名（如 `var(--z3)`），**不要写死 hex**。
   *
   * 写死 hex 会绕过主题系统：styles.css 里的 `--z3` 在浅色主题下是
   * 深橄榄绿 `#55730c`（柠檬绿在白底上不可读），但组件收到写死的
   * `#c6f24e` 仍然会渲染成柠檬绿 —— 浅色主题下「马拉松配速」那一行
   * 就看不清了。传变量名让前端在两套主题下都取到各自可读的颜色。
   */
  color: string;
};

export function trainingZones(threshold: Threshold, prediction: Prediction[]): TrainingZone[] {
  const fm = prediction.find((p) => p.distanceKm === 42.195);
  const mp = fm ? fm.paceSec : threshold.paceSec * 1.1;
  const tp = threshold.paceSec;

  const mk = (name: string, purpose: string, pace: number, color: string): TrainingZone => ({
    name, purpose, paceSec: pace,
    hr: threshold.a ? threshold.a + threshold.b * pace : 0,
    range: `HR ${Math.round((threshold.a + threshold.b * pace) || 0)} 上下`,
    color,
  });

  // 强度由慢到快对应 z1→z5，语义与 styles.css 的分区色一一对应
  return [
    mk("轻松跑", "恢复性跑量，能正常说话", tp * 1.22, "var(--z1)"),
    mk("马拉松配速", "比赛日目标强度", mp, "var(--z3)"),
    mk("半马配速", "MP 跑训练，比 MP 快 5–10 秒", mp * 0.965, "var(--z2)"),
    mk("阈值配速", "乳酸阈值，约 30 分钟比赛强度", tp, "var(--z4)"),
    mk("间歇配速", "5K 比赛强度，仅短间歇", tp * 0.92, "var(--z5)"),
  ];
}

// ---------------- 工具 ----------------

export function daysBetween(a: string, b: string): number {
  const t1 = new Date(a + "T00:00:00Z").getTime();
  const t2 = new Date(b + "T00:00:00Z").getTime();
  return Math.round((t2 - t1) / 86400000);
}

export function fmtT(sec: number): string {
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  if (m === 60) { h += 1; m = 0; }
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtP(sec: number): string {
  // 必须处理进位，否则 299.6s 会输出非法的 "4:60"
  let m = Math.floor(sec / 60);
  let s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
}
