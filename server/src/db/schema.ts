import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** 活动摘要，来自 querySportRecords */
export const activities = sqliteTable(
  "activities",
  {
    labelId: text("label_id").primaryKey(),
    sportType: integer("sport_type").notNull(),
    sportName: text("sport_name").notNull(),
    date: text("date").notNull(), // yyyyMMdd
    dateLabel: text("date_label").notNull(), // yyyy-mm-dd
    startTs: integer("start_ts"),
    endTs: integer("end_ts"),
    location: text("location"),
    lat: real("lat"),
    lon: real("lon"),
    durationSec: integer("duration_sec"),
    distanceKm: real("distance_km"),
    avgPaceSec: real("avg_pace_sec"),
    avgHr: integer("avg_hr"),
    calories: integer("calories"),
    raw: text("raw"),
    syncedAt: integer("synced_at").notNull().default(sql`(unixepoch())`),
    /** 数据来源品牌：coros / garmin / suunto / fit 等，默认 coros */
    source: text("source").default("coros"),
    /**
     * 比赛锚点的人工覆盖标记（见 drizzle/0010_race_anchor_exclude.sql）。
     *   1  = 强制排除出能力基准
     *   0  = 强制纳入（覆盖自动判定）
     *   null = 交给自动判定
     *
     * 同步的 upsert 不写这两列，所以人工标注不会被 COROS 同步冲掉。
     */
    raceExcluded: integer("race_excluded"),
    raceExcludeReason: text("race_exclude_reason"),
    /**
     * 重叠活动去重与对比标记：
     *   0 = 正常主力活动（计入跑量与负荷统计）
     *   1 = 冲突识别出的对比样本（归档展示，不计入跑量/负荷以防翻倍）
     */
    isDuplicate: integer("is_duplicate").default(0),
    /** 对应另一手表的记录 labelId */
    duplicateOf: text("duplicate_of"),
    /** 冲突解决状态：auto_primary / auto_duplicate / manual_primary / manual_duplicate / manual_keep_both */
    conflictStatus: text("conflict_status"),
  },
  (t) => [index("idx_activities_date").on(t.date), index("idx_activities_sport").on(t.sportType)],
);

/** 单次详情，来自 getActivityDetail */
export const activityDetails = sqliteTable("activity_details", {
  labelId: text("label_id").primaryKey().references(() => activities.labelId, { onDelete: "cascade" }),
  sportName: text("sport_name"),
  durationSec: integer("duration_sec"),
  distanceKm: real("distance_km"),
  avgPaceSec: real("avg_pace_sec"),
  movingPaceSec: real("moving_pace_sec"),
  adjustedPaceSec: real("adjusted_pace_sec"),
  bestKmSec: integer("best_km_sec"),
  avgHr: integer("avg_hr"),
  avgCadence: integer("avg_cadence"),
  avgStrideM: real("avg_stride_m"),
  avgPower: integer("avg_power"),
  elevGain: integer("elev_gain"),
  elevLoss: integer("elev_loss"),
  calories: integer("calories"),
  trainingLoad: integer("training_load"),
  aerobicTe: real("aerobic_te"),
  anaerobicTe: real("anaerobic_te"),
  trainingFocus: text("training_focus"),
  performance: text("performance"),
  raw: text("raw"),
});

