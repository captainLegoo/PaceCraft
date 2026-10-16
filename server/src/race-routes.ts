/**
 * 赛事路线定义 —— 官方只公布「经过哪些道路」，这里把路书转成坐标点，
 * 再配合 DEM 数据算出全程爬升。
 *
 * 这是一个**空的路线库**：仓库里刻意的、不预置任何赛事。
 *
 * 为什么不预置：内置一份路线表等于把「作者报名了哪场比赛」写进了代码。
 * 而且路线数据本身极难做准 —— 官方路书只给「经过哪些道路」，坐标要靠人工推定，
 * 路点差一点爬升就能差几十个百分点。所以可靠的来源只有两个：
 * 用户上传 GPX（自带实测海拔），或人工核对过的路书。
 *
 * 要加自己的赛事：拿官方路书，按行驶顺序列关键路点，坐标取路书推定值，
 * 参照下方 KNOWN_RACES 里注释掉的格式。找不到对应赛事时会明确报
 * 「没有这条路线」，不会拿同城别的赛事顶替（见下方 findKnownRace 的注释）。
 */

export type KnownRace = {
  name: string;
  date: string;
  city: string;
  /** 起终点所在城市的平均海拔（m），用于海拔修正 */
  altitude: number;
  distanceKm: number;
  /**
   * 赛事别名 —— 同城的不同赛事必须能区分开。
   * 例如「深圳马拉松」和「深圳南山半程马拉松」都是深圳，city 相同但赛事不同，
   * 所以查找路线时绝不能只按 city 匹配。
   */
  aliases: string[];
  /** 路书来源：官方发布的路线说明，必须能追溯到具体哪一场 */
  routeSourceNote: string;
  /** 关键路点（已按行驶顺序），坐标为路书推定值 */
  waypoints: { name: string; lat: number; lon: number }[];
};

/**
 * 按赛事查找内置路线。
 *
 * 为什么不提供"按城市查"：同一个城市可能有多场赛事
 * （深圳马拉松 / 深圳南山半程马拉松），按城市查必然选错。
 * 必须用赛事全名 + 日期来定位，找不到就明确告诉用户"没有这条路线"，
 * 绝不能退化成"给个同城的路线凑合用" —— 那是比没有更糟的错误。
 */
export function findKnownRace(name: string, date?: string): KnownRace | null {
  const n = name.trim();
  const byName = (r: KnownRace) =>
    r.name === n || r.aliases.some((a) => a === n || a.includes(n) || n.includes(a));

  const candidates = Object.values(KNOWN_RACES).filter(byName);
  if (candidates.length === 0) return null;
  if (date) {
    const dated = candidates.find((r) => r.date === date);
    if (dated) return dated;
  }
  // 名称唯一时直接返回；有歧义就返回 null，让调用方要求用户选
  return candidates.length === 1 ? candidates[0] : null;
}

/** 列出某个城市下所有已知赛事（给 UI 做提示用） */
export function knownRacesInCity(city: string): KnownRace[] {
  return Object.values(KNOWN_RACES).filter((r) => r.city === city);
}

/**
 * 内置路线表，默认为空。
 *
 * 键的格式是 `${日期}-${城市拼音}-${距离}`，值见 KnownRace 类型。
 * 示例（注释保留，仅作格式参考，不要直接把别人的赛事提交进仓库）：
 *
 *   "2027-01-01-example-city-full": {
 *     name: "2027 XX马拉松（全程）",
 *     date: "2027-01-01",
 *     city: "XX",
 *     altitude: 30,                    // 城市平均海拔，用于海拔修正
 *     distanceKm: 42.195,
 *     aliases: ["XX马拉松", "2027XX马拉松"],
 *     routeSourceNote: "官方发布路书：起点→…→终点",
 *     waypoints: [                     // 已按行驶顺序，坐标为路书推定值
 *       { name: "起点", lat: 0.0, lon: 0.0 },
 *       { name: "终点", lat: 0.0, lon: 0.0 },
 *     ],
 *   },
 */
export const KNOWN_RACES: Record<string, KnownRace> = {};

/**
 * 在关键点之间线性插值。
 *
 * 为什么需要插值：DEM 是 30m 分辨率，只取路书节点的话，
 * 相邻节点可能隔了好几公里，中间的真实起伏全被漏掉了。
 * 每段插 3 个中间点能把累计爬升的分辨率提高 4 倍。
 */
export function densifyWaypoints(
  race: KnownRace,
  perSegment = 3,
): { name: string; lat: number; lon: number }[] {
  const out: { name: string; lat: number; lon: number }[] = [race.waypoints[0]];
  for (let i = 1; i < race.waypoints.length; i++) {
    const a = race.waypoints[i - 1];
    const b = race.waypoints[i];
    for (let k = 1; k <= perSegment; k++) {
      const t = k / perSegment;
      out.push({
        name: `${a.name}→${b.name} ${Math.round(t * 100)}%`,
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      });
    }
  }
  return out;
}