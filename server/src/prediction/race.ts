import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { races, users } from "../db/schema.ts";
import { buildSessions, sessionLaps, fmtDistLabel, round } from "../analytics.ts";
import { buildReport } from "./pipeline.ts";
import { marathonPrep } from "./prep.ts";
import { fmtP, fmtT } from "./engine.ts";
import { altitudeAdjustPace } from "../altitude.ts";
import { densifyWaypoints, KNOWN_RACES } from "../race-routes.ts";
import { buildRouteProfile, climbPaceCost } from "../route-profile.ts";
import { existsSync, readFileSync } from "node:fs";

/**
 * 比赛日分析。
 *
 * 同一个入口，按比赛日期自动切两种模式：
 *  - 日期已过 → 赛后复盘（往后看：执行得怎么样、哪里丢了时间）
 *  - 日期在未来 → 赛前方案（往前看：怎么跑、哪几公里要小心）
 *
 * 核心不是"再算一遍预测"，而是把这场和**他自己的历史模式**对照：
 * 同样的后程掉速是不是他的老毛病、这次是变好了还是变差了。
 */

export type RaceMode = "result" | "plan";

export type SplitRow = {
  km: number;
  cumulativeSec: number;
  lapSec: number;
  paceSec: number;
  hr: number;
  maxHr: number;
  cadence: number;
  /** 相对目标配速的偏差（秒，正=慢）*/
  vsGoalSec: number;
};

export type RaceAnalysis = {
  mode: RaceMode;
  date: string;
  daysAway: number;
  goalSec: number | null;
  goalPaceSec: number | null;
  profile: { age: number | null; weightKg: number | null; heightCm: number | null };

  // ---- 赛后 ----
  found: boolean;
  actual: { seconds: number; distanceKm: number; paceSec: number; avgHr: number } | null;
  predicted: { seconds: number; paceSec: number } | null;
  deltaVsGoalSec: number | null;
  deltaVsPredictedSec: number | null;
  halves: {
    first: { paceSec: number; hr: number; km: number } | null;
    second: { paceSec: number; hr: number; km: number } | null;
    /** 配速变化：正=变慢 */
    paceDriftSec: number | null;
    /** 心率变化：正=心跳加速 */
    hrDrift: number | null;
  };
  quarters: { paceSec: number; hr: number; km: number }[];
  splits: SplitRow[];
  verdict: string;
  verdictReason: string;
  /**
   * 赛后主观体感备注（累不累、抽筋、哪里不舒服）。
   * COROS 没有这类数据，只有本人知道，而它常常是解释客观数据的关键 ——
   * 配速掉了到底是疲劳、上坡，还是抽筋。
   */
  notes?: string | null;

  // ---- 赛前 ----
  prep: ReturnType<typeof marathonPrep> | null;
  /** 他自己的历史掉速规律 */
  fadePattern: { typicalFadeKm: number | null; sampleRuns: number; note: string } | null;
};

// 注意：sessionLaps 的字段是 avgPaceSec / avgHr，不是 paceSec
function avgOf(
  xs: { avgPaceSec: number; avgHr: number; distanceM: number }[],
  k: "avgPaceSec" | "avgHr",
) {
  const full = xs.filter((x) => x.distanceM >= 900);
  const list = full.length >= 4 ? full : xs;
  if (list.length === 0) return null;
  return list.reduce((s, x) => s + (x[k] || 0), 0) / list.length;
}

