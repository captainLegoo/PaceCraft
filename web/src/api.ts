export type Activity = {
  labelId: string; sportType: number; sportName: string;
  date: string; dateLabel: string;
  startTs: number | null; endTs: number | null;
  location: string | null; lat: number | null; lon: number | null;
  durationSec: number | null; distanceKm: number | null;
  avgPaceSec: number | null; avgHr: number | null; calories: number | null;
  detail: null | {
    avgCadence: number | null; avgPower: number | null; trainingLoad: number | null;
    trainingFocus: string | null; performance: string | null; aerobicTe: number | null;
    bestKmSec: number | null; elevGain: number | null; elevLoss: number | null;
  };
};

export type Lap = {
  lapIndex: number; distanceM: number; timeSec: number; totalLengthSec: number | null;
  avgPaceSec: number; adjustedPaceSec: number; avgPower: number;
  avgHr: number; maxHr: number; avgCadence: number; maxCadence: number;
  avgStrideM: number; elevGain: number; totalDescent: number;
};

export type AiReport = {
  id: number; labelId: string; provider: string; model: string;
  focus: string | null; report: string; createdAt: number;
};

export type ActivityDetail = {
  activity: Activity & { raw?: string };
  detail: Record<string, any> | null;
  sessionKey?: string | null;
  laps: Lap[];
  scatter: { lapIndex: number; distanceKm: number; paceSec: number; hr: number; maxHr: number; cadence: number; strideM: number }[];
  reports: AiReport[];
  zones: { basis: number; maxHr: number; restingHr: number; reserve: number; source: string; method: string; usedFallback: boolean; belowZone1Seconds: number; belowZone1Pct: number; zones: { zone: string; label: string; pctLabel: string; seconds: number; pct: number; hrLo: number; hrHi: number | null }[] };
  age: number | null;
  lapSummary: {
    count: number; totalDistanceM: number; granularityM: number | null;
    distanceMatches: boolean | null; fastestLapSec: number | null; slowestLapSec: number | null;
  };
};

export type SessionSet = {
  distanceLabel: string; reps: number; avgDurationSec: number; avgPaceSec: number;
  avgHr: number | null; restSec: number | null;
  distanceTolerance: number; paceTolerance: number;
};

export type SessionDecoupling = {
  pct: number;
  level: "good" | "warn" | "bad" | "info";
  label: string;
};

export type Session = {
  key: string; date: string; startTs: number; endTs: number; maxGapSec: number;
  activityCount: number; labelIds: string[];
  totals: { distanceKm: number; durationSec: number; calories: number; trainingLoad: number; elevGain: number; avgHr: number | null };
  sets: SessionSet[];
  kind: "single" | "multi";
  classification: string; classificationReason: string;
  decoupling?: SessionDecoupling | null;
};

export type SessionLap = {
  labelId: string; lapIndex: number; offsetSec: number; elapsedSec: number;
  distanceM: number; timeSec: number; avgPaceSec: number;
  avgHr: number; maxHr: number; avgCadence: number; avgStrideM: number;
  elevGain: number | null; totalDescent: number | null;
};

export type WeekReport = {
  id: number; weekStart: string; weekEnd: string; sessionCount: number; blockCount: number;
  provider: string; model: string; focus: string | null; report: string; createdAt: number;
};

export type SessionReport = {
  id: number; sessionKey: string; date: string; activityCount: number;
  provider: string; model: string; focus: string | null; report: string; createdAt: number;
};

export type SessionDetail = {
  session: Session;
  activities: (Activity & { detail: any })[];
  laps: SessionLap[];
  zones: { basis: number; maxHr: number; restingHr: number; reserve: number; source: string; method: string; usedFallback: boolean; belowZone1Seconds: number; belowZone1Pct: number; zones: { zone: string; label: string; pctLabel: string; seconds: number; pct: number; hrLo: number; hrHi: number | null }[] };
  reports: SessionReport[];
  age: number | null;
};

export type Weekly = {
  weekStart: string; distanceKm: number; durationSec: number; count: number;
  calories: number; avgHr: number | null; avgPaceSec: number | null; longestRunKm: number;
  runs: { labelId: string; date: string; distanceKm: number; avgPaceSec: number; avgHr: number; durationSec: number }[];
};

export type LoadPoint = {
  date: string; comment: string | null; shortLoad: number | null;
  longLoad: number | null; ratio: number | null;
  shortLoadAvg7: number | null; ratioAvg7: number | null;
};

export type Fitness = {
  vo2max: number | null; runningLevel: number | null; thresholdPaceSec: number | null;
  pred5kSec: number | null; pred10kSec: number | null;
  predHalfSec: number | null; predMarathonSec: number | null;
};

