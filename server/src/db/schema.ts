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
  maxTokens: integer("max_tokens").notNull().default(8000),
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
    id: integer("id").primaryKey({ autoincrement: true }),
    /** 比赛日期 yyyy-mm-dd */
    date: text("date").notNull(),
    name: text("name").notNull(),
    /**
     * 关联的那次训练（activities.label_id）。
     *
     * 为什么要有：比赛当天在手表里就是一次普通训练，没有额外标记。
     * 关联之后才能把「这场比赛的实际分段数据」和「登记时的目标成绩」分开看 ——
     * 赛前是目标，赛后是实测，只有能对上同一次训练才做得了对比。
     *
     * 可空：未来的比赛（还没跑）、或当天训练没同步到，都允许先登记。
     */
    labelId: text("label_id"),
    /**
     * 主观体感备注 —— 累不累、有没有抽筋、哪一段不舒服、哪一段状态好。
     *
     * 这类信息 COROS 完全没有，只有本人知道，但往往是解释客观数据的关键线索
     * （比如配速下降到底是疲劳、上坡、还是补给不足）。
     * 写在这里而不是训练记录里，是因为它属于「这场比赛」而不是「这次训练」——
     * 同一天可能有多条记录，比赛指的是那一场。
     */
    notes: text("notes"),
    city: text("city"),
    /** 全程 42.195 / 半马 21.0975 / 其他 */
    distanceKm: real("distance_km").notNull(),
    /** 目标成绩（秒），可空 */
    goalSec: integer("goal_sec"),
    /** gpx | waypoints | none（none = 先登记、之后补路线） */
    routeSource: text("route_source").notNull().default("waypoints"),
    /** 路线原始数据：GPX 全文，或路书路点的 JSON */
    routeData: text("route_data"),
    /** 分析结果缓存（RouteProfile 的 JSON），避免每次都重算 DEM */
    profileJson: text("profile_json"),
    /** 分析时的数据来源说明，用于在 UI 上标注可信度 */
    sourceNote: text("source_note"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("idx_races_date").on(t.date)],
);