/** 分圈 / 分段，来自 queryActivityLapData（500m 圈） */
export const laps = sqliteTable(
  "laps",
  {
    labelId: text("label_id").notNull().references(() => activities.labelId, { onDelete: "cascade" }),
    lapIndex: integer("lap_index").notNull(),
    distanceM: real("distance_m").notNull(),
    timeSec: real("time_sec").notNull(),
    totalLengthSec: real("total_length_sec"),
    avgPaceSec: real("avg_pace_sec"),
    adjustedPaceSec: real("adjusted_pace_sec"),
    // avgSpeedV2 的单位无法确认为 m/s（实测与 距离/用时 对不上），故只存原始值；
    // 图表统一用已交叉验证过的 avg_pace_sec。
    avgSpeedRaw: real("avg_speed_raw"),
    avgPower: integer("avg_power"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    avgCadence: integer("avg_cadence"),
    maxCadence: integer("max_cadence"),
    avgStrideM: real("avg_stride_m"),
    elevGain: real("elev_gain"),
    totalDescent: real("total_descent"),
  },
  (t) => [primaryKey({ columns: [t.labelId, t.lapIndex] })],
);

/** 每日训练负荷，来自 queryTrainingLoadAssessment */
export const trainingLoad = sqliteTable("training_load", {
  date: text("date").primaryKey(), // yyyy-mm-dd
  comment: text("comment"),
  shortLoad: integer("short_load"),
  longLoad: integer("long_load"),
  ratio: real("ratio"),
});

/** 每日健康，来自 queryDailyHealthData */
export const dailyHealth = sqliteTable("daily_health", {
  date: text("date").primaryKey(), // yyyyMMdd
  dateLabel: text("date_label").notNull(),
  steps: integer("steps"),
  calories: integer("calories"),
  exerciseMin: integer("exercise_min"),
  stressAvg: integer("stress_avg"),
  restingHr: integer("resting_hr"),
  hrvBaseline: integer("hrv_baseline"),
});

/** 每日睡眠，来自 querySleepOverview */
export const sleep = sqliteTable("sleep", {
  date: text("date").primaryKey(),
  score: integer("score"),
  available: integer("available").notNull().default(0),
  raw: text("raw"),
});

/** 每日心率（来自 queryAvgHeartRate；静息心率序列在多数账号上无数据） */
export const heartRate = sqliteTable("heart_rate", {
  date: text("date").primaryKey(),
  avgHr: integer("avg_hr"),
  minHr: integer("min_hr"),
  maxHr: integer("max_hr"),
});

/** 每日压力（来自 queryStressLevel） */
export const stress = sqliteTable("stress", {
  date: text("date").primaryKey(),
  avgStress: integer("avg_stress"),
  level: text("level"),
});

/** 体能评估快照（每次同步追加一条，保留历史） */
export const fitness = sqliteTable("fitness", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  capturedAt: integer("captured_at").notNull(),
  vo2max: real("vo2max"),
  runningLevel: real("running_level"),
  thresholdPaceSec: integer("threshold_pace_sec"),
  pred5kSec: integer("pred5k_sec"),
  pred10kSec: integer("pred10k_sec"),
  predHalfSec: integer("pred_half_sec"),
  predMarathonSec: integer("pred_marathon_sec"),
});

/** 恢复状态快照 */
export const recovery = sqliteTable("recovery", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  capturedAt: integer("captured_at").notNull(),
  recoveryPct: integer("recovery_pct"),
  level: text("level"),
  fullRecoveryHours: real("full_recovery_hours"),
});

/** AI 训练分析报告 */
export const aiReports = sqliteTable(
  "ai_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    labelId: text("label_id").notNull().references(() => activities.labelId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    focus: text("focus"),
    report: text("report").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_ai_reports_label").on(t.labelId)],
);

/** AI 训练次（session）分析报告：同一天的多次记录合并成一份 */
export const aiSessionReports = sqliteTable(
  "ai_session_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 与 analytics.buildSessions 返回的 key 对应：yyyy-mm-dd#首个labelId */
    sessionKey: text("session_key").notNull(),
    date: text("date").notNull(),
    activityCount: integer("activity_count").notNull().default(1),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    focus: text("focus"),
    report: text("report").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_ai_session_reports_key").on(t.sessionKey), uniqueIndex("uq_ai_session_focus").on(t.sessionKey, t.focus)],
);

/**
 * AI 周级训练分析报告：一周一次，键是周一日期。
 * 与 aiSessionReports 分开：粒度不同（周 vs 场），不能互相覆盖。
 */
export const aiWeekReports = sqliteTable(
  "ai_week_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 周一日期 yyyy-mm-dd，与 weeklyVolume / Week 页的 weekStart 同口径 */
    weekStart: text("week_start").notNull(),
    weekEnd: text("week_end").notNull(),
    sessionCount: integer("session_count").notNull().default(1),
    /** 拆出来的训练块数量（含主/次/热身），用于报告页展示 */
    blockCount: integer("block_count").notNull().default(1),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    focus: text("focus"),
    report: text("report").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_ai_week_reports_week").on(t.weekStart),
    uniqueIndex("uq_ai_week_focus").on(t.weekStart, t.focus),
  ],
);

/** 比赛日分析的对话记录（支持看完报告后追问） */
export const aiChat = sqliteTable(
  "ai_chat",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 预留：race=比赛日分析，其他场景以后可扩展 */
    scope: text("scope").notNull().default("race"),
    refKey: text("ref_key").notNull(),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_ai_chat_thread").on(t.scope, t.refKey, t.id)],
);

