import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { activities, activityDetails, laps, trainingLoad, users } from "../db/schema.ts";
import { buildSessions, fmtDistLabel, round } from "../analytics.ts";
import { fmtP, fmtT } from "./engine.ts";
import { buildReport } from "./pipeline.ts";
import { classifySession, COROS_QUALITY, thresholdHrLine, type SessionFocus, type SessionLap } from "../training-focus.ts";

/**
 * 马拉松备赛体检。
 *
 * 只看「最近 N 周」而不是全部历史：备赛决策关心的是当前状态，
 * 半年前的训练量对「能不能跑进 3:05」没有参考价值。
 */

export type WeeklyBlock = {
  weekStart: string;
  distanceKm: number;
  durationSec: number;
  sessions: number;
  longestRunKm: number;
  longRunDate: string | null;
  avgPaceSec: number;
  qualitySessions: number;
  loadShort: number | null;
  loadLong: number | null;
  loadRatio: number | null;
  /** 相对上一周的跑量变化（%），第一周为 null */
  volumeChangePct: number | null;
};

export type ReadinessItem = {
  key: string;
  label: string;
  status: "ok" | "warn" | "bad" | "unknown";
  detail: string;
  value: string;
};

export type RacePrepReport = {
  generatedAt: number;
  weeks: number;
  raceDate: string | null;
  daysToRace: number | null;
  weekly: WeeklyBlock[];
  summary: {
    totalKm: number;
    avgWeeklyKm: number;
    peakWeeklyKm: number;
    avgSessionsPerWeek: number;
    longestRunKm: number;
    longestRunDate: string | null;
    qualityPerWeek: number;
    /** 连续几周跑量在递增（备赛期应该在稳步爬升） */
    buildStreak: number;
    /** 周跑量波动是否失控 */
    volatility: number;
    hasLoadSpike: boolean;
    spikeWeek: string | null;
  };
  checklist: ReadinessItem[];
  prediction: { seconds: number; paceSec: number } | null;
  profile: { age: number | null; weightKg: number | null; heightCm: number | null } | null;
};

// 强度课判定见 training-focus.ts：改用自建引擎的配速-心率回归，
// 不再匹配 COROS 的 trainingFocus 标签（实测该标签误判率过高）。

