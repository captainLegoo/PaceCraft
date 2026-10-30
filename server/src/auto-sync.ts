/**
 * 自动海拔抓取 + 后台跟随同步。
 *
 * 为什么需要「跟随」而不是「点一下就完事」：
 *  实测下来，跑完到 COROS 侧可查到之间有延迟 ——
 *  曾观察到晚场训练跑完约 4 小时后才出现在 MCP 里。
 *  所以「刚跑完点同步」大概率拉不到东西，反而让人以为按钮坏了。
 *
 * 正确的做法是：点一次按钮开启跟随，服务端在后台定期探测，
 *  一旦发现有新活动就自动同步 + 自动拉 FIT 海拔，
 *  前端再通过轮询感知到变化并刷新。
 *
 * FIT 额度很紧（50 个/24 小时），所以：
 *  - 只给「新增的活动」拉 FIT，不重复拉已有的
 *  - 跟随状态下拉 FIT 有节流，不会把额度一天烧光
 */
import { callTool } from "./coros/mcp.ts";
import { loadSportTypeCodes } from "./sports/types.ts";
import { FIT_DAILY_LIMIT } from "./config.ts";
import { db, sqlite } from "./db/client.ts";
import { activities } from "./db/schema.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { parseAltitudeFromFit } from "./fit-parser.ts";
import {
  appendAltitudeRecords,
  classifyAltitude,
  haveAltitudeFit,
  semicircleToDegrees,
  ALTITUDE_BAND_LABEL,
  FIT_DIR,
  type AltitudeRecord,
} from "./altitude.ts";

export type FollowState = {
  active: boolean;
  startedAt: number;
  /** 跟随期间新增的活动数 */
  found: number;
  lastCheckAt: number | null;
  lastCheckMessage: string | null;
  /** 跟随期间为新活动消耗的 FIT 额度 */
  fitUsed: number;
};

const state: FollowState = {
  active: false,
  startedAt: 0,
  found: 0,
  lastCheckAt: null,
  lastCheckMessage: null,
  fitUsed: 0,
};

let timer: ReturnType<typeof setInterval> | null = null;
let checkRunning = false;
/** 本进程内已消耗 FIT 的 labelId，防止同一次同步里重复下载 */
let doneFit = new Set<string>();

/** 探测间隔：3 分钟。不用更密 —— COROS 的上传延迟是小时级的。 */
const POLL_MS = 3 * 60 * 1000;

// ---------------- FIT 解码（采用纯 JS/TS fit-parser，彻底解耦 Python） ----------------

/**
 * 给指定活动拉 FIT 并提取海拔。
 * 已拉过的不重复拉 —— 这是额度保护的关键。
 */
export async function fetchAltitudeFor(labelId: string, sportType: number): Promise<AltitudeRecord | null> {
  if (doneFit.has(labelId)) return null;
  // 用 fitQuotaStatus 而不是裸计数，避免重启后误判额度
  if (fitQuotaStatus().exhausted) return null;

  try {
    const txt = await callTool("queryActivityFitFileDownloadUrls", { labelId, sportType });
    const url = txt.match(/https?:\/\/[^\s]+\.fit/)?.[0];
    if (!url) return null;

    mkdirSync(FIT_DIR, { recursive: true });
    const path = `${FIT_DIR}/${labelId}.fit`;
    execFileSync("curl", ["-s", "--max-time", "15", "-o", path, url], { timeout: 16000 });
    recordFitDownload();

    const s = await parseAltitudeFromFit(path);
    if (!s || !s.samples) return null;

    const band = classifyAltitude(s.altAvg);
    return {
      labelId,
      dateLabel: "",
      samples: s.samples,
      altMin: s.altMin,
      altMax: s.altMax,
      altAvg: s.altAvg,
      gainFromFit: s.gainFromFit,
      lat: semicircleToDegrees(s.latSemicircle),
      lon: semicircleToDegrees(s.lonSemicircle),
      band,
      bandLabel: ALTITUDE_BAND_LABEL[band],
    };
  } catch (e) {
    // 额度用尽时 COROS 会返回 isError。这里必须说清楚原因，
    // 否则前端只能显示"没拉到"，用户会以为功能坏了。
    const msg = (e as Error).message ?? "";
    if (/isError/i.test(msg)) {
      fitQuotaHit = true;
    }
    return null;
  }
}

/** 本次运行中 FIT 额度是否已被服务端拒绝 */
let fitQuotaHit = false;

/**
 * 本地日历日（YYYY-MM-DD）。
 *
 * 必须用本地时区拼，不能用 toISOString()：那是 UTC 日期，
 * 东八区凌晨 0–8 点会拿到「昨天」，导致跨天不重置。
 */
function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 记一次 FIT 下载（落库，跨重启不丢；跨天自然归零） */
function recordFitDownload() {
  const day = localDay();
  sqlite
    .query(
      `INSERT INTO fit_quota (day, used) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET used = used + 1`,
    )
    .run(day);
  state.fitUsed++;
}

/**
 * 额度状态。
 *
 * ⚠️ 这里曾经写错过，把「缓存里的 FIT 文件数」和「今天的下载次数」混在一起算：
 *
 *     const used = Math.max(state.fitUsed, onDisk);
 *
 * `onDisk` 是**累计**缓存量（`/tmp/coros-fit/*.fit`），
 * `FIT_DAILY_LIMIT` 是**每天** 50 次的请求配额 —— 两者量纲根本不同。
 * 后果是：一旦缓存里攒够 50 个 FIT，`used` 就永远 ≥ 50，
 * `exhausted` 恒为 true，海拔回填被永久锁死（界面上还显示「今日额度已用完」，
 * 看起来像 COROS 限流，实际是自己算错了）。
 *
 * 正确口径：
 *   · `used`     = **今天**实际发起的下载次数（存 fit_quota 表，跨重启不丢、跨天归零）
 *   · `exhausted`= 服务端已明确拒绝过（fitQuotaHit）或今天已用满 50 次
 *   · `cached`   = 累计缓存量，只作展示，不能参与额度判断
 */
