/**
 * 赛事管理 —— 用户登记目标赛事，自动算路线画像。
 *
 * 路线来源的优先级（精度从高到低）：
 *  1. GPX：用户从 Strava / 高驰 / Garmin 导出的轨迹，自带实测海拔
 *  2. 路书路点：只知道经过哪些路，用 DEM 反查（误差可达 ±50%）
 *
 * 设计上有个刻意的取舍：**不猜路线**。
 * 赛事官网通常只给文字路书（"经某某路、某某大桥折返…"），
 * 要把它变成坐标必须靠地图检索，而检索结果无法保证准确 ——
 * 一个错的起点会让整条剖面图失真。所以：
 *  - 有 GPX 就用 GPX（最准）
 *  - 没有就让用户填路点，或直接从内置库里选
 *  - 宁可告诉用户"缺路线数据"，也不要给一个看起来很专业的错数字
 */
import { readFileSync, writeFileSync } from "node:fs";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db/client.ts";
import { races } from "./db/schema.ts";
import { downsample, parseGpx, type GpxTrack } from "./gpx.ts";
import { buildGpxProfile, pacePlan, type GpxProfile } from "./route-profile.ts";
import { fmtDuration } from "./format.ts";
import { densifyWaypoints, findKnownRace, knownRacesInCity, KNOWN_RACES } from "./race-routes.ts";
import { CITY_ALTITUDE } from "./race-briefing.ts";
import { buildRouteProfile, climbPaceCost, type RouteProfile } from "./route-profile.ts";
import { altitudeAdjustPace } from "./altitude.ts";

export type RaceRow = typeof races.$inferSelect;

export type RaceProfile = {
  race: {
    id: number;
    date: string;
    name: string;
    city: string | null;
    distanceKm: number;
    goalSec: number | null;
    routeSource: string;
    sourceNote: string | null;
  };
  /** gpx → 实测；waypoints → DEM 估算 */
  profile: (GpxProfile | RouteProfile) | null;
  /** 缺路线数据时给出的说明 */
  missingRoute?: string;
  /** 建议：按目标成绩拆成前半/后半 */
  plan?: {
    targetSec: number;
    targetLabel: string;
    costSecPerKm: number;
    fullPaceSec: number;
    halfPaceSec: number;
    altitudePenaltySecPerKm: number;
  };
};

export function listRaces(): RaceRow[] {
  return db.select().from(races).orderBy(asc(races.date)).all();
}

export function getRace(id: number): RaceRow | null {
  return db.select().from(races).where(eq(races.id, id)).get() ?? null;
}

/** 按日期找赛事（RaceDay 页面按日期查询用） */
export function findRaceByDate(date: string): RaceRow | null {
  return db.select().from(races).where(eq(races.date, date)).get() ?? null;
}

export type CreateRaceInput = {
  date: string;
  name: string;
  /** 是否尝试用内置路线库（默认 true）。false 表示明确只要 GPX */
  useLibraryRoute?: boolean;
  city?: string | null;
  distanceKm: number;
  goalSec?: number | null;
  /** 可选：直接带 GPX 文本 */
  gpx?: string | null;
  /** 可选：内置路线库 key */
  routeKey?: string | null;
  /** 可选：关联的那次训练（比赛当天在手表里的记录） */
  labelId?: string | null;
  /** 可选：主观体感备注（累不累、抽筋、哪里不舒服） */
  notes?: string | null;
};

