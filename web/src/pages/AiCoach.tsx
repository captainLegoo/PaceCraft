import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  api,
  type CoachProfile,
  type CoachBaseline,
  type CoachPlan,
  type CoachWorkout,
  type CoachReview,
} from "../api";
import {
  IconCalendar,
  IconPulse,
  IconTarget,
  IconTrophy,
  IconShoe,
  IconRefresh,
  IconGear,
  IconHeart,
  IconGauge,
  IconRun,
  IconChevron,
} from "../icons";
import { fmtPace, fmtDur, Markdown } from "../charts";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export interface StrengthExercise {
  name: string;
  sets: string;
  target: string;
}

export interface StrengthRoutine {
  id: "core_stability" | "kinetic_chain" | "ankle_plyo" | "fascia_recovery";
  name: string;
  durationMin: number;
  focus: string;
  targetRuns: string;
  exercises: StrengthExercise[];
}

export const RUNNER_STRENGTH_ROUTINES: Record<string, StrengthRoutine> = {
  core_stability: {
    id: "core_stability",
    name: "跑后抗旋转骨盆核心稳定课",
    durationMin: 15,
    targetRuns: "轻松跑 (Easy)、排酸恢复跑后",
    focus: "强化深层腹横肌与骨盆中立位，防止长跑后半程骨盆前倾与躯干侧倾塌陷",
    exercises: [
      { name: "死虫式抗伸展核心 (Dead Bug)", sets: "3 组 × 10 次/侧", target: "对角线手脚缓慢下落，下背部紧贴地面不弓起" },
      { name: "侧支撑静态挺身 (Side Plank)", sets: "3 组 × 30 秒/侧", target: "肘关节在肩正下方，骨盆上顶使躯干保持直线" },
      { name: "对角线鸟狗式 (Bird-Dog)", sets: "3 组 × 10 次/侧", target: "腰椎维持中立位不晃动，感受臀肌与多裂肌收缩" },
      { name: "平板支撑交替摸肩 (Shoulder Taps)", sets: "3 组 × 16 次", target: "两脚微开，核心收紧抵抗躯干左右旋转" },
    ],
  },
  kinetic_chain: {
    id: "kinetic_chain",
    name: "下肢动力链与跟腱离心抗阻课",
    durationMin: 15,
    targetRuns: "马拉松配速稳态跑 (M)、乳酸门槛节奏跑 (T) 后",
    focus: "强化跟腱弹性储备与单腿支撑稳定性，预防跟腱炎、足底筋膜炎与ITBS",
    exercises: [
      { name: "单腿离心慢降提踵 (Eccentric Calf)", sets: "3 组 × 15 次/侧", target: "台阶边缘站立，1秒提踵顶峰，3秒慢速离心下落" },
      { name: "单腿臀桥 (Single-Leg Glute Bridge)", sets: "3 组 × 12 次/侧", target: "脚跟踩实发力，顶峰夹臀停顿2秒，激活后蹬链" },
      { name: "侧卧蚌壳式 (Clamshell)", sets: "3 组 × 15 次/侧", target: "骨盆垂直地面不后翻，精准激活臀中肌稳定膝关节" },
      { name: "保加利亚剪蹲 (Bulgarian Split Squat)", sets: "3 组 × 8-10 次/侧", target: "后脚搭椅，前膝不超过脚尖，垂直下沉强化股四头肌与臀肌" },
    ],
  },
  ankle_plyo: {
    id: "ankle_plyo",
    name: "足踝刚度与弹跳神经激活课",
    durationMin: 12,
    targetRuns: "最大摄氧量间歇 (Interval)、法特莱克变速跑后",
    focus: "提高足踝刚度 (Ankle Stiffness) 与跑步经济性，缩短触地时间",
    exercises: [
      { name: "原地踝关节弹跳 (Pogo Jumps)", sets: "3 组 × 30 次", target: "膝关节微屈固定，仅用踝关节弹性快速跳起，触地即离" },
      { name: "弹力带侧向怪兽步 (Monster Walk)", sets: "3 组 × 15 步/来回", target: "屈膝半蹲微收腹，双腿对抗弹力带抗阻横移" },
      { name: "单腿罗马尼亚硬拉 (Single-Leg RDL)", sets: "3 组 × 10 次/侧", target: "单腿微屈，髋部后推感受腘绳肌牵拉，维持足弓抓地平衡" },
    ],
  },
  fascia_recovery: {
    id: "fascia_recovery",
    name: "长跑后深层肌筋膜放松与拉伸",
    durationMin: 12,
    targetRuns: "周末/指定日渐进长距离耐力跑 (LSD) 后",
    focus: "长距离后避免高强度抗阻，以髂胫束、小腿腓肠肌与屈髋肌拉伸放松为主",
    exercises: [
      { name: "泡沫轴大腿前侧与外侧滚压", sets: "左右各 90 秒", target: "避开大转子与膝关节骨突，缓慢寻觅痛点深呼吸放松" },
      { name: "跪姿单腿屈髋肌群拉伸 (Couch Stretch)", sets: "左右各 60 秒", target: "后膝抵墙或地面，骨盆后倾感受髂腰肌前侧充分拉伸" },
      { name: "鸽子式臀部深层拉伸 (Pigeon Pose)", sets: "左右各 60 秒", target: "前腿横放骨盆摆正，上身前俯缓解臀大肌与梨状肌紧绷" },
    ],
  },
};

export function getStrengthRoutineForWorkout(
  workoutType: string,
  dayIndex: number,
  isRest: boolean
): StrengthRoutine | null {
  if (isRest || workoutType === "rest") return null;
  if (workoutType === "long") {
    return RUNNER_STRENGTH_ROUTINES.fascia_recovery;
  }
  if (workoutType === "interval") {
    return RUNNER_STRENGTH_ROUTINES.ankle_plyo;
  }
  if (workoutType === "marathon" || workoutType === "tempo" || workoutType === "threshold") {
    return RUNNER_STRENGTH_ROUTINES.kinetic_chain;
  }
  return dayIndex % 2 === 0 ? RUNNER_STRENGTH_ROUTINES.core_stability : RUNNER_STRENGTH_ROUTINES.kinetic_chain;
}

