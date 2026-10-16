/**
 * 历史数据回填 —— 把库里缺失的更早训练补进来。
 *
 * 为什么需要这个：
 *  常规 sync 的窗口是 30 天，而且**从今天往回切**，所以它只能拿到最近 30 天。
 *  而更早的比赛（目标赛前的同级别赛事）往往因为没回填而完全看不到，
 *  这些比赛数据对备赛参考价值极高 —— 它们是**实测的全力输出**，比任何推算都准。
 *
 * 举例：某人 2026-04 才建库，但 2025-11 跑过一场精英赛、
 *  2026-01 跑过一场马拉松 —— 没回填就看不到这两场。
 *
 * 关键约束（实测）：
 *  - `querySportRecords` 单次查询**硬上限 20 条**，传 limit:300 也只给 20。
 *    所以必须把时间区间切碎（默认 10 天），否则会静默丢数据。
 *  - 服务端至少保留到 2025-09，暂未见更早的边界。
 *
 * 用法：
 *   bun run src/cli/backfill.ts              # 回填最近 12 个月
 *   bun run src/cli/backfill.ts 24           # 回填 24 个月
 *   bun run src/cli/backfill.ts 12 --dry     # 只看会拉到什么，不写库
 */
import { db, sqlite } from "../db/client.ts";
import { activities, activityDetails, laps } from "../db/schema.ts";
import { callTool } from "../coros/mcp.ts";
import { parseActivityDetail, parseLapData, parseSportRecords, type SportRecord } from "../coros/parse.ts";

const args = process.argv.slice(2);
const months = Number(args.find((a) => /^\d+$/.test(a)) ?? 12);
const dryRun = args.includes("--dry");
/** 10 天一个窗口：服务端单次只回 20 条，窗口太大就会漏 */
const WINDOW_DAYS = 10;
const RUN_CODES = [100, 101, 102, 103];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

const existing = new Set(db.select().from(activities).all().map((a) => a.labelId));
const all = db.select().from(activities).all();
const dates = all.map((a) => a.dateLabel!).sort();
console.log(`现有：${all.length} 条，${dates[0]} ~ ${dates[dates.length - 1]}`);
console.log(`模式：${dryRun ? "DRY RUN（不写库）" : "写入数据库"}，回填最近 ${months} 个月\n`);

// 从今天往回切 WINDOW_DAYS 的窗口
const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - months);
const windows: { from: Date; to: Date }[] = [];
{
  let to = new Date();
  while (to.getTime() > cutoff.getTime()) {
    const from = new Date(to);
    from.setDate(from.getDate() - WINDOW_DAYS);
    windows.push({ from: from < cutoff ? cutoff : from, to });
    to = from;
  }
}
console.log(`将查询 ${windows.length} 个窗口（每个 ${WINDOW_DAYS} 天）\n`);

const records: SportRecord[] = [];
let truncated = 0;

for (const [i, w] of windows.entries()) {
  try {
    const raw = await callTool("querySportRecords", {
      startDate: ymd(w.from),
      endDate: ymd(w.to),
      sportTypeCodes: RUN_CODES,
      minDistanceKm: null,
      maxDistanceKm: null,
      minDurationMinutes: null,
      maxDurationMinutes: null,
      maxAveragePace: null,
      locationKeyword: null,
      limit: 300,
    });
    const parsed = parseSportRecords(raw);
    // 单窗口 20 条 = 可能被截断，需要缩小窗口重来
    if (parsed.length >= 20) {
      truncated++;
      console.log(
        `  ⚠ ${ymd(w.from)}~${ymd(w.to)} 返回 ${parsed.length} 条（疑似触顶，需细分）`,
      );
    }
    records.push(...parsed);
    process.stdout.write(`\r  进度 ${i + 1}/${windows.length} 窗口，累计 ${records.length} 条   `);
    await sleep(150);
  } catch (e) {
    console.log(`\n  ${ymd(w.from)} 查询失败: ${(e as Error).message.slice(0, 60)}`);
  }
}
process.stdout.write("\n\n");

// 去重：labelId 唯一
const byId = new Map<string, SportRecord>();
for (const r of records) if (r.labelId) byId.set(r.labelId, r);
const fresh = [...byId.values()].filter((r) => !existing.has(r.labelId)).sort((a, b) =>
  (a.dateLabel ?? "").localeCompare(b.dateLabel ?? ""),
);

console.log(`拉到 ${records.length} 条（去重后 ${byId.size}），其中本地没有的 ${fresh.length} 条`);

if (fresh.length === 0) {
  console.log("没有新数据。");
  process.exit(0);
}

console.log("\n=== 将新增（比赛用 ★ 标记）===");
for (const r of fresh) {
  const isRace = (r.distanceKm ?? 0) >= 21;
  const dur = r.durationSec ? `${Math.floor(r.durationSec / 3600)}:${String(Math.floor((r.durationSec % 3600) / 60)).padStart(2, "0")}:${String(r.durationSec % 60).padStart(2, "0")}` : "—";
  console.log(
    `  ${isRace ? "★" : " "} ${r.dateLabel}  ${String((r.distanceKm ?? 0).toFixed(1)).padStart(5)}km  ` +
      `${dur.padStart(9)}  心率 ${String(r.avgHr ?? "—").padStart(3)}  ${r.location ?? ""}`,
  );
}

