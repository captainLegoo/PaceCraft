import type { BaselineSnapshot } from "./baseline.ts";

export type TrainingPhase = "base" | "build" | "peak" | "taper" | "maintenance";

export interface MacroWeekOutline {
  weekIndex: number;
  startDate: string;
  endDate: string;
  phase: TrainingPhase;
  targetVolumeKm: number;
  isDeload: boolean;
  longRunTargetKm: number;
  focusTheme: string;
}

export interface DayTemplateSlot {
  dayOfWeek: number; // 0 = 周日, 1-6 = 周一至周六
  workoutType: "easy" | "long" | "tempo" | "interval" | "repetition" | "fartlek" | "recovery" | "strength" | "rest";
  isKeyWorkout: boolean; // 是否是核心关键课
  targetDistanceKm: number;
  targetDurationMin: number;
  includeStrength: boolean;
  suggestedTitle: string;
}

/**
 * 产生宏周期周度包络线大纲 (Macro Outline)
 */
export function generateMacroOutline(
  startDateStr: string,
  targetRaceDateStr: string | null | undefined,
  baseline: BaselineSnapshot,
  daysPerWeek: number
): MacroWeekOutline[] {
  const start = new Date(startDateStr);
  const outlines: MacroWeekOutline[] = [];

  // 计算总周数
  let totalWeeks = 12; // 默认无比赛时的常规进阶大周期（12周）
  if (targetRaceDateStr) {
    const raceDate = new Date(targetRaceDateStr);
    const diffDays = Math.max(7, Math.floor((raceDate.getTime() - start.getTime()) / (86400 * 1000)));
    totalWeeks = Math.max(1, Math.min(26, Math.ceil(diffDays / 7)));
  }

  // 基线周跑量 (取近6周均量与最低安全量的上限)
  const baseVolume = Math.max(20, Math.round(baseline.weeklyMileageAvgKm > 10 ? baseline.weeklyMileageAvgKm : 25));

  for (let w = 1; w <= totalWeeks; w++) {
    const weekStart = new Date(start.getTime() + (w - 1) * 7 * 86400 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400 * 1000);
    const sDate = weekStart.toISOString().slice(0, 10);
    const eDate = weekEnd.toISOString().slice(0, 10);

    let phase: TrainingPhase = "maintenance";
    let isDeload = false;
    let volume = baseVolume;
    let longRun = Math.max(8, Math.round(baseVolume * 0.32));
    let theme = "有氧基础稳固";

    if (!targetRaceDateStr) {
      // 无比赛：常态 3:1 阶梯进阶波 (Maintenance & Progression)
      phase = "maintenance";
      const cycleStep = ((w - 1) % 4) + 1; // 1, 2, 3, 4
      if (cycleStep === 4) {
        isDeload = true;
        volume = Math.round(baseVolume * 0.75); // 减负周砍 25%
        theme = "主动减负吸收周 (Deload & Adapt)";
      } else {
        const factor = 1 + (cycleStep - 1) * 0.08;
        volume = Math.round(baseVolume * factor);
        theme = `持续进阶周第 ${cycleStep} 步 (容量递增)`;
      }
      longRun = Math.round(volume * 0.3);
    } else {
      // 有明确比赛倒计时：分阶段结构化划分
      const weeksToRace = totalWeeks - w;

      if (totalWeeks <= 2) {
        // 临赛突击情况：直接进入 Taper
        phase = "taper";
        isDeload = true;
        volume = Math.round(baseVolume * (weeksToRace === 0 ? 0.45 : 0.65));
        theme = "临战神经激活与体能超量恢复 (Taper)";
        longRun = Math.round(volume * 0.35);
      } else {
        // 标准周期切分 (Taper: 2-3周, Peak: 3-4周, Build: 3-5周, 其余为 Base)
        const taperWeeks = totalWeeks >= 8 ? 2 : 1;
        const peakWeeks = totalWeeks >= 10 ? 3 : 2;
        const buildWeeks = Math.max(2, Math.floor((totalWeeks - taperWeeks - peakWeeks) * 0.6));

        if (weeksToRace < taperWeeks) {
          phase = "taper";
          isDeload = true;
          volume = Math.round(baseVolume * 0.6 * (weeksToRace === 0 ? 0.8 : 1.0));
          theme = "赛前减量充碳与神经兴奋 (Taper)";
          longRun = Math.round(volume * 0.3);
        } else if (weeksToRace < taperWeeks + peakWeeks) {
          phase = "peak";
          // 专项高峰期：周跑量见顶，长距离向比赛配速收敛
          volume = Math.round(baseVolume * 1.25);
          theme = "比赛专项突破与特定耐力锻造 (Specific Endurance)";
          longRun = Math.min(32, Math.round(volume * 0.35));
        } else if (weeksToRace < taperWeeks + peakWeeks + buildWeeks) {
          phase = "build";
          // 阶梯攀升
          const step = ((w - 1) % 4) + 1;
          if (step === 4) {
            isDeload = true;
            volume = Math.round(baseVolume * 0.85);
            theme = "进阶吸收减负周 (Build Deload)";
          } else {
            volume = Math.round(baseVolume * (1.05 + (step - 1) * 0.08));
            theme = "乳酸门槛抗乳酸构建 (Threshold & VO2max)";
          }
          longRun = Math.round(volume * 0.32);
        } else {
          phase = "base";
          const step = ((w - 1) % 4) + 1;
          if (step === 4) {
            isDeload = true;
            volume = Math.round(baseVolume * 0.8);
            theme = "基础打底吸收减负周 (Base Deload)";
          } else {
            volume = Math.round(baseVolume * (0.95 + (step - 1) * 0.06));
            theme = "有氧毛细血管网扩展与脂肪供能 (Aerobic Foundation)";
          }
          longRun = Math.round(volume * 0.3);
        }
      }
    }

    outlines.push({
      weekIndex: w,
      startDate: sDate,
      endDate: eDate,
      phase,
      targetVolumeKm: volume,
      isDeload,
      longRunTargetKm: longRun,
      focusTheme: theme,
    });
  }

  return outlines;
}