function parseGoal(input: string | number | null | undefined): number | null {
  if (input == null || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? Math.round(input) : null;
  const m = String(input).trim().match(/^(?:(\d+)[:：](\d{1,2}))?(?:[:：](\d{1,2}))?$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x != null).map(Number);
  if (parts.length === 0 || parts.some((p) => Number.isNaN(p))) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}


/**
 * 读取某场比赛的路线画像（由 `bun run src/cli/race-route.ts` 预先算好）。
 *
 * 为什么不实时算：DEM 查询要走外部 API，几十个点要十几秒，
 *  比赛页每次打开都等不起。所以是 CLI 预热 + 页面只读缓存。
 */
export function getRouteProfile(date: string) {
  const key = Object.keys(KNOWN_RACES).find((k) => KNOWN_RACES[k].date === date);
  if (!key) return null;
  const race = KNOWN_RACES[key];

  const cachePath = `/tmp/coros-race-routes/${key}.json`;
  if (!existsSync(cachePath)) {
    return { key, race, profile: null, reason: "尚未分析该路线，请先运行 bun run src/cli/race-route.ts" };
  }
  const altitudes = JSON.parse(readFileSync(cachePath, "utf8")) as number[];
  // 用 race-routes 里的插值逻辑重建点，保证与 CLI 完全一致
  const pts = densifyWaypoints(race);
  if (altitudes.length !== pts.length) {
    return {
      key,
      race,
      profile: null,
      reason: "缓存的 DEM 数据与当前路点不匹配，请重新运行 race-route",
    };
  }

  const profile = buildRouteProfile(race.name, pts, altitudes, race.distanceKm);
  return { key, race, profile, reason: null };
}

/** 把路线画像转成给 AI 用的文字说明 */
export function describeRoute(date: string): string | null {
  const r = getRouteProfile(date);
  if (!r) return null;
  if (!r.profile) return `【赛事路线】${r.race.name}（${r.reason}）`;
  const p = r.profile;
  const altNote =
    r.race.altitude >= 200
      ? `城市海拔 ${r.race.altitude} m，高原惩罚约 ${Math.abs(altitudeAdjustPace(0, r.race.altitude)).toFixed(1)} s/km。`
      : `城市海拔仅 ${r.race.altitude} m，海拔影响可忽略。`;
  return [
    `【赛事路线画像】${p.name}`,
    `- 距离 ${p.totalDistanceKm} km｜估算爬升 ${p.gainM} m（${p.gainPerKm} m/km）｜下降 ${p.lossM} m`,
    `- 高程范围 ${p.altMin}–${p.altMax} m｜起点到终点净变化 ${p.netChange >= 0 ? "+" : ""}${p.netChange} m`,
    `- ${altNote}`,
    `- 赛道判断：${p.verdict}`,
    p.gainPerKm >= 3
      ? `- 地形代价：按实测爬升代价折算，全程地形约让配速慢了 ${climbPaceCost(p.gainPerKm)} s/km，配速判断时必须考虑这一点。`
      : `- 地形代价：约 ${climbPaceCost(p.gainPerKm)} s/km，可忽略，配速可直接按平路标准执行。`,
    `- 注意：${p.caveat}`,
  ].join("\n");
}

export function analyzeRace(opts: { date: string; goal?: string | number | null }): RaceAnalysis {
  const date = opts.date;
  const goalSec = parseGoal(opts.goal);
  const today = new Date().toISOString().slice(0, 10);
  const daysAway = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000,
  );
  const mode: RaceMode = daysAway > 0 ? "plan" : "result";

  const profile = db.select().from(users).all()[0] ?? null;
  const age = profile?.birthday
    ? Math.floor((Date.now() - new Date(profile.birthday).getTime()) / (365.25 * 86400000))
    : null;

  // 主观体感备注：赛后才写得出来，是解释客观数据的关键线索
  const raceRow = db.select().from(races).where(eq(races.date, date)).get();
  const notes = raceRow?.notes?.trim() || null;

  // 自建预测始终带上（赛后用来对照，赛前用来定目标）
  let predicted: RaceAnalysis["predicted"] = null;
  try {
    const rep = buildReport();
    const byKm: Record<number, number> = {};
    for (const p of rep.predictions) byKm[p.distanceKm] = p.seconds;
    // 选最接近这场实际距离的预测档
    const sessions = buildSessions();
    const target = sessions.find((s) => s.date === date);
    const dist = target?.totals.distanceKm ?? 42.195;
    const nearest = [5, 10, 15, 21.0975, 42.195].reduce((a, b) =>
      Math.abs(b - dist) < Math.abs(a - dist) ? b : a,
    );
    if (byKm[nearest]) predicted = { seconds: byKm[nearest], paceSec: byKm[nearest] / dist };
  } catch {
    // 预测失败不该阻断比赛日分析
  }

  // ================= 赛后复盘 =================
  const session = buildSessions().find((s) => s.date === date);
  const laps = session ? sessionLaps(session.labelIds) : [];
  const fullLaps = laps.filter((l) => l.distanceM >= 900);

  if (mode === "result" && !session) {
    return emptyResult({
      date, daysAway, goalSec, predicted, age,
      profile: { age, weightKg: profile?.weightKg ?? null, heightCm: profile?.heightCm ?? null },
      notes,
    });
  }

  if (mode === "result" && session) {
    const half = Math.floor(fullLaps.length / 2);
    const first = fullLaps.slice(0, half);
    const second = fullLaps.slice(half);
    const q = Math.max(1, Math.floor(fullLaps.length / 4));
    const quarters = [0, 1, 2, 3].map((i) => {
      const seg = fullLaps.slice(i * q, i === 3 ? undefined : (i + 1) * q);
      return {
        paceSec: Math.round(avgOf(seg, "avgPaceSec") ?? 0),
        hr: Math.round(avgOf(seg, "avgHr") ?? 0),
        km: round(seg.reduce((s, x) => s + x.distanceM / 1000, 0), 1),
      };
    });

    const fPace = avgOf(first, "avgPaceSec") ?? 0;
    const sPace = avgOf(second, "avgPaceSec") ?? 0;
    const fHr = avgOf(first, "avgHr") ?? 0;
    const sHr = avgOf(second, "avgHr") ?? 0;
    const paceDriftSec = sPace - fPace;
    const hrDrift = sHr - fHr;

    const actualSec = session.totals.durationSec;
    const goalPaceSec = goalSec ? goalSec / session.totals.distanceKm : null;

    const splits: SplitRow[] = fullLaps.map((l, i) => ({
      km: i + 1,
      cumulativeSec: l.elapsedSec,
      lapSec: Math.round(l.timeSec),
      paceSec: Math.round(l.avgPaceSec),
      hr: l.avgHr,
      maxHr: l.maxHr,
      cadence: l.avgCadence,
      vsGoalSec: goalPaceSec ? Math.round(l.avgPaceSec - goalPaceSec) : 0,
    }));

    const { verdict, reason } = judge(paceDriftSec, hrDrift, fullLaps.length);

    return {
      mode, date, daysAway, goalSec, goalPaceSec,
      profile: { age, weightKg: profile?.weightKg ?? null, heightCm: profile?.heightCm ?? null },
      found: true,
      actual: {
        seconds: actualSec,
        distanceKm: session.totals.distanceKm,
        paceSec: actualSec / session.totals.distanceKm,
        avgHr: Math.round(session.totals.avgHr ?? 0),
      },
      predicted,
      deltaVsGoalSec: goalSec ? actualSec - goalSec : null,
      deltaVsPredictedSec: predicted ? actualSec - predicted.seconds : null,
      halves: {
        first: { paceSec: Math.round(fPace), hr: Math.round(fHr), km: quarterKm(first) },
        second: { paceSec: Math.round(sPace), hr: Math.round(sHr), km: quarterKm(second) },
        paceDriftSec: Math.round(paceDriftSec),
        hrDrift: Math.round(hrDrift),
      },
      quarters,
      splits,
      verdict, verdictReason: reason,
      prep: null,
      fadePattern: detectFadePattern(),
      notes,
    };
  }

  // ================= 赛前方案 =================
  const dist = 42.195;
  const targetSec = goalSec ?? predicted?.seconds ?? null;
  return {
    mode, date, daysAway, goalSec: targetSec,
    goalPaceSec: targetSec ? targetSec / dist : null,
    profile: { age, weightKg: profile?.weightKg ?? null, heightCm: profile?.heightCm ?? null },
    found: false,
    actual: null, predicted,
    deltaVsGoalSec: null, deltaVsPredictedSec: null,
    halves: { first: null, second: null, paceDriftSec: null, hrDrift: null },
    quarters: [], splits: [],
    verdict: "", verdictReason: "",
    prep: marathonPrep({ weeks: daysAway > 90 ? 12 : 8, raceDate: date }),
    fadePattern: detectFadePattern(),
    notes,
  };
}