export function fitQuotaStatus(): {
  used: number;
  limit: number;
  exhausted: boolean;
  cached: number;
  note: string;
} {
  let cached = 0;
  try {
    cached = readdirSync(FIT_DIR).filter((f) => f.endsWith(".fit")).length;
  } catch {
    cached = 0;
  }
  const row = sqlite
    .query("SELECT used FROM fit_quota WHERE day = ?")
    .get(localDay()) as { used: number } | undefined;
  const used = row?.used ?? 0;
  const exhausted = fitQuotaHit || used >= FIT_DAILY_LIMIT;
  return {
    used,
    limit: FIT_DAILY_LIMIT,
    cached,
    exhausted,
    note: exhausted
      ? "今日 FIT 额度已用完，海拔数据明天再补"
      : `今日还能拉 ${FIT_DAILY_LIMIT - used} 个`,
  };
}

/** 为尚未记录海拔的活动补拉 FIT */
export async function backfillAltitude(
  maxCount = 3,
): Promise<{ added: number; skipped: number; quotaExhausted: boolean }> {
  // 每次都重新读盘，保证重启进程后额度统计依然准确
  doneFit = haveAltitudeFit(db.select({ labelId: activities.labelId }).from(activities).all().map((a) => a.labelId));
  const candidates = db
    .select({ labelId: activities.labelId, sportType: activities.sportType, dateLabel: activities.dateLabel })
    .from(activities)
    .orderBy(activities.dateLabel)
    .all()
    .filter((a) => (a.sportType ?? 0) === 100 || (a.sportType ?? 0) === 103)
    .filter((a) => !doneFit.has(a.labelId))
    .slice(-maxCount);

  if (candidates.length === 0) return { added: 0, skipped: 0, quotaExhausted: false };

  const records: AltitudeRecord[] = [];
  for (const a of candidates) {
    // 用统一口径判断，不能看进程内计数 —— 重启后 state.fitUsed 会归零，
    // 那样今天明明还能拉，循环却直接退出了。
    if (fitQuotaStatus().exhausted) break;
    const rec = await fetchAltitudeFor(a.labelId, a.sportType);
    if (rec) {
      rec.dateLabel = a.dateLabel ?? "";
      records.push(rec);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const added = appendAltitudeRecords(records);
  return {
    added,
    skipped: candidates.length - records.length,
    quotaExhausted: fitQuotaStatus().exhausted,
  };
}

// ---------------- 后台跟随 ----------------

export function followState(): FollowState {
  return { ...state, lastCheckMessage: state.lastCheckMessage };
}

export function startFollow(): FollowState {
  if (state.active) return followState();
  state.active = true;
  state.startedAt = Date.now();
  state.found = 0;
  state.fitUsed = 0;
  state.lastCheckAt = null;
  state.lastCheckMessage = "已开启跟随，正在检查…";

  void runCheck();
  timer = setInterval(() => void runCheck(), POLL_MS);
  return followState();
}

export function stopFollow(): FollowState {
  state.active = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  state.lastCheckMessage = "已停止跟随";
  return followState();
}

/**
 * 一轮探测：看有没有新活动。
 *
 * 这里刻意**不直接跑 syncAll** —— 那个函数会写 sync_log、拉训练负荷/睡眠等
 * 一大堆数据，而且 120 天窗口很慢。跟随只需要知道"有没有新的跑步记录"，
 * 轻量得多；真正需要完整数据时用户再点一次同步按钮。
 */
async function runCheck(): Promise<void> {
  if (checkRunning || !state.active) return;
  checkRunning = true;
  try {
    state.lastCheckAt = Date.now();

    const today = new Date().toISOString().slice(0, 10);
    // 看最近 2 天（跨时区保险）：如果本地已有今天的记录就静默，否则报告
    const known = new Set(
      db.select({ dateLabel: activities.dateLabel }).from(activities).all().map((a) => a.dateLabel ?? ""),
    );

    // 轻量探测：只查今天的记录，不写入
    let todayCount = 0;
    try {
      const raw = await callTool("querySportRecords", {
        startDate: today.replace(/-/g, ""),
        endDate: today.replace(/-/g, ""),
        // 用用户在设置页勾选的白名单，而不是写死的跑步类型：
        // 否则只练力量/有氧的日子会被判成「今天没有训练」，提醒就漏了。
        sportTypeCodes: loadSportTypeCodes(),
        minDistanceKm: null,
        maxDistanceKm: null,
        minDurationMinutes: null,
        maxDurationMinutes: null,
        maxAveragePace: null,
        locationKeyword: null,
        limit: 50,
      });
      todayCount = (raw.match(/(\d+)\s+records/)?.[1] ?? "0") as unknown as number;
    } catch {
      state.lastCheckMessage = "探测失败，将自动重试";
      return;
    }

    const numToday = Number(todayCount) || 0;
    const haveToday = known.has(today);

    if (numToday > 0 && !haveToday) {
      state.lastCheckMessage = `⚠ 服务端已有今天 ${numToday} 次训练，本地还没有 —— 点「立即同步」拉进来`;
    } else if (numToday > 0 && haveToday) {
      state.lastCheckMessage = `今天的数据已就位（${numToday} 次）`;
    } else {
      state.lastCheckMessage = "今天还没有训练记录（手表可能还没上传）";
    }
  } finally {
    checkRunning = false;
  }
}