if (dryRun) {
  console.log("\n（DRY RUN，未写库）");
  process.exit(0);
}

// ---- 写入 ----
let inserted = 0;
for (const r of fresh) {
  try {
    sqlite
      .query(
        `INSERT OR REPLACE INTO activities
         (label_id, sport_type, sport_name, date, date_label, start_ts, end_ts,
          location, lat, lon, duration_sec, distance_km, avg_pace_sec, avg_hr,
          calories, raw, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())`,
      )
      .run(
        r.labelId,
        r.sportType,
        r.sportName,
        (r.startTimestamp ? new Date(r.startTimestamp * 1000).toISOString().slice(0, 10) : r.dateLabel) ?? "",
        r.dateLabel ?? "",
        r.startTimestamp ?? null,
        r.endTimestamp ?? null,
        r.location ?? null,
        r.lat ?? null,
        r.lon ?? null,
        r.durationSec ?? null,
        r.distanceKm ?? null,
        r.avgPaceSec ?? null,
        r.avgHr ?? null,
        r.calories ?? null,
        JSON.stringify(r),
      );
    inserted++;

    // 明细 + 逐圈：比赛数据必须补上，逐圈是配速-心率分析的基础
    try {
      const detailRaw = await callTool("getActivityDetail", {
        labelId: r.labelId,
        sportType: r.sportType,
      });
      const d = parseActivityDetail(detailRaw, r.labelId);
      if (d) {
        sqlite
          .query(
            `INSERT OR REPLACE INTO activity_details
             (label_id, sport_name, duration_sec, distance_km, avg_pace_sec, moving_pace_sec,
              adjusted_pace_sec, best_km_sec, avg_hr, avg_cadence, avg_stride_m, avg_power,
              elev_gain, elev_loss, calories, training_load, aerobic_te, anaerobic_te,
              training_focus, performance, raw)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            r.labelId, d.sportName ?? r.sportName, d.durationSec ?? null, d.distanceKm ?? null,
            d.avgPaceSec ?? null, d.movingPaceSec ?? null, d.adjustedPaceSec ?? null,
            d.bestKmSec ?? null, d.avgHr ?? null, d.avgCadence ?? null, d.avgStrideM ?? null,
            d.avgPower ?? null, d.elevGain ?? null, d.elevLoss ?? null, d.calories ?? null,
            d.trainingLoad ?? null, d.aerobicTe ?? null, d.anaerobicTe ?? null,
            d.trainingFocus ?? null, d.performance ?? null, detailRaw,
          );
      }
    } catch { /* 明细失败不阻塞，摘要已入库 */ }

    try {
      const lapRaw = await callTool("queryActivityLapData", {
        labelId: r.labelId,
        sportType: r.sportType,
      });
      const lap = parseLapData(lapRaw);
      if (lap && lap.laps.length > 0) {
        sqlite.transaction(() => {
          sqlite.query("DELETE FROM laps WHERE label_id = ?").run(r.labelId);
          for (const l of lap.laps) {
            sqlite
              .query(
                `INSERT INTO laps
                 (label_id, lap_index, distance_m, time_sec, total_length_sec, avg_pace_sec,
                  adjusted_pace_sec, avg_speed_raw, avg_power, avg_hr, max_hr, avg_cadence,
                  max_cadence, avg_stride_m, elev_gain, total_descent)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
                r.labelId, l.lapIndex, l.distanceM, l.timeSec, l.totalLengthSec ?? null,
                l.avgPaceSec ?? null, l.adjustedPaceSec ?? null, l.avgSpeedRaw ?? null,
                l.avgPower ?? null, l.avgHr ?? null, l.maxHr ?? null, l.avgCadence ?? null,
                l.maxCadence ?? null, l.avgStrideM ?? null, l.elevGain ?? null,
                l.totalDescent ?? null,
              );
          }
        })();
      }
    } catch { /* 逐圈失败不阻塞 */ }

    await sleep(120);
  } catch (e) {
    console.log(`  ✗ ${r.dateLabel} ${r.labelId}: ${(e as Error).message.slice(0, 60)}`);
  }
}

const after = db.select().from(activities).all();
const d2 = after.map((a) => a.dateLabel!).sort();
console.log(`\n写入完成：新增 ${inserted} 条`);
console.log(`现在共 ${after.length} 条，${d2[0]} ~ ${d2[d2.length - 1]}`);

const races = after.filter((a) => (a.distanceKm ?? 0) >= 21);
console.log(`\n=== 全库 ≥21km 的长距离（含比赛）${races.length} 次 ===`);
for (const r of races.sort((a, b) => a.dateLabel!.localeCompare(b.dateLabel!))) {
  const sec = r.durationSec ?? 0;
  const t = sec >= 3600
    ? `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`
    : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  console.log(`  ${r.dateLabel}  ${r.distanceKm!.toFixed(2)}km  ${t.padStart(9)}  心率 ${r.avgHr ?? "—"}  ${r.location ?? ""}`);
}

if (truncated > 0) {
  console.log(`\n⚠ 有 ${truncated} 个窗口返回 20 条（服务端上限），可能仍有遗漏。`);
  console.log("  可以再跑一次并缩小窗口，或从官方导出 CSV 补齐。");
}