function quarterKm(laps: { distanceM: number }[]) {
  return round(laps.reduce((s, x) => s + x.distanceM / 1000, 0), 1);
}

function emptyResult(a: {
  date: string; daysAway: number; goalSec: number | null; predicted: RaceAnalysis["predicted"]; age: number | null;
  profile: { age: number | null; weightKg: number | null; heightCm: number | null };
  notes?: string | null;
}): RaceAnalysis {
  return {
    mode: "result", date: a.date, daysAway: a.daysAway, goalSec: a.goalSec, goalPaceSec: null,
    profile: a.profile, found: false, actual: null, predicted: a.predicted,
    deltaVsGoalSec: null, deltaVsPredictedSec: null,
    halves: { first: null, second: null, paceDriftSec: null, hrDrift: null },
    quarters: [], splits: [], verdict: "", verdictReason: "",
    prep: null, fadePattern: null, notes: a.notes ?? null,
  };
}

/** 判定执行质量：配速与心率谁在动，才知道是「跑崩了」还是「配速本来就该那么慢」 */
function judge(paceDrift: number, hrDrift: number, n: number): { verdict: string; reason: string } {
  if (n < 4) return { verdict: "样本不足", reason: "有效分段太少，无法判断配速策略" };
  if (paceDrift > 12 && hrDrift > 5)
    return { verdict: "后程掉速（疲劳型）", reason: `后半配速慢了 ${Math.round(paceDrift)} 秒/km，同时心率上升 ${Math.round(hrDrift)} bpm —— 典型的体能撑不住，通常是前段配速偏快或补给不足` };
  if (paceDrift > 12 && hrDrift <= 5)
    return { verdict: "后程掉速（配速型）", reason: `后半配速慢了 ${Math.round(paceDrift)} 秒/km，但心率基本没变（${hrDrift >= 0 ? "+" : ""}${Math.round(hrDrift)} bpm）—— 说明是主动降速而不是体能崩溃，属于可控的保守策略` };
  if (paceDrift < -8)
    return { verdict: "负分段（激进型）", reason: `后半配速比前半快了 ${Math.abs(Math.round(paceDrift))} 秒/km —— 后程加速很危险，容易在最后 5km 崩掉` };
  if (Math.abs(paceDrift) <= 8)
    return { verdict: "匀速完成", reason: `前后半配速差 ${Math.round(paceDrift)} 秒/km，控制得很稳，心率漂移 ${Math.round(hrDrift)} bpm` };
  return { verdict: "轻微掉速", reason: `后半配速慢了 ${Math.round(paceDrift)} 秒/km，属于正常范围` };
}