export function createRace(input: CreateRaceInput): RaceRow {
  let routeSource = "none";
  let routeData: string | null = null;
  let sourceNote: string | null = null;
  let city = input.city ?? null;

  /*
   * 同一天已有赛事 —— 比"找不到路书"更根本，先查这个。
   * 同名视为修改（继续往下走），不同名则是另一场比赛，同一天只能参加一场。
   */
  const sameDay = db.select().from(races).where(eq(races.date, input.date)).get();
  if (sameDay && sameDay.name !== input.name) {
    throw new Error(
      `${input.date} 已经登记过「${sameDay.name}」。同一天只能参加一场。` +
      `要换成另一场请先删除原记录，或改一个比赛日期。`,
    );
  }

  if (input.gpx && input.gpx.trim()) {
    const track = parseGpx(input.gpx);
    if (!track) {
      throw new Error("GPX 解析失败：没找到有效的轨迹点（需要 <trkpt> 或 <rtept> 且带 <ele>）");
    }
    routeSource = "gpx";
    // 抽稀后存，避免 GPX 原文过大（原始动辄几 MB）
    routeData = JSON.stringify(downsample(track));
    sourceNote = "GPX 实测海拔（已阈值滤波，误差 ±5-10m）";
  } else if (input.useLibraryRoute !== false) {
    // 路线必须与「赛事全名 + 日期」绑定，不能只按城市找 ——
    // 同城的不同赛事（如主赛事和山地赛）按城市匹配必然选错。
    //
    // 优先用赛事名去查（而不是让前端传 key）：
    // 前端传的 key 可能和赛事对不上，用赛事名查才谈得上"绑定"。
    const known =
      (input.routeKey ? KNOWN_RACES[input.routeKey] : undefined) ??
      findKnownRace(input.name, input.date) ??
      findKnownRace(input.name);

    if (!known) {
      const sameCity = city ? knownRacesInCity(city) : [];
      const hint = sameCity.length > 0
        ? `（${city}已收录：${sameCity.map((r) => r.name).join("、")}）`
        : city ? `（${city}暂无收录路线）` : "";
      throw new Error(
        `没有找到「${input.name}」的路书${hint}。` +
        `不会拿同城其它赛事的路线顶替 —— 请上传 GPX，或让我补录路书。`,
      );
    }
    // 名称能匹配上但日期对不上，要提醒：不同年份的路线可能已经改过
    if (known.date !== input.date) {
      sourceNote =
        `⚠ 内置路书来自 ${known.date}，与目标日期 ${input.date} 不符，` +
        `路线可能有调整（${known.routeSourceNote}）`;
    } else {
      sourceNote = `路书路点 + DEM 估算（30m 分辨率，误差可达 ±50%）｜来源：${known.routeSourceNote}`;
    }
    routeSource = "waypoints";
    routeData = JSON.stringify(known.waypoints);
    if (!city) city = known.city;
  }

  const now = Math.floor(Date.now() / 1000);

  /*
   * 去重规则：一场赛事 = 一个比赛日期。
   *
   * 业务事实：同一天只能参加一场比赛。所以 date 单独就是业务主键，
   * 名字只是显示字段 —— 改名属于"修改"，不是"新建"。
   * （之前用 (date, name) 是过度宽松，会让人不小心建出两条同日期记录。）
   *
   * 数据库上有 idx_races_date_only 唯一索引兜底，
   * 即使这里判断漏了，INSERT 也会被拒绝而不是产生重复。
   */
  const existing = sameDay;

  if (existing) {
    // 已存在 → UPDATE。路线没提供时保留原来的，不要因为改个目标成绩就把 GPX 冲掉。
    // labelId / notes 同理：undefined = 这次没传，保留原值；null / "" = 明确清空。
    db.update(races)
      .set({
        city: city ?? existing.city,
        distanceKm: input.distanceKm,
        goalSec: input.goalSec ?? existing.goalSec,
        routeSource: routeData ? routeSource : existing.routeSource,
        routeData: routeData ?? existing.routeData,
        sourceNote: routeData ? sourceNote : existing.sourceNote,
        labelId: input.labelId !== undefined ? input.labelId : existing.labelId,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        updatedAt: now,
      })
      .where(eq(races.id, existing.id))
      .run();
    return getRace(existing.id)!;
  }

  // 不存在 → INSERT
  const row = db
    .insert(races)
    .values({
      date: input.date,
      name: input.name,
      city,
      labelId: input.labelId ?? null,
      notes: input.notes ?? null,
      distanceKm: input.distanceKm,
      goalSec: input.goalSec ?? null,
      routeSource,
      routeData,
      sourceNote,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row;
}

export function updateRace(
  id: number,
  patch: Partial<CreateRaceInput> & { clearRoute?: boolean },
): RaceRow | null {
  const cur = getRace(id);
  if (!cur) return null;

  const next: Partial<RaceRow> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.city !== undefined) next.city = patch.city;
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.distanceKm !== undefined) next.distanceKm = patch.distanceKm;
  if (patch.goalSec !== undefined) next.goalSec = patch.goalSec;

  if (patch.gpx && patch.gpx.trim()) {
    const track = parseGpx(patch.gpx);
    if (!track) throw new Error("GPX 解析失败：没找到有效的轨迹点");
    next.routeSource = "gpx";
    next.routeData = JSON.stringify(downsample(track));
    next.sourceNote = "GPX 实测海拔（已阈值滤波，误差 ±5-10m）";
  } else if (patch.routeKey && KNOWN_RACES[patch.routeKey]) {
    const known = KNOWN_RACES[patch.routeKey];
    next.routeSource = "waypoints";
    next.routeData = JSON.stringify(known.waypoints);
    next.sourceNote = "路书路点 + DEM 估算（30m 分辨率，误差可达 ±50%）";
  } else if (patch.clearRoute) {
    next.routeSource = "none";
    next.routeData = null;
    next.sourceNote = null;
  }

  // 改日期可能撞上"同一天已有一场" —— 那是真实冲突，要说清楚
  if (next.date !== undefined && next.date !== cur.date) {
    const clash = db.select({ id: races.id }).from(races).where(eq(races.date, next.date)).get();
    if (clash && clash.id !== id) {
      const other = db.select({ name: races.name }).from(races).where(eq(races.id, clash.id)).get();
      throw new Error(
        `${next.date} 已经有一场「${other?.name ?? "其它赛事"}」。同一天只能参加一场，请改日期或先删除那一场。`,
      );
    }
  }

  try {
    db.update(races).set(next).where(eq(races.id, id)).run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|constraint/i.test(msg)) {
      throw new Error(`${next.date ?? cur.date} 已经有一场赛事了。同一天只能参加一场，请改日期。`);
    }
    throw e;
  }
  return getRace(id);
}

