/**
 * 地形与爬升分析。
 *
 * 为什么需要这一层：
 *  典型跑者的训练场只有三类 —— 操场（理论 0 爬升）、马路、跑山。
 *  但直接看 COROS 记录的爬升率，会发现它是**双峰**的：
 *
 *    0–2 m/km    → 操场 / 真平路（约 37 次）
 *    6–14 m/km   → 有起伏的路段（约 70 次）
 *    2–6 m/km    → 几乎空缺（只有 4 次过渡）
 *
 *  两峰之间没有中间地带，所以「平路 vs 起伏」这个二分是可靠的自动分类，
 *  而操场那批数据也干净到可以当基准（每圈爬升都是 0，不是「约等于 0」）。
 *
 *  但要注意两点，否则这个模块会给出错误结论：
 *
 *  1. **修正不是预减一个常数就够了**。爬升率不仅拉慢配速，
 *     还会改变「配速-心率」这条线本身的斜率。实测两种做法差别很大：
 *     直接把 pace - k×rate 喂回归，偏差 -5.1 s/km（σ 2.0）；
 *     把 rate 作为协变量一起拟合，偏差 +9.7 s/km（σ 4.9）。
 *     后者明显更差，所以这里用前者。
 *
 *  2. **rate 方差不足时模型不可辨识**。如果只用平路数据去拟合，
 *     rate 几乎是常数，正规方程病态，会算出 3:00/km 这种废阈值。
 *     所以 fitClimbModel 在方差不足时返回 usable:false，调用方必须降级。
 *
 *  代价系数从**使用者自己的历史分圈**拟合，不套外部经验公式。
 *  所以每个人打开这个项目得到的是他本人的系数，不是通用常数。
 */

export type Terrain = "flat" | "rolling";

/**
 * 平路 / 起伏的分界（m/km）。
 * 3 这个值是站在两峰中间的安全位置：平路峰在 0–2，起伏峰在 6 以上。
 */
export const FLAT_RATE_MAX = 3;

/** rate 的标准差低于这个值，说明样本里几乎没有地形变化，爬升系数不可辨识 */
export const MIN_RATE_SD = 2;

export const TERRAIN_LABEL: Record<Terrain, string> = {
  flat: "平路",
  rolling: "起伏",
};

/** 每公里爬升多少米 */
export function climbRate(
  elevGainM: number | null | undefined,
  distanceKm: number | null | undefined,
): number {
  if (!elevGainM || !distanceKm || distanceKm <= 0) return 0;
  return elevGainM / distanceKm;
}

export function classifyTerrain(rate: number): Terrain {
  return rate < FLAT_RATE_MAX ? "flat" : "rolling";
}

// ---------------- 爬升代价模型 ----------------

export type ClimbSample = {
  /** 该圈的配速（秒/km，原始值，未修正） */
  paceSec: number;
  /** 该圈平均心率 */
  hr: number;
  /** 该圈的爬升率（m/km） */
  rate: number;
};

export type ClimbModel = {
  /** 每 1 m/km 爬升多耗多少秒。实测约 1.0 s/(m/km)，11 m/km ≈ 11 s/km */
  costSecPerRate: number;
  /** 配速 = intercept + hrCoef × 心率 + costSecPerRate × 爬升率 */
  intercept: number;
  hrCoef: number;
  r2: number;
  samples: number;
  /** 爬升率的标准差，用来判断模型是否可辨识 */
  rateSd: number;
  /** false 时必须退回「不修正」，不能采信 costSecPerRate */
  usable: boolean;
};

/**
 * 最小二乘多元回归（正规方程 + 高斯消元）。
 * 只用到 2 个自变量，不值得引入线性代数库。
 */