/**
 * 从他所有长距离训练里找「习惯性掉速点」：
 * 第一次出现「连续 3 段比前 5 段均值慢 3% 以上」的位置。
 * 这是赛前方案里最有价值的一条——知道自己在第几公里会开始掉。
 */
export function detectFadePattern() {
  const longRuns = buildSessions()
    .filter((s) => s.totals.distanceKm >= 15)
    .slice(0, 12);
  if (longRuns.length < 2) return null;

  const fadePoints: number[] = [];
  for (const s of longRuns) {
    const laps = sessionLaps(s.labelIds).filter((l) => l.distanceM >= 900);
    if (laps.length < 8) continue;
    const base = laps.slice(0, Math.min(5, Math.floor(laps.length / 3))).reduce((a, l) => a + l.avgPaceSec, 0) /
      Math.min(5, Math.floor(laps.length / 3));
    let found: number | null = null;
    for (let i = 5; i < laps.length; i++) {
      const seg = laps.slice(i, i + 3);
      if (seg.length < 3) break;
      const m = seg.reduce((a, l) => a + l.avgPaceSec, 0) / 3;
      if (m > base * 1.03) { found = i + 1; break; }
    }
    if (found != null) fadePoints.push(found);
  }

  if (fadePoints.length === 0) {
    return { typicalFadeKm: null, sampleRuns: longRuns.length, note: "历史长距离里没有找到明显的习惯性掉速点" };
  }
  fadePoints.sort((a, b) => a - b);
  const median = fadePoints[fadePoints.length >> 1];
  return {
    typicalFadeKm: median,
    sampleRuns: longRuns.length,
    note: `${longRuns.length} 次长距离里有 ${fadePoints.length} 次出现后程掉速，中位点在第 ${median} 公里（范围 ${fadePoints[0]}–${fadePoints[fadePoints.length - 1]} 公里）`,
  };
}

// ---------------- prompt ----------------