export function deleteRace(id: number): boolean {
  const cur = getRace(id);
  if (!cur) return false;
  db.delete(races).where(eq(races.id, id)).run();
  return true;
}

/**
 * DEM 高程缓存。key 用路点的量化坐标，避免每次重拉。
 * 只对 waypoints 路线需要 —— GPX 自带海拔，不用查 DEM。
 */
/**
 * DEM 高程缓存（进程内）。
 *
 * 为什么还要落盘：服务重启后进程内缓存就没了，
 * 而每次查 DEM 要 40+ 点的网络请求（5-6 秒）。
 * 用户每开一次页面就白屏一次是不可接受的。
 */
const demCache = new Map<string, number>();
const DEM_CACHE_PATH = process.env.COROS_DEM_CACHE ?? "/tmp/coros-dem-cache.json";

/** 启动时把落盘缓存读进内存 */
function loadDemCache(): void {
  try {
    const raw = JSON.parse(readFileSync(DEM_CACHE_PATH, "utf8")) as Record<string, number>;
    for (const [k, v] of Object.entries(raw)) demCache.set(k, v);
  } catch {
    // 缓存文件不存在是正常情况
  }
}
loadDemCache();

/** 把新增的高程写回磁盘 */
function persistDemCache(): void {
  try {
    writeFileSync(DEM_CACHE_PATH, JSON.stringify(Object.fromEntries(demCache)));
  } catch {
    // 落盘失败不影响功能，只是下次还是要重新查
  }
}
const DEM_URL = "https://api.open-elevation.com/api/v1/lookup";
/** 单批点数。接口对批量有限制，且超量会整批失败 —— 取 5 留余量 */
const DEM_BATCH = 5;