/** AI provider 配置（base_url / key / model） */
export const aiSettings = sqliteTable("ai_settings", {
  id: integer("id").primaryKey(),
  provider: text("provider").notNull().default("openai"), // openai | anthropic
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model").notNull(),
  temperature: real("temperature").notNull().default(0.7),
  maxTokens: integer("max_tokens").notNull().default(64000),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/**
 * 同步配置 —— 单行表（id 恒为 1），存 sportTypeCodes 的 JSON 数组。
 *
 * 为什么放 DB 而不是配置文件：这个看板是单机本地应用，没有多用户，
 * 但**运动类型的选择因人而异**。写死在代码里等于把「我练什么」这件事
 * 硬编码给了所有使用者。详见 0009_sync_settings.sql。
 *
 * 没有这一行时读取端回退到 DEFAULT_SPORT_TYPE_CODES。
 */
export const syncSettings = sqliteTable("sync_settings", {
  id: integer("id").primaryKey(),
  /** JSON number[]，如 [100,102,103,400,401,402] */
  sportTypeCodes: text("sport_type_codes").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/** 同步日志 */
export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  status: text("status").notNull(), // running | ok | error
  detail: text("detail"),
});

/** FIT 下载配额（官方限制 50 个 / 24 小时） */
export const fitQuota = sqliteTable("fit_quota", {
  day: text("day").primaryKey(),
  used: integer("used").notNull().default(0),
});

/** 训练计划/日程（来自 queryTrainingSchedule） */
export const scheduledWorkouts = sqliteTable(
  "scheduled_workouts",
  {
    date: text("date").notNull(),
    idInPlan: text("id_in_plan").notNull(),
    name: text("name"),
    sportType: integer("sport_type"),
    raw: text("raw"),
  },
  (t) => [primaryKey({ columns: [t.date, t.idInPlan] })],
);

export const users = sqliteTable("users", {
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  birthday: text("birthday"),
  gender: text("gender"),
  nickname: text("nickname"),
  /**
   * 实测最大心率。null = 从历史分圈自动推算（observedMaxHr），
   * 再兜底到 Tanaka 公式。手动填的意义是当自动推算被脏数据带偏时能纠正它。
   */
  maxHr: integer("max_hr"),
  /**
   * 实测静息心率。null = 用生理中位数 55 兜底。
   *
   * 为什么这个字段必须有：静息心率决定 HRR 的分母，直接影响全部分区边界。
   * 49 和 65 的两个人，同样的训练心率落在完全不同的区间。
   * 让每个人自己填，而不是在代码里写死某个人的实测值。
   */
  restingHr: integer("resting_hr"),
  /**
   * 心率区间计算模式："auto"（按 HRR 百分比自动推算）| "custom"（自定义五区间绝对数值）
   */
  hrCalcMode: text("hr_calc_mode"),
  /**
   * 自定义五区间心率配置（JSON 字符串）。
   * 格式：[
   *   { zone: "Z1", label: "有氧耐力", hrLo: 125, hrHi: 142 },
   *   { zone: "Z2", label: "有氧动力", hrLo: 143, hrHi: 156 },
   *   { zone: "Z3", label: "乳酸阈", hrLo: 157, hrHi: 168 },
   *   { zone: "Z4", label: "速度耐力", hrLo: 169, hrHi: 180 },
   *   { zone: "Z5", label: "无氧动力", hrLo: 181, hrHi: 195 }
   * ]
   */
  customHrZones: text("custom_hr_zones"),
  raw: text("raw"),
});

/**
 * 赛事设定 —— 用户手动登记即将参加的比赛。
 *
 * 为什么要有这张表：比赛日分析需要一个「目标赛事」，
 * 而 COROS 那边拿不到赛事信息（比赛不在训练记录里）。
 *
 * 路线来源分三档，精度差很多，必须区分：
 *  - gpx：用户导入的轨迹文件（GPX / KML）。自带高度，是**实测海拔**，最准。
 *    这里的 "gpx" 是"轨迹文件"的统称，不是文件后缀 —— 真实格式写在 source_note 里。
 *  - waypoints：只知道路书（经过哪些道路），用 DEM 反查高程。
 *    30m 分辨率的 DEM 看不到路面微起伏，只能当趋势看，误差可达 ±50%。
 *  - none：先登记赛事、路线之后再补。这是**正常状态**不是错误，
 *    但 UI 必须显式标出来，否则用户会以为爬升已经算过了。
 */
export const races = sqliteTable(
  "races",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 比赛日期 yyyy-mm-dd */
    date: text("date").notNull(),
    name: text("name").notNull(),
    labelId: text("label_id"),
    notes: text("notes"),
    city: text("city"),
    distanceKm: real("distance_km").notNull(),
    goalSec: integer("goal_sec"),
    routeSource: text("route_source").notNull().default("waypoints"),
    routeData: text("route_data"),
    profileJson: text("profile_json"),
    sourceNote: text("source_note"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_races_date").on(t.date)],
);

/**
 * AI 教练用户档案与偏好配置表
 */
export const aiCoachProfiles = sqliteTable("ai_coach_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** 目标类型: 'race' (有具体比赛) | 'fitness' (常态进阶/保持) */
  targetType: text("target_type").notNull().default("fitness"),
  /** 关联 races 表的 id，若无具体比赛可为空 */
  raceId: integer("race_id"),
  /** 目标比赛日期 yyyy-mm-dd (若无比赛则为 null) */
  targetRaceDate: text("target_race_date"),
  /** 目标距离类型: 'marathon' | 'half_marathon' | '10k' | '5k' | 'general' */
  targetDistance: text("target_distance").notNull().default("general"),
  /** 目标完赛时间（秒） */
  targetTimeSec: integer("target_time_sec"),
  /** 每周训练天数: 3 | 4 | 5 | 6 */
  daysPerWeek: integer("days_per_week").notNull().default(4),
  /** 偏好的训练日 (JSON 数组，如 [1, 3, 5, 0]，0代表周日) */
  preferredDaysJson: text("preferred_days_json").notNull().default("[2,4,6,0]"),
  /** 偏好长距离跑的星期几 (通常为 0 周日或 6 周六) */
  longRunDay: integer("long_run_day").notNull().default(0),
  /** 训练体系偏好: 'hybrid' (极化80/20+丹尼尔斯改良) | 'daniels' | 'norwegian' | 'maf' */
  methodology: text("methodology").notNull().default("hybrid"),
  /** 训练锚点偏好: 'balanced' (混合) | 'heart_rate' (心率优先) | 'pace' (配速优先) */
  intensityTarget: text("intensity_target").notNull().default("balanced"),
  /** 是否纳入核心与力量训练 (0 = 否, 1 = 是) */
  includeStrength: integer("include_strength").notNull().default(1),
  /** 所在气候类型: 'auto' | 'humid_hot' (湿热) | 'cold_snow' (极寒降雪) | 'temperate' (温带) */
  climateType: text("climate_type").notNull().default("auto"),
  /** 是否拥有跑步机备用方案 (0 = 无, 1 = 有) */
  hasTreadmill: integer("has_treadmill").notNull().default(1),
  /** 临时出差/出行信息 (JSON: { city: string, untilDate: string } 或 null) */
  travelModeJson: text("travel_mode_json"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/**
 * AI 教练宏观周期规划表 (Macrocycle Plan)
 */
export const aiCoachPlans = sqliteTable("ai_coach_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").notNull().references(() => aiCoachProfiles.id, { onDelete: "cascade" }),
  /** 计划标题 */
  title: text("title").notNull(),
  /** 计划起始日期 yyyy-mm-dd */
  startDate: text("start_date").notNull(),
  /** 计划截止日期 yyyy-mm-dd (通常为比赛日或阶段结束日) */
  endDate: text("end_date").notNull(),
  /** 总周数 */
  totalWeeks: integer("total_weeks").notNull(),
  /** 当前推进到第几周 (1-indexed) */
  currentWeek: integer("current_week").notNull().default(1),
  /** 计划状态: 'active' | 'completed' | 'archived' */
  status: text("status").notNull().default("active"),
  /** 基准体能快照 (JSON: { vdot: number, ctl: number, atl: number, tsb: number, maxHr: number, restingHr: number }) */
  baselineSnapshotJson: text("baseline_snapshot_json").notNull(),
  /** 全周期阶段与跑量包络线大纲 (JSON 数组: [{ week: 1, phase: 'base', targetVolumeKm: 40, isDeload: false }]) */
  macroOutlineJson: text("macro_outline_json").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/**
 * AI 教练每日课表项 (滚动微周期 Workout Schedules)
 */
export const aiCoachWorkouts = sqliteTable(
  "ai_coach_workouts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planId: integer("plan_id").notNull().references(() => aiCoachPlans.id, { onDelete: "cascade" }),
    /** 课表所属日期 yyyy-mm-dd */
    date: text("date").notNull(),
    /** 第几周 (1-indexed) */
    weekIndex: integer("week_index").notNull(),
    /** 星期几 (0-6, 0为周日) */
    dayOfWeek: integer("day_of_week").notNull(),
    /** 阶段: 'base' | 'build' | 'peak' | 'taper' | 'maintenance' */
    phase: text("phase").notNull().default("base"),
    /** 课表主类型: 'easy' | 'long' | 'tempo' | 'interval' | 'repetition' | 'fartlek' | 'recovery' | 'strength' | 'rest' */
    workoutType: text("workout_type").notNull(),
    /** 训练主题名称 (如: "渐进加速长跑 18km", "30-30 高原氧间歇", "核心抗阻激活") */
    title: text("title").notNull(),
    /** 教练详细指导语 (包含趣味性说明、动作注意、防厌跑要领) */
    description: text("description").notNull(),
    /** 计划总跑量 (km, 休息/纯力量课为 0) */
    distanceKm: real("distance_km").notNull().default(0),
    /** 计划预估时长 (分钟) */
    durationMinutes: integer("duration_minutes").notNull().default(0),
    /** 目标配速下限 (秒/km, 如 330 = 5:30/km) */
    targetPaceMinSec: integer("target_pace_min_sec"),
    /** 目标配速上限 (秒/km, 如 345 = 5:45/km) */
    targetPaceMaxSec: integer("target_pace_max_sec"),
    /** 目标心率下限 (bpm) */
    targetHrMin: integer("target_hr_min"),
    /** 目标心率上限 (bpm) */
    targetHrMax: integer("target_hr_max"),
    /** 结构化训练段落 (JSON 数组: [{ step: 'warmup', distKm: 2, pace: '6:15', note: '关节活动' }, ...]) */
    structureJson: text("structure_json"),
    /** 恶劣天气备用方案 (JSON: { type: 'treadmill' | 'indoor_core', inclinePct: 1.0, paceSec: 340, note: string }) */
    alternativeJson: text("alternative_json"),
    /** 关联的实际完成活动 labelId (来自 activities 表) */
    actualLabelId: text("actual_label_id"),
    /** 实际完成距离 (km) */
    actualDistanceKm: real("actual_distance_km"),
    /** 实际平均配速 (秒/km) */
    actualAvgPaceSec: real("actual_avg_pace_sec"),
    /** 实际平均心率 (bpm) */
    actualAvgHr: integer("actual_avg_hr"),
    /** 遵从度评分 (0-100, 综合考量距离、强度、心率吻合度) */
    complianceScore: integer("compliance_score"),
    /** 状态: 'pending' (待练) | 'completed' (已完成) | 'missed' (未达标/缺卡) | 'skipped' (主动跳过) */
    status: text("status").notNull().default("pending"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_coach_workouts_date").on(t.date), index("idx_coach_workouts_plan").on(t.planId)],
);

/**
 * AI 教练周度复盘与自适应调整记录 (Weekly Reviews)
 */
export const aiCoachReviews = sqliteTable(
  "ai_coach_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planId: integer("plan_id").notNull().references(() => aiCoachPlans.id, { onDelete: "cascade" }),
    weekIndex: integer("week_index").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    /** 计划跑量 (km) */
    plannedVolumeKm: real("planned_volume_km").notNull(),
    /** 实际完成跑量 (km) */
    actualVolumeKm: real("actual_volume_km").notNull(),
    /** 周总体完成率 (百分比 0-100) */
    completionRatePct: integer("completion_rate_pct").notNull(),
    /** 急性/慢性负荷比率 ACWR */
    acwr: real("acwr"),
    /** 心率脱偶合/漂移评估结果: 'normal' (<5%) | 'moderate_drift' (5-8%) | 'severe_drift' (>8%) | 'insufficient_data' */
    cardiacDecouplingStatus: text("cardiac_decoupling_status").notNull().default("insufficient_data"),
    /** 疲劳诊断: 'optimal' (适应良好) | 'overreaching' (轻微过载) | 'overtrained' (过度疲劳) | 'undertrained' (欠练) */
    fatigueAssessment: text("fatigue_assessment").notNull().default("optimal"),
    /** AI 调整决策: 'advance' (按部就班递增) | 'hold' (维持当前负荷) | 'deload' (强制减负周) | 'prune' (剪枝欠练) */
    adjustmentDecision: text("adjustment_decision").notNull().default("advance"),
    /** 教练详细点评与下周导言 (自然语言 Markdown) */
    reviewMarkdown: text("review_markdown").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_coach_reviews_plan").on(t.planId)],
);
