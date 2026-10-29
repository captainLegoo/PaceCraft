import { sqlite } from "../server/src/db/client.ts";
import { detectActivityConflicts } from "../server/src/conflicts.ts";

const garminLabelId = "garmin_10279883482";
const corosLabelId = "481332128104088454";

// 1. 清理可能已存在的旧 mock 数据
sqlite.query("DELETE FROM laps WHERE label_id = ?").run(garminLabelId);
sqlite.query("DELETE FROM activity_details WHERE label_id = ?").run(garminLabelId);
sqlite.query("DELETE FROM activities WHERE label_id = ?").run(garminLabelId);

// 2. 插入 Garmin 活动基础信息
sqlite.query(`
  INSERT INTO activities (
    label_id, sport_type, sport_name, date, date_label, start_ts, end_ts,
    duration_sec, distance_km, avg_pace_sec, avg_hr, calories, source, is_duplicate, synced_at
  ) VALUES (
    ?, 100, ?, '20261027', '2026-10-27', 1793098345, 1793098345 + 3385,
    3385, 12.18, 278, 149, 792, 'garmin', 0, unixepoch()
  )
`).run(garminLabelId, "朝阳区 晨跑 (Garmin 265)");

// 3. 插入 Garmin 详情
sqlite.query(`
  INSERT INTO activity_details (
    label_id, sport_name, duration_sec, distance_km, avg_pace_sec, moving_pace_sec,
    avg_hr, avg_cadence, avg_stride_m, avg_power, elev_gain, elev_loss, calories,
    training_load, aerobic_te, anaerobic_te, training_focus, performance
  ) VALUES (
    ?, ?, 3385, 12.18, 278, 279,
    149, 183, 1.18, 240, 126, 132, 792,
    116, 3.2, 1.8, '节奏跑', '出色'
  )
`).run(garminLabelId, "朝阳区 晨跑 (Garmin 265)");

// 4. 插入 Garmin 分圈数据 (微调心率与距离公差，模拟真实光电心率与 GPS 滤波)
const lapsData = [
  { lap: 1, dist: 1000, time: 285.2, pace: 285.2, hr: 136, maxHr: 151, cad: 180, stride: 1.16, elev: 13, desc: 6 },
  { lap: 2, dist: 1000, time: 300.8, pace: 300.8, hr: 147, maxHr: 156, cad: 180, stride: 1.10, elev: 21, desc: 14 },
  { lap: 3, dist: 1000, time: 286.0, pace: 286.0, hr: 142, maxHr: 155, cad: 181, stride: 1.15, elev: 12, desc: 16 },
  { lap: 4, dist: 1000, time: 285.0, pace: 285.0, hr: 143, maxHr: 157, cad: 183, stride: 1.14, elev: 11, desc: 24 },
  { lap: 5, dist: 1000, time: 270.0, pace: 270.0, hr: 143, maxHr: 152, cad: 186, stride: 1.19, elev: 5, desc: 12 },
  { lap: 6, dist: 1000, time: 279.8, pace: 279.8, hr: 151, maxHr: 161, cad: 185, stride: 1.15, elev: 9, desc: 4 },
  { lap: 7, dist: 1000, time: 278.2, pace: 278.2, hr: 153, maxHr: 162, cad: 184, stride: 1.17, elev: 6, desc: 5 },
  { lap: 8, dist: 1000, time: 284.1, pace: 284.1, hr: 156, maxHr: 167, cad: 182, stride: 1.15, elev: 18, desc: 7 },
  { lap: 9, dist: 1000, time: 266.0, pace: 266.0, hr: 145, maxHr: 154, cad: 185, stride: 1.21, elev: 0, desc: 21 },
  { lap: 10, dist: 1000, time: 275.1, pace: 275.1, hr: 156, maxHr: 171, cad: 185, stride: 1.17, elev: 14, desc: 8 },
  { lap: 11, dist: 1000, time: 280.5, pace: 280.5, hr: 157, maxHr: 168, cad: 183, stride: 1.16, elev: 13, desc: 6 },
  { lap: 12, dist: 1000, time: 250.8, pace: 250.8, hr: 160, maxHr: 168, cad: 188, stride: 1.25, elev: 0, desc: 9 },
  { lap: 13, dist: 180, time: 43.5, pace: 241.6, hr: 166, maxHr: 168, cad: 190, stride: 1.29, elev: 0, desc: 0 },
];

let cumTime = 0;
for (const l of lapsData) {
  cumTime += l.time;
  sqlite.query(`
    INSERT INTO laps (
      label_id, lap_index, distance_m, time_sec, total_length_sec, avg_pace_sec,
      avg_hr, max_hr, avg_cadence, avg_stride_m, elev_gain, total_descent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    garminLabelId,
    l.lap,
    l.dist,
    l.time,
    cumTime,
    l.pace,
    l.hr,
    l.maxHr,
    l.cad,
    l.stride,
    l.elev,
    l.desc
  );
}

console.log("✅ 成功插入 Garmin 10-27 模拟活动与 13 圈分圈数据！");

// 5. 触发去重与冲突判定引擎
const dedupResult = detectActivityConflicts({ primaryBrand: "coros" });
console.log("✅ 触发智能去重：", dedupResult);

const corosAct = sqlite.query("SELECT label_id, source, is_duplicate, duplicate_of, conflict_status FROM activities WHERE label_id = ?").get(corosLabelId);
const garminAct = sqlite.query("SELECT label_id, source, is_duplicate, duplicate_of, conflict_status FROM activities WHERE label_id = ?").get(garminLabelId);

console.log("高驰记录状态：", corosAct);
console.log("佳明记录状态：", garminAct);