export function marathonPrep(opts: { weeks?: number; raceDate?: string | null } = {}): RacePrepReport {
  const weeks = Math.min(Math.max(opts.weeks ?? 8, 2), 26);
  const profile = db.select().from(users).all()[0] ?? null;
  const age = profile?.birthday
    ? Math.floor((Date.now() - new Date(profile.birthday).getTime()) / (365.25 * 86400000))
    : null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // ---- 场次级：最近 N 周的训练 ----
  const sessions = buildSessions().filter((s) => s.date >= cutoffStr);

  const details = db.select().from(activityDetails).all();
  const detailById = new Map(details.map((d) => [d.labelId, d]));

  /**
   * 强度课判定改用本项目自己的引擎（见 `training-focus.ts`），
   * 不再匹配 COROS 的 `trainingFocus` 标签 —— 那个标签按瞬时心率打，
   * 会把「轻松跑末段心率略高」也标成 Tempo，其中很大一部分并没真正进过阈值。
   *
   * 判定线由预测引擎的配速-心率回归在阈值配速处取值，天然自适配。
   */
  const report = buildReport();
  const lapsByLabel = new Map<string, SessionLap[]>();
  for (const l of db.select().from(laps).all()) {
    const arr = lapsByLabel.get(l.labelId) ?? [];
    arr.push({ distanceM: l.distanceM, timeSec: l.timeSec, avgHr: l.avgHr, maxHr: l.maxHr });
    lapsByLabel.set(l.labelId, arr);
  }
  const focusByLabel = new Map<string, SessionFocus>();
  for (const s of sessions) {
    for (const id of s.labelIds) {
      if (focusByLabel.has(id)) continue;
      // 注意：不能按 distanceM 过滤。间歇课的 COROS 分圈距离记 0
      // （实测 4 场 Anaerobic/VO2 Max 全部如此），而它们恰恰是最该算的强度课。
      // 判定只用「时间 + 心率」，与距离无关。
      focusByLabel.set(id, classifySession(lapsByLabel.get(id) ?? [], report.threshold));
    }
  }

  // ---- 按周分桶（周一起）----
  const buckets = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const d = new Date(`${s.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }

  const loadByDate = new Map(
    db.select().from(trainingLoad).all().map((l) => [l.date, l]),
  );

  const blocks: WeeklyBlock[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, list]) => {
      const distanceKm = list.reduce((n, s) => n + s.totals.distanceKm, 0);
      const durationSec = list.reduce((n, s) => n + s.totals.durationSec, 0);
      const longest = list.reduce((a, s) => (s.totals.distanceKm > (a?.totals.distanceKm ?? 0) ? s : a), list[0]);
      const quality = list.reduce(
        (n, s) => n + s.labelIds.filter((id) => focusByLabel.get(id)?.isQuality).length,
        0,
      );
      const load = loadByDate.get(weekStart) ?? null;
      return {
        weekStart,
        distanceKm: round(distanceKm, 1),
        durationSec,
        sessions: list.length,
        longestRunKm: longest?.totals.distanceKm ?? 0,
        longRunDate: longest?.date ?? null,
        avgPaceSec: distanceKm > 0 ? Math.round(durationSec / distanceKm) : 0,
        qualitySessions: quality,
        loadShort: load?.shortLoad ?? null,
        loadLong: load?.longLoad ?? null,
        loadRatio: load?.ratio ?? null,
        volumeChangePct: null,
      };
    });

  // 环比变化
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1].distanceKm;
    blocks[i].volumeChangePct = prev > 0 ? round(((blocks[i].distanceKm - prev) / prev) * 100, 1) : null;
  }

  // ---- 汇总 ----
  const vols = blocks.map((b) => b.distanceKm);
  const avgWeeklyKm = vols.length ? round(vols.reduce((a, b) => a + b, 0) / vols.length, 1) : 0;
  const peakWeeklyKm = vols.length ? round(Math.max(...vols), 1) : 0;
  const longestBlock = blocks.reduce((a, b) => ((b?.longestRunKm ?? 0) > (a?.longestRunKm ?? 0) ? b : a), blocks[0]);

  const changes = blocks.map((b) => b.volumeChangePct).filter((v): v is number => v != null);
  const meanChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
  const volatility = changes.length
    ? round(Math.sqrt(changes.reduce((s, c) => s + (c - meanChange) ** 2, 0) / changes.length), 1)
    : 0;

  let buildStreak = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const c = blocks[i].volumeChangePct;
    if (c == null || c <= 0) break;
    buildStreak++;
  }

  // 负荷突增：单周跑量涨幅 > 20% 是公认的伤病风险信号
  const spike = blocks.find((b) => (b.volumeChangePct ?? 0) > 20);

  // ---- 备赛清单 ----
  const checklist = buildChecklist({
    blocks, avgWeeklyKm, peakWeeklyKm, longestBlock, volatility, spike, daysToRace: daysTo(raceDateOf(opts.raceDate)),
    focusByLabel, detailById, sessions,
    thresholdHrLine: Math.round(thresholdHrLine(report.threshold)),
    thresholdPaceSec: report.threshold.paceSec,
  });

  // ---- 当前预测（复用自建预测引擎）----
  let prediction: RacePrepReport["prediction"] = null;
  try {
    const fm = report.predictions.find((p) => p.distanceKm === 42.195);
    if (fm) prediction = { seconds: fm.seconds, paceSec: fm.paceSec };
  } catch {
    // 预测失败不该让备赛页整页报错
  }

  return {
    generatedAt: Math.floor(Date.now() / 1000),
    weeks,
    raceDate: raceDateOf(opts.raceDate),
    daysToRace: daysTo(raceDateOf(opts.raceDate)),
    weekly: blocks,
    summary: {
      totalKm: round(vols.reduce((a, b) => a + b, 0), 1),
      avgWeeklyKm,
      peakWeeklyKm,
      avgSessionsPerWeek: blocks.length ? round(blocks.reduce((n, b) => n + b.sessions, 0) / blocks.length, 1) : 0,
      longestRunKm: longestBlock?.longestRunKm ?? 0,
      longestRunDate: longestBlock?.longRunDate ?? null,
      qualityPerWeek: blocks.length ? round(blocks.reduce((n, b) => n + b.qualitySessions, 0) / blocks.length, 1) : 0,
      buildStreak,
      volatility,
      hasLoadSpike: !!spike,
      spikeWeek: spike?.weekStart ?? null,
    },
    checklist,
    prediction,
    profile: { age, weightKg: profile?.weightKg ?? null, heightCm: profile?.heightCm ?? null },
  };
}

function raceDateOf(d?: string | null): string | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function daysTo(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}

function buildChecklist(a: {
  blocks: WeeklyBlock[];
  avgWeeklyKm: number;
  peakWeeklyKm: number;
  longestBlock?: WeeklyBlock;
  volatility: number;
  spike?: WeeklyBlock;
  daysToRace: number | null;
  focusByLabel: Map<string, SessionFocus>;
  detailById: Map<string, { trainingFocus?: string | null }>;
  sessions: ReturnType<typeof buildSessions>;
  thresholdHrLine: number;
  thresholdPaceSec: number;
}): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const s = a.blocks.reduce(
    (acc, b) => ({
      km: acc.km + b.distanceKm,
      quality: acc.quality + b.qualitySessions,
      sessions: acc.sessions + b.sessions,
    }),
    { km: 0, quality: 0, sessions: 0 },
  );
  const longest = a.longestBlock?.longestRunKm ?? 0;
  const longestDate = a.longestBlock?.longRunDate ?? "—";

  // 1. 最长单次跑量：赛前应至少完成一次 30km 以上
  items.push({
    key: "longRun",
    label: "最长单次跑量",
    status: longest >= 30 ? "ok" : longest >= 24 ? "warn" : "bad",
    detail:
      longest >= 30
        ? "已完成 30km 以上长跑，比赛日最关键的一次性耐力考验已经过关"
        : longest >= 24
          ? `目前最长 ${longest}km，赛前最好再完成一次 30km+ 的长跑`
          : `目前最长只有 ${longest}km，离马拉松需要的耐力还差不少`,
    value: `${fmtDistLabel(longest)}（${longestDate}）`,
  });

  // 2. 周跑量
  items.push({
    key: "weeklyKm",
    label: "近 " + a.blocks.length + " 周平均周跑量",
    status: a.avgWeeklyKm >= 45 ? "ok" : a.avgWeeklyKm >= 30 ? "warn" : "bad",
    detail:
      a.avgWeeklyKm >= 45
        ? "周跑量在业余马拉松跑者的合理区间"
        : a.avgWeeklyKm >= 30
          ? "周跑量偏低，全马 3 小时以上的强度通常需要更多有氧堆积"
          : "周跑量明显不足，靠这个基数跑全马风险高",
    value: `${a.avgWeeklyKm} km/周（峰值 ${a.peakWeeklyKm}）`,
  });

  // 3. 强度课密度
  //
  // 判定完全由自建引擎给出（阈值区累计 ≥10 分钟），不采信 COROS 标签。
  // 下面的逐条依据让这个数字可复核 —— 教练问「哪几次算强度课」时能直接答。
  const qualityPerWeek = a.blocks.length ? round(s.quality / a.blocks.length, 1) : 0;
  const qualitySessions = a.sessions
    .flatMap((sess) => sess.labelIds)
    .map((id) => ({ id, date: a.sessions.find((x) => x.labelIds.includes(id))?.date ?? "", f: a.focusByLabel.get(id) }))
    .filter((x) => x.f?.isQuality);
  const corosCount = a.sessions
    .flatMap((sess) => sess.labelIds)
    .filter((id) => COROS_QUALITY.test(a.detailById.get(id)?.trainingFocus ?? "")).length;
  const corosAll = a.sessions.flatMap((sess) => sess.labelIds).length;

  items.push({
    key: "quality",
    label: "每周强度课",
    status: qualityPerWeek >= 1.5 ? "ok" : qualityPerWeek >= 0.8 ? "warn" : "bad",
    detail:
      (qualityPerWeek >= 1.5
        ? "强度课频率合理：够刺激阈值，又不至于堆积疲劳"
        : qualityPerWeek >= 0.8
          ? "强度课略少，阈值和跑步经济性可能提升有限"
          : "几乎没有强度课，全马后程容易掉速") +
      `。判定标准：分圈平均心率 ≥ ${a.thresholdHrLine} bpm 累计 ≥10 分钟` +
      `（该线由你的阈值配速 ${fmtP(a.thresholdPaceSec)}/km 经配速-心率回归推出，非固定值）` +
      (qualitySessions.length
        ? `。计入：${qualitySessions
            .slice(0, 4)
            .map((x) => `${x.date.slice(5)}（${Math.round(x.f!.thresholdSec / 60)} 分钟）`)
            .join("、")}${qualitySessions.length > 4 ? " 等" : ""}`
        : "") +
      (corosCount !== s.quality
        ? `。COROS 官方标签会算 ${corosCount}/${corosAll} 场强度课，与本判定相差 ${Math.abs(corosCount - s.quality)} 场 —— 以本判定为准`
        : ""),
    value: `${qualityPerWeek} 次/周（近 ${a.blocks.length} 周共 ${s.quality} 次）`,
  });

  // 4. 训练连续性
  items.push({
    key: "consistency",
    label: "训练频次",
    status: s.sessions / Math.max(a.blocks.length, 1) >= 4 ? "ok" : s.sessions / Math.max(a.blocks.length, 1) >= 3 ? "warn" : "bad",
    detail:
      s.sessions / Math.max(a.blocks.length, 1) >= 4
        ? "训练频率稳定，有氧基础会持续累积"
        : "训练频率偏低，注意别让有氧基础停滞",
    value: `${a.blocks.length} 周共 ${s.sessions} 场`,
  });

  // 5. 跑量波动 / 伤病风险
  items.push({
    key: "volatility",
    label: "跑量波动与伤病风险",
    status: a.spike ? "bad" : a.volatility > 25 ? "warn" : "ok",
    detail: a.spike
      ? `${a.spike.weekStart} 当周跑量暴涨 ${a.spike.volumeChangePct}%，单周增幅超过 20% 是公认的伤病风险信号`
      : a.volatility > 25
        ? `周跑量标准差 ${a.volatility}km，波动偏大，建议加入减量周让身体吸收`
        : `周跑量波动标准差 ${a.volatility}km，爬升节奏平稳`,
    value: a.spike ? `${a.spike.weekStart} +${a.spike.volumeChangePct}%` : `σ ${a.volatility} km`,
  });

  // 6. 比赛日安排
  if (a.daysToRace != null) {
    const d = a.daysToRace;
    if (d < 0) {
      items.push({ key: "race", label: "比赛日", status: "unknown", detail: "比赛日期已过", value: "已结束" });
    } else if (d <= 7) {
      items.push({
        key: "race",
        label: "比赛日",
        status: "warn",
        detail: "已进入赛前 7 天，应该处于减量期：跑量降到平时的 40–50%，保留短强度但不追量",
        value: `还有 ${d} 天（减量期）`,
      });
    } else if (d <= 21) {
      items.push({
        key: "race",
        label: "比赛日",
        status: "ok",
        detail: "进入赛前 3 周，这是备赛里最关键的「上量」窗口，接下来每 10 天要见一次 30km 以上的长跑",
        value: `还有 ${d} 天（关键期）`,
      });
    } else if (d <= 60) {
      items.push({
        key: "race",
        label: "比赛日",
        status: "ok",
        detail: "距离比赛还有两个月以上，当前应以稳中有升地堆有氧量为主",
        value: `还有 ${d} 天（基础期）`,
      });
    } else {
      items.push({
        key: "race",
        label: "比赛日",
        status: "unknown",
        detail: "距离比赛还早，这是长期备赛的爬坡阶段",
        value: `还有 ${d} 天`,
      });
    }
  }

  return items;
}

// ---------------- AI 备赛分析 ----------------

const PREP_SYSTEM_PROMPT = `你是一位资深马拉松备赛教练。用户正准备参加一场马拉松比赛，
系统会把 TA **最近几周**的训练数据整理好交给你。

你的任务不是泛泛而谈，而是回答三个问题：
1. **现在这个状态能不能跑出目标成绩？** 给出判断和理由。
2. **最大的短板是什么？** 从跑量、最长单跑、强度课、恢复、负荷波动里找出最致命的那一项。
3. **接下来每周具体怎么练？** 给出可执行的周计划（周跑量、长跑安排、强度课位置、减量周安排）。

要求：
- 必须引用具体数字（周跑量、最长单跑、强度课次数、负荷比、周环比变化），不要空话。
- **不要建议加量过头**。如果数据显示负荷波动或涨幅过快，要明确劝阻，并说明理由。
- 区分「有氧基础不够」和「强度不够」——两者的处方完全不同，别混着说。
- 如果距离比赛只剩 2–3 周，要切换到减量视角，而不是继续讲怎么加量。
- 如果数据本身有缺口（比如没有睡眠数据），直接说明这影响了什么判断，不要假装有。
- 用 Markdown，控制在 700 字以内，最后必须给一个「本周训练清单」。`;

export function buildPrepUserPrompt(rep: RacePrepReport): string {
  const p: string[] = [];
  const s = rep.summary;

  p.push(`## 运动员`);
  p.push(
    `- ${rep.profile?.age ?? "—"} 岁｜${rep.profile?.heightCm ?? "—"} cm｜${rep.profile?.weightKg ?? "—"} kg`,
  );
  p.push(
    `- 比赛日：${rep.raceDate ?? "未设定"}${rep.daysToRace != null ? `（还有 ${rep.daysToRace} 天）` : ""}`,
  );

  p.push(`\n## 最近 ${rep.weeks} 周训练概览`);
  p.push(`- 总跑量 ${s.totalKm} km｜周均 ${s.avgWeeklyKm} km｜峰值 ${s.peakWeeklyKm} km`);
  p.push(`- 周均 ${s.avgSessionsPerWeek} 场｜周均强度课 ${s.qualityPerWeek} 次`);
  p.push(`- 最长单次跑量 ${fmtDistLabel(s.longestRunKm)}（${s.longestRunDate ?? "—"}）`);
  p.push(`- 跑量波动 σ=${s.volatility} km｜连续爬升 ${s.buildStreak} 周${s.hasLoadSpike ? `｜⚠ ${s.spikeWeek} 周出现负荷突增` : ""}`);
  if (rep.prediction) {
    p.push(`- 自建模型当前全马预测：${fmtT(rep.prediction.seconds)}（${fmtP(rep.prediction.paceSec)}/km）`);
  }

  p.push(`\n## 逐周明细`);
  p.push(`| 周起始 | 跑量 | 场次 | 最长单跑 | 强度课 | 均配速 | 短期/长期负荷 | 负荷比 | 周环比 |`);
  p.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const b of rep.weekly) {
    p.push(
      `| ${b.weekStart} | ${b.distanceKm} | ${b.sessions} | ${fmtDistLabel(b.longestRunKm)} | ${b.qualitySessions} | ${fmtP(b.avgPaceSec)} | ${b.loadShort ?? "—"}/${b.loadLong ?? "—"} | ${b.loadRatio ?? "—"} | ${b.volumeChangePct == null ? "—" : `${b.volumeChangePct > 0 ? "+" : ""}${b.volumeChangePct}%`} |`,
    );
  }

  p.push(`\n## 系统体检结果`);
  for (const c of rep.checklist) {
    p.push(`- [${c.status === "ok" ? "达标" : c.status === "warn" ? "注意" : c.status === "bad" ? "不足" : "未知"}] ${c.label}：${c.value} —— ${c.detail}`);
  }

  return p.join("\n");
}

export async function analyzeRacePrep(opts: {
  weeks?: number;
  raceDate?: string | null;
  focus?: string | null;
}): Promise<{ report: string; provider: string; model: string; rep: RacePrepReport }> {
  const { callModel, getAiConfig } = await import("../ai/provider.ts");
  const cfg = getAiConfig();
  if (!cfg) throw new Error("尚未配置 AI 模型，请先在设置页填写");

  const rep = marathonPrep(opts);
  if (rep.weekly.length === 0) throw new Error("所选时间范围内没有训练数据，先同步一下");

  const focusLine = opts.focus ? `\n\n## 本次分析重点\n${opts.focus}\n` : "";
  const report = await callModel(cfg, PREP_SYSTEM_PROMPT, buildPrepUserPrompt(rep) + focusLine);
  return { report, provider: cfg.provider, model: cfg.model, rep };
}

export { PREP_SYSTEM_PROMPT };