function olsMulti(
  y: number[],
  X: number[][],
): { coef: number[]; r2: number } | null {
  const n = y.length;
  const k = X[0]?.length ?? 0;
  if (n <= k) return null;

  // 正规方程 A·coef = b
  const A: number[][] = [];
  const b: number[] = [];
  for (let r = 0; r < k; r++) {
    const row: number[] = [];
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i][r] * X[i][c];
      row.push(s);
    }
    A.push(row);
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][r] * y[i];
    b.push(s);
  }

  // 高斯消元（带部分主元选取）
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    }
    if (Math.abs(M[piv][i]) < 1e-10) return null;
    [M[i], M[piv]] = [M[piv], M[i]];

    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= k; c++) M[r][c] -= f * M[i][c];
    }
  }

  const coef = M.map((row, i) => row[k] / row[i]);

  const yBar = y.reduce((s, v) => s + v, 0) / n;
  const ss = y.reduce((s, v) => s + (v - yBar) ** 2, 0);
  let se = 0;
  for (let i = 0; i < n; i++) {
    const pred = coef.reduce((s, c, j) => s + c * X[i][j], 0);
    se += (y[i] - pred) ** 2;
  }
  return { coef, r2: ss > 0 ? 1 - se / ss : 0 };
}

/**
 * 拟合「配速 ~ 心率 + 爬升率」。
 *
 * 返回值里的 usable 是给调用方的硬约束：只有 usable 为 true 时
 * 才可以用 costSecPerRate 做修正，否则爬升系数是从常数里算出来的噪声。
 */
export function fitClimbModel(samples: ClimbSample[]): ClimbModel {
  const clean = samples.filter(
    (s) => s.hr > 60 && s.paceSec > 0 && s.rate >= 0 && Number.isFinite(s.rate),
  );

  const rateSd = clean.length
    ? Math.sqrt(
        clean.reduce((s, x) => s + (x.rate - clean.reduce((a, b) => a + b.rate, 0) / clean.length) ** 2, 0) /
          clean.length,
      )
    : 0;

  if (clean.length < 30 || rateSd < MIN_RATE_SD) {
    return {
      costSecPerRate: 0,
      intercept: 0,
      hrCoef: 0,
      r2: 0,
      samples: clean.length,
      rateSd,
      usable: false,
    };
  }

  const fit = olsMulti(
    clean.map((s) => s.paceSec),
    clean.map((s) => [1, s.hr, s.rate]),
  );
  if (!fit) {
    return {
      costSecPerRate: 0, intercept: 0, hrCoef: 0, r2: 0,
      samples: clean.length, rateSd, usable: false,
    };
  }

  const [intercept, hrCoef, costSecPerRate] = fit.coef;

  // 系数为负是物理上不可能的（爬升只会更慢），出现就说明拟合崩了
  if (!Number.isFinite(costSecPerRate) || costSecPerRate <= 0) {
    return {
      costSecPerRate: 0, intercept, hrCoef, r2: fit.r2,
      samples: clean.length, rateSd, usable: false,
    };
  }

  return {
    costSecPerRate,
    intercept,
    hrCoef,
    r2: fit.r2,
    samples: clean.length,
    rateSd,
    usable: true,
  };
}

/**
 * 平路等效配速（GAP）—— 这一段实际跑了多少秒，折算到平路该是多少秒。
 *
 * 爬升率越高，实跑配速被拉得越慢；扣掉这部分之后，
 * 不同地形的配速才放到同一个坐标系里比较。
 */
export function flatEquivalentPace(
  paceSec: number,
  rate: number,
  model: ClimbModel | null,
): number {
  if (!model || !model.usable) return paceSec;
  return paceSec - model.costSecPerRate * Math.max(0, rate);
}

/** 反过来：给定平路等效配速和爬升率，实际会跑多慢 */
export function actualPaceFor(
  flatPaceSec: number,
  rate: number,
  model: ClimbModel | null,
): number {
  if (!model || !model.usable) return flatPaceSec;
  return flatPaceSec + model.costSecPerRate * Math.max(0, rate);
}

// ---------------- 爬升能力 ----------------

export type HrBand = {
  hrLo: number;
  hrHi: number;
  climbingPaceSec: number | null;
  flatPaceSec: number | null;
  /** 同一心率下爬升比平路慢多少秒/km。正数 = 爬坡是短板 */
  penaltySecPerKm: number | null;
  nClimbing: number;
  nFlat: number;
};

export type ClimbAbility = {
  /** 全局爬升短板：同心率下爬升路段比平路慢多少秒/km */
  penaltySecPerKm: number | null;
  penaltyPct: number | null;
  bands: HrBand[];
  model: ClimbModel;
  note: string;
};