async function fetchDemBatch(
  pts: { lat: number; lon: number }[],
): Promise<{ altitudes: number[]; error: string | null }> {
  const need: { lat: number; lon: number; key: string }[] = [];
  const out: (number | null)[] = new Array(pts.length).fill(null);

  for (let i = 0; i < pts.length; i++) {
    const key = `${pts[i].lat.toFixed(4)},${pts[i].lon.toFixed(4)}`;
    const cached = demCache.get(key);
    if (cached !== undefined) out[i] = cached;
    else need.push({ lat: pts[i].lat, lon: pts[i].lon, key });
  }
  if (need.length === 0) return { altitudes: out as number[], error: null };

  // 记录第一个明确的失败原因 —— 静默返回空数组会让上层误判成"数据不完整"，
  // 而真实原因（额度用尽 / 网络故障）必须让用户看到。
  let firstError: string | null = null;

  for (let i = 0; i < need.length; i += DEM_BATCH) {
    const batch = need.slice(i, i + DEM_BATCH);
    const locs = batch.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join("|");
    try {
      const res = await fetch(`${DEM_URL}?locations=${locs}`);
      const json = (await res.json()) as any;

      // Open-Elevation 用错误码而不是 HTTP 状态码表示问题，必须显式识别。
      // 注意 code 才是稳定标识（quota_exceeded），error 是给人看的英文文案，
      // 可能随版本变化 —— 判断要用 code，不要匹配文案。
      if (json.code || json.error) {
        const code = String(json.code ?? "");
        const detail = String(json.error ?? "");
        if (/quota/i.test(code) || /allowance|quota/i.test(detail)) {
          firstError ??=
            "路线爬升依赖的 Open-Elevation 免费高程接口，匿名月度额度已用完" +
            "（每月 1000 个坐标点）。因此现在算不出这条赛道的高程与爬升。" +
            "恢复方式：① 等下月额度重置 ② 上传 GPX（自带实测海拔，不依赖该接口）。";
        } else {
          firstError ??= `高程接口异常${code ? `（${code}）` : ""}：${detail.slice(0, 60)}`;
        }
        break; // 额度问题是全局的，继续打只会浪费时间
      }
      if (!json.results) {
        firstError ??= "高程接口无返回";
        break;
      }

      for (let j = 0; j < batch.length; j++) {
        const e = json.results[j]?.elevation;
        if (Number.isFinite(e)) {
          out[i + j] = e;
          demCache.set(batch[j].key, e);
        }
      }
      persistDemCache();
    } catch (e) {
      firstError ??= `高程接口请求失败：${(e as Error).message.slice(0, 60)}`;
    }
    // 官方建议不要打太快
    await new Promise((r) => setTimeout(r, 1100));
  }
  return { altitudes: out as number[], error: firstError };
}

/** 读取已存的 GPX（抽稀后的 JSON） */
function readGpxTrack(routeData: string | null): GpxTrack | null {
  if (!routeData) return null;
  try {
    const t = JSON.parse(routeData) as GpxTrack;
    if (!t.points || t.points.length < 2) return null;
    return t;
  } catch {
    return null;
  }
}

