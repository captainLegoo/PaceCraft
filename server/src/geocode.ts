/**
 * 地理编码 —— 地名/路口 → 候选坐标列表。
 *
 * 为什么返回「候选」而不是「一个结果」：
 *  实测某条城市干道有市区段和新区段两处，OSM 会返回多条。
 *  哪一条才是赛道，取决于它在路线中的位置 —— 单独看路名无法判断，
 *  必须结合官方距离和相邻路点做全局消歧（见 route-disambiguate.ts）。
 *
 * 为什么必须有这一步：
 *  AI 搜到的是**路书文字**（"某公园→某路→某大道…"），不含坐标。
 *  让模型直接吐经纬度，它只会凭记忆编 —— 编错整条爬升剖面就废了。
 *
 * ⚠️ 重要限制（实测结论，别绕过去）：
 *  这个模块**不能用来自动生成赛事路线**。实测某场马拉松的 10 个路点：
 *    - 直接取首条候选 → 平均偏差 18.5 km（同名道路匹配到几百公里外的另一座城市）
 *    - 用动态规划在候选里消歧 → 仍差 15.1 km
 *  根本原因是**数据缺失**：OSM 里根本没有该市新区的同名干道，
 *  也没有任何马拉松赛道要素（用"赛事名+起终点"搜索返回 0 条）。
 *  算法再聪明也拼不出源数据里没有的东西。
 *
 *  所以它只用于：GPX 缺失时，用户手动指定起终点坐标的辅助查询。
 *  路线数据的可靠来源只有两个：① GPX ② 人工核实的路书。
 *
 * 用 Nominatim（OpenStreetMap 官方），免费无需 key。使用规范要求：
 *  - 带可识别的 User-Agent
 *  - 不能并发轰炸（限速 1 req/s）
 *  - 结果必须缓存
 *  下面三条都实现了。
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "coros-dashboard/1.0 (personal running analysis; local-only)";

export type GeoCandidate = {
  lat: number;
  lon: number;
  displayName: string;
  category: string;
  /** 名称是否精确命中 */
  exact: boolean;
  /** 0-1，类别可信度 */
  score: number;
};

export type GeocodeHit = {
  /** 原始路点名 */
  query: string;
  candidates: GeoCandidate[];
  /** 没有候选时为 "failed" */
  match: "ok" | "failed";
  /** 首选候选（置信度最高） */
  best: GeoCandidate | null;
};

const cache = new Map<string, GeocodeHit>();
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scoreOf(r: any): number {
  const cat = String(r.category ?? r.class ?? "");
  const type = String(r.type ?? "");
  if (/^(highway|footway|path|cycleway|pedestrian|steps)$/.test(type)) return 0.95;
  if (/^(tourism|leisure|historic)$/.test(cat)) return 0.92;
  if (/^(place|building)$/.test(cat)) return 0.88;
  return 0.8;
}

async function nominatim(query: string, limit = 6): Promise<any[]> {
  const wait = Date.now() - lastRequestAt;
  if (wait < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - wait);
  lastRequestAt = Date.now();
  try {
    const url =
      `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2` +
      `&addressdetails=1&limit=${limit}&countrycodes=cn`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * 地理编码单个地名，返回全部候选。
 * city 用于过滤掉外地的同名设施（"黄河路"在郑州也有）。
 */
export async function geocode(raw: string, opts: { city?: string } = {}): Promise<GeocodeHit> {
  const city = opts.city?.trim();
  const key = `${raw}|${city ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let raw5: any[] = [];
  if (city) {
    raw5 = await nominatim(raw);
    // 城市内优先；一个都没有再退回"路名 + 城市"
    const inCity = raw5.filter((r) => String(r.display_name ?? "").includes(city));
    if (inCity.length === 0) {
      const withCity = await nominatim(`${raw}, ${city}, 中国`);
      raw5 = withCity.filter((r) => String(r.display_name ?? "").includes(city));
    } else {
      raw5 = inCity;
    }
  } else {
    raw5 = await nominatim(raw);
  }

  const candidates: GeoCandidate[] = raw5.map((r) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    displayName: String(r.display_name ?? ""),
    category: String(r.category ?? r.type ?? ""),
    exact: String(r.display_name ?? "").includes(raw) || String(r.name ?? "").includes(raw),
    score: scoreOf(r),
  }));

  const result: GeocodeHit =
    candidates.length > 0
      ? {
          query: raw,
          match: "ok",
          candidates,
          best: candidates.reduce((a, b) => (a.score >= b.score && (a.exact || !b.exact) ? a : b)),
        }
      : { query: raw, match: "failed", candidates: [], best: null };

  cache.set(key, result);
  return result;
}

/** 批量地理编码（串行，遵守限速）。10-20 个路点约需 15-25 秒。 */
export async function geocodeAll(
  names: string[],
  opts: { city?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<GeocodeHit[]> {
  const out: GeocodeHit[] = [];
  for (let i = 0; i < names.length; i++) {
    out.push(await geocode(names[i], { city: opts.city }));
    opts.onProgress?.(i + 1, names.length);
  }
  return out;
}

export function havM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}