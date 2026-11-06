import { db } from "../../db/client.ts";
import { aiCoachProfiles, aiCoachPlans, aiCoachWorkouts, activities } from "../../db/schema.ts";
import { eq, and, asc, ne } from "drizzle-orm";
import { getAiConfig, callModel } from "../provider.ts";
import { computeAthleteBaseline, evaluateGoalFeasibility, type BaselineSnapshot } from "./baseline.ts";
import { fmtDuration } from "../../format.ts";
import {
  generateMacroOutline,
  buildWeeklySlots,
  type MacroWeekOutline,
  type DayTemplateSlot,
} from "./periodization.ts";

export interface WorkoutItemToSave {
  date: string;
  weekIndex: number;
  dayOfWeek: number;
  phase: string;
  workoutType: string;
  title: string;
  description: string;
  distanceKm: number;
  durationMinutes: number;
  targetPaceMinSec: number | null;
  targetPaceMaxSec: number | null;
  targetHrMin: number | null;
  targetHrMax: number | null;
  structureJson: string;
  alternativeJson: string;
}

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
  exercises: StrengthExercise[];
}

export const RUNNER_STRENGTH_ROUTINES: Record<string, StrengthRoutine> = {
  core_stability: {
    id: "core_stability",
    name: "跑后抗旋转骨盆核心稳定课",
    durationMin: 15,
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

function fmtPace(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function parsePaceToSec(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return val > 0 ? Math.round(val) : null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed));
    const parts = trimmed.split(":");
    if (parts.length === 2) {
      const m = parseInt(parts[0], 10);
      const s = parseInt(parts[1], 10);
      if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
    }
  }
  return null;
}

function normalizeWorkoutType(type: any): string {
  if (!type || typeof type !== "string") return "easy";
  const t = type.toLowerCase().trim();
  if (t.includes("race") || t.includes("比赛")) return "race";
  if (t.includes("rest") || t.includes("休")) return "rest";
  if (t.includes("long") || t.includes("lsd") || t.includes("长")) return "long";
  if (t.includes("interval") || t.includes("间歇")) return "interval";
  if (t.includes("threshold") || t.includes("门槛") || t.includes("乳酸")) return "threshold";
  if (t.includes("marathon") || t.includes("马") || t.includes("steady")) return "marathon";
  if (t.includes("tempo") || t.includes("动力")) return "tempo";
  if (t.includes("recovery") || t.includes("排酸") || t.includes("激活") || t.includes("shakeout")) return "recovery";
  return "easy";
}

