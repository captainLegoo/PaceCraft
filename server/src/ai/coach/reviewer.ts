import { db } from "../../db/client.ts";
import { aiCoachPlans, aiCoachWorkouts, aiCoachReviews, activities } from "../../db/schema.ts";
import { eq, and, gte, lte, asc, desc } from "drizzle-orm";
import { computeAthleteBaseline, type BaselineSnapshot } from "./baseline.ts";
import { getAiConfig, callModel } from "../provider.ts";
import { generateTwoWeekRollingPlan } from "./generator.ts";

/**
 * 自动比对打卡并完成周度闭环复盘与自适应调整
 */
export async function executeWeeklyReview(planId: number, weekIndex: number) {
  const plan = db.select().from(aiCoachPlans).where(eq(aiCoachPlans.id, planId)).get();
  if (!plan) throw new Error("找不到对应的训练计划");

  // 1. 提取该周内的所有已计划课表
  const workouts = db
    .select()
    .from(aiCoachWorkouts)
    .where(and(eq(aiCoachWorkouts.planId, planId), eq(aiCoachWorkouts.weekIndex, weekIndex)))
    .orderBy(asc(aiCoachWorkouts.date))
    .all();

  if (workouts.length === 0) throw new Error(`找不到第 ${weekIndex} 周的课表数据`);

  const startDateStr = workouts[0].date;
  const endDateStr = workouts[workouts.length - 1].date;

  // 2. 匹配真实的跑步记录 (activities 使用 dateLabel)
  const realActivities = db
    .select({
      labelId: activities.labelId,
      dateLabel: activities.dateLabel,
      distanceKm: activities.distanceKm,
      durationSec: activities.durationSec,
      avgPaceSec: activities.avgPaceSec,
      avgHr: activities.avgHr,
    })
    .from(activities)
    .where(and(gte(activities.dateLabel, startDateStr), lte(activities.dateLabel, endDateStr)))
    .all();

  let plannedVolumeKm = 0;
  let actualVolumeKm = 0;

  for (const w of workouts) {
    plannedVolumeKm += w.distanceKm;

    // 匹配同一天的跑步记录
    const dayActs = realActivities.filter((a) => a.dateLabel === w.date);
    if (dayActs.length > 0) {
      // 累加该日实际完成跑量
      const dayTotalDist = dayActs.reduce((s, a) => s + (a.distanceKm ?? 0), 0);
      const mainAct = dayActs[0];

      // 评估遵从度分数
      let score = 100;
      if (w.workoutType === "rest") {
        score = dayTotalDist > 3 ? 50 : 100; // 休息日偷跑扣分
      } else if (w.distanceKm > 0) {
        const ratio = dayTotalDist / w.distanceKm;
        if (ratio < 0.6) score = 40;
        else if (ratio < 0.85) score = 75;
        else if (ratio <= 1.25) score = 95;
        else score = 80; // 严重超量
      }

      actualVolumeKm += dayTotalDist;

      const actualLabelIdVal = dayActs.length > 1
        ? JSON.stringify(dayActs.map((a) => ({ labelId: a.labelId, distanceKm: a.distanceKm, avgPaceSec: a.avgPaceSec, avgHr: a.avgHr })))
        : mainAct.labelId;

      db.update(aiCoachWorkouts)
        .set({
          actualLabelId: actualLabelIdVal,
          actualDistanceKm: Math.round(dayTotalDist * 10) / 10,
          actualAvgPaceSec: mainAct.avgPaceSec,
          actualAvgHr: mainAct.avgHr,
          complianceScore: score,
          status: score >= 60 ? "completed" : "missed",
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(aiCoachWorkouts.id, w.id))
        .run();
    } else {
      if (w.workoutType === "rest") {
        db.update(aiCoachWorkouts)
          .set({ status: "completed", complianceScore: 100 })
          .where(eq(aiCoachWorkouts.id, w.id))
          .run();
      } else {
        db.update(aiCoachWorkouts)
          .set({ status: "missed", complianceScore: 0 })
          .where(eq(aiCoachWorkouts.id, w.id))
          .run();
      }
    }
  }

  plannedVolumeKm = Math.round(plannedVolumeKm * 10) / 10;
  actualVolumeKm = Math.round(actualVolumeKm * 10) / 10;
  const completionRatePct = plannedVolumeKm > 0
    ? Math.min(150, Math.round((actualVolumeKm / plannedVolumeKm) * 100))
    : 100;

  // 3. 重新提取最新体能与脱偶诊断
  const baseline = computeAthleteBaseline(endDateStr);

  // 4. 自适应决策树
  let adjustmentDecision: "advance" | "hold" | "deload" | "prune" = "advance";
  let fatigueAssessment: "optimal" | "overreaching" | "overtrained" | "undertrained" = "optimal";

  if (baseline.acwr > 1.45 || baseline.tsb < -28) {
    adjustmentDecision = "deload";
    fatigueAssessment = "overtrained";
  } else if (baseline.cardiacDecoupling.status === "drifted" && completionRatePct >= 85) {
    // 跑量完成了，但心率漂移过大 -> 身体在代偿硬撑
    adjustmentDecision = "hold";
    fatigueAssessment = "overreaching";
  } else if (completionRatePct < 65) {
    // 严重欠练/生活干扰
    adjustmentDecision = "prune";
    fatigueAssessment = "undertrained";
  } else {
    adjustmentDecision = "advance";
    fatigueAssessment = "optimal";
  }

  // 5. 撰写周报文案
  let coachMarkdown = `### 🏃 第 ${weekIndex} 周训练复盘报告\n\n`;
  coachMarkdown += `* **跑量执行**：计划 **${plannedVolumeKm} km**，实际完成 **${actualVolumeKm} km**（完成率 **${completionRatePct}%**）\n`;
  coachMarkdown += `* **生理负荷状态**：长期体能 (CTL) **${baseline.ctl}**，疲劳度 (ATL) **${baseline.atl}**，ACWR **${baseline.acwr}**\n`;
  coachMarkdown += `* **心血管适应**：${baseline.cardiacDecoupling.summary}\n\n`;

  if (adjustmentDecision === "deload") {
    coachMarkdown += `> ⚠️ **教练紧急决策：触发疲劳保护减负周**\n> 监测到您近期的急性训练负荷与疲劳指数偏高（ACWR > 1.4），下周将自动转入主动减负吸收周（削减 30% 跑量，取消高强度红区无氧间歇），让结缔组织与中枢神经彻底超补偿！\n`;
  } else if (adjustmentDecision === "hold") {
    coachMarkdown += `> 💡 **教练决策：巩固基础，暂缓提速**\n> 虽然跑量达标，但有氧长距离出现心率漂移脱偶合，说明身体在微弱代偿硬撑。下周将维持当前负荷并放宽轻松跑心率上限，打牢有氧底子，切勿急躁。\n`;
  } else if (adjustmentDecision === "prune") {
    coachMarkdown += `> 🛡️ **教练决策：欠练剪枝，禁止补课**\n> 过去一周受工作或生活影响缺席了部分课表。请千万不要在下周强行补跑！教练已为您智能平滑重置下周跑量起点，轻装上阵即可。\n`;
  } else {
    coachMarkdown += `> ✅ **教练决策：状态极佳，按部就班推进**\n> 负荷吸收良好，有氧效率优异！下周课表将按宏观周期规划正常递增进入新阶段。\n`;
  }

  // 尝试调用 AI 润色周总结
  const aiCfg = getAiConfig();
  if (aiCfg) {
    try {
      const prompt = `你是一位世界顶级耐力运动科学家与金牌跑步教练。
请根据以下真实复盘数据，为跑者生成一段富有洞察力、温暖鼓励且具有科学前瞻性的 Markdown 周报点评：
数据：
- 周次：第 ${weekIndex} 周
- 计划 vs 实际跑量：${plannedVolumeKm} km vs ${actualVolumeKm} km (完成率 ${completionRatePct}%)
- 负荷指标：CTL ${baseline.ctl}, ATL ${baseline.atl}, ACWR ${baseline.acwr}
- 脱偶合状态：${baseline.cardiacDecoupling.summary}
- 教练决策：${adjustmentDecision} (${fatigueAssessment})

请直接输出 Markdown 格式的点评，不要输出冗余的前缀问候。`;

      const aiText = await callModel(aiCfg, "你是一位顶尖耐力运动教练与运动生理学专家", prompt);
      if (aiText && aiText.length > 50) {
        coachMarkdown = aiText;
      }
    } catch {}
  }

  // 6. 存储 ai_coach_reviews
  db.insert(aiCoachReviews)
    .values({
      planId,
      weekIndex,
      startDate: startDateStr,
      endDate: endDateStr,
      plannedVolumeKm,
      actualVolumeKm,
      completionRatePct,
      acwr: baseline.acwr,
      cardiacDecouplingStatus: baseline.cardiacDecoupling.status === "healthy" ? "normal" : baseline.cardiacDecoupling.status === "drifted" ? "severe_drift" : "insufficient_data",
      fatigueAssessment,
      adjustmentDecision,
      reviewMarkdown: coachMarkdown,
    })
    .run();

  // 7. 更新 plan 当前周次，并重新触发滚动课表生成（微调下一周并生成新的后续周）
  const nextWeekIndex = weekIndex + 1;
  db.update(aiCoachPlans)
    .set({
      currentWeek: nextWeekIndex,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(aiCoachPlans.id, planId))
    .run();

  // 滚动生成下阶段课表
  const nextStartDate = new Date(new Date(endDateStr).getTime() + 86400 * 1000).toISOString().slice(0, 10);
  await generateTwoWeekRollingPlan(plan.profileId, nextStartDate);

  return {
    weekIndex,
    plannedVolumeKm,
    actualVolumeKm,
    completionRatePct,
    decision: adjustmentDecision,
    reviewMarkdown: coachMarkdown,
  };
}
