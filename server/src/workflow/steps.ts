/**
 * 内置工作流步骤 —— 把已有的能力接进流水线。
 *
 * 每个 step 都是独立的：可以在配置里单独关掉、单独调参数，
 * 也可以从代码里摘掉而不影响其它能力（这就是"可插拔"）。
 */
import { db } from "../db/client.ts";
import { activities, laps, trainingLoad } from "../db/schema.ts";
import { registerStep, type Step } from "./engine.ts";
import { backfillAltitude, fitQuotaStatus } from "../auto-sync.ts";
import { buildReport } from "../prediction/pipeline.ts";
import { buildBriefing } from "../race-briefing.ts";
import { buildRaceProfile, getRace, listRaces } from "../race-service.ts";
import { buildSessions, sessionLaps } from "../analytics.ts";
import { desc, eq } from "drizzle-orm";
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

// ---------------- 3. 急慢性负荷比（ACWR）与伤病风险预警 ----------------

registerStep({
  name: "check-acwr-risk",
  label: "急慢性负荷比 (ACWR)",
  description: "基于 Gabbett 负荷模型评估短期疲劳与长期体能比值，预警负荷激增与伤病风险",
  order: 25,
  critical: false,
  async run() {
    const loads = db.select().from(trainingLoad).orderBy(desc(trainingLoad.date)).limit(14).all();
    if (!loads.length || loads[0].ratio == null) {
      return {
        status: "skipped",
        message: "暂无训练负荷评估数据，请先在「设置」页同步",
      };
    }

    const latest = loads[0];
    const ratio = Number(latest.ratio);
    const shortLoad = latest.shortLoad ?? "—";
    const longLoad = latest.longLoad ?? "—";

    let zone: "danger" | "caution" | "sweet" | "under";
    let message = "";

    if (ratio >= 1.5) {
      zone = "danger";
      message = `⚠ 负荷激增（ACWR ${ratio.toFixed(2)}，危险区 >1.50）：短期负荷 ${shortLoad} 显著高于长期基线 ${longLoad}，软组织伤病风险成倍增加，强烈建议安排主动休息或排酸慢跑`;
    } else if (ratio >= 1.3) {
      zone = "caution";
      message = `⚡ 负荷较快累积（ACWR ${ratio.toFixed(2)}，警示区 1.30–1.50）：短期负荷 ${shortLoad} / 长期 ${longLoad}，疲劳持续蓄积，建议关注肌肉反馈，避免连续冲击高强度`;
    } else if (ratio >= 0.8) {
      zone = "sweet";
      message = `✓ ACWR ${ratio.toFixed(2)}（最佳甜点区 0.80–1.30）：短期负荷 ${shortLoad} / 长期 ${longLoad}，体能稳步累积，伤病发生率处于最低区间`;
    } else {
      zone = "under";
      message = `○ ACWR ${ratio.toFixed(2)}（减量恢复区 <0.80）：短期负荷 ${shortLoad} 低于长期基线 ${longLoad}，疲劳充分消退，适宜赛前减量或恢复`;
    }

    return {
      status: "ok",
      message,
      data: {
        date: latest.date,
        ratio,
        shortLoad: latest.shortLoad,
        longLoad: latest.longLoad,
        zone,
        comment: latest.comment,
      },
    };
  },
});

// ---------------- 4. 路线画像 + 备赛简报 ----------------

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

// ---------------- 5. 有氧脱钩率（心率漂移）分析 ----------------