const COACH_SYSTEM_PROMPT = `你是一位世界顶级专业耐力跑步教练与运动生理学专家（精通 Jack Daniels 丹尼尔斯经典训练法、Renato Canova 马拉松专项收敛、Stephen Seiler 80/20 极化训练与 Issurin 板块周期）。
系统内部科学算法底座已经精准计算了该跑者的各项生理数据、体能负荷（CTL/ATL/TSB/ACWR）、个人储备心率区间 (HRR)、各配速区间与偏好设置。

你的任务是：
基于内部科学算法底座提供的 Ground Truth 数据与约束，为跑者量身制定严格对应未来两周（严格自然周一至周日共 14 天）的个性化科学课表，并直接返回合法的 JSON 对象。

核心指导原则：
1. 【尊重跑者实力基准】：该跑者是能够驾驭单次 10K+ 有氧、周跑量 55~65km、全马约 3小时05分水平的严肃高阶跑者。单次轻松跑/节奏跑建议 10~12km，周末长跑建议 20~24km。严禁生成 3~4km 这种针对初学者的极低跑量。
2. 【分工明确的执行基准（该心率就心率，该配速就配速，严禁写二选一）】：
   每堂课必须指明【控制基准 (focusMetric)】（"pace" 或 "hr"），根据课表生理刺激目的明确划分：
   - 【间歇跑 (Intervals / VO2max)】：必须【配速主导 (pace)】！高强度间歇跑心率存在明显的生理滞后性，必须盯准秒表配速执行，以秒表配速为唯一考核基准。
   - 【乳酸阈值跑 (Threshold Tempo / T跑)】：必须【配速主导 (pace)】！乳酸门槛转折点需要恒定的车速以训练乳酸生成-清除平衡，必须严格在门槛配速区间巡航。
   - 【马拉松配速稳态跑 (Marathon Pace / M跑)】：必须【配速主导 (pace)】！训练专项目标配速下的跑步经济性与肌肉神经记忆，严格按目标马拉松配速巡航。
   - 【低心率纯有氧基础跑 (Zone 2 Easy / E跑)】：必须【心率主导 (hr)】！核心目标是扩展毛细血管床与心室容积，严禁死磕配速，必须把心率严格压制在储备心率 Z1 (136~155 bpm) 封顶，顺应地形体感，配速自然浮动。
   - 【周末长距离耐力跑 (LSD)】：必须【心率主导 (hr)】！重点是发展脂肪氧化代谢与防心血管漂移，全程紧盯心率稳态，严防后程心率失控。
   - 【排酸恢复跑 (Recovery Shakeout)】：必须【心率主导 (hr)】！极低强度促进血液循环，心率压在极低水平，配速越慢越好。
3. 【课表丰富度与科学组合】：
   对于每周 4~6 天的严肃跑者，双周周期内必须包含以下多样化关键课表组合：
   - 间歇跑 (interval)：例如 1000m × 5~6 组 (间歇配速 3:45~3:55/km，组间慢跑 90-120秒) 或 800m × 8 组；
   - 乳酸阈值跑 (threshold)：例如 热身 2km + 连续 6~8km 门槛节奏跑 (门槛配速 4:05~4:15/km) + 冷身 2km；
   - 马拉松配速稳态跑 (marathon)：例如 热身 2km + 连续 10~14km 专项配速 (4:20~4:28/km) + 冷身 1.5km；
   - 低心率基础跑 (easy)：10~12km (心率 Z1 136~155 bpm)；
   - 周末长距离跑 (long)：20~24km (心率 Z1~Z2 稳态)；
   - 恢复跑 (recovery) 与 彻底休息日 (rest)；
   注意：同一周内高强度课（间歇/门槛）不得连续两天安排，中间必须插入轻松跑或休息日（硬/易交替原则）。
4. 【目标情境划分】：
   - 若处于【目标比赛备战】且赛期临近（例如 2-3 天后比赛）：赛前 2 天彻底休息充碳（0km），赛前 1 天为 3km 神经激活慢跑+短冲跨步，比赛日全力出战，赛后首周安排超低心率排酸恢复。
   - 若处于【常态进阶/维持健康】：按 80/20 极化与 3:1 阶梯超补偿平稳推进，包含上述丰富的专项课表组合，不得插入突兀的比赛日。
5. 【科学处理期望目标成绩与当前能力的落差（严防拔苗助长导致严重运动损伤）】：
   跑者可能设定了远大的比赛期望成绩（例如全马期望破三 2:59:59，或半马 110 等）：
   - 若跑者目标属于【跨周期长期愿景】（当前水平与目标差距较大，例如当前全马预测 4~5 小时，但目标设定为破三）：
     你作为顶级运动生理学专家与总教练，必须在 summary 寄语中以高度专业且富有同理心的口吻指导跑者：
     高度赞赏其雄心壮志，但必须严肃指出运动生理学规律：“跨级成绩差距需要经过 2~3 个完整的宏周期（1~2年）稳步积累，绝不可能靠单周期十几周拔苗助长达成。本双周课表确立为破三宏伟蓝图的‘第 1 阶段奠基与专项突破’，必须立足于您当前的真实能力稳健向上超补偿，绝不能直接盲目套用 4:15/km 的破三专项配速去拉长距离，否则极易引发胫骨疲劳性骨裂、韧带急性损伤与深度过度训练！安全无伤才能持续变强！”
     排课时，配速必须基于跑者当前的真实基准配速稳健向上微调（例如当前水平提升 1~2%），绝不要直接跨级输出破三配速。
   - 若跑者目标属于【实力契合】或【挑战突破】（差距在 3%~8% 以内）：
     则可以在节奏课与间歇课中积极围绕目标比赛配速巡航进行专项收敛，强化抗乳酸耐受与比赛体感。
6. 【结合跑者生理表型（有氧短板 vs 速度/无氧短板）动态倾斜排课重心】：
   系统内部科学算法底座已基于跑者的 Riegel 疲劳衰减指数 k、短程 vs 长程 VDOT 差值以及长跑后半程心率漂移 (Pw:Hr)，精准诊断出了跑者的生理表型：
   - 若跑者为【⚡ 速度爆发型（有氧耐力短板 / 跑得快但持续不长）】：
     快肌爆发力好，但慢肌线粒体密度与脂肪氧化不足，容易在长跑中后段剧烈衰减。
     【排课重点倾斜】：双周课表必须以【打牢有氧地基与慢肌抗疲劳】为第一核心！增加 Zone 2 纯有氧基础跑 (E) 的里程比重，严格压制心率在储备心率 Zone 1 (136~155 bpm) 封顶，严禁盲目跑快沦为半吊子无效混氧；周末长跑 (LSD) 必须全程匀速稳态巡航，严禁后半程盲目冲刺，首要任务是压低心血管漂移 (Pw:Hr) 并提升脂肪供能比；适度控制高乳酸无氧大间歇组数，避免快肌无氧酵解过度兴奋抑制有氧氧化酶。
   - 若跑者为【🛡️ 长明灯耐力型（速度动力/无氧短板 / 跑得慢但能撑很久）】：
     长跑耐受如磐石、心率漂移极低，但 5K/10K 冲刺与高步频神经反射不足，速度天花板低。
     【排课重点倾斜】：双周课表必须以【激活快肌神经募集与拓宽速度天花板】为第一核心！重点加码最大摄氧量巡航间歇跑 (VO2max Intervals, 1000m×6 组 @ 3:45~3:50/km) 与乳酸阈值门槛跑 (T)；在轻松跑后固定安排 4~5 组 80~100m 跨步跑 (Strides) 激活神经反射；在周末长跑最后 3~4km 安排 Fast-Finish 渐进加速至马拉松目标配速，打破低速巡航舒适区锁定！
   - 若跑者为【⚖️ 速度耐力均衡型】：
     按 80/20 极化金字塔与 Canova 专项收敛均衡推进。
7. 【训练日与休息日铁律约束（严禁擅自增减、调换训练日或偷跑）】：
   跑者的工作与生活节奏高度依赖其设定的训练日与休息日安排：
   - 在待生成的 14 天自然日历中，系统已逐日锁定角色。凡标注【必须为休息日 Rest Day】的日期，当天严禁安排任何跑步（包括排酸恢复跑），workoutType 必须为 "rest"，distanceKm 为 0，durationMinutes 为 0！
   - 凡标注【必须为训练日 Run Day】的日期，严禁设为休息日（rest），必须安排科学跑步课表！
   - 凡标注【长距离长跑指定日 Long Run】的日期，workoutType 必须为 "long"，且只能安排在指定的这一天，严禁挪动至其他日子！
8. 【严格输出格式】：直接返回 JSON 对象，格式如下：
{
  "summary": "AI总教练致跑者的双周备战寄语与体能诊断分析（约 80-150 字，点明当前体能状态、负荷把控与训练哲学）",
  "workouts": [
    {
      "date": "yyyy-mm-dd",
      "workoutType": "interval | threshold | marathon | easy | long | recovery | race | rest",
      "title": "课表主题名称（如：最大摄氧量巡航间歇 1000m×6、乳酸阈值稳态巡航 8km、马拉松配速专项稳态跑 14km、低心率纯有氧基础跑 10km、周末渐进长距离耐力跑 22km）",
      "focusMetric": "pace | hr",
      "distanceKm": 10.0,
      "durationMinutes": 50,
      "targetPaceMinSec": 245,
      "targetPaceMaxSec": 255,
      "targetHrMin": 159,
      "targetHrMax": 173,
      "description": "详细动作要求与课表结构（简洁清晰说明热身、主课间歇/稳态组数、冷身拉伸，专注动作要求与训练执行，严禁在开头添加【心率主导】、【配速主导】等理论解释前缀）",
      "alternativeNote": "恶劣天气跑步机建议（如：室内跑步机 1% 坡度，速度设定 13.0 km/h）"
    }
  ]
}`;

function getRaceDistanceKm(targetDistance: string): number {
  if (targetDistance === "marathon") return 42.195;
  if (targetDistance === "half_marathon") return 21.0975;
  if (targetDistance === "10k") return 10.0;
  if (targetDistance === "5k") return 5.0;
  return 42.195;
}