/**
 * 微周期单周结构模板生成器 (根据天数分配 7 天的槽位)
 */
export function buildWeeklySlots(
  weekOutline: MacroWeekOutline,
  preferredDays: number[], // 如 [2, 4, 6, 0]
  longRunDay: number, // 如 0 (周日)
  includeStrength: boolean
): DayTemplateSlot[] {
  const slots: DayTemplateSlot[] = [];
  const targetKm = weekOutline.targetVolumeKm;
  const longKm = weekOutline.longRunTargetKm;
  const remainingKm = Math.max(0, targetKm - longKm);

  // 区分跑日与休跑日
  const runDaysSet = new Set(preferredDays);
  // 去除长距离日，计算剩余跑步天数
  const otherRunDays = preferredDays.filter((d) => d !== longRunDay);
  const otherCount = otherRunDays.length;

  for (let d = 0; d < 7; d++) {
    // 默认作为休息日
    if (!runDaysSet.has(d)) {
      slots.push({
        dayOfWeek: d,
        workoutType: "rest",
        isKeyWorkout: false,
        targetDistanceKm: 0,
        targetDurationMin: 0,
        includeStrength: false,
        suggestedTitle: "彻底休息与肌肉修复 (Rest Day)",
      });
      continue;
    }

    // 长距离日
    if (d === longRunDay) {
      slots.push({
        dayOfWeek: d,
        workoutType: "long",
        isKeyWorkout: true,
        targetDistanceKm: longKm,
        targetDurationMin: Math.round(longKm * 6), // 预估约 6分/km
        includeStrength: false,
        suggestedTitle: weekOutline.phase === "peak" ? "比赛专项长距离模拟跑" : `${d === 0 || d === 6 ? "周末" : ""}渐进长距离耐力跑 (LSD)`,
      });
      continue;
    }

    // 其它训练日根据阶段分配 (间歇/门槛/轻松/法特莱克)
    const runIdx = otherRunDays.indexOf(d);
    const avgDist = otherCount > 0 ? Math.round((remainingKm / otherCount) * 10) / 10 : 8;

    if (runIdx === 0 && !weekOutline.isDeload) {
      // 安排周内第一个关键课 (速度/门槛/法特莱克)
      if (weekOutline.phase === "base") {
        slots.push({
          dayOfWeek: d,
          workoutType: "fartlek",
          isKeyWorkout: true,
          targetDistanceKm: avgDist,
          targetDurationMin: Math.round(avgDist * 5.8),
          includeStrength: includeStrength,
          suggestedTitle: "趣味法特莱克变速跑 (Fartlek Play)",
        });
      } else if (weekOutline.phase === "build") {
        slots.push({
          dayOfWeek: d,
          workoutType: "interval",
          isKeyWorkout: true,
          targetDistanceKm: avgDist,
          targetDurationMin: Math.round(avgDist * 5.5),
          includeStrength: includeStrength,
          suggestedTitle: "最大摄氧量 (VO2max) 巡航间歇",
        });
      } else {
        slots.push({
          dayOfWeek: d,
          workoutType: "tempo",
          isKeyWorkout: true,
          targetDistanceKm: avgDist,
          targetDurationMin: Math.round(avgDist * 5.4),
          includeStrength: includeStrength,
          suggestedTitle: "乳酸门槛节奏跑 (Threshold Tempo)",
        });
      }
    } else if (runIdx === 1 && otherCount >= 3 && !weekOutline.isDeload && weekOutline.phase !== "base") {
      // 跑 4~5 天时的第二个强度/节奏日
      slots.push({
        dayOfWeek: d,
        workoutType: "tempo",
        isKeyWorkout: false,
        targetDistanceKm: avgDist,
        targetDurationMin: Math.round(avgDist * 5.8),
        includeStrength: false,
        suggestedTitle: "马拉松稳态配速跑 (Steady State)",
      });
    } else {
      // 基础轻松跑 / 恢复跑
      slots.push({
        dayOfWeek: d,
        workoutType: "easy",
        isKeyWorkout: false,
        targetDistanceKm: avgDist,
        targetDurationMin: Math.round(avgDist * 6.2),
        includeStrength: includeStrength && runIdx === otherRunDays.length - 1,
        suggestedTitle: "低心率纯有氧基础跑 (Zone 2 Easy Run)",
      });
    }
  }

  // 按周一(1)至周日(0)排序，或者按 0-6 排序
  return slots;
}