export default function AiCoach({
  onOpenActivity,
  onOpenConnect,
}: {
  onOpenActivity: (labelId: string) => void;
  onOpenConnect?: () => void;
}) {
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [baseline, setBaseline] = useState<CoachBaseline | null>(null);
  const [plan, setPlan] = useState<CoachPlan | null>(null);
  const [workouts, setWorkouts] = useState<CoachWorkout[]>([]);
  const [reviews, setReviews] = useState<CoachReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasAthleteData = Boolean(baseline?.hasData);

  // 周复盘折叠与分页状态
  const [expandedReviewIds, setExpandedReviewIds] = useState<Set<number>>(new Set());
  const [showAllReviews, setShowAllReviews] = useState(false);

  useEffect(() => {
    if (reviews.length > 0) {
      setExpandedReviewIds((prev) => (prev.size === 0 ? new Set([reviews[0].id]) : prev));
    }
  }, [reviews]);

  const toggleReviewExpand = (id: number) => {
    setExpandedReviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 弹窗状态
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTravelModal, setShowTravelModal] = useState(false);
  const [showStrengthLibraryModal, setShowStrengthLibraryModal] = useState(false);
  const [showAdjustDaysModal, setShowAdjustDaysModal] = useState(false);
  const [travelCity, setTravelCity] = useState("");
  const [travelUntil, setTravelUntil] = useState("");

  // 设置表单状态
  const [formData, setFormData] = useState<Partial<CoachProfile>>({});
  const [customTimeStr, setCustomTimeStr] = useState("");

  useEffect(() => {
    setCustomTimeStr(formatCustomTimeStr(formData.targetTimeSec));
  }, [formData.targetTimeSec, showSettingsModal]);

  const getTargetPresets = (dist: string) => {
    if (dist === "half_marathon") {
      return [
        { label: "1:10:00", sec: 4200 },
        { label: "1:15:00", sec: 4500 },
        { label: "1:20:00", sec: 4800 },
        { label: "1:25:00", sec: 5100 },
        { label: "1:30:00", sec: 5400 },
        { label: "1:40:00", sec: 6000 },
        { label: "1:45:00", sec: 6300 },
        { label: "2:00:00", sec: 7200 },
      ];
    }
    if (dist === "10k") {
      return [
        { label: "32分", sec: 1920 },
        { label: "35分", sec: 2100 },
        { label: "38分", sec: 2280 },
        { label: "40分", sec: 2400 },
        { label: "45分", sec: 2700 },
        { label: "50分", sec: 3000 },
        { label: "1小时", sec: 3600 },
      ];
    }
    if (dist === "5k") {
      return [
        { label: "15分", sec: 900 },
        { label: "16分半", sec: 990 },
        { label: "18分", sec: 1080 },
        { label: "20分", sec: 1200 },
        { label: "22分", sec: 1320 },
        { label: "25分", sec: 1500 },
      ];
    }
    // marathon
    return [
      { label: "2:30:00", sec: 9000 },
      { label: "2:40:00", sec: 9600 },
      { label: "2:45:00", sec: 9900 },
      { label: "2:50:00", sec: 10200 },
      { label: "破3 (2:59:59)", sec: 10799 },
      { label: "3:10:00", sec: 11400 },
      { label: "3:15:00", sec: 11700 },
      { label: "3:20:00", sec: 12000 },
      { label: "3:30:00", sec: 12600 },
      { label: "3:45:00", sec: 13500 },
      { label: "4:00:00", sec: 14400 },
      { label: "4:30:00", sec: 16200 },
    ];
  };

  const formatCustomTimeStr = (sec: number | null | undefined): string => {
    if (!sec || sec <= 0) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const parseCustomTimeStr = (str: string): number | null => {
    const v = str.trim().replace(/：/g, ":");
    if (!v) return null;
    const parts = v.split(":").map((p) => parseInt(p, 10));
    if (parts.some((n) => isNaN(n) || n < 0)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) {
      return parts[0] > 24 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60;
    }
    if (parts.length === 1 && parts[0] > 60) return parts[0];
    return null;
  };

  const targetDiagnosis = useMemo(() => {
    const targetSec = formData.targetTimeSec;
    if (!targetSec || targetSec <= 0 || !baseline || !baseline.hasData) return null;
    const dist = formData.targetDistance || "marathon";
    let predSec = 0;
    if (dist === "half_marathon") {
      predSec = baseline.predictions?.halfMarathonSec ?? 5400;
    } else if (dist === "10k") {
      predSec = baseline.predictions?.tenKSec ?? 2400;
    } else if (dist === "5k") {
      predSec = baseline.predictions?.fiveKSec ?? 1140;
    } else {
      predSec = baseline.predictions?.marathonSec ?? 11500;
    }

    const gapSec = predSec - targetSec;
    const gapPct = (gapSec / targetSec) * 100;
    const currentPredStr = fmtDur(predSec);
    const gapMinutes = Math.abs(Math.round(gapSec / 60));
    const gapStr = gapSec > 0 ? `当前预测慢 ${gapMinutes} 分钟` : `已领先 ${gapMinutes} 分钟`;

    if (gapPct <= 3.0) {
      return {
        badge: "🟢 实力高度契合 · 冲刺收敛期",
        color: "#16a34a",
        bg: "rgba(22, 163, 74, 0.08)",
        border: "rgba(22, 163, 74, 0.25)",
        currentPredStr,
        gapStr,
        advice: "当前等效能力与目标差距在 3% 以内，课表将着重围绕目标比赛配速进行专项巡航收敛与乳酸清除耐受强化！",
      };
    } else if (gapPct <= 8.5) {
      return {
        badge: "🟡 挑战突破 · 系统进阶期",
        color: "#d97706",
        bg: "rgba(217, 119, 6, 0.08)",
        border: "rgba(217, 119, 6, 0.25)",
        currentPredStr,
        gapStr,
        advice: `当前预测与目标差距约 ${gapMinutes} 分钟。属于单周期的科学挑战范围，AI 将通过 80/20 极化、间歇提摄氧量与门槛拓展拐点，稳步缩小差距！`,
      };
    } else {
      return {
        badge: "🟣 跨周期长期愿景 · 分阶段筑基",
        color: "#7c3aed",
        bg: "rgba(124, 58, 237, 0.08)",
        border: "rgba(124, 58, 237, 0.25)",
        currentPredStr,
        gapStr,
        advice: `当前预测（${currentPredStr}）与目标差距达 ${gapMinutes} 分钟。跨级生理提升需要多周期扎实积累，绝不能拔苗助长用目标配速直接训练（极易导致疲劳骨折或严重伤病）！本阶段课表确立为“第 1 阶段奠基与专项突破”，以当前能力稳步超补偿，确保安全防伤！`,
      };
    }
  }, [formData.targetTimeSec, formData.targetDistance, baseline]);

  const activeGoalEval = useMemo(() => {
    if (!profile?.targetTimeSec || !baseline || !baseline.hasData) return null;
    const dist = profile.targetDistance || "marathon";
    let predSec = 0;
    if (dist === "half_marathon") {
      predSec = baseline.predictions?.halfMarathonSec ?? 5400;
    } else if (dist === "10k") {
      predSec = baseline.predictions?.tenKSec ?? 2400;
    } else if (dist === "5k") {
      predSec = baseline.predictions?.fiveKSec ?? 1140;
    } else {
      predSec = baseline.predictions?.marathonSec ?? 11500;
    }
    const gapSec = predSec - profile.targetTimeSec;
    const gapPct = (gapSec / profile.targetTimeSec) * 100;
    const gapMinutes = Math.abs(Math.round(gapSec / 60));
    if (gapPct <= 3.0) {
      return {
        level: "realistic",
        badgeText: "🟢 实力契合 · 专项收敛",
        color: "#16a34a",
        advice: `当前预测能力非常接近目标成绩（差距约 ${gapMinutes} 分钟），课表着重围绕目标配速进行专项收敛！`,
      };
    } else if (gapPct <= 8.5) {
      return {
        level: "challenging",
        badgeText: `🟡 差距 ${gapMinutes}分 · 系统进阶`,
        color: "#d97706",
        advice: `当前预测与目标差距约 ${gapMinutes} 分钟，需经过系统超补偿进阶，课表以拓展有氧天花板为主。`,
      };
    } else {
      return {
        level: "visionary",
        badgeText: `🟣 差距 ${gapMinutes}分 · 第1阶段奠基`,
        color: "#7c3aed",
        advice: `目标与当前实际差距达 ${gapMinutes} 分钟。属于多周期远景目标，本双周作为第 1 阶段奠基石稳步提速，防伤第一！`,
      };
    }
  }, [profile?.targetTimeSec, profile?.targetDistance, baseline]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [prof, base, planRes] = await Promise.all([
        api.coachProfile(),
        api.coachBaseline(),
        api.coachPlan(),
      ]);
      setProfile(prof);
      setFormData(prof);
      if (planRes.plan?.baselineSnapshotJson) {
        try {
          const snap = JSON.parse(planRes.plan.baselineSnapshotJson);
          if (snap.aiSummary) (base as any).aiSummary = snap.aiSummary;
        } catch {}
      }
      setBaseline(base);
      setPlan(planRes.plan);
      setWorkouts(planRes.workouts);
      setReviews(planRes.reviews);
      setErr(null);
    } catch (e: any) {
      setErr(e.message || "加载 AI 教练数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      await api.generateCoachPlan();
      await loadData();
    } catch (e: any) {
      alert("生成课表失败: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleReview = async (weekIndex: number) => {
    if (!plan) return;
    try {
      setReviewing(true);
      await api.reviewCoachPlan(plan.id, weekIndex);
      await loadData();
    } catch (e: any) {
      alert("周度复盘执行失败: " + e.message);
    } finally {
      setReviewing(false);
    }
  };

  const handleEndPlan = async () => {
    if (!plan) return;
    const confirmed = window.confirm(
      "确定要结束并归档当前周期的训练课表吗？\n\n" +
      "• 当前计划将标记为已归档，历史打卡与周复盘报告将妥善保存。\n" +
      "• 结束后您可以随时按最新的身体状态，一键开启全新的训练周期。"
    );
    if (!confirmed) return;

    try {
      setGenerating(true);
      await api.endCoachPlan(plan.id);
      setShowSettingsModal(false);
      await loadData();
    } catch (e: any) {
      alert("结束课表失败: " + (e.message || String(e)));
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveSettings = async () => {
    setShowSettingsModal(false);
    setGenerating(true);
    try {
      const payload = {
        ...formData,
        includeStrength: 1,
        targetRaceDate: formData.targetType === "fitness" ? null : formData.targetRaceDate,
        raceId: formData.targetType === "fitness" ? null : formData.raceId,
      };
      await api.updateCoachProfile(payload);
      await api.generateCoachPlan();
      await loadData();
    } catch (e: any) {
      alert("保存设置与重新生成课表失败: " + (e.message || String(e)));
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveTravel = async () => {
    try {
      await api.setCoachTravel(travelCity || null, travelUntil || null);
      setShowTravelModal(false);
      await loadData();
    } catch (e: any) {
      alert("保存出差模式失败: " + e.message);
    }
  };

  // 弹窗打开时锁定底层页面滚动（避免 macOS/Windows 弹窗与底层双重晃动与滚轮穿透）
  useEffect(() => {
    const isAnyModalOpen =
      showSettingsModal ||
      showTravelModal ||
      showAdjustDaysModal ||
      showStrengthLibraryModal;

    if (isAnyModalOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [showSettingsModal, showTravelModal, showAdjustDaysModal, showStrengthLibraryModal]);

  // 桌面端快捷键：按 Escape 键关闭当前激活的模态弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showSettingsModal && !generating) setShowSettingsModal(false);
        if (showTravelModal) setShowTravelModal(false);
        if (showAdjustDaysModal) setShowAdjustDaysModal(false);
        if (showStrengthLibraryModal) setShowStrengthLibraryModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettingsModal, showTravelModal, showAdjustDaysModal, showStrengthLibraryModal, generating]);

  if (loading) {
    return (
      <div className="card" style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-dim)" }}>
        <IconRefresh size={28} className="animate-spin" style={{ margin: "0 auto 12px", opacity: 0.7 }} />
        <div>正在调取您的生理体能基准与 AI 课表…</div>
      </div>
    );
  }

  // 整理出差信息
  const travelMode = profile?.travelModeJson ? JSON.parse(profile.travelModeJson) : null;

  // 按周次分组课表
  const currentWeek = plan?.currentWeek && plan.currentWeek >= 1 ? plan.currentWeek : 1;
  let week1Workouts = workouts.filter((w) => w.weekIndex === currentWeek);
  let week2Workouts = workouts.filter((w) => w.weekIndex === currentWeek + 1);

  if (week1Workouts.length === 0 && workouts.length > 0) {
    week1Workouts = workouts.slice(0, 7);
    week2Workouts = workouts.slice(7, 14);
  }

  // 解析偏好天数
  let preferredDays: number[] = [2, 4, 6, 0];
  try {
    if (formData.preferredDaysJson) preferredDays = JSON.parse(formData.preferredDaysJson);
  } catch {}

  const toggleDay = (day: number) => {
    let next: number[];
    if (preferredDays.includes(day)) {
      if (preferredDays.length <= 3) {
        alert("建议每周至少保留 3 天跑步训练");
        return;
      }
      next = preferredDays.filter((d) => d !== day);
    } else {
      if (preferredDays.length >= 6) {
        alert("建议每周至少安排 1 天彻底休息");
        return;
      }
      next = [...preferredDays, day].sort((a, b) => a - b);
    }
    let nextLongRunDay = formData.longRunDay ?? 0;
    if (!next.includes(nextLongRunDay)) {
      nextLongRunDay = next[next.length - 1];
    }
    setFormData({
      ...formData,
      longRunDay: nextLongRunDay,
      daysPerWeek: next.length,
      preferredDaysJson: JSON.stringify(next),
    });
  };

  return (
    <>
      {err && <div className="banner error" style={{ marginBottom: 14 }}>{err}</div>}

      {/* 顶部 Page Head */}
      <div className="page-head coach-page-head" style={{ marginBottom: 16 }}>
        <div>
          <h2>AI 科学课表</h2>
          <div className="sub">
            Banister 冲动响应模型 · 80/20 极化与 Canova 专项收敛 · 双周滚动自适应闭环
          </div>
        </div>
        <div className="coach-head-actions" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* 环境或出差模式快捷状态小药丸（仅在已有排课时展示） */}
          {plan && (travelMode?.city ? (
            <button
              className="pill"
              style={{
                background: "var(--warn-bg)",
                borderColor: "var(--warn-border)",
                color: "var(--warn)",
                fontWeight: 600,
                cursor: "pointer",
                padding: "5px 12px",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={() => {
                setTravelCity(travelMode.city);
                setTravelUntil(travelMode.untilDate || "");
                setShowTravelModal(true);
              }}
              title="点击调整出差模式"
            >
              <span>✈️ 出差模式: {travelMode.city}</span>
              <span style={{ opacity: 0.7, fontSize: 11 }}>({travelMode.untilDate}止)</span>
            </button>
          ) : (
            <button
              className="pill"
              style={{
                background: "var(--surface-2)",
                borderColor: "var(--border)",
                color: "var(--text-dim)",
                cursor: "pointer",
                padding: "5px 12px",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={() => {
                setTravelCity("");
                setTravelUntil("");
                setShowTravelModal(true);
              }}
              title="点击切换出差/异地环境"
            >
              <span>📍 常态气候: {baseline?.detectedClimate.avgTempC ? `${baseline.detectedClimate.avgTempC}℃` : "气温适宜"}</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>· 切换出差</span>
            </button>
          ))}

          {plan ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => setShowAdjustDaysModal(true)}
                style={{ fontSize: 13, padding: "7px 13px", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="快捷调整后续训练日安排，不影响历史打卡与周次"
              >
                🗓️ 调整跑步日 ({preferredDays.length}天)
              </button>
              <button
                className="btn"
                onClick={() => setShowStrengthLibraryModal(true)}
                style={{ fontSize: 13, padding: "7px 13px", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="查看跑后核心与抗阻力量动作库与执行标准"
              >
                🏋️ 跑后核心力量课表
              </button>
              <button
                className="btn"
                onClick={() => setShowSettingsModal(true)}
                style={{ fontSize: 13, padding: "7px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <IconGear size={15} />
                课表与偏好定制
              </button>
              <button
                className="btn"
                onClick={handleEndPlan}
                disabled={generating}
                style={{
                  fontSize: 12.5,
                  padding: "7px 12px",
                  borderColor: "var(--border)",
                  color: "var(--text-dim)",
                }}
                title="完赛结营或计划中断时点击，归档当前课表"
              >
                🏁 结束课表
              </button>
            </div>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {!hasAthleteData && onOpenConnect && (
                <button
                  className="btn primary"
                  onClick={onOpenConnect}
                  style={{ fontSize: 13, padding: "7px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  ⌚ 连接运动手表
                </button>
              )}
              <button
                className="btn"
                onClick={() => setShowStrengthLibraryModal(true)}
                style={{ fontSize: 13, padding: "7px 13px", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="查看跑后核心与抗阻力量动作库与执行标准"
              >
                🏋️ 跑后核心力量课表
              </button>
              <span
                title={!hasAthleteData ? "当前跑友档案暂无跑步记录，请先连接手表同步数据后再排课" : undefined}
                style={{ display: "inline-flex", cursor: !hasAthleteData ? "not-allowed" : undefined }}
              >
                <button
                  className={hasAthleteData ? "btn primary" : "btn"}
                  disabled={generating || !hasAthleteData}
                  onClick={() => setShowSettingsModal(true)}
                  style={{ fontSize: 13, padding: "7px 16px", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <IconGear size={15} />
                  个性化定制并生成课表
                </button>
              </span>
            </div>
          )}
        </div>
      </div>



      {/* 生理底座指标 Hero 网格 */}
      {baseline && (
        <div className="coach-hero-grid" style={{ position: "relative", zIndex: 60 }}>
          {/* VDOT */}
          <HeroStatCard
            icon={<IconGauge size={14} />}
            label="Daniels VDOT"
            value={baseline.hasData && baseline.vdot > 0 ? baseline.vdot : "--"}
            valueColor="var(--accent)"
            hint={baseline.hasData && baseline.vdot > 0 ? "能力锚点基准 · 动态推演" : "需同步跑步数据自动推演"}
            detail={{
              title: "Daniels VDOT (丹尼尔斯跑力)",
              definition: "综合衡量最大摄氧量 (VO2max) 与跑步经济性的综合跑力战力值。数值越高，跑速越快、耐力越强。",
              currentLevel: baseline.hasData && baseline.vdot > 0
                ? (baseline.vdot >= 54 ? "破三精英" : baseline.vdot >= 47 ? "严肃高阶" : baseline.vdot >= 39 ? "大众进阶" : "健康起步")
                : "等待首次同步",
              levelColor: "var(--accent)",
              ranges: [
                { label: "健康起步 (全马 > 4:15)", range: "< 39", isCurrent: Boolean(baseline.hasData && baseline.vdot > 0 && baseline.vdot < 39) },
                { label: "大众进阶 (全马 3:30 ~ 4:15)", range: "39 ~ 46", isCurrent: Boolean(baseline.hasData && baseline.vdot >= 39 && baseline.vdot < 47) },
                { label: "严肃高阶 (全马 3:00 ~ 3:30)", range: "47 ~ 53", isCurrent: Boolean(baseline.hasData && baseline.vdot >= 47 && baseline.vdot < 54) },
                { label: "破三精英 (全马 < 3:00)", range: "≥ 54", isCurrent: Boolean(baseline.hasData && baseline.vdot >= 54) },
              ],
              coachAdvice: baseline.hasData && baseline.vdot > 0
                ? `当前跑力 ${baseline.vdot}，等效全马约 3小时05分水平。AI 课表已基于此精确锁定 E/M/T/I 各区间配速。`
                : "当前档案暂无跑步记录。请先在顶部连接手表同步历史训练，系统将自动基于您的真实分圈推演跑力。",
            }}
          />

          {/* CTL */}
          <HeroStatCard
            icon={<IconHeart size={14} />}
            label="长期体能 (CTL)"
            value={baseline.hasData && baseline.ctl > 0 ? baseline.ctl : "--"}
            valueColor="var(--good)"
            hint={baseline.hasData && baseline.ctl > 0 ? "42天加权积蓄 · Fitness" : "需同步跑步数据计算负荷"}
            detail={{
              title: "长期体能 (CTL · Fitness)",
              definition: "过去 42 天（6 周）每日训练负荷的加权积蓄值，代表有氧体能底座与承受跑量的耐受底子（蓄水池）。",
              currentLevel: baseline.hasData && baseline.ctl > 0
                ? (baseline.ctl >= 80 ? "体能底座极厚" : baseline.ctl >= 50 ? "备赛进阶储备" : "基础体能维持")
                : "等待首次同步",
              levelColor: "var(--good)",
              ranges: [
                { label: "基础维持 (周跑量 20~35km)", range: "< 45", isCurrent: Boolean(baseline.hasData && baseline.ctl > 0 && baseline.ctl < 45) },
                { label: "大众进阶备赛 (周跑量 40~60km)", range: "45 ~ 75", isCurrent: Boolean(baseline.hasData && baseline.ctl >= 45 && baseline.ctl < 75) },
                { label: "严肃高负荷备赛 (周跑量 60~85km)", range: "75 ~ 100", isCurrent: Boolean(baseline.hasData && baseline.ctl >= 75 && baseline.ctl < 100) },
                { label: "精英耐力储备 (体能底子雄厚)", range: "≥ 100", isCurrent: Boolean(baseline.hasData && baseline.ctl >= 100) },
              ],
              coachAdvice: baseline.hasData && baseline.ctl > 0
                ? `CTL 达到 ${baseline.ctl}，体能底座极厚，具备冲击大跑量和高强度长跑的坚实生理底座。`
                : "当前档案暂无历史负荷。同步手表后，系统将自动按 42 天 EWMA 滑动窗口累积长期体能 (Fitness)。",
            }}
          />

          {/* ATL */}
          <HeroStatCard
            icon={<IconPulse size={14} />}
            label="急性疲劳 (ATL)"
            value={baseline.hasData ? baseline.atl : "--"}
            valueColor="var(--warn)"
            hint={baseline.hasData ? "7天短期负荷 · Fatigue" : "需同步跑步数据计算疲劳"}
            detail={{
              title: "急性疲劳 (ATL · Fatigue)",
              definition: "过去 7 天短期训练负荷的加权值，代表身体近一周刚承受的即刻身体冲击与疲劳程度。",
              currentLevel: baseline.hasData
                ? (baseline.atl < baseline.ctl ? "疲劳已释放 (恢复良好)" : "短期疲劳累积期")
                : "等待首次同步",
              levelColor: "var(--warn)",
              ranges: [
                { label: "疲劳释放超补偿 (ATL < CTL)", range: "恢复良好", isCurrent: Boolean(baseline.hasData && baseline.atl < baseline.ctl) },
                { label: "日常负荷平衡 (ATL ≈ CTL)", range: "平稳推进", isCurrent: Boolean(baseline.hasData && Math.abs(baseline.atl - baseline.ctl) <= 5) },
                { label: "高负荷冲击 (ATL > CTL × 1.25)", range: "深度疲劳期", isCurrent: Boolean(baseline.hasData && baseline.atl >= baseline.ctl * 1.25) },
              ],
              coachAdvice: baseline.hasData
                ? `近期疲劳值 ${baseline.atl} 低于体能底座 ${baseline.ctl}，疲劳正在稳步出清，身体处于良性恢复节奏。`
                : "当前档案暂无短期疲劳。同步手表后，系统将自动追踪近 7 天运动产生的急性冲击 (Fatigue)。",
            }}
          />

          {/* TSB */}
          <HeroStatCard
            icon={<IconTrophy size={14} />}
            label="状态平衡 (TSB)"
            value={baseline.hasData ? (baseline.tsb > 0 ? `+${baseline.tsb}` : baseline.tsb) : "--"}
            valueColor={baseline.hasData && baseline.tsb >= 0 ? "var(--good)" : "var(--pace)"}
            hint={baseline.hasData ? "Form 竞技状态 (CTL - ATL)" : "需同步跑步数据"}
            alignRight
            detail={{
              title: "竞技状态平衡 (TSB · Form)",
              definition: "计算公式 CTL - ATL（体能减去疲劳）。衡量当前的身体新鲜度与比赛实战爆发力。",
              currentLevel: baseline.hasData
                ? (baseline.tsb >= 5 && baseline.tsb <= 20 ? "🌟 比赛日黄金巅峰！" : baseline.tsb > 20 ? "休跑衰退期" : baseline.tsb >= -15 ? "平稳训练期" : "高疲劳积累期")
                : "等待首次同步",
              levelColor: baseline.hasData && baseline.tsb >= 0 ? "var(--good)" : "var(--pace)",
              ranges: [
                { label: "高疲劳积累 (上量上强度)", range: "< -15", isCurrent: Boolean(baseline.hasData && baseline.tsb < -15) },
                { label: "平稳训练期 (动态平衡)", range: "-15 ~ +5", isCurrent: Boolean(baseline.hasData && baseline.tsb >= -15 && baseline.tsb < 5) },
                { label: "比赛日黄金巅峰 (破 PB 最佳状态)", range: "+5 ~ +20", isCurrent: Boolean(baseline.hasData && baseline.tsb >= 5 && baseline.tsb <= 20) },
                { label: "过度休跑 (体能下滑)", range: "> +20", isCurrent: Boolean(baseline.hasData && baseline.tsb > 20) },
              ],
              coachAdvice: baseline.hasData
                ? (baseline.tsb >= 5 && baseline.tsb <= 20
                  ? "当前正处在 +5 ~ +20 比赛日黄金巅峰窗口，神经肌肉新鲜充沛，极利于跑出最好成绩！"
                  : "注意平衡高强度课与恢复课，避免 TSB 持续低于 -25 导致隐性伤病。")
                : "TSB 为体能与疲劳的天平（CTL - ATL），有数据后可直接预判比赛日竞技状态窗口。",
            }}
          />

          {/* ACWR */}
          <HeroStatCard
            icon={<IconPulse size={14} />}
            label="负荷比率 (ACWR)"
            value={baseline.hasData && baseline.acwr > 0 ? baseline.acwr : "--"}
            valueColor={baseline.hasData && baseline.acwr > 1.4 ? "var(--hr)" : "var(--good)"}
            hint={baseline.hasData && baseline.acwr > 0 ? (baseline.acwr <= 1.3 ? "安全甜区 (0.8 ~ 1.3)" : "需警惕过度疲劳") : "需积累训练数据"}
            alignRight
            detail={{
              title: "急慢性负荷比 (ACWR)",
              definition: "短期疲劳 (ATL) ÷ 长期体能 (CTL)。国际运动医学顶级金指标，用于精确监控加量速度并预警伤病风险。",
              currentLevel: baseline.hasData && baseline.acwr > 0
                ? (baseline.acwr <= 1.3 && baseline.acwr >= 0.8 ? "安全黄金甜区 (Sweet Spot)" : baseline.acwr > 1.3 && baseline.acwr <= 1.5 ? "需警惕疲劳" : baseline.acwr > 1.5 ? "高伤病危险区" : "负荷不足")
                : "等待首次同步",
              levelColor: baseline.hasData && baseline.acwr > 1.4 ? "var(--hr)" : "var(--good)",
              ranges: [
                { label: "负荷不足 (体能下滑)", range: "< 0.80", isCurrent: Boolean(baseline.hasData && baseline.acwr > 0 && baseline.acwr < 0.8) },
                { label: "安全黄金甜区 (伤病率最低)", range: "0.80 ~ 1.30", isCurrent: Boolean(baseline.hasData && baseline.acwr >= 0.8 && baseline.acwr <= 1.3) },
                { label: "需警惕疲劳 (加量稍快)", range: "1.31 ~ 1.50", isCurrent: Boolean(baseline.hasData && baseline.acwr > 1.3 && baseline.acwr <= 1.5) },
                { label: "危险区 (受伤率激增 2~4倍)", range: "> 1.50", isCurrent: Boolean(baseline.hasData && baseline.acwr > 1.5) },
              ],
              coachAdvice: baseline.hasData && baseline.acwr > 0
                ? (baseline.acwr <= 1.3 && baseline.acwr >= 0.8
                  ? "负荷比处于 0.8~1.3 黄金安全区间，加量节奏科学稳健，跟腱与滑囊炎风险极低。"
                  : "加量稍急，需密切关注下肢肌腱与关节酸痛体感，适当安排减量恢复。")
                : "急慢性负荷比（ACWR）需在积累有效训练后开始监控，帮助您精准防伤避险。",
            }}
          />

          {/* Pw:Hr 心率漂移 */}
          <HeroStatCard
            icon={<IconRun size={14} />}
            label="心率漂移 (Pw:Hr)"
            value={baseline.hasData && baseline.cardiacDecoupling?.tested && baseline.cardiacDecoupling.driftPct != null ? `${baseline.cardiacDecoupling.driftPct}%` : "数据积累中"}
            valueColor={baseline.cardiacDecoupling?.status === "healthy" ? "var(--good)" : "var(--warn)"}
            hint={baseline.cardiacDecoupling?.tested ? (baseline.cardiacDecoupling.status === "healthy" ? "有氧基础稳固 · 脱偶率<5%" : "后半程脱偶代偿") : "需至少一次≥10km长跑"}
            hintTitle={baseline.cardiacDecoupling?.summary}
            alignRight
            detail={{
              title: "心率漂移 (Pw:Hr · 有氧脱偶率)",
              definition: "长跑后半程相比前半程的【心率与配速比值漂移量】。衡量纯有氧耐力底座与脂肪氧化供能比例。",
              currentLevel: baseline.cardiacDecoupling?.tested
                ? (baseline.cardiacDecoupling.status === "healthy" ? "有氧底座稳如磐石" : "后半程心率代偿漂移")
                : "数据积累中",
              levelColor: baseline.cardiacDecoupling?.status === "healthy" ? "var(--good)" : "var(--warn)",
              ranges: [
                { label: "有氧底座极其稳固 (无代偿)", range: "< 5.0%", isCurrent: Boolean(baseline.cardiacDecoupling?.tested && (baseline.cardiacDecoupling.driftPct ?? 0) < 5) },
                { label: "轻度漂移 (后半程轻微代偿)", range: "5.0% ~ 8.0%", isCurrent: Boolean(baseline.cardiacDecoupling?.tested && (baseline.cardiacDecoupling.driftPct ?? 0) >= 5 && (baseline.cardiacDecoupling.driftPct ?? 0) <= 8) },
                { label: "显著脱偶 (心率飙升/跑姿塌陷)", range: "> 8.0%", isCurrent: Boolean(baseline.cardiacDecoupling?.tested && (baseline.cardiacDecoupling.driftPct ?? 0) > 8) },
              ],
              coachAdvice: baseline.cardiacDecoupling?.tested
                ? (baseline.cardiacDecoupling.status === "healthy"
                  ? "长跑后半程无心血管漂移，说明心室泵血效率稳定、脂肪氧化供能扎实，后半程抗掉速能力出众！"
                  : "后半程出现心率漂移，说明纯有氧基础仍需夯实，需多安排 Zone 2 纯有氧跑，并注意跑步补水与电解质。")
                : (baseline.cardiacDecoupling?.summary || "需至少完成一次 10km 以上的长距离稳定配速跑步，系统将自动对比前后半程心率脱偶比率。"),
            }}
          />

          {/* 期望目标与可行性 */}
          {profile?.targetTimeSec && profile.targetTimeSec > 0 && (
            <div
              className="card stat-card"
              style={{
                padding: "14px 16px",
                borderLeft: `4px solid ${
                  activeGoalEval?.level === "realistic"
                    ? "#16a34a"
                    : activeGoalEval?.level === "challenging"
                    ? "#d97706"
                    : "#7c3aed"
                }`,
              }}
              title={activeGoalEval?.advice}
            >
              <div className="stat">
                <span className="label">
                  <IconTarget size={14} />
                  期望目标 ({profile.targetDistance === "marathon" || profile.targetDistance === "general" ? "全马" : profile.targetDistance === "half_marathon" ? "半马" : profile.targetDistance})
                </span>
                <span className="value num" style={{ fontSize: 18, color: "var(--text)" }}>
                  {fmtDur(profile.targetTimeSec)}
                </span>
                <span
                  className="hint truncate"
                  style={{
                    color: activeGoalEval?.color ?? "var(--text-dim)",
                    fontWeight: 600,
                  }}
                >
                  {activeGoalEval?.badgeText ?? "阶梯超补偿进阶中"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 课表展示区 / AI 编排生成中 */}
      {generating ? (
        <div
          className="card"
          style={{
            padding: "60px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            marginBottom: 20,
            background: "var(--surface)",
            border: "1px solid var(--accent-border)",
            minHeight: 280,
          }}
        >
          <IconRefresh
            size={42}
            className="animate-spin"
            style={{ color: "var(--accent)", margin: "0 auto", opacity: 0.9 }}
          />
          <div>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "var(--text)" }}>
              AI 科学教练正在为您量身编排双周课表...
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", maxWidth: 520, lineHeight: 1.5 }}>
              正在基于 {baseline?.hasData && baseline.vdot > 0 ? `Daniels 跑力（VDOT ${baseline.vdot}）` : "生理基准模型"}、储备心率区间与所选偏好进行生理负荷推演与排课，预计需要 30~60 秒，请稍候。
            </p>
          </div>
        </div>
      ) : workouts.length === 0 ? (
        <div
          className="card"
          style={{
            padding: "50px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 16,
              background: "var(--accent-bg)",
              border: "1px solid var(--accent-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
            }}
          >
            <IconTarget size={28} />
          </div>
          <div>
            <h3 style={{ margin: "0 0 6px", fontSize: 17, color: "var(--text)" }}>开始您的 AI 科学进阶之旅</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", maxWidth: 540, lineHeight: 1.6 }}>
              {baseline && !baseline.hasData
                ? "💡 当前跑友档案尚未同步任何跑步记录。建议先在顶部连接手表（高驰 COROS / 佳明 Garmin）同步历史数据，AI 即可根据您的真实生理负荷底座精准排课。"
                : "根据您的历史跑步生理数据、所选训练天数、气候与目标比赛日期，自动制定符合 80/20 极化与 3:1 阶梯超补偿的专业双周滚动课表。"}
            </p>
          </div>
          <div style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
            {!hasAthleteData && onOpenConnect && (
              <button
                onClick={onOpenConnect}
                className="btn primary"
                style={{ fontSize: 13, padding: "8px 20px", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                ⌚ 连接运动手表设备
              </button>
            )}
            <span
              title={!hasAthleteData ? "当前跑友档案暂无跑步记录，请先连接手表同步数据后再排课" : undefined}
              style={{ display: "inline-flex", cursor: !hasAthleteData ? "not-allowed" : undefined }}
            >
              <button
                onClick={() => setShowSettingsModal(true)}
                disabled={generating || !hasAthleteData}
                className={hasAthleteData ? "btn primary" : "btn"}
                style={{ fontSize: 13, padding: "8px 20px", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <IconGear size={15} />
                个性化定制并生成课表
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 24 }}>
          {/* AI 科学总教练寄语与双周训练哲学 */}
          {baseline && (baseline as any).aiSummary && (
            <div
              className="card"
              style={{
                padding: "12px 16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderLeft: "4px solid var(--accent)",
                borderRadius: "var(--radius)",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--accent-bg)",
                  color: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 16,
                  marginTop: 1,
                }}
              >
                🤖
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>AI 教练备战分析与训练指导</span>
                  {baseline.phenotype && (
                    <span
                      className="pill"
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        fontWeight: 700,
                        color: baseline.phenotype.badgeColor,
                        borderColor: baseline.phenotype.badgeColor,
                        background: baseline.phenotype.badgeBg,
                      }}
                      title={baseline.phenotype.characteristics}
                    >
                      {baseline.phenotype.badge}
                    </span>
                  )}
                  {baseline.phenotype?.prescription?.focusDesc && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      · {baseline.phenotype.prescription.focusDesc}
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55 }}>
                  {(baseline as any).aiSummary}
                </p>
              </div>
            </div>
          )}

          {/* 本周执行中课表 */}
          <WeekScheduleSection
            weekIndex={currentWeek}
            workouts={week1Workouts}
            onOpenActivity={onOpenActivity}
            reviewing={reviewing}
            onReview={() => handleReview(currentWeek)}
          />

          {/* 下周预告课表 */}
          {week2Workouts.length > 0 && (
            <WeekScheduleSection
              weekIndex={currentWeek + 1}
              workouts={week2Workouts}
              onOpenActivity={onOpenActivity}
              isUpcoming
            />
          )}
        </div>
      )}

      {/* 历史复盘记录与自适应日志 */}
      {reviews.length > 0 && (() => {
        const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 3);
        return (
          <div className="card" style={{ padding: "16px 20px", marginBottom: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <div className="card-title" style={{ fontSize: 14, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <IconCalendar size={16} />
                <span>AI 教练周度闭环复盘与自适应调整记录</span>
                <span className="pill" style={{ fontSize: 10.5, padding: "1px 6px" }}>
                  累计 {reviews.length} 周
                </span>
              </div>

              {reviews.length > 1 && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    if (expandedReviewIds.size > 0) {
                      setExpandedReviewIds(new Set());
                    } else {
                      setExpandedReviewIds(new Set(reviews.map((r) => r.id)));
                    }
                  }}
                  style={{ fontSize: 11, padding: "2px 8px" }}
                >
                  {expandedReviewIds.size > 0 ? "全部折叠" : "全部展开"}
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleReviews.map((rev, idx) => {
                const isExpanded = expandedReviewIds.has(rev.id);
                const isLatest = idx === 0;
                return (
                  <div
                    key={rev.id}
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      overflow: "hidden",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {/* 头部摘要栏：始终可见，点击一键展开/收起 */}
                    <div
                      onClick={() => toggleReviewExpand(rev.id)}
                      style={{
                        padding: "10px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                        cursor: "pointer",
                        userSelect: "none",
                        background: isExpanded ? "var(--surface-3, rgba(255,255,255,0.02))" : "transparent",
                      }}
                      title="点击展开或收起本周复盘详情"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                            transition: "transform 0.18s ease",
                            display: "inline-flex",
                            color: "var(--text-faint)",
                          }}
                        >
                          <IconChevron size={14} />
                        </span>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                          第 {rev.weekIndex} 周复盘
                          <span style={{ fontSize: 11.5, color: "var(--text-dim)", fontWeight: 400, marginLeft: 6 }}>
                            ({rev.startDate} ~ {rev.endDate})
                          </span>
                          {isLatest && (
                            <span
                              className="pill accent"
                              style={{ fontSize: 9.5, padding: "1px 6px", marginLeft: 6, fontWeight: 700 }}
                            >
                              最新
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="pill" style={{ fontSize: 11 }}>
                          完成率: <strong>{rev.completionRatePct}%</strong>
                        </span>
                        <span
                          className={`pill ${
                            rev.adjustmentDecision === "advance"
                              ? "good"
                              : rev.adjustmentDecision === "deload"
                              ? "warn"
                              : rev.adjustmentDecision === "prune"
                              ? "accent"
                              : ""
                          }`}
                          style={{ fontSize: 11, fontWeight: 600 }}
                        >
                          决策: {rev.adjustmentDecision === "advance" ? "按计划进阶" : rev.adjustmentDecision === "deload" ? "减负吸收周" : rev.adjustmentDecision === "hold" ? "维持巩固" : "剪枝平滑"}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 4 }}>
                          {isExpanded ? "收起 ▴" : "展开 ▾"}
                        </span>
                      </div>
                    </div>

                    {/* 展开的详情内容 */}
                    {isExpanded && (
                      <div
                        style={{
                          padding: "14px 16px",
                          borderTop: "1px solid var(--border-subtle)",
                          fontSize: 12.5,
                          color: "var(--text)",
                          lineHeight: 1.65,
                        }}
                      >
                        <Markdown text={rev.reviewMarkdown} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 超过 3 周时的分页展开切换 */}
            {reviews.length > 3 && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setShowAllReviews(!showAllReviews)}
                  style={{ fontSize: 12, padding: "6px 16px", color: "var(--text-dim)" }}
                >
                  {showAllReviews
                    ? "收起早期历史复盘 ▴"
                    : `查看更早的历史复盘 (共 ${reviews.length} 周，已隐藏 ${reviews.length - 3} 周) ▾`}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* 偏好设置弹窗 Modal (通过 createPortal 挂载到 document.body，确保 100% 遮罩且不被父容器裁剪) */}
      {showSettingsModal && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            zIndex: 999999,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSettingsModal(false);
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 540,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
                {plan ? "AI 科学课表个性化定制" : "定制偏好并生成首份双周课表"}
              </div>
              <button
                className="btn sm"
                disabled={generating}
                onClick={() => setShowSettingsModal(false)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            {!hasAthleteData && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  color: "#ef4444",
                  fontSize: 12.5,
                  marginBottom: 14,
                  lineHeight: 1.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⚠️</span>
                  <span>当前跑友档案尚未同步任何跑步数据，AI 暂无法推演排课。</span>
                </div>
                {onOpenConnect && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => {
                      setShowSettingsModal(false);
                      onOpenConnect();
                    }}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                  >
                    去连接手表 ➔
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* 目标类型 */}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                  备赛目标类型
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div
                    onClick={() => setFormData({ ...formData, targetType: "fitness" })}
                    style={{
                      padding: 12,
                      borderRadius: "var(--radius)",
                      border: `1.5px solid ${formData.targetType === "fitness" ? "var(--accent)" : "var(--border)"}`,
                      background: formData.targetType === "fitness" ? "var(--accent-bg)" : "var(--surface-2)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: formData.targetType === "fitness" ? "var(--accent)" : "var(--text)" }}>
                      常态进阶 / 维持健康
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
                      无特定比赛，按 3:1 阶梯周度循环持续打磨有氧
                    </div>
                  </div>

                  <div
                    onClick={() => setFormData({ ...formData, targetType: "race" })}
                    style={{
                      padding: 12,
                      borderRadius: "var(--radius)",
                      border: `1.5px solid ${formData.targetType === "race" ? "var(--accent)" : "var(--border)"}`,
                      background: formData.targetType === "race" ? "var(--accent-bg)" : "var(--surface-2)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: formData.targetType === "race" ? "var(--accent)" : "var(--text)" }}>
                      目标赛事备战
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
                      指定比赛日期，严格分阶段周期倒排 (Base/Build/Peak/Taper)
                    </div>
                  </div>
                </div>
              </div>

              {/* 比赛日期与距离 */}
              {formData.targetType === "race" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    padding: 12,
                    background: "var(--surface-2)",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-dim)", display: "block", marginBottom: 4 }}>
                      比赛日期
                    </label>
                    <input
                      type="date"
                      value={formData.targetRaceDate || ""}
                      onChange={(e) => setFormData({ ...formData, targetRaceDate: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: 13,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        color: "var(--text)",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--text-dim)", display: "block", marginBottom: 4 }}>
                      目标距离
                    </label>
                    <select
                      value={formData.targetDistance || "marathon"}
                      onChange={(e) => setFormData({ ...formData, targetDistance: e.target.value })}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: 13,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        color: "var(--text)",
                      }}
                    >
                      <option value="marathon">全程马拉松 (42.195km)</option>
                      <option value="half_marathon">半程马拉松 (21.0975km)</option>
                      <option value="10k">10 公里</option>
                      <option value="5k">5 公里</option>
                    </select>
                  </div>

                  {/* 期望目标完赛成绩 (如全马破3 / 半马110) */}
                  <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
                        <span>🎯 期望目标成绩</span>
                        <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-dim)" }}>
                          (AI 将结合当前体能与目标进行梯级可行性诊断与科学排课)
                        </span>
                      </label>
                      {formData.targetTimeSec && formData.targetTimeSec > 0 && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, targetTimeSec: null })}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--text-dim)",
                            fontSize: 10,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          清除目标
                        </button>
                      )}
                    </div>

                    {/* 快捷预设按钮组 */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {getTargetPresets(formData.targetDistance || "marathon").map((p) => {
                        const isSelected = formData.targetTimeSec === p.sec;
                        return (
                          <button
                            key={p.sec}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, targetTimeSec: p.sec });
                              setCustomTimeStr(formatCustomTimeStr(p.sec));
                            }}
                            className="btn sm"
                            style={{
                              padding: "2px 8px",
                              fontSize: 11,
                              borderRadius: 4,
                              background: isSelected ? "var(--accent)" : "var(--surface)",
                              color: isSelected ? "#fff" : "var(--text)",
                              borderColor: isSelected ? "var(--accent)" : "var(--border)",
                              fontWeight: isSelected ? 700 : 500,
                            }}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* 自定义时间输入框 */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="自定义时间 (如 02:30:00、02:59:00 或 1:25:00)"
                        value={customTimeStr}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomTimeStr(val);
                          const sec = parseCustomTimeStr(val);
                          if (sec !== null) {
                            setFormData((prev) => ({ ...prev, targetTimeSec: sec }));
                          }
                        }}
                        onBlur={() => {
                          const sec = parseCustomTimeStr(customTimeStr);
                          if (sec !== null) {
                            setFormData((prev) => ({ ...prev, targetTimeSec: sec }));
                            setCustomTimeStr(formatCustomTimeStr(sec));
                          } else if (!customTimeStr.trim()) {
                            setFormData((prev) => ({ ...prev, targetTimeSec: null }));
                            setCustomTimeStr("");
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          fontSize: 12.5,
                          fontFamily: "var(--font-mono, monospace)",
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          color: "var(--text)",
                        }}
                      />
                      <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                        {formData.targetTimeSec
                          ? `目标配速 ~${fmtPace(Math.round(formData.targetTimeSec / (formData.targetDistance === "marathon" ? 42.195 : formData.targetDistance === "half_marathon" ? 21.0975 : formData.targetDistance === "10k" ? 10 : 5)))}/km`
                          : "未设定"}
                      </span>
                    </div>

                    {/* 实时可行性与梯级进阶诊断提示卡 */}
                    {targetDiagnosis && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "8px 10px",
                          borderRadius: 6,
                          background: targetDiagnosis.bg,
                          border: `1px solid ${targetDiagnosis.border}`,
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: targetDiagnosis.color }}>
                            {targetDiagnosis.badge}
                          </span>
                          <span style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono, monospace)" }}>
                            当前预测: <strong>{targetDiagnosis.currentPredStr}</strong> ｜ 差距: <strong>{targetDiagnosis.gapStr}</strong>
                          </span>
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--text)", lineHeight: 1.4 }}>
                          {targetDiagnosis.advice}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 若为常态进阶，也可设定远期成绩愿景 */}
              {formData.targetType === "fitness" && (
                <div
                  style={{
                    padding: 12,
                    background: "var(--surface-2)",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
                      <span>🌟 个人远期成绩愿景 (选填)</span>
                      <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-dim)" }}>
                        (虽无具体比赛，AI 会将此愿景作为长期有氧打底的北极星指标)
                      </span>
                    </label>
                    {formData.targetTimeSec && formData.targetTimeSec > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, targetTimeSec: null });
                          setCustomTimeStr("");
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--text-dim)",
                          fontSize: 10,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        清除愿景
                      </button>
                    )}
                  </div>

                  {/* 愿景项目选择 */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {[
                      { key: "marathon", label: "全马愿景" },
                      { key: "half_marathon", label: "半马愿景" },
                      { key: "10k", label: "10K愿景" },
                      { key: "5k", label: "5K愿景" },
                    ].map((d) => {
                      const isSel = (formData.targetDistance || "marathon") === d.key;
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => setFormData({ ...formData, targetDistance: d.key })}
                          style={{
                            padding: "3px 8px",
                            fontSize: 11,
                            borderRadius: 4,
                            background: isSel ? "var(--surface)" : "transparent",
                            border: `1px solid ${isSel ? "var(--accent)" : "transparent"}`,
                            color: isSel ? "var(--accent)" : "var(--text-dim)",
                            fontWeight: isSel ? 700 : 500,
                            cursor: "pointer",
                          }}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* 快捷预设按钮组 */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {getTargetPresets(formData.targetDistance || "marathon").map((p) => {
                      const isSelected = formData.targetTimeSec === p.sec;
                      return (
                        <button
                          key={p.sec}
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, targetTimeSec: p.sec, targetDistance: formData.targetDistance || "marathon" });
                            setCustomTimeStr(formatCustomTimeStr(p.sec));
                          }}
                          className="btn sm"
                          style={{
                            padding: "2px 8px",
                            fontSize: 11,
                            borderRadius: 4,
                            background: isSelected ? "var(--accent)" : "var(--surface)",
                            color: isSelected ? "#fff" : "var(--text)",
                            borderColor: isSelected ? "var(--accent)" : "var(--border)",
                            fontWeight: isSelected ? 700 : 500,
                          }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* 自定义时间输入框 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="自定义愿景成绩 (如 02:30:00、02:45:00 或 02:59:00)"
                      value={customTimeStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomTimeStr(val);
                        const sec = parseCustomTimeStr(val);
                        if (sec !== null) {
                          setFormData((prev) => ({
                            ...prev,
                            targetTimeSec: sec,
                            targetDistance: prev.targetDistance || "marathon",
                          }));
                        }
                      }}
                      onBlur={() => {
                        const sec = parseCustomTimeStr(customTimeStr);
                        if (sec !== null) {
                          setFormData((prev) => ({
                            ...prev,
                            targetTimeSec: sec,
                            targetDistance: prev.targetDistance || "marathon",
                          }));
                          setCustomTimeStr(formatCustomTimeStr(sec));
                        } else if (!customTimeStr.trim()) {
                          setFormData((prev) => ({ ...prev, targetTimeSec: null }));
                          setCustomTimeStr("");
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        fontSize: 12.5,
                        fontFamily: "var(--font-mono, monospace)",
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        color: "var(--text)",
                      }}
                    />
                    <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                      {formData.targetTimeSec
                        ? `目标配速 ~${fmtPace(Math.round(formData.targetTimeSec / ((formData.targetDistance || "marathon") === "marathon" ? 42.195 : formData.targetDistance === "half_marathon" ? 21.0975 : formData.targetDistance === "10k" ? 10 : 5)))}/km`
                        : "未设定"}
                    </span>
                  </div>

                  {targetDiagnosis && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: targetDiagnosis.bg,
                        border: `1px solid ${targetDiagnosis.border}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: targetDiagnosis.color }}>
                          {targetDiagnosis.badge}
                        </span>
                        <span style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono, monospace)" }}>
                          当前预测: <strong>{targetDiagnosis.currentPredStr}</strong> ｜ 差距: <strong>{targetDiagnosis.gapStr}</strong>
                        </span>
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text)", lineHeight: 1.4 }}>
                        {targetDiagnosis.advice}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 每周训练天数与偏好日选择 */}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                  每周训练日选择 (已选 {preferredDays.length} 天)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const isChecked = preferredDays.includes(d);
                    const isLongRun = formData.longRunDay === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        style={{
                          padding: "8px 2px",
                          borderRadius: "var(--radius)",
                          border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
                          background: isChecked ? "var(--accent)" : "var(--surface-2)",
                          color: isChecked ? "#fff" : "var(--text-dim)",
                          fontWeight: isChecked ? 700 : 500,
                          fontSize: 12,
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                        }}
                      >
                        <span>{WEEKDAYS[d]}</span>
                        {isLongRun && <span style={{ fontSize: 9, opacity: 0.9 }}>长跑</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>长距离指定于：</span>
                  <select
                    value={formData.longRunDay ?? 0}
                    onChange={(e) => {
                      const day = Number(e.target.value);
                      let nextDays = [...preferredDays];
                      if (!nextDays.includes(day)) {
                        nextDays = [...nextDays, day].sort((a, b) => a - b);
                      }
                      setFormData({
                        ...formData,
                        longRunDay: day,
                        daysPerWeek: nextDays.length,
                        preferredDaysJson: JSON.stringify(nextDays),
                      });
                    }}
                    style={{
                      padding: "4px 8px",
                      fontSize: 12,
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--text)",
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>
                        {WEEKDAYS[d]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 气候环境模式 */}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                  所处地区气候环境
                </label>
                <select
                  value={formData.climateType || "auto"}
                  onChange={(e) => setFormData({ ...formData, climateType: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: 13,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                  }}
                >
                  <option value="auto">自动感知（根据手表温度传感器历史）</option>
                  <option value="humid_hot">湿热地区（如广东/东南亚，触发露点配速放宽与Zone2封顶）</option>
                  <option value="cold_snow">寒冷降雪地区（如加拿大/东北，取消户外极限冲刺，提供室内备选）</option>
                  <option value="temperate">四季温带（标准平原配速）</option>
                </select>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 20,
                paddingTop: 14,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button className="btn" disabled={generating} onClick={() => setShowSettingsModal(false)}>
                取消
              </button>
              <span
                title={!hasAthleteData ? "当前档案暂无跑步记录，无法生成课表" : undefined}
                style={{ display: "inline-flex", cursor: !hasAthleteData ? "not-allowed" : undefined }}
              >
                <button
                  className="btn primary"
                  disabled={generating || !hasAthleteData}
                  onClick={handleSaveSettings}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {plan ? "保存偏好并让 AI 重新生成课表" : "确认偏好，开始生成双周课表 🚀"}
                </button>
              </span>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 出差模式切换弹窗 Modal */}
      {showTravelModal && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            zIndex: 999999,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTravelModal(false);
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 380,
              padding: 20,
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
              出差 / 旅行临时环境模式
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              出差至不同温湿度的城市时，AI 将自动调整近几日的补水建议与室外安全防线。
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-dim)", display: "block", marginBottom: 4 }}>
                  出差城市
                </label>
                <input
                  type="text"
                  placeholder="例如: 哈尔滨、曼谷、新加坡"
                  value={travelCity}
                  onChange={(e) => setTravelCity(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: 13,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "var(--text-dim)", display: "block", marginBottom: 4 }}>
                  出差截止日期
                </label>
                <input
                  type="date"
                  value={travelUntil}
                  onChange={(e) => setTravelUntil(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: 13,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                className="btn sm"
                style={{ color: "var(--hr)", borderColor: "var(--border)" }}
                onClick={async () => {
                  await api.setCoachTravel(null, null);
                  setShowTravelModal(false);
                  await loadData();
                }}
              >
                清除出差
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => setShowTravelModal(false)}>
                  取消
                </button>
                <button className="btn primary" onClick={handleSaveTravel}>
                  启用
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 快捷调整训练日 Modal */}
      {showAdjustDaysModal && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAdjustDaysModal(false);
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 520,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface)",
              borderRadius: "var(--radius-lg, 12px)",
              border: "1px solid var(--border)",
              boxShadow: "0 24px 48px rgba(0, 0, 0, 0.35)",
              overflow: "hidden",
            }}
          >
            {/* 弹窗头部 */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface-2)",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
                🗓️ 快捷调整后续训练日安排
              </div>
              <button
                className="btn sm"
                onClick={() => setShowAdjustDaysModal(false)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            {/* 弹窗内容 */}
            <div style={{ padding: "18px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  background: "var(--accent-bg)",
                  border: "1px solid var(--accent-border)",
                  fontSize: 12,
                  color: "var(--text)",
                  lineHeight: 1.5,
                }}
              >
                <strong>💡 历史数据与周次智能保护机制：</strong>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
                  本次调整仅对后续待办课表自适应重排。您第 1 ~ {currentWeek} 周所有已完成的历史打卡记录（包含高驰、佳明、手动 FIT/GPX 上传等已同步数据）与周度复盘结论<strong>绝对受物理锁定保护</strong>，训练周次平滑连续，不会重置或被冲掉。
                </div>
              </div>

              {/* 每周训练日选择 */}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                  每周训练日选择 (已选 {preferredDays.length} 天)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const isChecked = preferredDays.includes(d);
                    const isLongRun = formData.longRunDay === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        style={{
                          padding: "8px 2px",
                          borderRadius: "var(--radius)",
                          border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
                          background: isChecked ? "var(--accent)" : "var(--surface-2)",
                          color: isChecked ? "#fff" : "var(--text-dim)",
                          fontWeight: isChecked ? 700 : 500,
                          fontSize: 12,
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 2,
                        }}
                      >
                        <span>{WEEKDAYS[d]}</span>
                        {isLongRun && <span style={{ fontSize: 9, opacity: 0.9 }}>长跑</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>长距离指定于：</span>
                  <select
                    value={formData.longRunDay ?? 0}
                    onChange={(e) => {
                      const day = Number(e.target.value);
                      let nextDays = [...preferredDays];
                      if (!nextDays.includes(day)) {
                        nextDays = [...nextDays, day].sort((a, b) => a - b);
                      }
                      setFormData({
                        ...formData,
                        longRunDay: day,
                        daysPerWeek: nextDays.length,
                        preferredDaysJson: JSON.stringify(nextDays),
                      });
                    }}
                    style={{
                      padding: "4px 8px",
                      fontSize: 12,
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--text)",
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>
                        {WEEKDAYS[d]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 弹窗底部 */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                background: "var(--surface-2)",
              }}
            >
              <button className="btn" onClick={() => setShowAdjustDaysModal(false)}>
                取消
              </button>
              <button
                className="btn primary"
                disabled={generating}
                onClick={async () => {
                  setShowAdjustDaysModal(false);
                  await handleSaveSettings();
                }}
              >
                确认调整并更新后续课表 🚀
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showStrengthLibraryModal && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowStrengthLibraryModal(false);
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface)",
              borderRadius: "var(--radius-lg, 12px)",
              border: "1px solid var(--border)",
              boxShadow: "0 24px 48px rgba(0, 0, 0, 0.35)",
              overflow: "hidden",
            }}
          >
            {/* 弹窗头部 */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                background: "var(--surface-2)",
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🏋️ 跑者专项：跑后核心与抗阻力量课表</span>
                  <span className="pill primary" style={{ fontSize: 11, padding: "1px 6px" }}>全周期默认纳入</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                  基于 Daniels & Canova 运动生理学 · 强化动力链肌腱刚度 · 预防跑步伤病 · 稳固后程跑姿
                </div>
              </div>
              <button
                className="btn sm"
                onClick={() => setShowStrengthLibraryModal(false)}
                style={{ padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            {/* 弹窗内容区 */}
            <div style={{ padding: "18px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* 科普横幅 */}
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius)",
                  background: "var(--accent-bg)",
                  border: "1px solid var(--accent-border)",
                  fontSize: 12,
                  color: "var(--text)",
                  lineHeight: 1.5,
                }}
              >
                <strong>💡 为什么长跑必须练跑后专项力量？</strong>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
                  严肃长跑的力量训练目标<strong>不是练大肌肉块</strong>，而是锻造深层骨盆抗旋转稳定性与小腿-跟腱的弹性刚度（Tendon Stiffness）。
                  研究表明：每周在跑后进行 2~3 次针对性核心与抗阻训练，可将 30km 后的跑姿塌陷率降低 40%，并有效预防跟腱炎、足底筋膜炎及髂胫束综合征 (ITBS)。
                </div>
              </div>

              {/* 4 大核心力量方案卡片 */}
              {Object.values(RUNNER_STRENGTH_ROUTINES).map((routine, rIdx) => (
                <div
                  key={routine.id}
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>方案 {String.fromCharCode(65 + rIdx)}：{routine.name}</span>
                      <span className="pill" style={{ fontSize: 10, padding: "1px 6px", background: "var(--surface)" }}>
                        约 {routine.durationMin} 分钟
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
                      📌 适用：{routine.targetRuns}
                    </span>
                  </div>

                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10 }}>
                    🎯 <strong>训练靶向：</strong>{routine.focus}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
                    {routine.exercises.map((ex, eIdx) => (
                      <div
                        key={eIdx}
                        style={{
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "8px 10px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 12, color: "var(--text)" }}>
                          <span>{eIdx + 1}. {ex.name}</span>
                          <span style={{ color: "var(--accent)", fontSize: 11, fontFamily: "var(--font-mono, monospace)" }}>
                            {ex.sets}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3, lineHeight: 1.35 }}>
                          {ex.target}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 弹窗底部 */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
                background: "var(--surface-2)",
              }}
            >
              <button className="btn primary" onClick={() => setShowStrengthLibraryModal(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/** 顶部核心生理指标卡片（带鼠标悬停/移动端点击查看通俗释义与科学参考区间标尺） */
function HeroStatCard({
  icon,
  label,
  value,
  valueColor,
  hint,
  hintTitle,
  alignRight = false,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  hint: React.ReactNode;
  hintTitle?: string;
  alignRight?: boolean;
  detail: {
    title: string;
    definition: string;
    currentLevel: string;
    levelColor: string;
    ranges: { label: string; range: string; isCurrent?: boolean }[];
    coachAdvice: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 640 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 桌面端点击外部或按 Escape 键关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!isMobile && cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, isMobile]);

  const detailContent = (
    <>
      {/* 移动端专属居中下拉手柄 */}
      {isMobile && <div className="coach-sheet-handle" />}

      {/* 标题与当前评级标签 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: isMobile ? 15 : 13, fontWeight: 800, color: "var(--text)" }}>
          {detail.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="pill"
            style={{
              fontSize: isMobile ? 11 : 10,
              padding: isMobile ? "2px 8px" : "1px 6px",
              fontWeight: 700,
              color: detail.levelColor,
              borderColor: detail.levelColor,
              background: "var(--surface-2)",
              flexShrink: 0,
            }}
          >
            {detail.currentLevel}
          </span>
          {isMobile && (
            <button
              type="button"
              className="coach-sheet-close-btn"
              onClick={() => setOpen(false)}
              title="关闭"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 通俗大白话定义 */}
      <div style={{ fontSize: isMobile ? 12.5 : 11.5, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 12 }}>
        {detail.definition}
      </div>

      {/* 科学参考区间对照表 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: isMobile ? 11.5 : 10.5, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
          📊 科学参考区间对照：
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {detail.ranges.map((r, rIdx) => (
            <div
              key={rIdx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: isMobile ? 11.5 : 10.5,
                padding: isMobile ? "4px 8px" : "3px 6px",
                borderRadius: 4,
                background: r.isCurrent ? "var(--accent-bg)" : "var(--surface-2)",
                border: r.isCurrent ? "1px solid var(--accent-border)" : "1px solid transparent",
                fontWeight: r.isCurrent ? 700 : 400,
                color: r.isCurrent ? "var(--accent)" : "var(--text)",
              }}
            >
              <span>{r.isCurrent ? "● " : ""}{r.label}</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: isMobile ? 11 : 10, color: r.isCurrent ? "var(--accent)" : "var(--text-dim)" }}>
                {r.range}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 教练行动提示 */}
      <div
        style={{
          fontSize: isMobile ? 12 : 11,
          color: "var(--text)",
          padding: isMobile ? "8px 10px" : "6px 8px",
          background: "var(--surface-2)",
          borderRadius: 6,
          borderLeft: `3px solid ${detail.levelColor}`,
          lineHeight: 1.45,
        }}
      >
        <strong>💡 教练解读：</strong>{detail.coachAdvice}
      </div>
    </>
  );

  return (
    <div
      ref={cardRef}
      className="card stat-card"
      style={{
        padding: "14px 16px",
        position: "relative",
        zIndex: open ? 1000 : 1,
        cursor: "pointer",
        userSelect: "none",
        transition: "box-shadow 0.2s, border-color 0.2s",
        borderColor: open ? "var(--accent)" : undefined,
      }}
      onMouseEnter={() => !isMobile && setOpen(true)}
      onMouseLeave={() => !isMobile && setOpen(false)}
      onClick={() => setOpen((prev) => !prev)}
    >
      <div className="stat">
        <span className="label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {icon}
            {label}
          </span>
          <span
            style={{
              fontSize: 10.5,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: open ? "var(--accent)" : "var(--surface-2)",
              color: open ? "#fff" : "var(--text-dim)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              opacity: 0.85,
              flexShrink: 0,
            }}
            title="点击或悬停查看通俗释义与参考标尺"
          >
            ⓘ
          </span>
        </span>
        <span className="value num" style={{ color: valueColor || "var(--text)" }}>
          {value}
        </span>
        <span className="hint truncate" title={hintTitle || (typeof hint === "string" ? hint : undefined)}>
          {hint}
        </span>
      </div>

      {/* 悬停/点击智能浮层 Popover（桌面端卡片下方气泡；手机端通过 createPortal 挂到 body 形成原生纯正底部抽屉） */}
      {open && (
        isMobile && typeof document !== "undefined" ? (
          createPortal(
            <>
              {/* 全局暗色透明遮罩 */}
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0, 0, 0, 0.55)",
                  backdropFilter: "blur(2px)",
                  zIndex: 999998,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
              />
              {/* 真正的全屏底贴式抽屉 Bottom Sheet */}
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "fixed",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  width: "100%",
                  maxWidth: "100%",
                  background: "var(--surface)",
                  borderTop: "1px solid var(--border)",
                  borderRadius: "20px 20px 0 0",
                  padding: "16px 20px max(24px, env(safe-area-inset-bottom, 24px)) 20px",
                  boxShadow: "0 -10px 40px rgba(0, 0, 0, 0.5)",
                  zIndex: 999999,
                  maxHeight: "82vh",
                  overflowY: "auto",
                  boxSizing: "border-box",
                  animation: "coachSheetSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {detailContent}
              </div>
            </>,
            document.body
          )
        ) : (
          <div
            className="coach-hero-popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              [alignRight ? "right" : "left"]: 0,
            }}
          >
            {detailContent}
          </div>
        )
      )}
    </div>
  );
}

/** 单周课表区块组件（移动端自适应快速跳转条与触控吸附轮播轨道） */
function WeekScheduleSection({
  weekIndex,
  workouts,
  onOpenActivity,
  reviewing,
  onReview,
  isUpcoming = false,
}: {
  weekIndex: number;
  workouts: CoachWorkout[];
  onOpenActivity: (labelId: string) => void;
  reviewing?: boolean;
  onReview?: () => void;
  isUpcoming?: boolean;
}) {
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    const tIdx = workouts.findIndex((w) => w.date === todayStr);
    if (tIdx >= 0) {
      setActiveDayIdx(tIdx);
    }
  }, [workouts, todayStr]);

  // 桌面端（尤其是 Windows 普通单滚轮鼠标）：在课表轨道上滚动鼠标滚轮时，自动转化为顺滑横向滚动
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      // 仅当轨道存在横向溢出内容时介入
      if (el.scrollWidth > el.clientWidth) {
        // 垂直滚轮幅度明显大于水平滚轮时（非触摸板横滑）
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
          const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
          if (!atStart && !atEnd) {
            el.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const scrollToDay = (idx: number) => {
    setActiveDayIdx(idx);
    const container = trackRef.current;
    if (!container) return;
    const cardEl = container.children[idx] as HTMLElement;
    if (cardEl) {
      const scrollLeft = cardEl.offsetLeft - (container.clientWidth - cardEl.clientWidth) / 2;
      container.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
    }
  };

  const totalKm = Math.round(workouts.reduce((s, w) => s + w.distanceKm, 0));

  return (
    <div style={{ paddingTop: isUpcoming ? 16 : 0, borderTop: isUpcoming ? "1px dashed var(--border)" : undefined }}>
      {/* 头部标题与统计 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`pill ${isUpcoming ? "" : "accent"}`} style={{ fontSize: 12, padding: "3px 10px", fontWeight: 700 }}>
            {isUpcoming ? `第 ${weekIndex} 周 (滚动预告)` : `第 ${weekIndex} 周 (执行中)`}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
            计划总跑量: <strong style={{ color: "var(--text)" }}>{totalKm} km</strong>
            {isUpcoming && (
              <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 6 }}>
                (将根据第 {weekIndex - 1} 周实操数据自适应微调)
              </span>
            )}
          </span>
        </div>

        {!isUpcoming && onReview && (
          <button
            disabled={reviewing}
            onClick={onReview}
            className="btn"
            style={{
              fontSize: 12,
              padding: "5px 12px",
              borderColor: "var(--good-border)",
              color: "var(--good)",
              background: "var(--good-bg)",
            }}
          >
            {reviewing ? "结算复盘中..." : "✅ 结算本周完成情况并微调"}
          </button>
        )}
      </div>

      {/* 移动端专属：7 天快速跳转胶囊条 */}
      <div className="coach-mobile-week-strip">
        {workouts.map((w, idx) => {
          const isToday = w.date === todayStr;
          const isSelected = activeDayIdx === idx;
          const isRest = w.workoutType === "rest";
          return (
            <button
              key={w.id}
              type="button"
              className={`coach-mobile-day-btn ${isSelected ? "active" : ""} ${isToday ? "today" : ""}`}
              onClick={() => scrollToDay(idx)}
            >
              <span>{WEEKDAYS[w.dayOfWeek]}</span>
              <span style={{ fontSize: 9.5, opacity: 0.85, marginTop: 1 }}>{w.date.slice(5)}</span>
              {isToday && (
                <span style={{ fontSize: 8.5, background: "rgba(255,255,255,0.28)", padding: "0 3px", borderRadius: 2, marginTop: 1 }}>
                  今日
                </span>
              )}
              <span
                className="day-dot"
                style={{
                  background: w.status === "completed"
                    ? "var(--good)"
                    : isRest
                    ? "var(--text-faint)"
                    : isSelected
                    ? "#fff"
                    : "var(--accent)",
                }}
              />
            </button>
          );
        })}
      </div>

      {/* 课表滑动轨道 */}
      <div ref={trackRef} className="coach-schedule-track" style={{ opacity: isUpcoming ? 0.94 : 1 }}>
        {workouts.map((w) => (
          <WorkoutCard key={w.id} workout={w} onOpenActivity={onOpenActivity} isUpcoming={isUpcoming} />
        ))}
      </div>
    </div>
  );
}

/** 单日课表卡片组件 */
function WorkoutCard({
  workout,
  onOpenActivity,
  isUpcoming = false,
}: {
  workout: CoachWorkout;
  onOpenActivity: (labelId: string) => void;
  isUpcoming?: boolean;
}) {
  const [showAlt, setShowAlt] = useState(false);
  const [expandedDesc, setExpandedDesc] = useState(false);
  const alt = workout.alternativeJson ? JSON.parse(workout.alternativeJson) : null;
  const isRest = workout.workoutType === "rest";

  // 状态颜色
  let badgeStyle = { background: "var(--surface-2)", color: "var(--text-faint)", border: "1px solid var(--border)" };
  let badgeText = "待完成";
  if (workout.status === "completed") {
    badgeStyle = { background: "var(--good-bg)", color: "var(--good)", border: "1px solid var(--good-border)" };
    badgeText = workout.complianceScore ? `已完成 ${workout.complianceScore}%` : "已完成";
  } else if (workout.status === "missed") {
    badgeStyle = { background: "var(--warn-bg)", color: "var(--warn)", border: "1px solid var(--warn-border)" };
    badgeText = "未完成";
  }

  // 训练类型标签与色彩标记
  let typeColor = "var(--pace)";
  let typeLabel = "低心率轻松跑 (E)";
  const isRace = workout.workoutType === "race";
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = workout.date === todayStr;

  const wType = (workout.workoutType || "easy").toLowerCase();
  const titleLow = (workout.title || "").toLowerCase();

  if (wType === "race" || titleLow.includes("比赛")) {
    typeColor = "#d97706";
    typeLabel = "🎯 目标赛事";
  } else if (wType === "interval" || titleLow.includes("间歇")) {
    typeColor = "#8b5cf6";
    typeLabel = "间歇跑 (I)";
  } else if (wType === "threshold" || titleLow.includes("门槛") || titleLow.includes("乳酸")) {
    typeColor = "#f59e0b";
    typeLabel = "乳酸阈值跑 (T)";
  } else if (wType === "marathon" || titleLow.includes("马拉松") || titleLow.includes("稳态") || titleLow.includes("动力")) {
    typeColor = "#06b6d4";
    typeLabel = "马拉松配速跑 (M)";
  } else if (wType === "tempo") {
    typeColor = "#f59e0b";
    typeLabel = "节奏跑";
  } else if (wType === "long" || titleLow.includes("长距离") || titleLow.includes("lsd")) {
    typeColor = "#10b981";
    typeLabel = "长距离耐力 (LSD)";
  } else if (wType === "recovery" || titleLow.includes("排酸") || titleLow.includes("恢复")) {
    typeColor = "#0284c7";
    typeLabel = "排酸恢复跑";
  } else if (wType === "rest" || titleLow.includes("休")) {
    typeColor = "var(--text-faint)";
    typeLabel = "休息恢复";
  } else {
    typeColor = "var(--accent)";
    typeLabel = "低心率轻松跑 (E)";
  }

  // 解析课表内部结构 (热身 / 主课 / 冷身里程拆解)
  let struct: { focusMetric?: "pace" | "hr"; warmupKm?: number; mainKm?: number; cooldownKm?: number } | null = null;
  try {
    if (workout.structureJson) struct = JSON.parse(workout.structureJson);
  } catch {}

  const hasStructure = Boolean(
    struct &&
    typeof struct.warmupKm === "number" &&
    struct.warmupKm > 0 &&
    typeof struct.cooldownKm === "number" &&
    struct.cooldownKm > 0 &&
    typeof struct.mainKm === "number" &&
    struct.mainKm > 0
  );

  // 判断考核基准：该心率就心率，该配速就配速
  let focusMetric: "pace" | "hr" = "hr";
  if (struct?.focusMetric === "pace" || struct?.focusMetric === "hr") {
    focusMetric = struct.focusMetric;
  } else {
    if (
      ["interval", "tempo", "threshold", "marathon", "race"].includes(wType) ||
      titleLow.includes("间歇") ||
      titleLow.includes("门槛") ||
      titleLow.includes("乳酸") ||
      titleLow.includes("马拉松") ||
      titleLow.includes("比赛")
    ) {
      focusMetric = "pace";
    } else {
      focusMetric = "hr";
    }
  }

  const [showRoutine, setShowRoutine] = useState(false);
  const routine =
    (struct as any)?.strengthRoutine ||
    (!isRest ? getStrengthRoutineForWorkout(wType, workout.dayOfWeek, isRest) : null);

  const cleanedDesc = (workout.description || "")
    .replace(/【(?:心率|配速)主导[^】]*】\s*/g, "")
    .replace(/(?:心率|配速)主导(?:[（(][^）)]*[）)])?[：:]\s*/g, "")
    .replace(/^(?:心率存在生理滞后|训练专项目标配速下的跑步经济性|核心目标是扩展毛细血管床|重点是发展脂肪氧化代谢|乳酸门槛转折点需要恒定的车速|极低强度促进血液循环|主动恢复[，、]维持血液循环|双周最长课[，、]验证)[^\n。]*[。；\n]\s*/gm, "")
    .trim();

  return (
    <div
      className="card coach-workout-card"
      style={{
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        borderTop: isRace ? "4px solid #f59e0b" : isToday ? "4px solid var(--accent)" : `3px solid ${typeColor}`,
        border: isRace ? "2px solid #f59e0b" : isToday ? "2px solid var(--accent)" : undefined,
        background: isRace
          ? "rgba(245, 158, 11, 0.05)"
          : isToday
          ? "var(--surface)"
          : isRest
          ? "var(--surface-2)"
          : "var(--surface)",
        minHeight: 220,
        boxShadow: isRace
          ? "0 4px 16px rgba(245, 158, 11, 0.16)"
          : isToday
          ? "0 4px 14px var(--accent-dim)"
          : undefined,
        position: "relative",
      }}
    >
      <div>
        {/* 顶部星期与状态 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 4 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: isToday ? 800 : 600,
              color: isToday ? "var(--accent)" : "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            {WEEKDAYS[workout.dayOfWeek]} <span style={{ fontSize: 11, opacity: 0.65, fontWeight: 500 }}>{workout.date.slice(5)}</span>
          </span>
          <span
            className="pill"
            style={{
              fontSize: 10,
              padding: "1px 6px",
              fontWeight: 700,
              whiteSpace: "nowrap",
              flexShrink: 0,
              ...(isRace
                ? { background: "rgba(245, 158, 11, 0.15)", color: "#d97706", borderColor: "#f59e0b" }
                : isToday && workout.status === "pending"
                ? { background: "var(--accent-bg)", color: "var(--accent)", borderColor: "var(--accent)" }
                : isToday && workout.status === "completed"
                ? { background: "var(--good-bg)", color: "var(--good)", borderColor: "var(--good-border)" }
                : badgeStyle),
            }}
          >
            {isRace ? "🎯 比赛日" : isToday && workout.status === "pending" ? "今日待练" : isToday && workout.status === "completed" ? (workout.complianceScore ? `今日完成 ${workout.complianceScore}%` : "今日已完成") : badgeText}
          </span>
        </div>

        {/* 训练类型胶囊与目标跑量 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span
            className="pill"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: typeColor,
              borderColor: typeColor,
              padding: "1px 6px",
            }}
          >
            {typeLabel}
          </span>
          {workout.distanceKm > 0 && (
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }} className="num">
                {workout.distanceKm} <span style={{ fontSize: 10.5, fontWeight: 500, color: "var(--text-dim)" }}>km</span>
              </span>
            </div>
          )}
        </div>

        {/* 标题 */}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: hasStructure ? 3 : 6, lineHeight: 1.3 }}>
          {workout.title}
        </div>

        {/* 里程结构拆解 (热身 · 主课 · 冷身) */}
        {hasStructure && (
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              marginBottom: 6,
              fontFamily: "var(--font-mono, monospace)",
            }}
            title={`全天总跑量 ${workout.distanceKm}km = 慢跑热身 ${struct!.warmupKm}km + 专项核心主课 ${struct!.mainKm}km + 慢跑冷身 ${struct!.cooldownKm}km`}
          >
            <span>热身 {struct!.warmupKm}k</span>
            <span style={{ margin: "0 3px", opacity: 0.4 }}>·</span>
            <span style={{ color: "var(--accent)", fontWeight: 700 }}>主课 {struct!.mainKm}k</span>
            <span style={{ margin: "0 3px", opacity: 0.4 }}>·</span>
            <span>冷身 {struct!.cooldownKm}k</span>
          </div>
        )}

        {/* 配速与心率考核指标：统一紧凑卡片 */}
        {!isRest && (
          <div
            style={{
              background: focusMetric === "pace" ? "rgba(59, 130, 246, 0.05)" : "rgba(239, 68, 68, 0.05)",
              border: `1px solid ${focusMetric === "pace" ? "rgba(59, 130, 246, 0.22)" : "rgba(239, 68, 68, 0.22)"}`,
              borderRadius: 5,
              padding: "5px 7px",
              marginBottom: 6,
            }}
          >
            {/* 核心指标行 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: focusMetric === "pace" ? "#2563eb" : "#dc2626" }}>
                {focusMetric === "pace" ? "⚡ 目标配速" : "❤️ 目标心率"}
              </span>
              <strong
                style={{
                  fontSize: 12.5,
                  fontFamily: "var(--font-mono, monospace)",
                  color: focusMetric === "pace" ? "#1d4ed8" : "#b91c1c",
                }}
              >
                {focusMetric === "pace"
                  ? `${fmtPace(workout.targetPaceMinSec)}~${fmtPace(workout.targetPaceMaxSec)}/km`
                  : `${workout.targetHrMin}~${workout.targetHrMax} bpm`}
              </strong>
            </div>

            {/* 次要参考行 */}
            {focusMetric === "pace" && workout.targetHrMin ? (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--text-dim)", marginTop: 2, opacity: 0.85 }}>
                <span>心率参考</span>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  {workout.targetHrMin}~{workout.targetHrMax} bpm
                </span>
              </div>
            ) : focusMetric === "hr" && workout.targetPaceMinSec ? (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "var(--text-dim)", marginTop: 2, opacity: 0.85 }}>
                <span>参考配速</span>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  ~{fmtPace(workout.targetPaceMinSec)}/km
                </span>
              </div>
            ) : null}
          </div>
        )}

        {/* 教练指导语 */}
        {cleanedDesc && (
          <div style={{ marginBottom: 6 }}>
            <p
              onClick={() => {
                if (cleanedDesc.length > 30) setExpandedDesc(!expandedDesc);
              }}
              style={{
                margin: 0,
                fontSize: 10.5,
                color: "var(--text-dim)",
                lineHeight: 1.4,
                display: expandedDesc ? "block" : "-webkit-box",
                WebkitLineClamp: expandedDesc ? undefined : 2,
                WebkitBoxOrient: "vertical",
                overflow: expandedDesc ? "visible" : "hidden",
                cursor: cleanedDesc.length > 30 ? "pointer" : "default",
              }}
              title={cleanedDesc}
            >
              {cleanedDesc}
            </p>
            {cleanedDesc.length > 30 && (
              <span
                onClick={() => setExpandedDesc(!expandedDesc)}
                style={{
                  fontSize: 9.5,
                  color: "var(--accent)",
                  cursor: "pointer",
                  marginTop: 2,
                  display: "inline-block",
                  userSelect: "none",
                  fontWeight: 500,
                }}
              >
                {expandedDesc ? "收起 ▴" : "展开 ▾"}
              </span>
            )}
          </div>
        )}

        {/* 跑后核心与力量强化专项课表 */}
        {routine && (
          <div
            style={{
              marginTop: 6,
              marginBottom: 6,
              padding: "6px 8px",
              background: "var(--surface-2)",
              border: "1px dashed var(--border)",
              borderRadius: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
              }}
              onClick={() => setShowRoutine(!showRoutine)}
              title="点击查看今日跑后专项动作与组数"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11 }}>🏋️</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                  {routine.name}
                </span>
                <span
                  style={{
                    fontSize: 9.5,
                    padding: "0 4px",
                    borderRadius: 3,
                    background: "var(--accent-bg)",
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {routine.durationMin}min
                </span>
              </div>
              <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                {showRoutine ? "收起" : "展开动作 ▾"}
              </span>
            </div>

            {showRoutine && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 9.5, color: "var(--text-dim)", marginBottom: 5 }}>
                  🎯 {routine.focus}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {routine.exercises.map((ex, exIdx) => (
                    <div
                      key={exIdx}
                      style={{
                        fontSize: 10,
                        background: "var(--surface)",
                        padding: "5px 7px",
                        borderRadius: 4,
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "var(--text)" }}>
                        <span>{exIdx + 1}. {ex.name}</span>
                        <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono, monospace)" }}>{ex.sets}</span>
                      </div>
                      <div style={{ fontSize: 9.5, color: "var(--text-dim)", marginTop: 2 }}>
                        {ex.target}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 室内跑步机备选切换（暂时隐藏） */}
        {/*
        {alt && alt.type === "treadmill" && (
          <div style={{ marginBottom: 6 }}>
            <span
              onClick={() => setShowAlt(!showAlt)}
              style={{
                fontSize: 11,
                color: "var(--accent)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {showAlt ? "收起备选" : "🏃 恶劣天气跑步机备选"}
            </span>
            {showAlt && (
              <div
                style={{
                  marginTop: 4,
                  padding: "6px 8px",
                  fontSize: 10.5,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text-dim)",
                  lineHeight: 1.4,
                }}
              >
                {alt.note}
              </div>
            )}
          </div>
        )}
        */}
      </div>

      {/* 底部打卡比对 (支持多次分段跑步记录单独点击查看) */}
      {workout.actualLabelId && workout.actualDistanceKm ? (() => {
        let matchedList: { labelId: string; distanceKm: number; avgPaceSec?: number; avgHr?: number }[] = [];
        if (workout.actualLabelId.startsWith("[")) {
          try {
            matchedList = JSON.parse(workout.actualLabelId);
          } catch {}
        }
        if (matchedList.length === 0) {
          matchedList = [{
            labelId: workout.actualLabelId,
            distanceKm: workout.actualDistanceKm,
            avgPaceSec: workout.actualAvgPaceSec ?? undefined,
            avgHr: workout.actualAvgHr ?? undefined,
          }];
        }

        if (matchedList.length <= 1) {
          return (
            <div
              style={{
                paddingTop: 8,
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
              }}
            >
              <div>
                <span style={{ color: "var(--text-faint)", fontSize: 10 }}>实测完成 </span>
                <strong style={{ color: "var(--good)" }} className="num">{workout.actualDistanceKm} km</strong>
              </div>
              <button
                className="btn sm"
                onClick={() => onOpenActivity(matchedList[0].labelId)}
                style={{ fontSize: 10.5, padding: "2px 6px" }}
              >
                详情 →
              </button>
            </div>
          );
        }

        return (
          <div
            style={{
              paddingTop: 8,
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 11,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ color: "var(--text-faint)", fontSize: 10 }}>实测完成 </span>
                <strong style={{ color: "var(--good)" }} className="num">{workout.actualDistanceKm} km</strong>
                <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 4 }}>({matchedList.length}段)</span>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {matchedList.map((m, idx) => (
                <button
                  key={m.labelId}
                  className="btn sm"
                  onClick={() => onOpenActivity(m.labelId)}
                  style={{ fontSize: 10, padding: "1px 5px", background: "var(--surface-2)" }}
                  title={`第 ${idx + 1} 段: ${m.distanceKm} km ${m.avgPaceSec ? "· " + fmtPace(m.avgPaceSec) + "/km" : ""}`}
                >
                  #{idx + 1} {m.distanceKm}k →
                </button>
              ))}
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
