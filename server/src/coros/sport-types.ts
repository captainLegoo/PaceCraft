/**
 * COROS 运动类型（dubbo sportType）编码表。
 *
 * 数据来源是 querySportRecords 工具描述里的官方编码表，不是自己编的。
 * 这个文件是唯一的真源：后端同步读它、前端勾选列表也从 API 读它，
 * 避免两处各维护一份然后慢慢对不上。
 *
 * 为什么不做成「全选 / 跑步 / 全部」三档按钮：真实用户练的东西很杂
 * （有人跑 + 爬楼，有人跑 + 骑车 + 力量），粒度太粗就没法用。
 */

import { db } from "../db/client.ts";
import { syncSettings } from "../db/schema.ts";

export type SportType = { code: number; label: string };

export type SportGroup = { key: string; label: string; types: SportType[] };

export const SPORT_GROUPS: SportGroup[] = [
  {
    key: "run",
    label: "跑步",
    types: [
      { code: 100, label: "户外跑" },
      { code: 101, label: "室内跑" },
      { code: 102, label: "越野跑" },
      { code: 103, label: "场地跑" },
      { code: 104, label: "徒步" },
      { code: 105, label: "登山" },
      { code: 106, label: "多段攀登" },
    ],
  },
  {
    key: "bike",
    label: "骑行",
    types: [
      { code: 200, label: "户外骑" },
      { code: 201, label: "室内骑" },
      { code: 202, label: "电助力车" },
      { code: 203, label: "砾石骑" },
      { code: 204, label: "山地骑" },
      { code: 205, label: "山地电助力" },
      { code: 299, label: "头盔骑" },
    ],
  },
  {
    key: "swim",
    label: "游泳",
    types: [
      { code: 300, label: "泳池" },
      { code: 301, label: "开放水域" },
    ],
  },
  {
    key: "cardio",
    label: "有氧 / 力量",
    types: [
      { code: 400, label: "室内有氧" },
      { code: 401, label: "GPS 有氧" },
      { code: 402, label: "力量训练" },
    ],
  },
  {
    key: "walk",
    label: "步行 / 健身",
    types: [
      { code: 900, label: "步行" },
      { code: 901, label: "跳绳" },
      { code: 902, label: "爬楼" },
      { code: 903, label: "椭圆机" },
      { code: 904, label: "瑜伽" },
      { code: 905, label: "普拉提" },
      { code: 906, label: "拳击" },
    ],
  },
  { key: "ski", label: "滑雪", types: [
    { code: 500, label: "滑雪" },
    { code: 501, label: "单板" },
    { code: 502, label: "越野滑雪" },
    { code: 503, label: "登山滑雪" },
  ] },
  { key: "row", label: "水上 / 钓鱼", types: [
    { code: 700, label: "划船" },
    { code: 701, label: "室内划船机" },
    { code: 702, label: "激流皮划艇" },
    { code: 704, label: "静水皮划艇" },
    { code: 705, label: "风帆冲浪" },
    { code: 706, label: "速帆" },
  ] },
  { key: "climb", label: "攀岩", types: [
    { code: 800, label: "室内单攀" },
    { code: 801, label: "抱石" },
    { code: 802, label: "户外攀岩" },
  ] },
  { key: "ball", label: "球类", types: [
    { code: 1000, label: "羽毛球" },
    { code: 1001, label: "乒乓球" },
    { code: 1002, label: "篮球" },
    { code: 1003, label: "足球" },
    { code: 1004, label: "匹克球" },
    { code: 1005, label: "网球" },
    { code: 1006, label: "板式网球" },
  ] },
  { key: "leisure", label: "休闲", types: [
    { code: 1100, label: "飞盘" },
    { code: 1101, label: "滑板" },
  ] },
  { key: "hybrid", label: "混合 / 多项", types: [
    { code: 1200, label: "混合体能" },
    { code: 10000, label: "铁人三项" },
    { code: 10001, label: "自由组合" },
    { code: 10002, label: "攀爬滑雪" },
    { code: 10003, label: "多段攀登" },
  ] },
  { key: "custom", label: "自定义", types: [
    { code: 9800, label: "户外球类" },
    { code: 9801, label: "户外休闲" },
    { code: 9802, label: "户外山地" },
    { code: 9803, label: "户外高海拔" },
    { code: 9804, label: "户外机动车" },
    { code: 9805, label: "户外水上" },
    { code: 9806, label: "户外探险" },
    { code: 9807, label: "户外其它" },
    { code: 9900, label: "室内球类" },
    { code: 9901, label: "室内力量" },
    { code: 9902, label: "室内塑形" },
    { code: 9903, label: "室内舞蹈" },
    { code: 9904, label: "室内其它" },
    { code: 9999, label: "通用自定义" },
  ] },
];

/** 全部已知编码，用来校验前端传来的值 */
export const ALL_SPORT_CODES = new Set(SPORT_GROUPS.flatMap((g) => g.types.map((t) => t.code)));

/**
 * 默认同步的运动类型。
 *
 * = 原本硬编码的跑步相关编码 + 有氧/力量三项（400/401/402）。
 *
 * 注意这里**没有**包含骑行和游泳：那些类型的距离/配速语义跟跑步不同
 * （游泳算的是趟数，配速是 min/100m），下游图表目前按跑步口径画，
 * 混进来会得出误导性的结论。用户可以在设置里自行勾选，那是他的选择。
 */
export const DEFAULT_SPORT_TYPE_CODES = [100, 102, 103, 104, 900, 902, 903, 904, 400, 401, 402];

const SETTINGS_ID = 1;

function parseCodes(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const codes = parsed.map(Number).filter((n) => Number.isInteger(n) && ALL_SPORT_CODES.has(n));
    // 去重 + 升序，让存储值稳定，便于比对
    return [...new Set(codes)].sort((a, b) => a - b);
  } catch {
    return null;
  }
}

/**
 * 读当前生效的同步白名单。
 *
 * 没有配置行（老库首次升级）或内容损坏时回退到默认值 ——
 * 同步是这个应用的主功能，不能因为配置缺失就一条数据都拉不回来。
 * 全空数组同样回退：sportTypeCodes 传空数组给 COROS 的语义不明，
 * 比"回退默认"更容易出怪问题。
 */
export function loadSportTypeCodes(): number[] {
  const row = db.select().from(syncSettings).all().find((r) => r.id === SETTINGS_ID);
  const codes = parseCodes(row?.sportTypeCodes);
  if (!codes || codes.length === 0) return [...DEFAULT_SPORT_TYPE_CODES];
  return codes;
}

export function saveSportTypeCodes(input: unknown): number[] {
  const list = Array.isArray(input) ? input : [];
  const codes = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && ALL_SPORT_CODES.has(n)))].sort(
    (a, b) => a - b,
  );
  if (codes.length === 0) throw new Error("至少要选择一种运动类型，否则同步不到任何数据");

  db.insert(syncSettings)
    .values({ id: SETTINGS_ID, sportTypeCodes: JSON.stringify(codes), updatedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoUpdate({
      target: syncSettings.id,
      set: { sportTypeCodes: JSON.stringify(codes), updatedAt: Math.floor(Date.now() / 1000) },
    })
    .run();

  return codes;
}

/** 给设置页用：分组表 + 当前选中 + 默认值，一次返回 */
export function sportSettingsPayload() {
  return {
    groups: SPORT_GROUPS,
    selected: loadSportTypeCodes(),
    defaults: DEFAULT_SPORT_TYPE_CODES,
  };
}