const RESULT_PROMPT = `你是一位资深马拉松教练。用户刚跑完一场比赛，下面是**真实分段数据**和对照分析。

你的任务：
1. **先说结论**：这场跑得怎么样？目标达成了吗？
2. **诊断执行**：把配速曲线和心率曲线放在一起看，判断掉速/加速是体能问题、策略问题还是执行问题。
   注意：如果配速变慢而心率没怎么变，那是主动降速（可控）；如果配速变慢且心率上升，那是体能撑不住（不可控）。
3. **对照他的历史**：他的长期训练数据里是否有同样的掉速规律？这次是变好了还是变差了？
4. **下次怎么办**：给出具体可执行的调整（目标配速、什么时候主动减速、什么时候该冲）。

要求：
- 引用具体数字（第几公里、慢了多少秒、心率差多少），不要泛泛而谈。
- 不要只报成绩，要解释「时间丢在哪里」。
- 如果数据不足以支撑某个判断，直接说明缺什么。
- 用 Markdown，600 字以内，最后给「下次比赛要改的 3 件事」。

主观体感备注（重要）：
- 数据里可能有「跑者的主观体感」一段，是本人手记：累不累、哪里抽筋、哪里不舒服、哪里状态好。
  这些是**只有他自己知道的信息**，客观数据里完全没有，价值很高。
- 解读掉速/异常时**优先用它**：配速掉了到底是体能、上坡、还是抽筋？
  把主观描述对应到具体公里数上，别泛泛地说「可能是疲劳」。
- 如果备注描述的不适（抽筋、胸闷、头晕、掉速）与分段数据能对上，要明确指出两者对应关系。
- 但也要**保持独立**：主观感受是重要线索，不是定论。如果备注说「很累」而数据全程心率平稳配速稳定，
  要如实指出两者不一致，而不是强行把数据解释成很累。`;

const PLAN_PROMPT = `你是一位资深马拉松教练。用户即将参加一场马拉松比赛，下面是**他最近的真实训练数据**和**自建成绩预测**。

你的任务：
1. **给一个明确的目标配速建议**，并说明依据。
2. **拆解配速计划**：按 5km 或 10km 分段给出目标配速，让用户能照着跑。
3. **指出他的个人风险点**：根据他的训练数据（尤其是掉速规律、负荷波动、后程心率表现），
   明确说出他最可能在第几公里出问题、该在那里做什么。
4. **赛前最后 N 天的安排**：按他实际剩余天数给建议（已经 ≤7 天就必须是减量方案）。
5. **比赛日策略**：什么时候跟别人、什么时候保守、补给和饮水怎么安排（通用但要具体）。

要求：
- 引用具体数字，不要空话。
- 不要建议他超出当前能力的目标；如果目标配速明显快于他的训练水平，要直接说。
- 用 Markdown，700 字以内，最后给「本周训练清单」和「比赛日 checklist」。`;

