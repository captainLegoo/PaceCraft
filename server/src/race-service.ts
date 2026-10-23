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
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db/client.ts";
import { races } from "./db/schema.ts";
import { usableForProfile, type GpxTrack } from "./gpx.ts";
import { parseRouteFile, routeSourceNote, type RouteFileHint } from "./route-file.ts";
import { buildGpxProfile, climbPaceCost, type GpxProfile } from "./route-profile.ts";
import { fmtDuration } from "./format.ts";

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
    labelId?: string | null;
    notes?: string | null;
  };
  profile: GpxProfile | null;
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

/**
 * 列表用的列。**刻意不含 routeData / profileJson**。
 *
 * routeData 现在存的是完整分辨率轨迹（一条全马 10504 个点 ≈ 525KB 的 JSON），
 * `db.select().from(races)` 会把它一并带出来，而这个列表是**一次性返回所有赛事**
 * 的 —— 20 场就是 10MB 的响应，而前端只用得到日期、名称、距离那几个标量字段。
 * （profileJson 目前没有任何代码读写，画像每次现算；一并排掉只是不想留隐患。）
 *
 * 单条详情走 getRace，那边确实需要 routeData。
 */
const RACE_LIST_COLUMNS = {
  id: races.id,
  date: races.date,
  name: races.name,
  city: races.city,
  distanceKm: races.distanceKm,
  goalSec: races.goalSec,
  routeSource: races.routeSource,
  sourceNote: races.sourceNote,
  labelId: races.labelId,
  notes: races.notes,
  createdAt: races.createdAt,
  updatedAt: races.updatedAt,
};

export type RaceListRow = { [K in keyof typeof RACE_LIST_COLUMNS]: RaceRow[K] };

export function listRaces(): RaceListRow[] {
  return db.select(RACE_LIST_COLUMNS).from(races).orderBy(asc(races.date)).all();
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
  /**
   * 是否尝试用内置路线库（默认 true）。false 表示用户明确说"先不填路线"。
   *
   * 这个字段以前是**接不上的**：前端一直在传，但 HTTP 层没往这里透传，
   * 于是服务端拿到的永远是 undefined，`!== false` 恒成立，空库必然抛错。
   * 结果就是"先登记、后补轨迹"这条路在表单里根本走不通。
   */
  useLibraryRoute?: boolean;
  city?: string | null;
  distanceKm: number;
  goalSec?: number | null;
  /**
   * 轨迹文件全文（GPX 或 KML 的 XML 文本）。
   *
   * 这是现在的主字段；`gpx` 是旧字段，保留只为兼容，两者都传时以本字段为准。
   */
  routeText?: string | null;
  /** 显式声明格式。默认 "auto"（按内容嗅探）—— 后缀名会骗人，嗅探更可靠 */
  routeKind?: RouteFileHint;
  /**
   * 导入时的文件名，只用于回显"这份路线来自哪个文件"。
   *
   * 不存原文（原文动辄几 MB，存了也不会用），但名字必须留着：
   * 编辑时能看到"来源：track.gpx"，用户才敢确认自己没导错那一条。
   */
  routeFileName?: string | null;
  /** 可选：直接带 GPX 文本（旧字段，等价于 routeText + routeKind:"gpx"） */
  gpx?: string | null;
  /** 可选：内置路线库 key */
  routeKey?: string | null;
  /** 可选：关联的那次训练（比赛当天在手表里的记录） */
  labelId?: string | null;
  /** 可选：主观体感备注（累不累、抽筋、哪里不舒服） */
  notes?: string | null;
};

/**
 * 把一份轨迹文件解析成可入库的路线数据。
 *
 * 抽稀放在这里做（存库前），因为原始轨迹文件动辄几 MB，
 * 剖面图只需要每 50m 一个点，全存进去只是浪费空间和加载时间。
 */
function buildRouteFromFile(
  routeText: string | null | undefined,
  legacyGpx: string | null | undefined,
  hint: RouteFileHint | undefined,
  fileName?: string | null,
): { routeData: string; sourceNote: string } {
  // 文件名会进 sourceNote 并长期展示，这里去掉控制字符并限长：
  // 换行/零宽字符能让一整段伪造的说明混进来源标注里
  const safeName = (fileName ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  const text = (routeText ?? legacyGpx ?? "").trim();
  const parsed = parseRouteFile(text, hint ?? "auto");
  // 解析失败一律抛错，**绝不**退化成"建一条没有路线的赛事"——
  // 用户刚上传完文件，看到的却是"已保存"，然后疑惑为什么没有剖面图
  if (parsed.error || !parsed.track) {
    throw new Error(parsed.error ?? "轨迹文件解析失败");
  }
  return {
    // 入库存**完整分辨率**，不做抽稀。
    // 抽稀是有损的：爬升必须在最高保真的序列上算，抽稀后的那份只用来画剖面图，
    // 由 buildGpxProfile 在渲染时按图表宽度裁。存稀的等于把数据一次性扔掉 ——
    // 以后每改进一次算法都得让用户重新上传文件。
    routeData: JSON.stringify(parsed.track),
    sourceNote: routeSourceNote(parsed.kind, safeName || null),
  };
}

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

  if ((input.routeText ?? input.gpx ?? "").trim()) {
    const route = buildRouteFromFile(input.routeText, input.gpx, input.routeKind, input.routeFileName);
    routeSource = "gpx";
    routeData = route.routeData;
    sourceNote = route.sourceNote;
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

  if ((patch.routeText ?? patch.gpx ?? "").trim()) {
    const route = buildRouteFromFile(patch.routeText, patch.gpx, patch.routeKind, patch.routeFileName);
    next.routeSource = "gpx";
    next.routeData = route.routeData;
    next.sourceNote = route.sourceNote;
  } else if (patch.clearRoute) {
    next.routeSource = "none";
    next.routeData = null;
    next.sourceNote = null;
  }
  /*
   * 以上都没命中 → 路线保持原样。
   *
   * 这是刻意的：编辑表单里改个目标成绩，不该顺手把已经上传好的 GPX 冲掉。
   * 用户想清空路线时必须显式选「先不填路线」（对应 clearRoute），
   * 否则一律当"这次没提路线"。宁可少做，不可误删。
   */

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
      /*
       * labelId / notes 必须一并返回。
       * 以前这里漏了这两个字段，编辑表单保存时会被冲掉。
       */
      labelId: row.labelId,
      notes: row.notes,
    },
  };

  let profile: GpxProfile | null = null;
  let missingRoute: string | undefined;

  if (row.routeSource === "gpx") {
    const track = readGpxTrack(row.routeData);
    if (usableForProfile(track)) profile = buildGpxProfile(row.name, track);
    else missingRoute = "已存的轨迹数据里没有可用的高程，无法计算爬升。请重新上传带海拔的 GPX。";
  } else {
    missingRoute =
      "尚未设置路线。可以先用「修改」里的「导入轨迹文件」补上 —— " +
      "在两步路 / Strava / Garmin 导出时选「GPX格式」即可。";
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