export function stripMetricExplanations(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/【(?:心率|配速)主导[^】]*】\s*/g, "")
    .replace(/(?:心率|配速)主导(?:[（(][^）)]*[）)])?[：:]\s*/g, "")
    .replace(/^(?:心率存在生理滞后|训练专项目标配速下的跑步经济性|核心目标是扩展毛细血管床|重点是发展脂肪氧化代谢|乳酸门槛转折点需要恒定的车速|极低强度促进血液循环|主动恢复[，、]维持血液循环|双周最长课[，、]验证)[^\n。]*[。；\n]\s*/gm, "")
    .trim();
}

/**
 * 生成全周期宏观大纲并落地滚动的未来两周 (严格周一至周日 14天) 细化课表
 */
export async function generateTwoWeekRollingPlan(profileId: number, startFromDateStr?: string) {
  const profile = db.select().from(aiCoachProfiles).where(eq(aiCoachProfiles.id, profileId)).get();
  if (!profile) throw new Error("找不到 AI 教练档案");

  // 使用当前本地时间基准
  const now = startFromDateStr ? new Date(`${startFromDateStr}T00:00:00`) : new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();
  const curDate = now.getDate();
  const todayStr = `${curYear}-${String(curMonth + 1).padStart(2, "0")}-${String(curDate).padStart(2, "0")}`;

  const baseline = computeAthleteBaseline(todayStr);

  if (!baseline.hasData) {
    throw new Error("当前档案尚未同步任何跑步记录，无法推演生理底座与生成科学课表。请先连接运动手表同步历史数据。");
  }

  let preferredDays: number[] = [2, 4, 6, 0];
  try {
    preferredDays = JSON.parse(profile.preferredDaysJson);
  } catch {}

  const travelMode = profile.travelModeJson ? JSON.parse(profile.travelModeJson) : null;
  // 严格依据 profile.targetType：只有当用户明确选择 "race" 且设定了有效比赛日期时，才激活比赛逻辑
  const targetRaceDate = (profile.targetType === "race" && profile.targetRaceDate && profile.targetRaceDate.trim().length >= 8)
    ? profile.targetRaceDate.trim()
    : null;

  // 1. 生成宏周期包络线大纲
  const outlines = generateMacroOutline(todayStr, targetRaceDate, baseline, profile.daysPerWeek);
  const totalWeeks = outlines.length;
  const endDateStr = outlines[outlines.length - 1].endDate;

  // 2. 写入或更新 ai_coach_plans
  let plan = db.select().from(aiCoachPlans).where(and(eq(aiCoachPlans.profileId, profileId), eq(aiCoachPlans.status, "active"))).get();

  const planTitle = targetRaceDate
    ? `备战目标赛事 (${profile.targetDistance === "marathon" || profile.targetDistance === "general" ? "全马" : profile.targetDistance === "half_marathon" ? "半马" : profile.targetDistance}) · 比赛日 ${targetRaceDate}`
    : `进阶有氧与健康维持 · ${totalWeeks} 周科学阶梯方案`;

  const currentWeek = plan?.currentWeek && plan.currentWeek >= 1 ? plan.currentWeek : 1;
  const initialStartDate = plan?.startDate || todayStr;

  if (plan) {
    db.update(aiCoachPlans)
      .set({
        title: planTitle,
        startDate: initialStartDate,
        endDate: endDateStr,
        totalWeeks,
        currentWeek,
        baselineSnapshotJson: JSON.stringify(baseline),
        macroOutlineJson: JSON.stringify(outlines),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(aiCoachPlans.id, plan.id))
      .run();
  } else {
    const inserted = db
      .insert(aiCoachPlans)
      .values({
        profileId,
        title: planTitle,
        startDate: todayStr,
        endDate: endDateStr,
        totalWeeks,
        currentWeek: 1,
        status: "active",
        baselineSnapshotJson: JSON.stringify(baseline),
        macroOutlineJson: JSON.stringify(outlines),
      })
      .returning({ id: aiCoachPlans.id })
      .get();
    plan = { id: inserted.id } as any;
  }

  const planId = plan!.id;

  // 3. 构建以自然周（周一至周日）为基准的双周（14天）细化课表
  const deterministicWorkouts: WorkoutItemToSave[] = [];
  const raceDistKm = getRaceDistanceKm(profile.targetDistance);

  // 计算本周一的准确本地日期 (0是周日, 1-6是周一至周六)
  const dayOfWeekToday = now.getDay();
  const diffToMonday = dayOfWeekToday === 0 ? -6 : 1 - dayOfWeekToday;

  for (let i = 0; i < 14; i++) {
    const d = new Date(curYear, curMonth, curDate + diffToMonday + i, 0, 0, 0);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayOfWeek = d.getDay(); // 0-6 (周一为1, 周日为0)
    const weekIndex = i < 7 ? currentWeek : currentWeek + 1;

    // 检查与比赛日的天数差异
    let daysToRace: number | null = null;
    let daysAfterRace: number | null = null;
    if (targetRaceDate) {
      const raceDateObj = new Date(`${targetRaceDate}T00:00:00`);
      const targetDateObj = new Date(`${dateStr}T00:00:00`);
      const diffMs = raceDateObj.getTime() - targetDateObj.getTime();
      const diffDays = Math.round(diffMs / (86400 * 1000));
      if (diffDays >= 0) {
        daysToRace = diffDays;
      } else {
        daysAfterRace = -diffDays;
      }
    }

    let focusMetric: "pace" | "hr" = "hr";
    let workoutType = "easy";
    let title = "纯有氧基础跑 (有氧耐力)";
    let descText = "";
    let distanceKm = 10.0;
    let durationMin = 50;
    let paceMin: number | null = baseline.zones.pace.easy[0];
    let paceMax: number | null = baseline.zones.pace.easy[1];
    let hrMin: number | null = baseline.zones.hr.z1[0];
    let hrMax: number | null = baseline.zones.hr.z1[1];
    let altType = "treadmill";
    let altNote = "室内跑步机 1.0% 坡度备选";
    const phase = daysToRace != null && daysToRace <= 7 ? "taper" : daysAfterRace != null ? "recovery" : "base";

    // ----------------- 场景 1: 精准命中目标比赛当天 -----------------
    if (daysToRace === 0) {
      workoutType = "race";
      focusMetric = "pace";
      title = `🎯【目标比赛日】${profile.targetDistance === "marathon" || profile.targetDistance === "general" ? "全程马拉松" : profile.targetDistance === "half_marathon" ? "半程马拉松" : "目标赛事"} · 全力出战！`;
      distanceKm = raceDistKm;
      paceMin = baseline.zones.pace.marathon[0];
      paceMax = baseline.zones.pace.marathon[1];
      hrMin = baseline.zones.hr.z2[0];
      hrMax = baseline.zones.hr.z3[1];
      durationMin = Math.round((distanceKm * ((paceMin + paceMax) / 2)) / 60);
      descText = `今天是目标比赛日！严格执行既定配速巡航策略（目标配速 ${fmtPace(paceMin)}~${fmtPace(paceMax)}/km）。鸣枪前 45 分钟完成动态拉伸与 1km 慢跑热身。前 5km 压制心率防冒进，逢补给站小口补充水与电解质能量胶。祝顺利破 PB！`;
      altType = "none";
      altNote = "现场实战";
    }
    // ----------------- 场景 2: 赛前 1 天 (Shakeout Run) -----------------
    else if (daysToRace === 1) {
      workoutType = "recovery";
      focusMetric = "hr";
      title = "赛前神经激活跑 (Shakeout Run)";
      distanceKm = 3.0;
      paceMin = baseline.zones.pace.easy[0];
      paceMax = baseline.zones.pace.easy[1];
      hrMin = baseline.zones.hr.z1[0];
      hrMax = baseline.zones.hr.z1[1];
      durationMin = 20;
      descText = "慢跑 2.5km，随后做 4 组 60~80 米加速跨步跑（体感 4:10 配速，专注步频与送髋，不产生乳酸）。检查计时芯片、号码布、跑鞋与能量胶，今晚早睡并摄入充足碳水。";
      altNote = "可在跑步机上极慢速走跑 2.5km。";
    }
    // ----------------- 场景 3: 赛前 2 天 (Rest / Taper) -----------------
    else if (daysToRace === 2) {
      workoutType = "rest";
      focusMetric = "hr";
      title = "彻底休息 · 赛前碳水充能 (Rest Day)";
      distanceKm = 0;
      durationMin = 0;
      paceMin = null;
      paceMax = null;
      hrMin = null;
      hrMax = null;
      descText = "距离目标赛事仅剩 2 天！今日全天静休，避免任何腿部疲劳。增加米饭面食等优质碳水摄入，补充充足水分与电解质。";
      altType = "rest";
      altNote = "全面放松。";
    }
    // ----------------- 场景 4: 赛前 3-5 天 (临赛深度减量) -----------------
    else if (daysToRace != null && daysToRace <= 5) {
      workoutType = "easy";
      focusMetric = "hr";
      title = "临赛轻负荷神经保持跑";
      distanceKm = 6.0;
      paceMin = baseline.zones.pace.easy[0];
      paceMax = baseline.zones.pace.easy[1];
      hrMin = baseline.zones.hr.z1[0];
      hrMax = baseline.zones.hr.z1[1];
      durationMin = 30;
      descText = "赛前减量周有氧维护：平稳慢跑 6km，心率严格控制在储备心率 Zone 1 (136~155 bpm)，跑后轻柔拉伸大腿与跟腱，严禁任何疲劳累积。";
    }
    // ----------------- 场景 5: 赛后 1-3 天 (赛后强制休养) -----------------
    else if (daysAfterRace != null && daysAfterRace <= 3) {
      workoutType = "rest";
      focusMetric = "hr";
      title = `赛后深度肌肉修复 (第 ${daysAfterRace} 天)`;
      distanceKm = 0;
      durationMin = 0;
      paceMin = null;
      paceMax = null;
      hrMin = null;
      hrMax = null;
      descText = "完赛辛苦了！赛后微细肌纤维处于急性损伤水肿期，严禁跑步！多摄入蛋白质、水分与电解质，可轻微散步或冷热水交替淋浴促进微循环。";
      altType = "rest";
      altNote = "彻底休息。";
    }
    // ----------------- 场景 6: 赛后 4-5 天 (赛后极慢排酸跑) -----------------
    else if (daysAfterRace != null && daysAfterRace <= 5) {
      workoutType = "recovery";
      focusMetric = "hr";
      title = "赛后超慢主动排酸慢跑 (Active Recovery)";
      distanceKm = 5.0;
      paceMin = baseline.zones.pace.easy[0] + 30;
      paceMax = baseline.zones.pace.easy[1] + 45;
      hrMin = 115;
      hrMax = 135;
      durationMin = 32;
      descText = "以极慢配速（甚至走跑结合）完成 5km 超低心率排酸，心率严格封顶在 135 bpm 以下。促进血液循环代谢下肢微损伤，若腿部有酸痛随时停下走步。";
    }
    // ----------------- 场景 7: 赛后 6-7 天 (赛后轻度有氧过渡) -----------------
    else if (daysAfterRace != null && daysAfterRace <= 7) {
      workoutType = "easy";
      focusMetric = "hr";
      title = "赛后有氧耐力恢复跑 (Recovery Easy)";
      distanceKm = 8.0;
      paceMin = baseline.zones.pace.easy[0] + 10;
      paceMax = baseline.zones.pace.easy[1] + 20;
      hrMin = baseline.zones.hr.z1[0];
      hrMax = baseline.zones.hr.z1[1];
      durationMin = 42;
      descText = "平稳完成 8km 超轻松跑。体感轻松自如，心率严格稳定在储备心率 Zone 1 (136~155 bpm)，严禁提速。";
    }
    // ----------------- 场景 8: 常规日常周期训练 -----------------
    else {
      const isRunDay = preferredDays.includes(dayOfWeek);
      const isLongDay = dayOfWeek === profile.longRunDay;

      // 严肃跑者真实周跑量基准
      const weeklyTargetKm = Math.max(55, baseline.weeklyMileageAvgKm > 20 ? baseline.weeklyMileageAvgKm : 58);

      if (!isRunDay) {
        workoutType = "rest";
        focusMetric = "hr";
        title = "彻底休息与肌肉修复 (Rest Day)";
        distanceKm = 0;
        durationMin = 0;
        paceMin = null;
        paceMax = null;
        hrMin = null;
        hrMax = null;
        descText = "今日休跑。保证充足深度睡眠，可进行滚泡沫轴放松大腿外侧髂胫束与小腿腓肠肌。";
        altType = "rest";
        altNote = "彻底休息。";
      } else if (isLongDay) {
        workoutType = "long";
        focusMetric = "hr";
        const isWeekend = profile.longRunDay === 0 || profile.longRunDay === 6;
        title = `${isWeekend ? "周末" : ""}渐进长距离耐力跑 (LSD)`;
        distanceKm = Math.max(20.0, Math.min(30.0, Math.round(weeklyTargetKm * 0.36)));
        paceMin = baseline.zones.pace.easy[0];
        paceMax = baseline.zones.pace.easy[1];
        hrMin = baseline.zones.hr.z1[0];
        hrMax = baseline.zones.hr.z1[1];
        durationMin = Math.round((distanceKm * ((paceMin + paceMax) / 2)) / 60);
        descText = `完成 ${distanceKm} km 长距离耐力跑。全程以前半程储备心率 Zone 1 (${hrMin}~${hrMax} bpm) 为准封顶，扎实提升脂肪氧化供能比；最后 3km 若体感充沛可平稳加速至马拉松目标配速。每 5km 补充水分与能量胶。`;
      } else {
        const otherRunDays = preferredDays.filter((d) => d !== profile.longRunDay);
        const otherDaysCount = Math.max(1, otherRunDays.length);
        const remainKm = Math.max(0, weeklyTargetKm - Math.max(20.0, Math.round(weeklyTargetKm * 0.36)));
        const runIdx = otherRunDays.indexOf(dayOfWeek);
        distanceKm = Math.max(10.0, Math.round((remainKm / otherDaysCount) * 10) / 10);

        if (runIdx === 0) {
          if (weekIndex === 1) {
            // 间歇跑 (Interval Run)
            workoutType = "interval";
            title = "最大摄氧量巡航间歇 (1000m × 5组)";
            focusMetric = "pace";
            paceMin = baseline.zones.pace.interval[0];
            paceMax = baseline.zones.pace.interval[1];
            hrMin = baseline.zones.hr.z4[0];
            hrMax = baseline.zones.hr.z4[1];
            distanceKm = 10.0;
            durationMin = 48;
            descText = `热身慢跑 2km 后，在操场或平路进行 1000m × 5 组间歇，每组严格按 ${fmtPace(paceMin)}~${fmtPace(paceMax)}/km 配速完成，组间原地或慢跑 90~120 秒待呼吸平顺，最后慢跑冷身 2km。`;
          } else {
            // 乳酸阈值跑 (Threshold Tempo)
            workoutType = "threshold";
            title = "乳酸门槛节奏巡航跑 (Threshold Tempo)";
            focusMetric = "pace";
            paceMin = baseline.zones.pace.threshold[0];
            paceMax = baseline.zones.pace.threshold[1];
            hrMin = baseline.zones.hr.z3[0];
            hrMax = baseline.zones.hr.z3[1];
            distanceKm = 11.0;
            durationMin = 50;
            const tCoreKm = Math.max(6, Math.round(distanceKm - 4));
            descText = `热身慢跑 2km 后，进行连续 ${tCoreKm} km 乳酸门槛配速稳态巡航 (${fmtPace(paceMin)}~${fmtPace(paceMax)}/km)，体感强适、交谈困难，精准刺激并拓宽乳酸生成-清除平衡拐点，最后慢跑冷身 2km。`;
          }
        } else if (runIdx === 1 && otherDaysCount >= 3) {
          // 马拉松配速专项稳态跑 (Marathon Pace)
          workoutType = "marathon";
          title = "马拉松配速专项稳态跑 (Marathon Pace)";
          focusMetric = "pace";
          paceMin = baseline.zones.pace.marathon[0];
          paceMax = baseline.zones.pace.marathon[1];
          hrMin = baseline.zones.hr.z2[0];
          hrMax = baseline.zones.hr.z2[1];
          distanceKm = 12.0;
          durationMin = 54;
          const mCoreKm = Math.max(7, Math.round(distanceKm - 3.5));
          descText = `热身慢跑 2km 后，进行连续 ${mCoreKm} km 马拉松目标配速稳态巡航 (${fmtPace(paceMin)}~${fmtPace(paceMax)}/km)，专注锻造特定比赛配速下的跑步经济性与肌肉耐力，最后慢跑冷身 1.5km。${profile.includeStrength === 1 ? "跑后完成 15 分钟死虫式核心与小腿提踵。" : ""}`;
        } else {
          // 低心率纯有氧基础跑 (Zone 2 Easy Run)
          workoutType = "easy";
          title = "低心率纯有氧基础跑 (Zone 2 有氧耐力)";
          focusMetric = "hr";
          paceMin = baseline.zones.pace.easy[0];
          paceMax = baseline.zones.pace.easy[1];
          hrMin = baseline.zones.hr.z1[0];
          hrMax = baseline.zones.hr.z1[1];
          durationMin = Math.round((distanceKm * ((paceMin + paceMax) / 2)) / 60);
          descText = `完成 ${distanceKm} km 低心率纯有氧跑。全程严格将心率压制在储备心率 Zone 1 (${hrMin}~${hrMax} bpm) 封顶，顺应地形体感自然跑，扎实扩展心室容积与肌纤维毛细血管网。${profile.includeStrength === 1 ? "跑后做 10 分钟臀桥与髋关节激活。" : ""}`;
        }
      }
    }

    const strengthRoutine = getStrengthRoutineForWorkout(workoutType, i, workoutType === "rest");
    deterministicWorkouts.push({
      date: dateStr,
      weekIndex,
      dayOfWeek,
      phase,
      workoutType,
      title,
      description: descText.trim(),
      distanceKm,
      durationMinutes: durationMin,
      targetPaceMinSec: paceMin,
      targetPaceMaxSec: paceMax,
      targetHrMin: hrMin,
      targetHrMax: hrMax,
      structureJson: JSON.stringify({
        focusMetric,
        warmupKm: workoutType === "rest" ? 0 : 2.0,
        mainKm: Math.max(0, distanceKm - (workoutType === "rest" ? 0 : 3.5)),
        cooldownKm: workoutType === "rest" ? 0 : 1.5,
        strengthRoutine,
      }),
      alternativeJson: JSON.stringify({
        type: altType,
        inclinePct: altType === "treadmill" ? 1.0 : 0,
        note: altNote,
      }),
    });
  }

  // 4. 将内部科学算法底座与跑者全量指标注入 AI，由 AI 大模型生成拟人化专业课表
  let finalWorkouts: WorkoutItemToSave[] = deterministicWorkouts;
  let aiCoachSummary = "基于近 8 周真实运动负荷（Banister 模型）· 80/20 极化与 Canova 专项收敛 · 双周滚动自适应闭环";
  const goalEval = evaluateGoalFeasibility(profile.targetDistance, profile.targetTimeSec, baseline.vdot);

  const aiCfg = getAiConfig();
  if (aiCfg) {
    try {
      const userPrompt = `
跑者核心生理基准与算法底座数据（Ground Truth）：
- Daniels VDOT: ${baseline.vdot}
- 长期体能 CTL: ${baseline.ctl}, 急性疲劳 ATL: ${baseline.atl}, 状态平衡 TSB: ${baseline.tsb}, 负荷比 ACWR: ${baseline.acwr}
- 近 8 周平均周跑量: ${baseline.weeklyMileageAvgKm} km/周, 单次最长跑量: ${baseline.longestRunKm} km
- 心血管脱偶合漂移 (Pw:Hr): ${baseline.cardiacDecoupling.tested ? `${baseline.cardiacDecoupling.driftPct}% (${baseline.cardiacDecoupling.summary})` : "数据收敛中"}
- 个人储备心率区间 (HRR):
  * Z1 有氧耐力 (E跑/轻松跑): ${baseline.zones.hr.z1[0]} ~ ${baseline.zones.hr.z1[1]} bpm
  * Z2 有氧动力 (M跑/稳态跑): ${baseline.zones.hr.z2[0]} ~ ${baseline.zones.hr.z2[1]} bpm (对应 4:20 左右稳态巡航)
  * Z3 乳酸阈值 (T跑/门槛跑): ${baseline.zones.hr.z3[0]} ~ ${baseline.zones.hr.z3[1]} bpm
  * Z4 速度耐力 (I跑/间歇跑): ${baseline.zones.hr.z4[0]} ~ ${baseline.zones.hr.z4[1]} bpm
- 科学建议配速区间:
  * 间歇配速 (I): ${fmtPace(baseline.zones.pace.interval[0])} ~ ${fmtPace(baseline.zones.pace.interval[1])} /km (${baseline.zones.pace.interval[0]}~${baseline.zones.pace.interval[1]} 秒) -> 必须【配速主导 (pace)】
  * 乳酸门槛 (T): ${fmtPace(baseline.zones.pace.threshold[0])} ~ ${fmtPace(baseline.zones.pace.threshold[1])} /km (${baseline.zones.pace.threshold[0]}~${baseline.zones.pace.threshold[1]} 秒) -> 必须【配速主导 (pace)】
  * 马拉松配速 (M): ${fmtPace(baseline.zones.pace.marathon[0])} ~ ${fmtPace(baseline.zones.pace.marathon[1])} /km (${baseline.zones.pace.marathon[0]}~${baseline.zones.pace.marathon[1]} 秒) -> 必须【配速主导 (pace)】
  * 轻松跑配速 (E): ${fmtPace(baseline.zones.pace.easy[0])} ~ ${fmtPace(baseline.zones.pace.easy[1])} /km (${baseline.zones.pace.easy[0]}~${baseline.zones.pace.easy[1]} 秒) -> 必须【心率主导 (hr)】
- 训练偏好与环境:
  * 每周训练天数: ${profile.daysPerWeek} 天 (偏好日: ${preferredDays.map((d) => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d]).join("、")})
  * 长跑/长距离指定日: ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][profile.longRunDay]}
  * 备赛目标模式: ${targetRaceDate ? `目标赛事备战 (比赛日: ${targetRaceDate}, 目标距离: ${profile.targetDistance === "marathon" || profile.targetDistance === "general" ? "全马" : profile.targetDistance})` : "常态进阶与健康维持 (无比赛，3:1 阶梯超补偿进阶)"}
  * 今日日期: ${todayStr} (处于第 1 周)
  * 气候环境: ${profile.climateType === "humid_hot" ? "湿热环境 (注意排汗电解质消耗)" : profile.climateType === "cold_snow" ? "低温寒冷 (延长热身防拉伤)" : "适宜气温"}
${goalEval ? `
- 跑者期望达成目标成绩与当前能力深度诊断：
  * 目标赛事项目: ${profile.targetDistance === "marathon" || profile.targetDistance === "general" ? "全程马拉松" : profile.targetDistance === "half_marathon" ? "半程马拉松" : profile.targetDistance}
  * 期望完赛成绩: ${fmtDuration(goalEval.targetSec)} (目标 VDOT: ${goalEval.targetVdot})
  * 当前能力等效预测: ${fmtDuration(goalEval.currentPredSec)} (当前真实 VDOT: ${baseline.vdot})
  * 成绩差距与生理差距: ${goalEval.gapSec > 0 ? `当前预测慢于目标约 ${Math.round(goalEval.gapSec / 60)} 分钟 (${goalEval.gapPct}%)，VDOT 相差 ${goalEval.vdotGap} 点` : `已达标或领先`}
  * 目标可行性与进阶梯级: 【${goalEval.badgeText}】
  * 运动生理学诊断结论: ${goalEval.advice}
  * 本双周排课核心原则: ${goalEval.principle}
` : ""}
- 跑者生理表型与短板诊断（Ground Truth）：
  * 表型诊断: 【${baseline.phenotype.badge}】
  * 表型生理特征: ${baseline.phenotype.characteristics}
  * 运动生理学诊断依据: ${baseline.phenotype.diagnosis}
  * 针对性课表重心倾斜策略: ${baseline.phenotype.prescription.focusDesc}
  * 轻松跑执行指导: ${baseline.phenotype.prescription.easyRunAdvice}
  * 间歇/门槛课执行指导: ${baseline.phenotype.prescription.qualityRunAdvice}
  * 周末长距离执行指导: ${baseline.phenotype.prescription.longRunAdvice}
- 核心要求：
  1. 必须根据课表科学目标明确指明 focusMetric: "pace" 或 "hr"，绝不要写“二选一”，今天该心率就心率，该配速就配速！
  2. 针对高阶跑者，结合其表型短板倾斜排布多样化课表：间歇跑 (interval)、乳酸阈值跑 (threshold)、马拉松配速专项稳态跑 (marathon)、低心率纯有氧基础跑 (easy)、周末长距离跑 (long)、恢复跑 (recovery) 与休息日 (rest)；
  3. 【必须严格遵守训练日与休息日锁定】：非训练日必须输出 workoutType: "rest", distanceKm: 0；训练日严禁偷跑或擅自改成休息；长跑日必须且只能安排长跑。
  4. 【课表描述简洁直接】：description 直接写具体动作执行（热身几公里、主课间歇/稳态组数、冷身几公里），严禁在开头添加【心率主导】、【配速主导】等理论解释标签！
  5. 【默认纳入核心与力量抗阻】：在轻松跑或稳态跑课表的末尾，默认给出 10~15 分钟核心与抗阻指导（如死虫式、臀桥、平板支撑、小腿提踵），以增强跑者下肢动力链抗伤病能力。
- 待生成的双周自然日历与各日角色锁定 (严格 14 天，必须逐日对照角色生成，严禁擅自增减调换):
${deterministicWorkouts.map((w, idx) => {
  const isRest = w.workoutType === "rest";
  const isLong = w.workoutType === "long";
  const roleTag = isRest
    ? "【必须为休息日 Rest Day · 严禁排跑步 · workoutType: 'rest', distanceKm: 0】"
    : isLong
    ? "【长距离长跑指定日 Long Run · workoutType: 'long'】"
    : `【必须为训练日 Run Day · 严禁设为 rest · 科学课表(${w.workoutType})】`;
  return `  [${idx + 1}] 日期: ${w.date} (第 ${w.weekIndex} 周, ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][w.dayOfWeek]}) -> ${roleTag}${w.date === todayStr ? " [今日]" : ""}${targetRaceDate && w.date === targetRaceDate ? " [目标比赛日]" : ""}`;
}).join("\n")}

请严格根据上述数据和原则，生成 14 天每一天的课表并返回 JSON 对象。`;

      const aiRaw = await callModel(aiCfg, COACH_SYSTEM_PROMPT, userPrompt);
      const jsonMatch = aiRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.summary && typeof parsed.summary === "string") {
          aiCoachSummary = parsed.summary.trim();
        }
        if (Array.isArray(parsed.workouts) && parsed.workouts.length >= 14) {
          const aiItemsMap = new Map<string, any>();
          for (const item of parsed.workouts) {
            if (item.date) aiItemsMap.set(item.date, item);
          }

          finalWorkouts = deterministicWorkouts.map((baseItem, idx) => {
            const aiItem = aiItemsMap.get(baseItem.date);

            // 铁律 1: 若跑者偏好未将此日选为训练日（算法底座为 rest），硬性锁定为休息日，严禁 AI 擅自加练或排恢复跑
            if (baseItem.workoutType === "rest") {
              const aiRestTitle = aiItem?.workoutType === "rest" && aiItem.title ? String(aiItem.title).trim() : null;
              const aiRestDesc = aiItem?.workoutType === "rest" && aiItem.description ? String(aiItem.description).trim() : null;
              return {
                ...baseItem,
                workoutType: "rest",
                title: aiRestTitle || baseItem.title,
                description: stripMetricExplanations(aiRestDesc || baseItem.description),
                distanceKm: 0,
                durationMinutes: 0,
                targetPaceMinSec: null,
                targetPaceMaxSec: null,
                targetHrMin: null,
                targetHrMax: null,
                structureJson: JSON.stringify({
                  focusMetric: "hr",
                  warmupKm: 0,
                  mainKm: 0,
                  cooldownKm: 0,
                }),
                alternativeJson: JSON.stringify({
                  type: "rest",
                  inclinePct: 0,
                  note: "彻底休息与肌肉修复",
                }),
              };
            }

            // 铁律 2: 若跑者选定此日为训练日，严禁 AI 擅自将其置为休息日
            let wType = normalizeWorkoutType(aiItem?.workoutType || baseItem.workoutType);
            if (wType === "rest") {
              wType = baseItem.workoutType;
            }
            // 铁律 3: 若为跑者指定的长跑日，锁定为 long
            if (baseItem.dayOfWeek === profile.longRunDay) {
              wType = "long";
            }

            if (!aiItem) return { ...baseItem, workoutType: wType };

            const dist = typeof aiItem.distanceKm === "number" && aiItem.distanceKm > 0 ? aiItem.distanceKm : baseItem.distanceKm;
            const pMin = parsePaceToSec(aiItem.targetPaceMinSec) ?? baseItem.targetPaceMinSec;
            const pMax = parsePaceToSec(aiItem.targetPaceMaxSec) ?? baseItem.targetPaceMaxSec;
            const hrMin = typeof aiItem.targetHrMin === "number" ? aiItem.targetHrMin : baseItem.targetHrMin;
            const hrMax = typeof aiItem.targetHrMax === "number" ? aiItem.targetHrMax : baseItem.targetHrMax;
            const dur = typeof aiItem.durationMinutes === "number" ? aiItem.durationMinutes : baseItem.durationMinutes;

            const aiFocus: "pace" | "hr" =
              aiItem.focusMetric === "pace" || aiItem.focusMetric === "hr"
                ? aiItem.focusMetric
                : ["interval", "tempo", "threshold", "marathon", "race"].includes(wType)
                ? "pace"
                : "hr";

            const strengthRoutine = getStrengthRoutineForWorkout(wType, idx, wType === "rest");
            return {
              ...baseItem,
              workoutType: wType,
              title: aiItem.title ? String(aiItem.title).trim() : baseItem.title,
              description: stripMetricExplanations(aiItem.description ? String(aiItem.description).trim() : baseItem.description),
              distanceKm: dist,
              durationMinutes: dur,
              targetPaceMinSec: pMin,
              targetPaceMaxSec: pMax,
              targetHrMin: hrMin,
              targetHrMax: hrMax,
              structureJson: JSON.stringify({
                focusMetric: aiFocus,
                warmupKm: 2.0,
                mainKm: Math.max(0, dist - 3.5),
                cooldownKm: 1.5,
                strengthRoutine,
              }),
              alternativeJson: JSON.stringify({
                type: "treadmill",
                inclinePct: 1.0,
                note: aiItem.alternativeNote || "室内跑步机 1.0% 坡度备选",
              }),
            };
          });
        }
      }
    } catch (aiErr) {
      console.warn("AI 课表模型调用或解析异常，已自动回退至高精度生理算法模版:", aiErr);
    }
  }

  // 更新计划概要与生理底座快照
  db.update(aiCoachPlans)
    .set({
      baselineSnapshotJson: JSON.stringify({ ...baseline, goalEval, aiSummary: aiCoachSummary }),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(aiCoachPlans.id, planId))
    .run();

  // 5. 智能增量更新：查询该计划已有的课表记录
  const existingWorkouts = db
    .select()
    .from(aiCoachWorkouts)
    .where(eq(aiCoachWorkouts.planId, planId))
    .all();

  // 若历史已有同日期的重复课表，优先保留已打卡或更完整的，并清理冗余记录
  const existingMap = new Map<string, typeof aiCoachWorkouts.$inferSelect>();
  for (const ew of existingWorkouts) {
    const prev = existingMap.get(ew.date);
    if (!prev) {
      existingMap.set(ew.date, ew);
    } else {
      const prevScore = (prev.status === "completed" || Boolean(prev.actualLabelId)) ? 100 : (prev.status === "missed" ? 50 : 10);
      const currScore = (ew.status === "completed" || Boolean(ew.actualLabelId)) ? 100 : (ew.status === "missed" ? 50 : 10);
      if (currScore > prevScore || (currScore === prevScore && ew.id > prev.id)) {
        db.delete(aiCoachWorkouts).where(eq(aiCoachWorkouts.id, prev.id)).run();
        existingMap.set(ew.date, ew);
      } else {
        db.delete(aiCoachWorkouts).where(eq(aiCoachWorkouts.id, ew.id)).run();
      }
    }
  }

  // 待更新的 14 天日期集合
  const targetDateSet = new Set(finalWorkouts.map((w) => w.date));

  // 仅清理当前 14 天窗口内、且未完成打卡的待办课表 (pending)；
  // 凡是历史周次或已匹配本地同步活动（COROS、Garmin、FIT/GPX上传等）的已完成课表，或已过日期（date < todayStr），绝对物理锁定保留！
  for (const date of targetDateSet) {
    const existing = existingMap.get(date);
    if (!existing) continue;
    const shouldKeep = existing.status === "completed" || Boolean(existing.actualLabelId) || existing.date < todayStr;
    if (shouldKeep) {
      // 保持不动
      continue;
    }
    // 否则删除待重新写入（删除该 planId 与该 date 的所有记录，彻底防重）
    db.delete(aiCoachWorkouts).where(and(eq(aiCoachWorkouts.planId, planId), eq(aiCoachWorkouts.date, date))).run();
    existingMap.delete(date);
  }

  // 6. 存储或更新最新的严格 14 天课表到数据库 ai_coach_workouts
  for (const w of finalWorkouts) {
    const existing = existingMap.get(w.date);
    // 如果该日已有打卡完成记录，或已属于过去日期，保留原记录，绝不重复插入覆盖
    const shouldKeep = Boolean(existing) && (existing.status === "completed" || Boolean(existing.actualLabelId) || existing.date < todayStr);
    if (shouldKeep) {
      continue;
    }
    let actualLabelId: string | null = null;
    let actualDist: number | null = null;
    let actualPace: number | null = null;
    let actualHr: number | null = null;
    let status = "pending";
    let complianceScore: number | null = null;

    try {
      const matchedActs = db
        .select({
          labelId: activities.labelId,
          distanceKm: activities.distanceKm,
          avgPaceSec: activities.avgPaceSec,
          avgHr: activities.avgHr,
        })
        .from(activities)
        .where(and(eq(activities.dateLabel, w.date), ne(activities.isDuplicate, 1)))
        .all();

      if (matchedActs.length > 0) {
        let totalDist = 0;
        let totalDurSec = 0;
        let weightedHrSum = 0;
        for (const act of matchedActs) {
          const d = act.distanceKm ?? 0;
          totalDist += d;
          if (act.avgPaceSec && d > 0) {
            const dur = act.avgPaceSec * d;
            totalDurSec += dur;
            if (act.avgHr) weightedHrSum += act.avgHr * dur;
          }
        }
        if (matchedActs.length === 1) {
          actualLabelId = matchedActs[0].labelId;
        } else {
          actualLabelId = JSON.stringify(
            matchedActs.map((a) => ({
              labelId: a.labelId,
              distanceKm: a.distanceKm,
              avgPaceSec: a.avgPaceSec,
              avgHr: a.avgHr,
            }))
          );
        }
        actualDist = Math.round(totalDist * 100) / 100;
        actualPace = totalDist > 0 && totalDurSec > 0 ? Math.round(totalDurSec / totalDist) : matchedActs[0].avgPaceSec;
        actualHr = totalDurSec > 0 && weightedHrSum > 0 ? Math.round(weightedHrSum / totalDurSec) : matchedActs[0].avgHr;
        status = "completed";
        const comp = w.distanceKm > 0 ? Math.round((totalDist / w.distanceKm) * 100) : 100;
        complianceScore = Math.min(100, Math.max(10, comp));
      } else if (w.date < todayStr && w.workoutType !== "rest") {
        status = "missed";
      }
    } catch {}

    db.insert(aiCoachWorkouts)
      .values({
        planId,
        date: w.date,
        weekIndex: w.weekIndex,
        dayOfWeek: w.dayOfWeek,
        phase: w.phase,
        workoutType: w.workoutType,
        title: w.title,
        description: w.description,
        distanceKm: w.distanceKm,
        durationMinutes: w.durationMinutes,
        targetPaceMinSec: w.targetPaceMinSec,
        targetPaceMaxSec: w.targetPaceMaxSec,
        targetHrMin: w.targetHrMin,
        targetHrMax: w.targetHrMax,
        structureJson: w.structureJson,
        alternativeJson: w.alternativeJson,
        actualLabelId,
        actualDistanceKm: actualDist,
        actualAvgPaceSec: actualPace,
        actualAvgHr: actualHr,
        complianceScore,
        status,
      })
      .run();
  }

  return { planId, totalWeeks, generatedDays: deterministicWorkouts.length };
}