export function buildRacePrompt(a: RaceAnalysis): string {
  const p: string[] = [];
  p.push(`## 运动员`);
  p.push(`- ${a.profile.age ?? "—"} 岁｜${a.profile.heightCm ?? "—"} cm｜${a.profile.weightKg ?? "—"} kg`);
  p.push(`- 比赛日期：${a.date}（${a.daysAway > 0 ? `还有 ${a.daysAway} 天` : "已结束"}）`);
  p.push(`- 目标成绩：${a.goalSec ? fmtT(a.goalSec) : "未设定"}`);

  if (a.fadePattern) {
    p.push(`\n## 他的习惯性掉速规律（从 ${a.fadePattern.sampleRuns} 次长距离训练里统计）`);
    p.push(`- ${a.fadePattern.note}`);
  }

  // 主观体感备注要放在分段数据之前 ——
  // 让模型先知道「哪里抽筋/不舒服」，再去解读那一段的配速和心率，
  // 而不是反过来在最后补一句解释。
  if (a.notes) {
    p.push(`\n## 跑者的主观体感（本人手记，只有这些是他自己的真实感受）`);
    p.push(a.notes);
  }

  if (a.mode === "result" && a.actual) {
    p.push(`\n## 本场结果`);
    p.push(`- 距离 ${a.actual.distanceKm} km｜用时 ${fmtT(a.actual.seconds)}｜均配速 ${fmtP(a.actual.paceSec)}/km｜均心率 ${a.actual.avgHr} bpm`);
    if (a.deltaVsGoalSec != null) {
      const d = a.deltaVsGoalSec;
      p.push(`- 对比目标：${d <= 0 ? `快了 ${fmtT(-d)}` : `慢了 ${fmtT(d)}`}（${((d / (a.goalSec!)) * 100).toFixed(1)}%）`);
    }
    if (a.deltaVsPredictedSec != null && a.predicted) {
      p.push(`- 对比自建模型预测（${fmtT(a.predicted.seconds)}）：${a.deltaVsPredictedSec <= 0 ? "快" : "慢"} ${fmtT(Math.abs(a.deltaVsPredictedSec))}`);
    }
    p.push(`- 执行判定：**${a.verdict}** —— ${a.verdictReason}`);

    if (a.halves.first && a.halves.second) {
      p.push(`\n## 前后半程对比`);
      p.push(`| | 前半（${a.halves.first.km}km） | 后半（${a.halves.second.km}km） | 变化 |`);
      p.push(`|---|---|---|---|`);
      p.push(`| 配速 | ${fmtP(a.halves.first.paceSec)}/km | ${fmtP(a.halves.second.paceSec)}/km | ${a.halves.paceDriftSec! > 0 ? "慢" : "快"} ${Math.abs(a.halves.paceDriftSec!)}s/km |`);
      p.push(`| 心率 | ${a.halves.first.hr} bpm | ${a.halves.second.hr} bpm | ${a.halves.hrDrift! >= 0 ? "+" : ""}${a.halves.hrDrift} bpm |`);
    }

    if (a.quarters.length === 4) {
      p.push(`\n## 四分段表现（时间流失定位）`);
      a.quarters.forEach((q, i) => {
        p.push(`- 第 ${i + 1} 段（${q.km}km）：${fmtP(q.paceSec)}/km，心率 ${q.hr} bpm${a.goalPaceSec ? `，目标配速 ${fmtP(a.goalPaceSec)}/km，偏差 ${q.paceSec > a.goalPaceSec ? "+" : ""}${q.paceSec - a.goalPaceSec}s` : ""}`);
      });
    }

    if (a.splits.length > 0) {
      p.push(`\n## 逐公里（累计时间 / 配速 / 心率 / 相对目标偏差）`);
      const rows = a.splits.map((s) =>
        `| ${s.km} | ${fmtT(s.cumulativeSec)} | ${fmtP(s.paceSec)} | ${s.hr} | ${s.vsGoalSec === 0 ? "—" : `${s.vsGoalSec > 0 ? "+" : ""}${s.vsGoalSec}s`} |`,
      );
      // 逐公里表太长会挤占上下文，只给前后各 1/4
      const cut = Math.floor(a.splits.length / 4);
      p.push(rows.slice(0, cut).join("\n"));
      p.push(`| … | … | … | … | … |`);
      p.push(rows.slice(a.splits.length - cut).join("\n"));
    }
  } else {
    p.push(`\n## 目标设定`);
    if (a.predicted) {
      p.push(`- 自建模型当前全马预测：${fmtT(a.predicted.seconds)}（${fmtP(a.predicted.paceSec)}/km）`);
    }
    if (a.goalSec) {
      p.push(`- 目标成绩：${fmtT(a.goalSec)}（${fmtP(a.goalSec / 42.195)}/km）`);
      if (a.predicted) {
        const gap = a.goalSec - a.predicted.seconds;
        p.push(`- 目标与预测的距离：${gap <= 0 ? "目标更快" : "目标更保守"} ${fmtT(Math.abs(gap))}（${((gap / a.predicted.seconds) * 100).toFixed(1)}%）`);
        if (a.goalSec < a.predicted.seconds * 0.97) {
          p.push(`- ⚠ 目标比当前能力快 3% 以上，需要谨慎：训练量或强度支撑不住这个成绩`);
        }
      }
    }

    if (a.prep) {
      p.push(`\n## 最近 ${a.prep.weeks} 周训练体检`);
      for (const c of a.prep.checklist) {
        p.push(`- [${c.status === "ok" ? "达标" : c.status === "warn" ? "注意" : c.status === "bad" ? "不足" : "未知"}] ${c.label}：${c.value}`);
      }
      p.push(`\n## 逐周明细`);
      p.push(`| 周 | 跑量 | 场次 | 最长单跑 | 强度课 | 环比 |`);
      p.push(`|---|---|---|---|---|---|`);
      for (const w of a.prep.weekly) {
        p.push(`| ${w.weekStart} | ${w.distanceKm} | ${w.sessions} | ${fmtDistLabel(w.longestRunKm)} | ${w.qualitySessions} | ${w.volumeChangePct == null ? "—" : `${w.volumeChangePct > 0 ? "+" : ""}${w.volumeChangePct}%`} |`);
      }
    }
  }

  return p.join("\n");
}

export { RESULT_PROMPT, PLAN_PROMPT, parseGoal };