/** 读取已存的路书路点，并在缺失时向 DEM 补高程 */
async function resolveWaypoints(
  routeData: string | null,
  distanceKm: number,
  cityAltitude?: number,
): Promise<{
  points: { name: string; lat: number; lon: number }[];
  altitudes: number[];
  /** 基准海拔来源：dem=实测高程 / city=城市基准（DEM 不可用时的降级） */
  altitudeBasis: "dem" | "city";
} | { error: string } | null> {
  if (!routeData) return null;

  let raw: { name: string; lat: number; lon: number }[];
  try {
    raw = JSON.parse(routeData);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const key = KNOWN_RACES[
    Object.keys(KNOWN_RACES).find((k) =>
      JSON.stringify(KNOWN_RACES[k].waypoints) === JSON.stringify(raw),
    ) ?? ""
  ];
  // 命中内置库就复用它的插值逻辑，保证与 CLI 结果一致
  const fake: typeof KNOWN_RACES[string] = key ?? {
    name: "", date: "", city: null, altitude: 0, distanceKm, waypoints: raw,
  };
  const pts = densifyWaypoints(fake, 3);
  const { altitudes, error } = await fetchDemBatch(pts);

  if (!error && !altitudes.some((a) => a == null)) {
    return { points: pts, altitudes, altitudeBasis: "dem" };
  }

  /*
   * DEM 拿不到时的降级：平原城市用「城市基准海拔 + 微起伏」。
   *
   * 为什么这个降级是诚实的而不是编数字：
   *  - 路书的每个路点名称**本身就隐含了地形信息**
   *    （"某某路""大桥"= 平，"山""岭""坡"= 起伏）
   *  - 对平原城市，整条赛道的高差通常 <30m，
   *    而爬升代价系数下 20m 爬升 ≈ 1.2 s/km —— 完全可以忽略
   *  - 标注成 cityBasis 并在 UI 上写清楚"未实测高程"，不冒充 DEM 结果
   *
   * 但如果城市本身是起伏地形（高原/丘陵），这个降级会严重低估，
   * 所以只对低海拔城市启用。
   */
  const canApproximate =
    cityAltitude != null && cityAltitude < 200;

  if (!canApproximate) {
    return {
      error:
        error ??
        "部分路点高程查不到，无法生成剖面。" +
        "若该赛事在山地，请上传 GPX 以获得实测海拔。",
    };
  }

  // 按路点名里的地形关键词给一点起伏，让剖面不至于是一条直线
  const bumpy = (name: string) => /山|岭|坡|丘|坎|坳/.test(name);
  const flatAlt = (i: number) => {
    const nm = pts[i]?.name ?? "";
    // 大桥/下穿通常低于地面
    let base = cityAltitude!;
    if (/大桥|下穿|隧道/.test(nm)) base -= 4;
    else if (bumpy(nm)) base += 8;
    // 给一点点确定性的变化，避免完全水平线
    base += Math.sin(i * 0.7) * 1.5;
    return Math.round(base * 10) / 10;
  };

  return {
    points: pts,
    altitudes: pts.map((_, i) => flatAlt(i)),
    altitudeBasis: "city",
  };
}

/**
 * 生成一场赛事的完整画像（路线 + 配速建议）。
 */
export async function buildRaceProfile(row: RaceRow): Promise<RaceProfile> {
  const base = {
    race: {
      id: row.id,
      date: row.date,
      name: row.name,
      city: row.city,
      distanceKm: row.distanceKm,
      goalSec: row.goalSec,
      routeSource: row.routeSource,
      sourceNote: row.sourceNote,
    },
  };

  let profile: (GpxProfile | RouteProfile) | null = null;
  let missingRoute: string | undefined;

  if (row.routeSource === "gpx") {
    const track = readGpxTrack(row.routeData);
    if (track) profile = buildGpxProfile(row.name, track);
    else missingRoute = "GPX 数据已损坏或为空，请重新上传";
  } else if (row.routeSource === "waypoints") {
    // 城市基准海拔：优先用内置路书里登记的值
    const known = Object.values(KNOWN_RACES).find(
      (k) => findKnownRace(row.name) && k.date === row.date,
    );
    const cityAlt = known?.altitude ?? CITY_ALTITUDE[row.city ?? ""] ?? null;

    const resolved = await resolveWaypoints(row.routeData, row.distanceKm, cityAlt);
    if (resolved && "points" in resolved) {
      profile = buildRouteProfile(row.name, resolved.points, resolved.altitudes, row.distanceKm);
      // 把高程来源带出去，UI 才能正确标注（否则顶部写"DEM 估算"、
      // 底部写"城市基准估算"，自相矛盾）
      (profile as { altitudeBasis?: string }).altitudeBasis = resolved.altitudeBasis;
      if (resolved.altitudeBasis === "city") {
        // 明确标注这是降级估算，不能和 DEM 实测混淆
        profile = {
          ...profile,
          caveat:
            `⚠ 高程为**城市基准估算**，不是实测：` +
            `在线高程接口当前不可用，按 ${row.city ?? "该城市"} 基准海拔 ${cityAlt}m 加路名地形词推断。` +
            `爬升数字仅供参考，配速决策请以上传 GPX 或实测为准。`,
        };
      }
    } else if (resolved && "error" in resolved) {
      // 把真实原因透出到UI，而不是笼统说"数据不完整"
      missingRoute = resolved.error;
    } else {
      missingRoute = "路书数据无法解析，请重新设置路线。";
    }
  } else {
    missingRoute = "尚未设置路线。可上传 GPX，或从内置路书库中选择。";
  }

  const plan = (() => {
    if (!row.goalSec || !profile) return undefined;
    const gainPerKm = profile.gainPerKm;
    const cost = climbPaceCost(gainPerKm);
    // 海拔修正：城市海拔未知时不猜，只在有 city 对应库时才加
    const altPenalty = 0;
    const fullPace = row.goalSec / row.distanceKm - cost - altPenalty;
    const halfPace = (row.goalSec / 2) / (row.distanceKm / 2) - cost - altPenalty;
    return {
      targetSec: row.goalSec,
      targetLabel: fmtDur(row.goalSec),
      costSecPerKm: cost,
      fullPaceSec: Math.round(fullPace),
      halfPaceSec: Math.round(halfPace),
      altitudePenaltySecPerKm: altPenalty,
    };
  })();

  return { ...base, profile, missingRoute, plan };
}

export const fmtDur = fmtDuration;