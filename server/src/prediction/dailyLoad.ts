/**
 * 自算日负荷（Daily Training Load）
 *
 * ── 为什么不直接用 COROS 的 short_load ──────────────────
 * 实测 COROS 的 short_load **没有一天是 0 或 NULL**，取值常年落在几十到一百多。
 * 它是 COROS 自己维护的「带衰减的负荷存量」，不是当日新增负荷：
 * 休息日依然有几十的存量值，而且一次 21K 长距离也只被记成和平常单日
 * 基线相差无几的值。
 *
 * 用它算疲劳指数有三个后果，全部实测过：
 *  1. `shortLoad > 0` 的过滤永远不过滤，「休息日」从第一天起就不存在；
 *  2. 7 天加权平均会把单次长距离摊平，21K 那次跑算出的比值反而低于基线；
 *  3. 「连续高负荷天数」因为阈值 = 基线×1.15（≈110）而恒等于 0。
 * 结果就是三项分量全部塌成 0，整张表给出一个假的高可信度分数。
 *
 * ── 本模块的口径 ────────────────────────────────────────
 * 改用 `activities` 表的原始活动自己算，Edwards TRIMP 连续化：
 *
 *     单次负荷 = 时长(分钟) × (1 + 4 × HRR)
 *     HRR = (avg_hr − 静息心率) / (HRmax − 静息心率)，夹取到 [0, 1]
 *     日负荷 = 当天所有活动负荷之和
 *
 * 选 HRR（心率储备）而不是绝对心率，是为了让公式**跨运动类型通用**：
 * 骑行和跑步的绝对心率分布完全不同，但「占最大心率的比例」是可比的。
 * 库里目前只有两种运动类型（Outdoor Run / Track Run，都是跑步），
 * 但公式本身不需要按 sport_type 分支，将来接入骑行/游泳不用改。
 *
 * ── 标定依据 ────────────────────────────────────────────
 * HRmax 取 190：库里观测到的最高「平均心率」明显低于真实最大心率
 * （短距离冲刺的均值通常只到 170 上下，而最大心率必然高于平均心率），
 * 所以 190 是个保守估计。这个值只影响所有负荷的
 * 绝对刻度，而分量①③用的是**相对基线的比值**，所以对最终分数不敏感。
 * 日负荷的典型量级是几十到三百多（单次长距离可到 350 上下）。
 */

export type DailyLoadInput = {
  date: string;
  sportType?: number | null;
  durationSec: number | null;
  avgHr: number | null;
  distanceKm?: number | null;
  isDuplicate?: number | null;
};

export type DailyLoad = {
  /** 归一化后的日期 YYYY-MM-DD */
  date: string;
  /** 自算日负荷；当天无活动记 0 */
  load: number;
  /** 当天活动数 */
  activities: number;
  /** 当天总距离（米），无距离记录时为 null */
  distanceM: number | null;
  /** 当天时长相加（秒） */
  durationSec: number;
  /** 当天出现过的 sport_type，用于区分「真的在练」和「表没戴」 */
  sportTypes: number[];
};

const DEFAULT_HRMAX = 190;
/** 静息心率缺失时的回退值；真实值由调用方传入 */
const FALLBACK_REST = 66;

/** COROS 的 activities.date 有 `20260101` 和 `2026-01-01` 两种写法，统一掉 */
export function normalizeDate(d: string): string {
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

/**
 * 把活动列表折叠成按日负荷。**日历上每一天都会出现**，没有活动的日子 load=0 ——
 * 这一点是刻意的：旧实现靠 `shortLoad > 0` 过滤，结果一条都滤不掉，
 * 「休息日」这个概念在数据里根本不存在。
 */
export function computeDailyLoads(
  acts: DailyLoadInput[],
  opts?: { hrmax?: number; restHr?: number },
): DailyLoad[] {
  const hrmax = opts?.hrmax ?? DEFAULT_HRMAX;
  const restHr = opts?.restHr ?? FALLBACK_REST;
  const span = Math.max(hrmax - restHr, 1);

  const byDay = new Map<string, DailyLoad>();
  const touch = (date: string): DailyLoad => {
    let row = byDay.get(date);
    if (!row) {
      row = { date, load: 0, activities: 0, distanceM: null, durationSec: 0, sportTypes: [] };
      byDay.set(date, row);
    }
    return row;
  };

  for (const a of acts) {
    if (a.isDuplicate === 1) continue; // 排除归档的对比样本，防止日负荷和疲劳指数翻倍
    const row = touch(normalizeDate(a.date));
    const sec = a.durationSec ?? 0;
    if (sec <= 0) continue;

    row.activities += 1;
    row.durationSec += sec;
    if (a.distanceKm != null && a.distanceKm > 0) {
      row.distanceM = (row.distanceM ?? 0) + a.distanceKm * 1000;
    }
    if (a.sportType != null && !row.sportTypes.includes(a.sportType)) {
      row.sportTypes.push(a.sportType);
    }

    // 心率缺失的活动仍计入时长，但强度按中性处理（HRR=0.5），
    // 而不是整条丢弃 —— 否则忘戴表的一次 90min 长跑会凭空消失。
    const hr = a.avgHr != null && a.avgHr > 0 ? a.avgHr : null;
    const hrr = hr == null ? 0.5 : Math.min(Math.max((hr - restHr) / span, 0), 1);
    row.load += (sec / 60) * (1 + 4 * hrr);
  }

  // 补齐日历空洞：填进 from..to 之间所有缺失的日子
  const dates = [...byDay.keys()].sort();
  if (dates.length) {
    const first = new Date(`${dates[0]}T00:00:00Z`).getTime();
    const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
    for (let t = first; t <= last; t += 86400000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (!byDay.has(iso)) touch(iso);
    }
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 数据的「区分度」体检。
 * 光看行数会得出假的高可信度 —— 40 天静息心率里只有 66 和 76 两个值，
 * 行数充足但完全没有信息量。
 */
export type SignalQuality = {
  /** 可用天数 */
  days: number;
  /** 不同取值个数 */
  distinct: number;
  /** 变异系数（标准差/均值），恒定序列为 0 */
  cv: number;
  /** 是否有真实区分度：至少 3 个不同取值且 cv ≥ 3% */
  usable: boolean;
  note: string;
};

export function assessSignal(values: (number | null)[], opts?: { minDays?: number; label?: string }): SignalQuality {
  const label = opts?.label ?? "信号";
  const minDays = opts?.minDays ?? 14;
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  const days = xs.length;

  if (days < minDays) {
    return {
      days,
      distinct: 0,
      cv: 0,
      usable: false,
      note: `${label}只有 ${days} 天可用（需 ≥${minDays} 天）`,
    };
  }

  const distinct = new Set(xs).size;
  const mean = xs.reduce((a, b) => a + b, 0) / days;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / days);
  const cv = mean > 0 ? sd / mean : 0;
  const usable = distinct >= 3 && cv >= 0.03;

  return {
    days,
    distinct,
    cv,
    usable,
    note: usable
      ? ""
      : distinct < 3
        ? `${label} ${days} 天里只有 ${distinct} 个不同取值，传感器基本没在记录`
        : `${label} ${days} 天波动仅 ${(cv * 100).toFixed(1)}%，不足以反映恢复差异`,
  };
}