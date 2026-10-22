import { db } from "../db/client.ts";
import { ageFromBirthday, buildSessions, hrZoneOptions, hrZones, sessionLaps } from "../analytics.ts";
import { activities, activityDetails, aiReports, aiSessionReports, aiSettings, fitness, laps, recovery, trainingLoad, users } from "../db/schema.ts";
import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import {
  classifyTerrain,
  climbAbility,
  climbRate,
  describeTerrain,
  fitClimbModel,
  TERRAIN_LABEL,
} from "../terrain.ts";
import { altitudeAdjustPace, describeAltitude, getAltitude } from "../altitude.ts";

export type AiConfig = {
  provider: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

export function getAiConfig(): AiConfig | null {
  const row = db.select().from(aiSettings).where(eq(aiSettings.id, 1)).get();
  if (!row) return null;
  return {
    provider: row.provider as AiConfig["provider"],
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
  };
}

export function saveAiConfig(cfg: AiConfig) {
  const existing = db.select().from(aiSettings).where(eq(aiSettings.id, 1)).get();
  if (existing) {
    db.update(aiSettings)
      .set({ ...cfg, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(aiSettings.id, 1))
      .run();
  } else {
    db.insert(aiSettings).values({ id: 1, ...cfg, updatedAt: Math.floor(Date.now() / 1000) }).run();
  }
}

export class AiError extends Error {}

/**
 * 截断检测 —— 必须在**存库之前**做，否则失败会变成一条"看起来成功"的空报告。
 *
 * 背景（推理类模型上实测）：agnes-2.5-flash 这类推理模型的 usage 里
 * completion_tokens 是「思考 + 正文」的**合计量**，共用 max_tokens 这一个预算。
 * 原先 max_tokens=2000，而这次场次分析光是思考就要 470~2000 token，
 * 于是经常在还没开始写正文时就把预算烧光：
 *
 *   #1 finish=length total=2000/2000 (思考 2000 + 正文 0)    → 正文长度 0
 *   #2 finish=stop   total=1632/2000 (思考  677 + 正文 955) → 正文 1351 字
 *   #4 finish=length total=2000/2000 (思考 1574 + 正文 426) → 正文 688 字（半截）
 *   #6 finish=length total=2000/2000 (思考 2000 + 正文 0)    → 正文长度 0
 *
 * 6 次里失败 3 次。原来的 `?? ""` 把空正文原样返回，不报错，
 * 于是库里存下一条 report='' 的记录，页面看上去像"一直在转圈"。
 */
function assertNotTruncated(
  content: string,
  reason: string | undefined,
  usage: any,
  limit: number,
): void {
  const total = Number(usage?.completion_tokens ?? 0);
  const reasoning = Number(usage?.completion_tokens_details?.reasoning_tokens ?? 0);
  const text = Number(usage?.completion_tokens_details?.text_tokens ?? 0);
  const split = reasoning
    ? `其中推理（thinking）占 ${reasoning} token`
    : "";

  if (reason === "length" || reason === "max_tokens") {
    throw new AiError(
      `模型输出被 max_tokens 截断（已用满 ${total}/${limit}，${split}）。` +
        `推理模型的"思考"和"正文"共用同一个预算，所以数值要比普通模型大得多 —— ` +
        `请到设置页把「最大输出 token」调大到 ${Math.max(limit * 4, 8000)} 以上后重试。` +
        (content ? `本次已拿到 ${content.length} 字，但内容不完整，已丢弃。` : "本次一个字正文都没写出来。"),
    );
  }

  if (!content.trim()) {
    throw new AiError(
      `模型没有返回正文（finish_reason=${reason ?? "未知"}，token 用量 ${total}/${limit}${split}）。` +
        `如果是推理模型，可能是思考阶段就耗尽了预算，请调大「最大输出 token」。`,
    );
  }
}

/** 统一返回模型输出文本；两种协议都走这里。 */
export async function callModel(cfg: AiConfig, system: string, user: string): Promise<string> {
  if (cfg.provider === "anthropic") return callAnthropic(cfg, system, user);
  return callOpenAiCompatible(cfg, system, user);
}

async function callOpenAiCompatible(cfg: AiConfig, system: string, user: string): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new AiError(`模型调用失败 (${res.status}): ${body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  }
  const content = typeof body?.choices?.[0]?.message?.content === "string"
    ? body.choices[0].message.content
    : "";
  assertNotTruncated(content, body?.choices?.[0]?.finish_reason, body?.usage, cfg.maxTokens);
  return content;
}

async function callAnthropic(cfg: AiConfig, system: string, user: string): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = base.endsWith("/v1/messages") ? base : `${base}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new AiError(`模型调用失败 (${res.status}): ${body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
  }
  const content = (body?.content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text)
    .join("\n");
  // Anthropic 的 stop_reason 用 "max_tokens" 表示截断，语义同上。
  assertNotTruncated(content, body?.stop_reason, body?.usage, cfg.maxTokens);
  return content;
}

// ---------------- context building ----------------

export const fmtPace = (sec: number | null | undefined) => {
  if (!sec) return "—";
  // 必须处理进位：299.6s 直接四舍五入会输出非法的 "4:60"
  let m = Math.floor(sec / 60);
  let s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const fmtDur = (sec: number | null | undefined) => {
  if (!sec) return "—";
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  if (m === 60) { h += 1; m = 0; }
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

export type AnalysisContext = {
  activity: any;
  detail: any;
  laps: any[];
  fitness: any;
  recovery: any;
  load7: any[];
  recentRuns: any[];
  user: any;
};

export function buildContext(labelId: string): AnalysisContext | null {
  // 注意：这里必须用 db.select() 核心 API。
  // db.query.* 是 Drizzle 的关系查询层，在 bun-sqlite 驱动下不提供同步的 .get()/.all()。
  const first = <T>(rows: T[]) => rows[0] ?? null;

  const activity = first(db.select().from(activities).where(eq(activities.labelId, labelId)).all());
  if (!activity) return null;

  const detail = first(db.select().from(activityDetails).where(eq(activityDetails.labelId, labelId)).all());
  const lapRows = db
    .select()
    .from(laps)
    .where(eq(laps.labelId, labelId))
    .orderBy(asc(laps.lapIndex))
    .all();
  const userRow = first(db.select().from(users).all());

  // 训练前 7 天的负荷
  const date = activity.dateLabel;

  // 快照必须对齐活动当天，不能拿全局最新一条（同 session 版的原因）
  const fitnessRow = fitnessAsOf(date);
  const recoveryRow = recoveryAsOf(date);

  const weekAgo = new Date(`${date}T00:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const loadRows = db
    .select()
    .from(trainingLoad)
    .where(and(gte(trainingLoad.date, weekAgo.toISOString().slice(0, 10)), lte(trainingLoad.date, date)))
    .orderBy(asc(trainingLoad.date))
    .all();

  // 本次之前的 10 次训练
  // 带出爬升：没有地形标签，AI 无法判断「配速变慢」是退步还是跑在了上坡路上
  const recentRows = db
    .select({
      dateLabel: activities.dateLabel,
      distanceKm: activities.distanceKm,
      durationSec: activities.durationSec,
      avgPaceSec: activities.avgPaceSec,
      avgHr: activities.avgHr,
      elevGain: activityDetails.elevGain,
    })
    .from(activities)
    .leftJoin(activityDetails, eq(activities.labelId, activityDetails.labelId))
    .where(lt(activities.dateLabel, date))
    .orderBy(desc(activities.dateLabel))
    .limit(10)
    .all();

  return {
    activity,
    detail: detail ?? null,
    laps: lapRows,
    fitness: fitnessRow ?? null,
    recovery: recoveryRow ?? null,
    load7: loadRows,
    recentRuns: recentRows,
    user: userRow ?? null,
  };
}

export const SYSTEM_PROMPT = `你是一位资深跑步教练，专精马拉松备赛与耐力运动表现分析。

你的任务：基于跑步者提供的 COROS 训练数据（单次训练明细 + 逐圈分段 + 近期训练负荷 + 体能基线 + 恢复状态），输出一份**具体、可执行**的中文训练分析。

⚠ 职责边界（最重要，先读这条）：
  使用者有专职教练负责训练计划。**你只负责解读数据，不要出训练计划。**
  禁止：安排周跑量、指定强度课组数/配速、规定减量节奏、建议"该练什么"。
  允许：指出数据里的规律（如"Z3 时间几乎为零"、"前后半程配速差异"）、
        陈述与历史基线的偏离、回答"这次训练说明了什么"。
  需要给建议时，表述成「这个数据供教练参考」，而不是直接下指令。

要求：
1. 先给结论（这次训练达成了什么、强度是否合理），再给依据。
   注意：结论可以指出问题，但"下一步"部分只描述数据缺口，不给训练指令。
2. **必须引用具体数字**（配速、心率、步频、负荷、负荷比），不要写"速度不错""状态良好"这种空话。
3. 逐圈数据要用来回答：哪一段掉速了？掉速时心率是升了还是没升？步频/步幅怎么变化的？
4. 结合体能基线（阈值配速、VO2max、全马预测）判断这次训练在备赛周期中的定位。
5. 结合训练负荷（短期/长期/负荷比）判断是否存在累积疲劳或负荷不足。
6. 如果指出需要调整的方向，只描述「数据显示什么」，并注明供教练参考，不要直接下训练指令。
7. 如果数据不足以支撑某个判断，直接说明缺什么数据，不要臆测。
8. 用 Markdown 组织，控制在 600 字以内。

地形判读（重要）：
- 这次训练会附带**地形说明**。同一心率下，爬升路段的配速天然比平路慢 ——
  具体数值用数据里给的「爬升代价系数」，那是**从这个人自己的历史分圈拟合出来的**，
  每个人不同，不要套用通用数字。
- 所以起伏路段配速比平路慢 **不等于** 体能退步或配速控制变差。判断状态好坏请优先看心率，而不是配速。
- 只有在**同一地形**内部比较配速变化，结论才成立。
- **爬升 0 m 或爬升率极低是有意义的结论，不是缺数据**。田径场/操场跑全场爬升就是 0，
  此时直接按平路场分析，不要因为「爬升 0」就打折扣或说「地形数据不可信」。
- 若标注了**海拔**，说明这次训练在高原：高原会让配速天然变慢约 2.5 s/km 每 1000m，这是生理性的，不是退步。跨海拔比较配速前必须先折算。

心率判读（重要）：
- 用**五区间心率法**，按 HRR（储备心率）占比判定，不是 %HRmax，也不是均匀分段：
  - Z0 积极恢复 < 59%（热身/散步/极轻微活动，用于观察热身与恢复充分度）
  - Z1 有氧耐力 59–74%
  - Z2 有氧动力 74–84%
  - Z3 乳酸阈 85–88%（**只有 4% 宽**）
  - Z4 速度耐力 89–95%
  - Z5 无氧动力 >95%
- **具体 bpm 边界以数据里给出的区间表为准**，不要用记忆里的数字 ——
  边界由使用者自己的 HRmax 和静息心率算出，每个人都不一样。
- 注意 Z3 乳酸阈很窄，判定时不要把 80–88% 整段都算成阈值。
- 静息心率低的人多数时间落在 Z1 是**正常的**基础有氧表现，不要说成强度不足。
- 判断一堂课是什么强度，看它主要落在哪个区间，不要只看平均心率高低。`;

export function buildUserPrompt(ctx: AnalysisContext): string {
  const { activity: a, detail: d, laps, fitness, recovery, load7, recentRuns, user } = ctx;
  const parts: string[] = [];

  parts.push(`## 运动员档案`);
  if (user) {
    const age = user.birthday
      ? Math.floor((Date.now() - new Date(user.birthday).getTime()) / 31557600000)
      : null;
    parts.push(`- 昵称：${user.nickname ?? "—"}｜性别：${user.gender ?? "—"}｜年龄：${age ?? "—"} 岁`);
    parts.push(`- 身高：${user.heightCm ?? "—"} cm｜体重：${user.weightKg ?? "—"} kg`);
  } else {
    parts.push("- （无档案数据）");
  }

  parts.push(`\n## 本次训练（${a.dateLabel}）`);
  parts.push(`- 项目：${a.sportName}｜地点：${a.location ?? "—"}`);
  parts.push(`- 距离：${a.distanceKm ?? "—"} km｜时长：${fmtDur(a.durationSec)}`);
  parts.push(`- 平均配速：${fmtPace(a.avgPaceSec)} /km｜平均心率：${a.avgHr ?? "—"} bpm`);
  parts.push(`- 消耗：${a.calories ?? "—"} kcal`);

  if (d) {
    const rate = climbRate(d.elevGain, a.distanceKm);
    parts.push(`- **地形**：${describeTerrain({ elevGain: d.elevGain, elevLoss: d.elevLoss, distanceKm: a.distanceKm })}`);
    const alt = getAltitude(a.labelId);
    if (alt) {
      parts.push(`- **海拔**：${describeAltitude(alt)}`);
      const penalty = Math.abs(altitudeAdjustPace(0, alt.altAvg));
      if (penalty >= 0.5) {
        parts.push(
          `- ⚠ 这是**高原训练**（${Math.round(alt.altAvg)}m）。高原惩罚约 ${penalty.toFixed(1)} s/km，` +
            `本次配速折算到海平面约等于 ${fmtPace((a.avgPaceSec ?? 0) - penalty)}；` +
            `若与平原训练比较，必须先做这个折算，否则会误判为退步。`,
        );
      }
    }
    parts.push(`\n## 训练明细`);
    parts.push(`- 移动平均配速 ${fmtPace(d.movingPaceSec)} /km｜等价配速 ${fmtPace(d.adjustedPaceSec)} /km｜最快公里 ${fmtPace(d.bestKmSec)} /km`);
    parts.push(`- 平均步频 ${d.avgCadence ?? "—"} spm｜平均步幅 ${d.avgStrideM ?? "—"} m｜平均功率 ${d.avgPower ?? "—"} W`);
    parts.push(`- 爬升/下降 ${d.elevGain ?? "—"}/${d.elevLoss ?? "—"} m`);
    if (rate >= 3) {
      // 起伏路段额外给一条参照：把配速折算成平路等效值，避免 AI 把地形当成状态问题
      parts.push(
        `- ⚠ 这是**起伏路段**（${rate.toFixed(1)} m/km）。实测爬升代价约 1.24 s/(m/km)，` +
          `本次地形大致让配速慢了 ${(rate * 1.24).toFixed(0)} s/km；` +
          `按此折算，${fmtPace(a.avgPaceSec)} 的配速约等于平路 ${fmtPace((a.avgPaceSec ?? 0) - rate * 1.24)}`,
      );
    }
    parts.push(`- 训练负荷 ${d.trainingLoad ?? "—"}｜有氧 TE ${d.aerobicTe ?? "—"}｜无氧 TE ${d.anaerobicTe ?? "—"}`);
    parts.push(`- 训练重点：${d.trainingFocus ?? "—"}｜表现评估：${d.performance ?? "—"}`);
  }

  if (laps.length > 0) {
    parts.push(`\n## 逐圈分段（共 ${laps.length} 段）`);
    parts.push(`| 段 | 距离(m) | 用时 | 配速/km | 平均心率 | 最大心率 | 步频 | 爬升 |`);
    parts.push(`|---|---|---|---|---|---|---|---|`);
    for (const l of laps) {
      parts.push(
        `| ${l.lapIndex} | ${Math.round(l.distanceM)} | ${fmtDur(l.timeSec)} | ${fmtPace(l.avgPaceSec)} | ${l.avgHr || "—"} | ${l.maxHr || "—"} | ${l.avgCadence || "—"} | ${Math.round(l.elevGain ?? 0)} |`,
      );
    }
  }

  if (fitness) {
    parts.push(`\n## 当前体能基线`);
    parts.push(`- VO2max：${fitness.vo2max ?? "—"}｜跑步等级：${fitness.runningLevel ?? "—"}`);
    parts.push(`- 阈值配速：${fmtPace(fitness.thresholdPaceSec)} /km`);
    parts.push(
      `- 成绩预测：5K ${fmtDur(fitness.pred5kSec)}｜10K ${fmtDur(fitness.pred10kSec)}｜半马 ${fmtDur(fitness.predHalfSec)}｜全马 ${fmtDur(fitness.predMarathonSec)}`,
    );
  }

  if (load7.length > 0) {
    parts.push(`\n## 训练前 7 天负荷`);
    for (const l of load7) {
      parts.push(`- ${l.date}：短期 ${l.shortLoad ?? "—"}｜长期 ${l.longLoad ?? "—"}｜负荷比 ${l.ratio ?? "—"}｜${l.comment ?? ""}`);
    }
  }

  if (recovery) {
    parts.push(`\n## 训练当日恢复状态：${recovery.recoveryPct ?? "—"}%（${recovery.level ?? "—"}）`);
  }

  {
    const z = hrZonePrompt(laps, ctx.user ? ageFromBirthday(ctx.user.birthday ?? null) : null);
    if (z) parts.push(`\n${z.text}`);
  }

  if (recentRuns.length > 0) {
    parts.push(`\n## 近期训练回顾（本次之前）`);
    for (const r of recentRuns.slice(0, 6)) {
      const rate = climbRate(r.elevGain, r.distanceKm);
      parts.push(
        `- ${r.dateLabel}：${r.distanceKm ?? "—"} km / ${fmtDur(r.durationSec)} / ${fmtPace(r.avgPaceSec)} per km / ${r.avgHr ?? "—"} bpm / ${TERRAIN_LABEL[classifyTerrain(rate)]}${rate >= 3 ? ` ${rate.toFixed(1)}m/km` : ""}`,
      );
    }
  }

  return parts.join("\n");
}

export async function analyzeActivity(
  labelId: string,
  focus: string | null,
): Promise<{ report: string; provider: string; model: string }> {
  const cfg = getAiConfig();
  if (!cfg) throw new AiError("尚未配置 AI 模型，请先在设置页填写");

  const ctx = buildContext(labelId);
  if (!ctx) throw new AiError(`找不到活动 ${labelId}`);

  const focusLine = focus ? `\n\n## 本次分析重点\n${focus}\n` : "";
  const report = await callModel(cfg, SYSTEM_PROMPT, buildUserPrompt(ctx) + focusLine);

  db.insert(aiReports).values({ labelId, provider: cfg.provider, model: cfg.model, focus, report }).run();
  return { report, provider: cfg.provider, model: cfg.model };
}

// ---------------- 训练次（session）级分析 ----------------

export const SESSION_SYSTEM_PROMPT = `你是一位资深跑步教练，专精马拉松备赛与间歇训练分析。

这次分析的对象是**同一天里的一整场训练**，它可能被手表记录成 1 条或多条：
- 间歇训练（1km×10 组 + 800m×10 组 + 400m×2 组）常被拆成很多条记录；
- 单次长距离跑通常只有 1 条；
- 一天两练会出现 2 场独立训练（已按间隔分开，不应混在一起）。

你的任务：把这一天（这一场）的所有记录当作**一个整体**来解读，而不是逐条点评。

⚠ 分析范围（最重要，先读这条）：
  本次分析的对象**只有这一天这一场**。系统不会给你其它日期的训练数据，
  这是刻意的 —— 场次复盘要回答「这场训练本身说明了什么」，
  混进其它日期的对比会让结论跑偏。
  所以：**不要写「基线对比」「比前几天快/慢」「与历史相比」这类跨场次结论**，
  也不要因为看不到历史数据就说「无法判断」—— 单场内部的对比（分段之间、
  前半程 vs 后半程、基线配速 vs 本场配速）已经足够支撑所有判断。

⚠ 职责边界（最重要，先读这条）：
  使用者有专职教练负责训练计划。**你只负责解读数据，不要出训练计划。**
  禁止：安排下次练什么、规定组数配速、建议减量节奏。
  允许：陈述数据规律、与本场体能基线（阈值配速/全马预测）对比、指出异常（如某段掉速、某区间缺失）。
  需要给建议时，表述成「这个数据供教练参考」。

要求：
1. 先给结论：这场训练整体达成了什么目的、结构是否合理、强度是否到位。
2. **必须引用具体数字**（总里程、总时长、各组配速与心率、组间休息、训练负荷、负荷比），不要空话。
3. **必须使用「逐段明细」表**。这是本次分析最容易出错的地方：
   - 判断掉速/加速、心率漂移、步频变化，只能用逐段数据，用全场均值一定会判错；
   - 「前 13km 稳、15km 后加不上去」这类**分段现象**，逐段表里通常一眼可见，
     不要在有逐段数据时写成「缺分段数据，无法判断」；
   - 特别检查最后 1/4：配速在变慢还是变快？心率在升还是没升？
     如果后半程配速反而更快，那是负分段长距离，不是掉速，别当成疲劳。
4. 结构分析要具体：
   - 有多组重复时，指出每组的配速与心率是否稳定、有没有前松后紧或前紧后松；
   - 组间休息是否足够支撑下一组的质量；
   - 最后一组（或最后 1/4）是否出现心率漂移而配速未变 —— 这是耐力训练最关键的信号。
5. 结合体能基线（阈值配速、全马预测）判断这场训练在备赛周期中的定位与配速选择是否合理。
6. 结合训练负荷（短期/长期/负荷比）判断累积疲劳风险。
7. 若要指出可改进之处，只描述数据层面的观察（哪一段掉速、哪个区间偏少），注明供教练参考，不要直接开训练处方。
8. 如果某项判断所需数据缺失（例如没有心率、没有组间时间），直接说明缺什么，不要臆测。
   注意区分「系统确实没给这项数据」和「你没看这张表」——后者不是缺数据。
9. 用 Markdown 组织，控制在 700 字以内。

地形判读（重要）：
- 会附带本场的**地形说明**与**爬升能力基线**。
- 同一心率下爬升路段配速天然比平路慢，**不是退步**。具体数值用数据里给的
  「爬升代价系数」—— 那是从这个人的历史分圈拟合出来的，不是通用常数。
- 起伏场的配速请与起伏场比、平路场与平路场比，跨地形直接比较会得出错误结论。
- 判断状态优先看心率与训练负荷，而不是跨地形的配速绝对值。
- **爬升 0 m 或爬升率极低是有意义的结论，不是缺数据**。
  田径场/操场跑全场爬升就是 0（气压计在这种场地读数极稳），
  此时应直接按平路场分析，不要因为「爬升 0」去打折扣或说「地形数据不可信」。
- 只有在**高差**异常大（全程最高与最低海拔相差几十米以上）而爬升读数却很小时，
  才说明气压计噪声干扰，此时说明即可，不要把它当成有爬升的训练。
- 若标注了**海拔**，按 2.5 s/km 每 1000m 做高原折算后再比较；不要把高原的慢配速说成状态下滑。

心率判读（重要）：
- 用**五区间心率法**，按 HRR 占比判定：
  Z1 59–74%｜Z2 74–84%｜Z3 85–88%（**仅 4% 宽**）｜Z4 89–95%｜Z5 >95%｜低于 Z1 下界记为热身/恢复
- **具体 bpm 边界以数据里给出的区间表为准**，不要用记忆里的数字 ——
  边界由使用者自己的 HRmax 和静息心率算出，每个人都不一样。
- 静息心率低的人 Z1 占多数是**正常的**基础有氧表现，不要说成强度不足。
- 判定强度课看是否出现 Z2 及以上的时间与占比，别只看平均心率。`;

/**
 * 取「场次当天或之前最近的一条」快照。
 *
 * COROS 的 recovery / fitness 用 captured_at（unix 秒）记录采集时间，
 * 表里没有独立的日期列，所以用「场次当天 23:59:59」作为截止点回溯。
 * 之前用 orderBy(desc).limit(1) 会拿到「数据库里最新的一条」，
 * 分析历史场次时就会把别的日期的恢复值标成「当日」（实测会拿到更新日期的值）。
 */
function asOfCutoff(dateLabel: string): number {
  return new Date(`${dateLabel}T23:59:59`).getTime() / 1000;
}

export function recoveryAsOf(dateLabel: string) {
  const cutoff = asOfCutoff(dateLabel);
  return (
    db
      .select()
      .from(recovery)
      .where(lte(recovery.capturedAt, cutoff))
      .orderBy(desc(recovery.capturedAt))
      .limit(1)
      .get() ?? null
  );
}

export function fitnessAsOf(dateLabel: string) {
  const cutoff = asOfCutoff(dateLabel);
  return (
    db
      .select()
      .from(fitness)
      .where(lte(fitness.capturedAt, cutoff))
      .orderBy(desc(fitness.capturedAt))
      .limit(1)
      .get() ?? null
  );
}

export function buildSessionContext(sessionKey: string) {
  const sessions = buildSessions();
  const session = sessions.find((s) => s.key === sessionKey);
  if (!session) return null;

  const acts = db
    .select()
    .from(activities)
    .where(inArray(activities.labelId, session.labelIds))
    .orderBy(asc(activities.startTs))
    .all();
  const detailRows = db
    .select()
    .from(activityDetails)
    .where(inArray(activityDetails.labelId, session.labelIds))
    .all();
  const detailById = new Map(detailRows.map((d) => [d.labelId, d]));

  // 恢复 / 体能基线必须对齐场次日期，不能拿「全局最新一条」。
  // 否则分析 10-06 的场次会拿到 10-08 的恢复值，却挂着「当日」的标题。
  const fitnessRow = fitnessAsOf(session.date);
  const recoveryRow = recoveryAsOf(session.date);
  const userRow = db.select().from(users).all()[0] ?? null;

  const weekAgo = new Date(`${session.date}T00:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const loadRows = db
    .select()
    .from(trainingLoad)
    .where(and(gte(trainingLoad.date, weekAgo.toISOString().slice(0, 10)), lte(trainingLoad.date, session.date)))
    .orderBy(asc(trainingLoad.date))
    .all();

  // 详情表里没有最大心率，从逐圈数据算每条记录的真实峰值
  const lapRows = sessionLaps(session.labelIds);
  const maxHrById = new Map<string, number>();
  for (const l of lapRows) {
    const m = l.maxHr || 0;
    if (m > (maxHrById.get(l.labelId) ?? 0)) maxHrById.set(l.labelId, m);
  }

  return { session, acts, detailById, fitnessRow, recoveryRow, userRow, loadRows, lapRows, maxHrById };
}

type SessionCtx = NonNullable<ReturnType<typeof buildSessionContext>>;

/**
 * 生成心率区间段落（HRR 口径），供两处 prompt 共用。
 * 直接给模型实际分布数字，比只给区间定义有用得多。
 */
export function hrZonePrompt(lapRows: { avgHr: number | null; maxHr: number | null; timeSec: number }[], age: number | null) {
  try {
    const z = hrZones(lapRows, hrZoneOptions(age));
    if (!z || z.zones.length === 0) return null;
    const lines = z.zones.map(
      (b) => `- ${b.zone} ${b.label} ${b.hrHi && b.hrHi < 900 ? `${b.hrLo}–${b.hrHi}` : `>${b.hrLo}`} bpm（${b.pctLabel === "自定义" ? "自定义" : `HRR ${b.pctLabel}`}）：${b.seconds}s（${b.pct}%）`,
    );
    if (z.belowZone1Pct > 0) {
      const z1Lo = z.zones[0]?.hrLo;
      lines.unshift(`- Z0 积极恢复（${z1Lo != null ? `< ${z1Lo}` : "低于 Z1"} bpm）：${z.belowZone1Seconds}s（${z.belowZone1Pct}%）`);
    }
    return {
      text:
        `## 心率区间分布（${z.method}）\n` +
        `- 最大心率 ${z.maxHr} bpm｜静息 ${z.restingHr} bpm｜储备 ${z.reserve} bpm\n` +
        lines.join("\n"),
      zones: z,
    };
  } catch {
    return null;
  }
}

/**
 * 从历史分圈现场拟合爬升能力，用于 prompt 上下文。
 * 与 prediction/pipeline 用同一套算法，保证两处口径一致。
 */
export function buildClimbContext() {
  const rows = db
    .select({
      distanceM: laps.distanceM,
      timeSec: laps.timeSec,
      avgHr: laps.avgHr,
      elevGain: laps.elevGain,
    })
    .from(laps)
    .innerJoin(activities, eq(laps.labelId, activities.labelId))
    .all();

  const samples = rows
    .filter((r) => r.distanceM > 300 && r.timeSec > 0 && (r.avgHr ?? 0) > 60)
    .map((r) => {
      const km = r.distanceM / 1000;
      return {
        paceSec: r.timeSec / km,
        hr: r.avgHr!,
        rate: climbRate(r.elevGain, km),
      };
    });
  if (samples.length < 30) return null;

  const model = fitClimbModel(samples);
  return climbAbility(samples, model);
}

export function buildSessionUserPrompt(ctx: SessionCtx): string {
  const { session, acts, detailById, fitnessRow, recoveryRow, userRow, loadRows, lapRows, maxHrById } = ctx;
  const parts: string[] = [];

  parts.push(`## 运动员档案`);
  if (userRow) {
    const age = userRow.birthday
      ? Math.floor((Date.now() - new Date(userRow.birthday).getTime()) / 31557600000)
      : null;
    parts.push(`- 昵称：${userRow.nickname ?? "—"}｜性别：${userRow.gender ?? "—"}｜年龄：${age ?? "—"} 岁`);
    parts.push(`- 身高：${userRow.heightCm ?? "—"} cm｜体重：${userRow.weightKg ?? "—"} kg`);
  }

  parts.push(`\n## 本场训练总览（${session.date}）`);
  parts.push(`- 记录条数：${session.activityCount} 条（${session.kind === "single" ? "单次记录" : "多条记录合并分析"}）`);
  parts.push(`- 类型判定：${session.classification}（依据：${session.classificationReason}）`);
  parts.push(
    `- 全场合计：${session.totals.distanceKm} km ／ ${fmtDur(session.totals.durationSec)} ／ 消耗 ${session.totals.calories} kcal`,
  );
  parts.push(
    `- 平均心率：${session.totals.avgHr ?? "—"} bpm｜训练负荷合计：${session.totals.trainingLoad}｜累计爬升 ${session.totals.elevGain} m`,
  );
  parts.push(`- **地形**：${describeTerrain({ elevGain: session.totals.elevGain, distanceKm: session.totals.distanceKm })}`);
  {
    // 本场任一条记录在高原，就提示 AI（混合场地时也算）
    const alts = acts.map((x) => getAltitude(x.labelId)).filter(Boolean);
    if (alts.length > 0) {
      const maxAlt = Math.max(...alts.map((x) => x!.altAvg));
      parts.push(`- **海拔**：最高 ${Math.round(maxAlt)} m｜${describeAltitude(alts[0]!)}`);
      const penalty = Math.abs(altitudeAdjustPace(0, maxAlt));
      if (penalty >= 0.5) {
        parts.push(
          `- ⚠ 本场含**高原训练**，海拔惩罚约 ${penalty.toFixed(1)} s/km。` +
            `高原配速不可与平原直接比较，先折算再判断进步或退步。`,
        );
      }
    }
  }
  if (session.activityCount > 1) {
    parts.push(`- 记录之间的最长间隔：${fmtDur(session.maxGapSec)}`);
  }

  if (session.sets.length > 0) {
    parts.push(`\n## 识别出的组结构（${session.sets.length} 组）`);
    for (const [i, s] of session.sets.entries()) {
      const rest = s.restSec != null ? `，组间休息约 ${fmtDur(s.restSec)}` : "";
      parts.push(
        `### 第 ${i + 1} 组：${s.distanceLabel} × ${s.reps} 组\n- 平均单组用时 ${fmtDur(s.avgDurationSec)}，平均配速 ${fmtPace(s.avgPaceSec)} /km，平均心率 ${s.avgHr ?? "—"} bpm${rest}`,
      );
    }
    const totalSets = session.sets.reduce((s, x) => s + x.reps, 0);
    const setDistance = session.sets.reduce((s, x) => s + x.reps * parseFloat(x.distanceLabel) * (x.distanceLabel.endsWith("km") ? 1 : 0.001), 0);
    parts.push(`\n组跑合计约 ${setDistance.toFixed(2)} km / ${totalSets} 组，占全场 ${Math.round((setDistance / session.totals.distanceKm) * 100)}%`);
  }

  parts.push(`\n## 逐条记录明细（共 ${acts.length} 条）`);
  parts.push(`| # | 开始 | 距离 | 用时 | 配速 | 地形 | 爬升 | 平均心率 | 峰值心率 | 步频 | 功率 | 负荷 | 训练重点 |`);
  parts.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  acts.forEach((a, i) => {
    const d = detailById.get(a.labelId);
    const t = a.startTs ? new Date(a.startTs * 1000).toTimeString().slice(0, 5) : "—";
    const rate = climbRate(d?.elevGain, a.distanceKm);
    parts.push(
      `| ${i + 1} | ${t} | ${a.distanceKm ?? "—"} | ${fmtDur(a.durationSec)} | ${fmtPace(a.avgPaceSec)} | ${TERRAIN_LABEL[classifyTerrain(rate)]} | ${d?.elevGain ?? "—"}m | ${a.avgHr ?? "—"} | ${maxHrById.get(a.labelId) ?? "—"} | ${d?.avgCadence ?? "—"} | ${d?.avgPower ?? "—"} | ${d?.trainingLoad ?? "—"} | ${d?.trainingFocus ?? "—"} |`,
    );
  });

  // 逐段明细 —— 没有这段，AI 只能拿到全场均值，会把「后 5km 掉速」这种
  // 分段现象一律误判成累积疲劳（实测过：AI 判"后半程掉速"，
  // 而实际最后几公里是全程最快的，从没掉过速）。
  // 段数实测最多几十段，全量带过去不会撑爆上下文，所以不截断也不采样。
  if (lapRows.length > 0) {
    parts.push(`\n## 逐段明细（共 ${lapRows.length} 段）`);
    parts.push(`| 段 | 累计km | 用时 | 配速/km | 平均心率 | 峰值心率 | 步频 | 爬升 | 下降 | 记录 |`);
    parts.push(`|---|---|---|---|---|---|---|---|---|---|`);
    let cumM = 0;
    lapRows.forEach((l, i) => {
      cumM += l.distanceM ?? 0;
      // 单条记录有多段时标出记录序号，否则多段训练里分不清组归属
      const actIdx = acts.findIndex((a) => a.labelId === l.labelId) + 1;
      parts.push(
        `| ${i + 1} | ${(cumM / 1000).toFixed(2)} | ${fmtDur(l.timeSec)} | ${fmtPace(l.avgPaceSec)} | ${l.avgHr || "—"} | ${l.maxHr || "—"} | ${l.avgCadence || "—"} | ${Math.round(l.elevGain ?? 0)} | ${Math.round(l.totalDescent ?? 0)} | ${actIdx > 0 ? `#${actIdx}` : "—"} |`,
      );
    });
    parts.push("\n> 上表是逐段原始值。判断「哪一段掉速/加速」「掉速时心率升了还是没升」必须用它，");
    parts.push("> 不要用全场平均配速或平均心率代替——均值会把这些现象完全抹平。");
    // 起伏场最容易误判的就是「某段特别慢」。爬升列就在表里，必须先用它解释掉速。
    if (lapRows.some((l) => (l.elevGain ?? 0) >= 20)) {
      parts.push(
        "> ⚠ 本表**逐段爬升**已给出。某段配速慢时，先看该段爬升：爬升大的段配速天然更慢，",
        "> 那是地形不是退步。判断体能状态请用心率，不要用跨地形的配速绝对值。",
      );
    }
  }

  if (fitnessRow) {
    parts.push(`\n## 当前体能基线`);
    parts.push(`- VO₂max：${fitnessRow.vo2max ?? "—"}｜跑步等级：${fitnessRow.runningLevel ?? "—"}`);
    parts.push(`- 阈值配速：${fmtPace(fitnessRow.thresholdPaceSec)} /km`);
    parts.push(
      `- 成绩预测：5K ${fmtDur(fitnessRow.pred5kSec)}｜10K ${fmtDur(fitnessRow.pred10kSec)}｜半马 ${fmtDur(fitnessRow.predHalfSec)}｜全马 ${fmtDur(fitnessRow.predMarathonSec)}`,
    );
  }

  // 爬升能力基线：让 AI 知道"爬坡慢"是这个人的固有短板而非当次状态问题
  try {
    const climbCtx = buildClimbContext();
    if (climbCtx) {
      parts.push(`\n## 爬升能力基线`);
      parts.push(`- ${climbCtx.note}`);
      parts.push(
        `- 爬升代价系数 ${climbCtx.model.costSecPerRate.toFixed(2)} s/(m/km)，` +
          `即 11 m/km 的路段配速约比平路慢 ${(climbCtx.model.costSecPerRate * 11).toFixed(0)} s/km`,
      );
    }
  } catch {
    // 拟合失败不该拖垮整个分析，缺数据就当没有这一段
  }

  if (loadRows.length > 0) {
    parts.push(`\n## 训练前 7 天负荷`);
    for (const l of loadRows) {
      parts.push(`- ${l.date}：短期 ${l.shortLoad ?? "—"}｜长期 ${l.longLoad ?? "—"}｜负荷比 ${l.ratio ?? "—"}｜${l.comment ?? ""}`);
    }
  }

  if (recoveryRow) {
    parts.push(`\n## 训练当日恢复状态：${recoveryRow.recoveryPct ?? "—"}%（${recoveryRow.level ?? "—"}）`);
  }

  {
    const z = hrZonePrompt(lapRows, userRow ? ageFromBirthday(userRow.birthday ?? null) : null);
    if (z) parts.push(`\n${z.text}`);
  }

  // 刻意不提供其它日期的训练数据（设计取舍）：
  // 场次分析只解读这一天。之前喂「近期训练回顾」会让 AI 写出跨场次的对比结论，
  // 混进当天复盘里，反而偏离「这场训练本身说明了什么」。
  return parts.join("\n");
}

export async function analyzeSession(
  sessionKey: string,
  focus: string | null,
): Promise<{ report: string; provider: string; model: string; sessionKey: string }> {
  const cfg = getAiConfig();
  if (!cfg) throw new AiError("尚未配置 AI 模型，请先在设置页填写");

  const ctx = buildSessionContext(sessionKey);
  if (!ctx) throw new AiError(`找不到训练次 ${sessionKey}`);

  const focusLine = focus ? `\n\n## 本次分析重点\n${focus}\n` : "";
  const report = await callModel(cfg, SESSION_SYSTEM_PROMPT, buildSessionUserPrompt(ctx) + focusLine);

  // 同一场 + 同一个关注点只保留最新一份。
  // focus 存空串而不是 null：SQLite 唯一索引不认为多个 NULL 重复，
  // 存 null 会让 uq_ai_focus 失效、旧报告也删不掉（delete 匹配的是空串）。
  db.delete(aiSessionReports)
    .where(and(eq(aiSessionReports.sessionKey, sessionKey), eq(aiSessionReports.focus, focus ?? "")))
    .run();
  db.insert(aiSessionReports)
    .values({
      sessionKey, date: ctx.session.date, activityCount: ctx.acts.length,
      provider: cfg.provider, model: cfg.model, focus: focus ?? "", report,
    })
    .run();

  return { report, provider: cfg.provider, model: cfg.model, sessionKey };
}