/**
 * 爬升能力：把「爬坡是不是我的短板」单独量化出来。
 *
 * 指标定义是**同心率**下的配速差，不是同配速下的心率差。
 * 原因：人会本能地在爬坡时降速保持心率（实测爬升段心率与
 * 平路段几乎一样，配速却差 0.3 min/km），所以同配速比心率会被
 * 这个自我调节掩盖掉；反过来同心率比配速才反映真实代价。
 *
 * 数值越小 = 爬坡越不吃力。多数人实测在 +15~25 s/km 区间。
 */
export function climbAbility(
  samples: ClimbSample[],
  model: ClimbModel,
  bands: [number, number][] = [[145, 155], [155, 163], [163, 172]],
): ClimbAbility {
  const climbing = samples.filter((s) => s.rate >= 6);
  const flat = samples.filter((s) => s.rate < FLAT_RATE_MAX);

  const bandRows: HrBand[] = bands.map(([lo, hi]) => {
    const c = climbing.filter((s) => s.hr >= lo && s.hr < hi);
    const f = flat.filter((s) => s.hr >= lo && s.hr < hi);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const mc = mean(c.map((s) => s.paceSec));
    const mf = mean(f.map((s) => s.paceSec));
    return {
      hrLo: lo,
      hrHi: hi,
      climbingPaceSec: mc,
      flatPaceSec: mf,
      penaltySecPerKm: mc != null && mf != null ? mc - mf : null,
      nClimbing: c.length,
      nFlat: f.length,
    };
  });

  // 只用样本量足够的分段算全局值
  const usable = bandRows.filter((b) => b.penaltySecPerKm != null && b.nClimbing >= 10 && b.nFlat >= 10);
  const penalty =
    usable.length > 0
      ? usable.reduce((s, b) => s + b.penaltySecPerKm!, 0) / usable.length
      : null;

  const flatMean = (() => {
    const f = flat.filter((s) => s.hr >= 145 && s.hr < 172);
    return f.length ? f.reduce((a, b) => a + b.paceSec, 0) / f.length : null;
  })();

  const note = !model.usable
    ? `爬升率方差不足（σ=${model.rateSd.toFixed(2)} < ${MIN_RATE_SD}），无法拟合爬升代价，已退回不修正`
    : penalty == null
      ? "可配对的爬升/平路样本不足，暂无法评估爬升能力"
      : `同心率下爬升比平路慢 ${penalty.toFixed(0)} s/km${flatMean ? `（约 ${(penalty / flatMean * 100).toFixed(1)}%）` : ""}`;

  return {
    penaltySecPerKm: penalty,
    penaltyPct: penalty != null && flatMean ? (penalty / flatMean) * 100 : null,
    bands: bandRows,
    model,
    note,
  };
}

// ---------------- 展示辅助 ----------------

/** 一句话描述某次训练的地形特征，供 UI / AI prompt 复用 */
export function describeTerrain(input: {
  elevGain: number | null | undefined;
  elevLoss?: number | null | undefined;
  distanceKm: number | null | undefined;
}): string {
  const { elevGain, elevLoss, distanceKm } = input;
  // 注意判空顺序：elevGain === 0 是「这场确实是平的」这个**有效结论**，
  // 不是「没采到数据」。写成 `!elevGain` 会把完全平路的场次
  // 报成「地形未知」，AI 就会去别处找一个地形解释（标准田径场就是这种情形）。
  if (elevGain == null || distanceKm == null || distanceKm <= 0) return "地形未知（无爬升数据）";

  const rate = climbRate(elevGain, distanceKm);
  const terrain = classifyTerrain(rate);
  const loss = elevLoss ? `，下降 ${Math.round(elevLoss)} m` : "";

  if (terrain === "flat") {
    // 0-2 m/km 在实测里就是「手表误差量级」，不用当真
    const note = rate < 1 ? "（手表读数噪声，实质平路）" : "（缓坡）";
    return `平路｜爬升 ${Math.round(elevGain)} m${loss}｜${rate.toFixed(1)} m/km ${note}`;
  }
  return `起伏路段｜爬升 ${Math.round(elevGain)} m${loss}｜${rate.toFixed(1)} m/km`;
}