registerStep({
  name: "compute-aerobic-decoupling",
  label: "有氧脱钩率分析",
  description: "基于 Joe Friel 有氧脱钩模型，检测长距离稳态跑前后半程效率因子衰减（<5% 优秀）",
  order: 35,
  critical: false,
  async run(ctx) {
    const sessions = buildSessions();
    if (!sessions.length) {
      return { status: "skipped", message: "尚未找到任何训练记录" };
    }

    // 优先取本次同步涉及的 session，否则取最近一次训练场次
    let targetSession = null;
    if (ctx.labelIds.length > 0) {
      targetSession = sessions.find((s) => s.labelIds.some((id) => ctx.labelIds.includes(id)));
    }
    if (!targetSession) {
      targetSession = sessions[0];
    }
    if (!targetSession) {
      return { status: "skipped", message: "未找到有效的训练场次" };
    }

    const { distanceKm, durationSec } = targetSession.totals;
    const isInterval = targetSession.classification === "间歇训练";

    // 校验前置条件：稳态、足够长（>= 30min 或 >= 5km）
    if (isInterval) {
      return {
        status: "skipped",
        message: `最近训练（${targetSession.date}，间歇跑）快慢交替，心率剧烈波动，不适用有氧脱钩评估`,
      };
    }

    if (durationSec < 1800 || distanceKm < 5.0) {
      return {
        status: "skipped",
        message: `最近训练（${targetSession.date}，${distanceKm.toFixed(1)}km / ${Math.round(durationSec / 60)}分）时长较短，脱钩率需在持续稳态跑（建议 ≥5km）中评估`,
      };
    }

    const lapRows = sessionLaps(targetSession.labelIds);
    // 过滤出有效的心率与距离分圈
    const validLaps = lapRows.filter((l) => l.avgHr && l.avgHr > 40 && l.timeSec > 0 && l.distanceM > 0);
    if (validLaps.length < 4) {
      return {
        status: "skipped",
        message: `最近训练分圈数据不足或心率缺失（仅 ${validLaps.length} 圈有效），无法进行前后半分段`,
      };
    }

    // 爬升率过滤：爬升率 > 18m/km 说明是山地越野，坡度对配速影响过大
    const totalGain = validLaps.reduce((s, l) => s + (l.elevGain ?? 0), 0);
    const gainPerKm = distanceKm > 0 ? totalGain / distanceKm : 0;
    if (gainPerKm > 18) {
      return {
        status: "skipped",
        message: `最近训练爬升较大（${Math.round(totalGain)}m，${gainPerKm.toFixed(1)} m/km），坡度对配速心率比扰动过大，不适用平路有氧脱钩分析`,
      };
    }

    // 按时间等分为前后两半
    const totalTime = validLaps.reduce((s, l) => s + l.timeSec, 0);
    const halfTime = totalTime / 2;

    let time1 = 0, dist1 = 0, hrTime1 = 0;
    let time2 = 0, dist2 = 0, hrTime2 = 0;
    let accumTime = 0;

    for (const lap of validLaps) {
      const lapStart = accumTime;
      const lapEnd = accumTime + lap.timeSec;
      accumTime = lapEnd;

      if (lapEnd <= halfTime) {
        time1 += lap.timeSec;
        dist1 += lap.distanceM;
        hrTime1 += (lap.avgHr ?? 0) * lap.timeSec;
      } else if (lapStart >= halfTime) {
        time2 += lap.timeSec;
        dist2 += lap.distanceM;
        hrTime2 += (lap.avgHr ?? 0) * lap.timeSec;
      } else {
        const t1 = halfTime - lapStart;
        const t2 = lapEnd - halfTime;
        const f1 = t1 / lap.timeSec;
        const f2 = t2 / lap.timeSec;

        time1 += t1;
        dist1 += lap.distanceM * f1;
        hrTime1 += (lap.avgHr ?? 0) * t1;

        time2 += t2;
        dist2 += lap.distanceM * f2;
        hrTime2 += (lap.avgHr ?? 0) * t2;
      }
    }

    if (time1 <= 0 || time2 <= 0 || dist1 <= 0 || dist2 <= 0) {
      return { status: "skipped", message: "分段耗时异常，未能计算前后半效率因子" };
    }

    const speed1 = dist1 / time1;
    const avgHr1 = hrTime1 / time1;
    const ef1 = speed1 / avgHr1;
    const paceSec1 = time1 / (dist1 / 1000);

    const speed2 = dist2 / time2;
    const avgHr2 = hrTime2 / time2;
    const ef2 = speed2 / avgHr2;
    const paceSec2 = time2 / (dist2 / 1000);

    const decouplingPct = Number((((ef1 - ef2) / ef1) * 100).toFixed(1));

    let verdict = "";
    if (decouplingPct < -3.0) {
      verdict = `负脱钩 ${decouplingPct}%（越跑越顺）：前半程 ${fmtPace(paceSec1)} / ${Math.round(avgHr1)}bpm，后半程 ${fmtPace(paceSec2)} / ${Math.round(avgHr2)}bpm，后程效率反超前半程`;
    } else if (decouplingPct <= 5.0) {
      verdict = `有氧脱钩率 ${decouplingPct}%（<5% 优秀）：前半程 ${fmtPace(paceSec1)} / ${Math.round(avgHr1)}bpm，后半程 ${fmtPace(paceSec2)} / ${Math.round(avgHr2)}bpm，心血管与有氧耐力储备扎实`;
    } else if (decouplingPct <= 8.0) {
      verdict = `有氧脱钩率 ${decouplingPct}%（5%–8% 轻度漂移）：前半程 ${fmtPace(paceSec1)} / ${Math.round(avgHr1)}bpm，后半程 ${fmtPace(paceSec2)} / ${Math.round(avgHr2)}bpm，后程出现微弱心血管疲劳/温升漂移`;
    } else {
      verdict = `有氧脱钩率 ${decouplingPct}%（>8% 显著漂移）：前半程 ${fmtPace(paceSec1)} / ${Math.round(avgHr1)}bpm，后半程 ${fmtPace(paceSec2)} / ${Math.round(avgHr2)}bpm，后程效率明显衰减，提示有氧耐力储备或补水不足`;
    }

    return {
      status: "ok",
      message: `${targetSession.date}（${distanceKm.toFixed(1)}km）｜${verdict}`,
      data: {
        sessionKey: targetSession.key,
        date: targetSession.date,
        distanceKm,
        decouplingPct,
        half1: { paceSec: paceSec1, avgHr: Math.round(avgHr1), ef: ef1 },
        half2: { paceSec: paceSec2, avgHr: Math.round(avgHr2), ef: ef2 },
      },
    };
  },
});


// ---------------- 格式化 ----------------

