/**
 * 分析即将参加的比赛路线爬升，输出配速建议。
 *
 * 用法：
 *   bun run src/cli/race-route.ts                          # 分析所有已知路线
 *   bun run src/cli/race-route.ts <key>                    # 只分析某一场
 *   bun run src/cli/race-route.ts <key> --target=18300      # 带上你的目标成绩
 *
 * 数据来源：Open-Elevation API（SRTM/Copernicus 30m DEM）
 * 结果会缓存到 /tmp/coros-race-routes/<key>.json，避免重复请求。
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildRouteProfile, paceAdvice, type RouteProfile } from "../route-profile.ts";
import { densifyWaypoints, KNOWN_RACES } from "../race-routes.ts";
import { altitudeAdjustPace } from "../altitude.ts";

const CACHE_DIR = "/tmp/coros-race-routes";
mkdirSync(CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
const keyArg = args.find((a) => !a.startsWith("--"));
const targetArg = Number(args.find((a) => a.startsWith("--target="))?.slice(9)) || null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 批量查 DEM 高程（API 单次最多 10 个点，必须分批） */
async function fetchAltitudes(
  pts: { name: string; lat: number; lon: number }[],
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 10) {
    const batch = pts.slice(i, i + 10);
    const locs = batch.map((p) => `${p.lat},${p.lon}`).join("|");
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${locs}`;
    const res = await fetch(url);
    const json = (await res.json()) as any;
    if (!json.results) throw new Error(`DEM 查询失败: ${JSON.stringify(json).slice(0, 120)}`);
    // API 按顺序返回，但保险起见按 lat/lon 对齐
    for (const r of json.results) out.push(r.elevation);
    await sleep(1200); // 官方建议不要打太快
  }
  return out;
}

const fmtDur = (sec: number) =>
  `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const fmtPace = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

for (const [key, race] of Object.entries(KNOWN_RACES)) {
  if (keyArg && key !== keyArg) continue;

  console.log(`\n${"=".repeat(64)}`);
  console.log(`${race.name}   ${race.date}`);
  console.log(`${"=".repeat(64)}`);

  const cachePath = `${CACHE_DIR}/${key}.json`;
  const pts = densifyWaypoints(race);

  let altitudes: number[];
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    if (cached.length === pts.length) {
      altitudes = cached;
      console.log(`使用缓存的 DEM 数据（${altitudes.length} 点）`);
    } else {
      console.log(`缓存点数不符（${cached.length} vs ${pts.length}），重新查询…`);
      altitudes = await fetchAltitudes(pts);
      writeFileSync(cachePath, JSON.stringify(altitudes));
    }
  } else {
    console.log(`查询 DEM 高程（${pts.length} 个点）…`);
    altitudes = await fetchAltitudes(pts);
    writeFileSync(cachePath, JSON.stringify(altitudes));
  }

  const profile: RouteProfile = buildRouteProfile(race.name, pts, altitudes, race.distanceKm);

  console.log(`\n【路线画像】`);
  console.log(`  赛段距离（官方）      ${profile.totalDistanceKm} km`);
  console.log(`  路书直线距离          ${profile.waypointDistanceKm} km（折返段只算一次，所以偏小，仅供校验）`);
  console.log(`  估算累计爬升          ${profile.gainM} m`);
  console.log(`  估算累计下降          ${profile.lossM} m`);
  console.log(`  爬升率                ${profile.gainPerKm} m/km`);
  console.log(`  高程范围              ${profile.altMin} – ${profile.altMax} m`);
  console.log(`  起点→终点净变化      ${profile.netChange >= 0 ? "+" : ""}${profile.netChange} m`);
  console.log(`  城市海拔              ${race.altitude} m（${(2.5 * race.altitude / 1000).toFixed(1)} s/km 以内可忽略海拔影响）`);
  console.log(`\n【判断】${profile.verdict}`);

  console.log(`\n【分段高程】（只看净变化 ≥3m 的路段）`);
  for (const s of profile.segments) {
    if (Math.abs(s.netChange) < 3) continue;
    const arrow = s.netChange > 0 ? "↑ 上坡" : "↓ 下坡";
    console.log(
      `  ${s.from} → ${s.to}\n     ${arrow} ${Math.abs(s.netChange)} m（${s.altFrom}→${s.altTo} m，坡度 ${s.gradePct}%）`,
    );
  }

  // 参照目标：不写死任何人的真实成绩，改成常见的成绩档位示例。
  // 需要按自己的历史比赛算，传 --target <秒数 或 时:分:秒>。
  const TARGETS = [
    ...(targetArg ? [{ label: `你的目标 ${fmtDur(targetArg)}`, sec: targetArg }] : []),
    { label: "目标 3:00:00", sec: 3 * 3600 },
    { label: "目标 3:05:00", sec: 3 * 3600 + 5 * 60 },
    { label: "目标 3:15:00", sec: 3 * 3600 + 15 * 60 },
  ];

  console.log(`\n【配速建议】`);
  for (const t of TARGETS) {
    const adv = paceAdvice(profile, t.sec);
    const adj = altitudeAdjustPace(adv.flatEquivalentSec, race.altitude);
    console.log(`\n  ${t.label}`);
    console.log(`    平路等效配速  ${fmtPace(Math.round(adj))}/km  (地形修正前 ${fmtPace(adv.flatEquivalentSec)}/km)`);
    console.log(`    地形代价      ${adv.costSecPerKm} s/km`);
  }

  console.log(`\n【数据说明】${profile.caveat}`);
}

if (!keyArg) {
  console.log(`\n（用 --target=秒数 可加入你的目标成绩，例如 --target=18300）`);
}