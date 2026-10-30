/**
 * 跨品牌运动类型（Unified Sport Types）标准化定义与通用字典
 *
 * 规范说明：
 * 1. 本字典作为 PaceCraft 全平台的标准运动类型基准（Unified Code）；
 * 2. 高驰（COROS）接口以其 dubbo sportType 映射至此；
 * 3. 佳明（Garmin）接口以其 activityType.typeKey / sportTypeId 归一化映射至此；
 * 4. 设置页所选白名单（White List）跨所有运动手表生态统一生效。
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
 * 默认同步的运动类型：
 * 默认包含核心跑步大类、徒步、健步健身以及日常有氧/力量。
 */
export const DEFAULT_SPORT_TYPE_CODES = [100, 101, 102, 103, 104, 900, 902, 903, 904, 400, 401, 402];

const SETTINGS_ID = 1;

function parseCodes(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const codes = parsed.map(Number).filter((n) => Number.isInteger(n) && ALL_SPORT_CODES.has(n));
    return [...new Set(codes)].sort((a, b) => a - b);
  } catch {
    return null;
  }
}

/**
 * 读当前生效的统一同步白名单。
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

/**
 * 佳明 Garmin 运动类型归一化映射函数
 * 将 Garmin 的 typeKey 及 sportTypeId 转换为系统标准统一编码
 */
export function mapGarminSportType(typeKey: string = "", sportTypeId?: number): { code: number; label: string } {
  const key = typeKey.toLowerCase();

  // 1. 跑步类
  if (key === "running" || sportTypeId === 1) return { code: 100, label: "户外跑" };
  if (key === "treadmill_running" || key.includes("treadmill")) return { code: 101, label: "室内跑" };
  if (key === "trail_running") return { code: 102, label: "越野跑" };
  if (key === "track_running") return { code: 103, label: "场地跑" };
  if (key === "hiking") return { code: 104, label: "徒步" };
  if (key === "mountaineering") return { code: 105, label: "登山" };

  // 2. 骑行类
  if (key === "indoor_cycling") return { code: 201, label: "室内骑" };
  if (key === "gravel_cycling") return { code: 203, label: "砾石骑" };
  if (key === "mountain_biking") return { code: 204, label: "山地骑" };
  if (key === "e_biking") return { code: 202, label: "电助力车" };
  if (key.includes("cycling") || key.includes("biking") || sportTypeId === 2) return { code: 200, label: "户外骑" };

  // 3. 游泳类
  if (key === "lap_swimming" || key.includes("pool")) return { code: 300, label: "泳池" };
  if (key === "open_water_swimming" || key.includes("swimming") || sportTypeId === 5) return { code: 301, label: "开放水域" };

  // 4. 有氧与力量
  if (key === "strength_training" || key.includes("strength")) return { code: 402, label: "力量训练" };
  if (key === "indoor_cardio" || key.includes("cardio")) return { code: 400, label: "室内有氧" };
  if (key.includes("fitness_equipment")) return { code: 400, label: "室内有氧" };

  // 5. 步行与健身
  if (key === "walking" || key.includes("walking")) return { code: 900, label: "步行" };
  if (key === "jump_rope" || key.includes("jump_rope")) return { code: 901, label: "跳绳" };
  if (key === "floor_climbing" || key.includes("stair")) return { code: 902, label: "爬楼" };
  if (key === "elliptical" || key.includes("elliptical")) return { code: 903, label: "椭圆机" };
  if (key === "yoga" || key.includes("yoga")) return { code: 904, label: "瑜伽" };
  if (key === "pilates" || key.includes("pilates")) return { code: 905, label: "普拉提" };
  if (key === "boxing" || key.includes("boxing")) return { code: 906, label: "拳击" };

  // 6. 滑雪
  if (key === "resort_skiing" || key.includes("ski")) return { code: 500, label: "滑雪" };
  if (key === "snowboarding") return { code: 501, label: "单板" };

  // 7. 水上
  if (key === "rowing") return { code: 700, label: "划船" };
  if (key === "indoor_rowing") return { code: 701, label: "室内划船机" };
  if (key === "kayaking") return { code: 704, label: "静水皮划艇" };
  if (key === "stand_up_paddleboarding") return { code: 705, label: "风帆冲浪" };

  // 8. 攀岩
  if (key === "rock_climbing") return { code: 802, label: "户外攀岩" };
  if (key === "bouldering") return { code: 801, label: "抱石" };

  // 9. 球类
  if (key === "tennis") return { code: 1005, label: "网球" };
  if (key === "pickleball") return { code: 1004, label: "匹克球" };
  if (key === "badminton") return { code: 1000, label: "羽毛球" };
  if (key === "table_tennis") return { code: 1001, label: "乒乓球" };

  // 10. 铁人三项 / 多项
  if (key === "triathlon" || key.includes("multisport")) return { code: 10000, label: "铁人三项" };

  // 默认兜底：常规跑步
  return { code: 100, label: "跑步" };
}