export const API_BASE =
  typeof window !== "undefined" && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV
    ? `http://${window.location.hostname}:43124`
    : "";

export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path}`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error ?? `请求失败 (${res.status})`);
  return body as T;
}

export type QuickSyncResult = {
  ok: boolean;
  busy?: boolean;
  newActivities?: number;
  altitudeAdded?: number;
  quotaExhausted?: boolean;
  activities?: number;
  details?: number;
  lapRows?: number;
  errors?: string[];
  fitQuotaLeft?: number;
  elapsedSec?: number;
  message: string;
};

export type FollowState = {
  active: boolean;
  startedAt: number;
  found: number;
  lastCheckAt: number | null;
  lastCheckMessage: string | null;
  fitUsed: number;
};

/** 同步运动类型配置：编码表由服务端下发，前端不自己维护一份 */
export type SyncSportsPayload = {
  groups: { key: string; label: string; types: { code: number; label: string }[] }[];
  selected: number[];
  defaults: number[];
};

export type RouteSegment = {
  from: string; to: string; distanceM: number;
  altFrom: number; altTo: number; netChange: number; gradePct: number;
};

/** 路线画像。gpx 与 waypoints 两种来源字段略有差异，用可选字段兼容 */
export type RaceProfile = {
  source: string;
  name: string;
  /** waypoints 来源的总距离 */
  totalDistanceKm?: number;
  /** gpx 来源的总距离 */
  distanceKm?: number;
  waypointDistanceKm?: number;
  gainM: number;
  lossM: number;
  gainPerKm: number;
  eleMin?: number;
  eleMax?: number;
  altMin?: number;
  altMax?: number;
  netChange: number;
  segments?: RouteSegment[];
  /** gpx 来源才有：剖面图采样点 */
  profile?: { distKm: number; ele: number }[];
  verdict: string;
  caveat: string;
  /** dem=实测高程 / city=城市基准估算（在线接口不可用时的降级） */
  altitudeBasis?: "dem" | "city";
};

export type RaceDetail = {
  race: {
    id: number; date: string; name: string; city: string | null;
    distanceKm: number; goalSec: number | null;
    routeSource: string; sourceNote: string | null;
    /** 关联的那次训练；为空表示未来的比赛或当天记录未同步 */
    labelId: string | null;
    /** 主观体感备注：累不累、抽筋、哪里不舒服 */
    notes: string | null;
  };
  profile: RaceProfile | null;
  missingRoute?: string;
  plan?: {
    targetSec: number; targetLabel: string; costSecPerKm: number;
    fullPaceSec: number; halfPaceSec: number; altitudePenaltySecPerKm: number;
  };
};

export type Race = RaceDetail["race"];

/**
 * 轨迹文件预检结果（POST /api/races/parse-route，只解析不���库）。
 *
 * 存在的理由：让用户在填完整张表之前就知道这份文件能不能用。
 * 导错格式是这一步最高频的失败原因，而"填了 8 个字段才报错"体验极差。
 */
export type RouteFilePreview = {
  ok: boolean;
  kind: "gpx" | "kml" | "kmz" | "unknown";
  error?: string;
  hasElevation?: boolean;
  /** 文件里的原始点数（入库就是这份，不抽稀） */
  pointCount?: number;
  /** 剖面图实际会画的点数 —— 展示层裁剪，与入库点数不是一回事 */
  profilePointCount?: number;
  /** 轨迹采样间隔（米）。> 20 说明文件本身偏稀，爬升可能偏低 */
  sampleSpacingM?: number;
  coarseSpacing?: boolean;
  distanceKm?: number;
  gainM?: number;
  lossM?: number;
  eleMin?: number;
  eleMax?: number;
  sourceNote?: string;
};

export const api = {
  races: () => req<Race[]>("/api/races"),
  race: (id: number) => req<RaceDetail>(`/api/races/${id}`),
  raceBriefing: (id: number) => req<any>(`/api/races/${id}/briefing`),
  /**
   * 人工指定某场是否计入能力基准。
   *   excluded=true  → 强制排除；false → 强制纳入；null → 撤销设定、交回自动判定
   */
  setAnchorExclusion: (labelId: string, excluded: boolean | null, reason?: string) =>
    req<{ ok: boolean }>(`/api/races/anchors/${encodeURIComponent(labelId)}/exclude`, {
      method: "POST",
      body: JSON.stringify({ excluded, reason }),
    }),
  createRace: (body: Record<string, unknown>) =>
    req<RaceDetail>("/api/races", { method: "POST", body: JSON.stringify(body) }),
  /** 只解析不入库，用来在填表阶段就核对文件对不对 */
  parseRouteFile: (body: { text: string; fileName?: string; routeKind?: string }) =>
    req<RouteFilePreview>("/api/races/parse-route", { method: "POST", body: JSON.stringify(body) }),
  uploadRaceRoute: (id: number, body: Record<string, unknown>) =>
    req<RaceDetail>(`/api/races/${id}/route`, { method: "POST", body: JSON.stringify(body) }),
  deleteRace: (id: number) => req<{ ok: boolean }>(`/api/races/${id}`, { method: "DELETE" }),
  /**
   * 只更新主观体感备注与训练关联，不碰路线。
   * 备注是赛后才写得出来的，走独立端点避免重传表单把 GPX 弄丢。
   */
  saveRaceNotes: (id: number, body: { notes?: string | null; labelId?: string | null }) =>
    req<Race>(`/api/races/${id}/notes`, { method: "PUT", body: JSON.stringify(body) }),

  /** 保存心率档案。支持自动推算（maxHr/restingHr）或自定义各区间（customHrZones） */
  saveHrProfile: (body: {
    maxHr?: number | null;
    restingHr?: number | null;
    hrCalcMode?: "auto" | "custom";
    customHrZones?: { zone: string; label: string; hrLo: number; hrHi?: number | null }[] | null;
  }) => req<any>("/api/profile/hr", { method: "PUT", body: JSON.stringify(body) }),

  status: () => req<any>("/api/status"),
  sync: (days = 120) => req<any>("/api/sync?days=" + days, { method: "POST" }),
  /** 快速同步：只回溯 3 天，跑完立刻点一下就够 */
  quickSync: () => req<QuickSyncResult>("/api/sync/quick", { method: "POST" }),

  /** 后台跟随：手表上传后自动探测 */
  followStatus: () => req<FollowState>("/api/sync/follow"),
  fitQuota: () => req<{ used: number; limit: number; exhausted: boolean }>("/api/sync/quota"),
  followStart: () => req<FollowState>("/api/sync/follow", { method: "POST" }),
  followStop: () => req<FollowState>("/api/sync/follow", { method: "DELETE" }),

  /** 同步哪些运动类型 —— 编码表由服务端下发，避免前后端各维护一份 */
  syncSports: () => req<SyncSportsPayload>("/api/sync/sports"),
  saveSyncSports: (codes: number[]) =>
    req<{ ok: boolean; codes: number[] }>("/api/sync/sports", {
      method: "PUT",
      body: JSON.stringify({ codes }),
    }),

  activities: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params).toString();
    return req<Activity[]>("/api/activities" + (q ? "?" + q : ""));
  },
  activity: (labelId: string) => req<ActivityDetail>("/api/activities/" + labelId),

  sessions: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params).toString();
    return req<Session[]>("/api/sessions" + (q ? "?" + q : ""));
  },
  session: (key: string) => req<SessionDetail>("/api/sessions/" + encodeURIComponent(key)),
  analyzeSession: (sessionKey: string, focus: string | null) =>
    req<{ report: string; provider: string; model: string; sessionKey: string }>(
      "/api/ai/analyze-session", { method: "POST", body: JSON.stringify({ sessionKey, focus }) }),

  analyzeWeek: (weekStart: string, focus: string | null) =>
    req<{ report: string; provider: string; model: string; weekStart: string; blockCount: number }>(
      "/api/ai/analyze-week", { method: "POST", body: JSON.stringify({ weekStart, focus }) }),
  weekReports: (weekStart: string) =>
    req<WeekReport[]>("/api/ai/week-reports?weekStart=" + encodeURIComponent(weekStart)),

  weekly: (weeks = 16) => req<Weekly[]>("/api/volume/weekly?weeks=" + weeks),
  monthly: (months = 12) => req<any[]>("/api/volume/monthly?months=" + months),
  load: (days = 90) => req<LoadPoint[]>("/api/load?days=" + days),

  health: (days = 60) => req<{
    health: any[]; hr: any[]; stress: any[]; sleep: any[];
  }>("/api/health?days=" + days),
  fitness: () => req<{ latest: any; history: any[] }>("/api/fitness"),
  recovery: () => req<{ latest: any }>("/api/recovery"),
  profile: () => req<any>("/api/profile"),

  aiSettings: () => req<any>("/api/ai/settings"),
  saveAiSettings: (cfg: any) => req<any>("/api/ai/settings", { method: "PUT", body: JSON.stringify(cfg) }),
  testAiSettings: (cfg: any) =>
    req<{ ok: boolean; reply: string; latencyMs: number }>("/api/ai/test", { method: "POST", body: JSON.stringify(cfg) }),
  analyze: (labelId: string, focus: string | null) =>
    req<{ report: string; provider: string; model: string }>(
      `/api/ai/analyze/${labelId}`, { method: "POST", body: JSON.stringify({ focus }) }),
};
