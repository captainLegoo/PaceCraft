/**
 * 内置工作流步骤 —— 把已有的能力接进流水线。
 *
 * 每个 step 都是独立的：可以在配置里单独关掉、单独调参数，
 * 也可以从代码里摘掉而不影响其它能力（这就是"可插拔"）。
 */
import { db } from "../db/client.ts";
import { activities } from "../db/schema.ts";
import { registerStep, type Step } from "./engine.ts";
import { backfillAltitude, fitQuotaStatus } from "../auto-sync.ts";
import { buildReport } from "../prediction/pipeline.ts";
import { buildBriefing } from "../race-briefing.ts";
import { buildRaceProfile, getRace, listRaces } from "../race-service.ts";
import { getAiConfig, analyzeActivity } from "../ai/provider.ts";
import { eq } from "drizzle-orm";
import { fmtDuration, fmtPace } from "../format.ts";

// ---------------- 1. FIT 海拔 ----------------

registerStep({
  name: "fetch-altitude",
  label: "训练海拔",
  description: "为新增活动下载 FIT，提取实测海拔（受每日 50 个下载限额约束）",
  order: 10,
  critical: false,
  async run(ctx) {
    const quota = fitQuotaStatus();
    if (quota.exhausted) {
      return {
        status: "skipped",
        message: `今日 FIT 下载已达 ${quota.limit} 次上限（已缓存 ${quota.cached} 个），明天再补`,
      };
    }
    // 只处理本次新增的；没有新增就退回到"补最后几个没记录的"
    const maxCount = ctx.get("maxCount", 5);
    const r = await backfillAltitude(maxCount);
    if (r.added > 0) {
      return { status: "ok", message: `新增 ${r.added} 条海拔记录`, data: r };
    }
    if (r.skipped > 0) {
      return {
        status: "skipped",
        message: `有 ${r.skipped} 个活动待补，但 FIT 额度或数据不可用`,
      };
    }
    return { status: "ok", message: "所有活动已有海拔数据" };
  },
});

// ---------------- 2. 成绩预测 ----------------

registerStep({
  name: "compute-prediction",
  label: "成绩预测模型",
  description: "重算阈值配速、爬升能力与各距离成绩预测（纯计算，不调用外部接口）",
  order: 20,
  critical: false,
  async run(ctx) {
    const t = Date.now();
    const r = buildReport();
    const ms = Date.now() - t;
    const climb = r.climb.penaltySecPerKm;
    return {
      status: "ok",
      message:
        `阈值配速 ${fmtPace(r.threshold.paceSec)}/km` +
        `（R²=${r.threshold.r2.toFixed(2)}, ${ms}ms）｜爬升短板 +${climb?.toFixed(0) ?? "—"} s/km`,
      data: {
        thresholdPaceSec: r.threshold.paceSec,
        climbPenalty: climb,
        predictions: r.predictions.map((p) => ({ km: p.distanceKm, sec: p.seconds })),
      },
    };
  },
});

// ---------------- 3. 路线画像 + 备赛简报 ----------------

registerStep({
  name: "compute-race-briefing",
  label: "赛事路线与备赛",
  description: "重算目标赛事的路线爬升画像与备赛简报（预测、配速、备赛日历）",
  order: 30,
  critical: false,
  async run(ctx) {
    const races = listRaces();
    // 只处理最近的一场 —— 未来的赛事还没到，不需要每步都算
    const target = getRace(Number(ctx.get("raceId", races[races.length - 1]?.id ?? 0)));
    if (!target) {
      return { status: "skipped", message: "尚未设置目标赛事" };
    }

    // 路书来源要查 DEM，网络慢；GPX 来源是纯计算
    const profile = await buildRaceProfile(target);
    if (!profile.profile) {
      return {
        status: "skipped",
        message: `路线画像不可用：${profile.missingRoute ?? "缺路线数据"}`,
      };
    }

    const briefing = buildBriefing(profile, target.goalSec, target.date);
    const pred = briefing.prediction;
    const p = profile.profile;

    return {
      status: "ok",
      message:
        `${target.name}｜爬升 ${p.gainM}m（${p.gainPerKm} m/km）` +
        (pred ? `｜预测 ${fmtDuration(pred.bestSec)}（置信度 ${pred.confidence}）` : "") +
        (briefing.pacing ? `｜起步配速 ${fmtPace(briefing.pacing.segments[0].targetPaceSec)}/km` : ""),
      data: {
        raceId: target.id,
        gainPerKm: p.gainPerKm,
        predictedSec: pred?.bestSec ?? null,
        daysToRace: briefing.daysToRace,
      },
    };
  },
});

// ---------------- 4. AI 训练分析 ----------------

/**
 * AI 步骤 —— 未配置自动跳过。
 *
 * 这是"AI 可插拔"的核心：AI 不是工作流的硬依赖，
 * 没配 key 就跳过这一步，其它步骤照常跑完。
 */
registerStep({
  name: "ai-analyze",
  label: "AI 训练分析",
  description: "对最近一次训练生成 AI 教练分析（需要先在设置里配置模型）",
  order: 40,
  critical: false,

  async applicable(ctx) {
    // 工作流级别的总开关
    if (ctx.config.options?.allowAi === false) {
      return { ok: false, reason: "配置中已关闭 AI" };
    }
    if (!getAiConfig()) {
      return { ok: false, reason: "未配置 AI 模型，已跳过（不影响其它步骤）" };
    }
    return { ok: true };
  },

  async run(ctx) {
    // 找本次新增里最近的一次
    let target: string | null = null;
    if (ctx.labelIds.length > 0) {
      target = ctx.labelIds[0];
    } else {
      const last = db
        .select({ labelId: activities.labelId })
        .from(activities)
        .orderBy(activities.dateLabel)
        .all()
        .pop();
      target = last?.labelId ?? null;
    }
    if (!target) return { status: "skipped", message: "没有可分析的训练" };

    const label = ctx.get("label", null as string | null) ?? "用教练视角分析这次训练：达成什么、强度是否合理、下一步怎么练";
    const r = await analyzeActivity(target, label);
    return {
      status: "ok",
      message: `已生成 AI 分析（${r.provider}/${r.model}，${r.report.length} 字）`,
      data: { labelId: target, model: r.model },
    };
  },
});

// ---------------- 格式化 ----------------

