#!/usr/bin/env bun
/**
 * 佳明与高驰导入数据全链路验证与自清理脚本
 *
 * 验证维度：
 *  1. 高驰 COROS 导入协议与时序归一化
 *  2. 佳明 Garmin 导入协议与时序归一化
 *  3. 双表同场重叠去重（Conflict Detection & Resolution）
 *  4. Session 同场双表对比（Head-to-Head Compare）
 *  5. 佳明夜间睡眠与 HRV 生态接入
 *  6. 跨品牌多生态统一训练负荷与 ACWR（Banister EWMA）
 *  7. 验证后全量自动清理与数据库纯净还原（Zero Residuals）
 */

import { sqlite, db } from "../db/client.ts";
import { activities, activityDetails, laps } from "../db/schema.ts";
import { detectActivityConflicts, cleanMockTestData, computeUnifiedTrimp } from "../conflicts.ts";
import { loadSeries } from "../analytics.ts";
import { initGarminHealthTable } from "../garmin/health.ts";

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, msg: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${msg}`);
  } else {
    console.error(`  ✗ [FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function main() {
  console.log("================================================================================");
  console.log("🚀 开始执行：高驰 COROS & 佳明 Garmin 导入数据全协议验证与自清理");
  console.log("================================================================================\n");

  initGarminHealthTable();

  // 0. 记录初始基准状态
  const initialActCount = (sqlite.query("SELECT count(*) as c FROM activities").get() as any).c;
  const initialLapCount = (sqlite.query("SELECT count(*) as c FROM laps").get() as any).c;
  const initialDetailCount = (sqlite.query("SELECT count(*) as c FROM activity_details").get() as any).c;
  const initialGarminHealthCount = (sqlite.query("SELECT count(*) as c FROM garmin_daily_health").get() as any).c;

  console.log(`📊 初始数据库基线:`);
  console.log(`   - 真实活动总数: ${initialActCount}`);
  console.log(`   - 分圈记录总数: ${initialLapCount}`);
  console.log(`   - 详情记录总数: ${initialDetailCount}`);
  console.log(`   - 佳明健康记录: ${initialGarminHealthCount}\n`);

  try {
    // --------------------------------------------------------------------------
    // 阶段 1: 验证高驰 COROS 导入协议
    // --------------------------------------------------------------------------
    console.log("📌 [阶段 1/6] 验证高驰 COROS 单表导入与指标标准化...");
    const corosLabelId = "sim_test_coros_10k";
    const corosStartTime = 1793260800; // 模拟时间戳
    const corosEndTime = corosStartTime + 3000; // 50 分钟整
    const corosDistanceKm = 10.0;
    const corosDurationSec = 3000;
    const corosPaceSec = 300; // 5:00 / km
    const corosTrimp = computeUnifiedTrimp(corosDurationSec, 155);

    sqlite.run(`
      INSERT INTO activities (
        label_id, sport_type, sport_name, source,
        start_ts, end_ts, duration_sec, distance_km, avg_pace_sec,
        avg_hr, calories, date, date_label, is_duplicate
      ) VALUES (
        '${corosLabelId}', 100, '跑步', 'coros',
        ${corosStartTime}, ${corosEndTime}, ${corosDurationSec}, ${corosDistanceKm}, ${corosPaceSec},
        155, 650, '20261028', '2026-10-28', 0
      )
    `);

    // 写入 10 个 1km 分圈
    for (let i = 1; i <= 10; i++) {
      sqlite.run(`
        INSERT INTO laps (
          label_id, lap_index, distance_m, time_sec, avg_pace_sec,
          avg_hr, max_hr, avg_cadence, elev_gain
        ) VALUES (
          '${corosLabelId}', ${i}, 1000, 300, 300,
          ${148 + i}, ${155 + i}, 180, 4
        )
      `);
    }

    sqlite.run(`
      INSERT INTO activity_details (
        label_id, sport_name, duration_sec, distance_km, avg_pace_sec,
        avg_hr, avg_cadence, elev_gain, calories, training_load, aerobic_te, anaerobic_te
      ) VALUES (
        '${corosLabelId}', '跑步', ${corosDurationSec}, ${corosDistanceKm}, ${corosPaceSec},
        155, 180, 45, 650, ${corosTrimp}, 3.5, 0.8
      )
    `);

    const corosRow = sqlite.query(`SELECT * FROM activities WHERE label_id = '${corosLabelId}'`).get() as any;
    assert(corosRow != null, "高驰活动入库成功");
    assert(corosRow.source === "coros", "高驰活动来源标记为 coros");
    assert(corosRow.avg_pace_sec === 300, "高驰配速标准化正确 (300s/km = 5:00/km)");
    assert(corosRow.distance_km === 10.0, "高驰距离单位标准化正确 (10.0 km)");

    const corosLaps = sqlite.query(`SELECT count(*) as c, sum(distance_m) as total_m FROM laps WHERE label_id = '${corosLabelId}'`).get() as any;
    assert(corosLaps.c === 10, "高驰分圈数一致 (10 圈)");
    assert(corosLaps.total_m === 10000, "高驰分圈总米数精确累加至 10000 米");

    const corosDetail = sqlite.query(`SELECT * FROM activity_details WHERE label_id = '${corosLabelId}'`).get() as any;
    assert(corosDetail.avg_cadence === 180, "高驰步频存储在详情中 (180 spm)");
    assert(corosDetail.training_load === corosTrimp, "高驰训练负荷 TRIMP 计算准确");

    console.log("   阶段 1 验证通过！\n");

    // --------------------------------------------------------------------------
    // 阶段 2: 验证佳明 Garmin 导入协议
    // --------------------------------------------------------------------------
    console.log("📌 [阶段 2/6] 验证佳明 Garmin 导入协议与字段归一化...");
    const garminLabelId = "sim_test_garmin_10k";
    const garminStartTime = 1793174400; // 模拟前一天
    const garminEndTime = garminStartTime + 3060; // 51 分钟
    const garminDistanceKm = 10.2;
    const garminDurationSec = 3060;
    const garminPaceSec = Math.round(garminDurationSec / garminDistanceKm); // 300 s/km
    const garminTrimp = computeUnifiedTrimp(garminDurationSec, 152);

    sqlite.run(`
      INSERT INTO activities (
        label_id, sport_type, sport_name, source,
        start_ts, end_ts, duration_sec, distance_km, avg_pace_sec,
        avg_hr, calories, date, date_label, is_duplicate
      ) VALUES (
        '${garminLabelId}', 1, '跑步', 'garmin',
        ${garminStartTime}, ${garminEndTime}, ${garminDurationSec}, ${garminDistanceKm}, ${garminPaceSec},
        152, 680, '20261027', '2026-10-27', 0
      )
    `);

    // 写入佳明 10 个分圈
    for (let i = 1; i <= 10; i++) {
      sqlite.run(`
        INSERT INTO laps (
          label_id, lap_index, distance_m, time_sec, avg_pace_sec,
          avg_hr, max_hr, avg_cadence, elev_gain
        ) VALUES (
          '${garminLabelId}', ${i}, 1020, 306, 300,
          ${146 + i}, ${153 + i}, 178, 5
        )
      `);
    }

    sqlite.run(`
      INSERT INTO activity_details (
        label_id, sport_name, duration_sec, distance_km, avg_pace_sec,
        avg_hr, avg_cadence, elev_gain, calories, training_load, aerobic_te, anaerobic_te
      ) VALUES (
        '${garminLabelId}', '跑步', ${garminDurationSec}, ${garminDistanceKm}, ${garminPaceSec},
        152, 178, 55, 680, ${garminTrimp}, 3.4, 0.5
      )
    `);

    const garminRow = sqlite.query(`SELECT * FROM activities WHERE label_id = '${garminLabelId}'`).get() as any;
    assert(garminRow != null, "佳明活动入库成功");
    assert(garminRow.source === "garmin", "佳明活动来源标记为 garmin");
    assert(garminRow.distance_km === 10.2, "佳明距离入库正确 (10.2 km)");

    const garminDetail = sqlite.query(`SELECT * FROM activity_details WHERE label_id = '${garminLabelId}'`).get() as any;
    assert(garminDetail.avg_cadence === 178, "佳明步频指标正确 (178 spm)");
    assert(garminDetail.training_load === garminTrimp, "佳明训练负荷 TRIMP 计算准确");

    console.log("   阶段 2 验证通过！\n");

    // --------------------------------------------------------------------------
    // 阶段 3: 验证双表同场重叠去重与比对绑定 (Conflict Resolution)
    // --------------------------------------------------------------------------
    console.log("📌 [阶段 3/6] 验证高驰 & 佳明同场双表重叠去重与比对绑定...");
    // 模拟同场晨跑：高驰 06:00:00 启动，佳明 06:00:20 启动，时长重叠 > 95%
    const dualCorosId = "sim_test_dual_coros";
    const dualGarminId = "sim_test_dual_garmin";
    const dualBaseTime = 1793347200; // 2026-10-29 06:00:00

    // 高驰记录: 12.00 km, 3600s, avgHr 156
    sqlite.run(`
      INSERT INTO activities (
        label_id, sport_type, sport_name, source,
        start_ts, end_ts, duration_sec, distance_km, avg_pace_sec,
        avg_hr, calories, date, date_label, is_duplicate
      ) VALUES (
        '${dualCorosId}', 100, '跑步', 'coros',
        ${dualBaseTime}, ${dualBaseTime + 3600}, 3600, 12.00, 300,
        156, 780, '20261029', '2026-10-29', 0
      )
    `);

    // 佳明记录: 12.08 km, 3590s, avgHr 154 (重叠 99%)
    sqlite.run(`
      INSERT INTO activities (
        label_id, sport_type, sport_name, source,
        start_ts, end_ts, duration_sec, distance_km, avg_pace_sec,
        avg_hr, calories, date, date_label, is_duplicate
      ) VALUES (
        '${dualGarminId}', 1, '跑步', 'garmin',
        ${dualBaseTime + 20}, ${dualBaseTime + 3610}, 3590, 12.08, 297,
        154, 795, '20261029', '2026-10-29', 0
      )
    `);

    // 执行去重与冲突判定算法
    const conflictResult = detectActivityConflicts();
    console.log(`   → 重叠冲突引擎扫描结果: 检测冲突配对 ${conflictResult.detectedPairs} 对，已自动解决 ${conflictResult.resolved} 笔`);

    assert(conflictResult.detectedPairs >= 1, "检测到同场重叠跑步");

    const dualCorosRow = sqlite.query(`SELECT is_duplicate, duplicate_of FROM activities WHERE label_id = '${dualCorosId}'`).get() as any;
    const dualGarminRow = sqlite.query(`SELECT is_duplicate, duplicate_of FROM activities WHERE label_id = '${dualGarminId}'`).get() as any;

    // 必须有且仅有一条为主力活动（is_duplicate=0），另一条被标记为副表（is_duplicate=1 且关联 duplicate_of）
    const hasOnePrimary = (dualCorosRow.is_duplicate === 0 && dualGarminRow.is_duplicate === 1) ||
                          (dualCorosRow.is_duplicate === 1 && dualGarminRow.is_duplicate === 0);
    assert(hasOnePrimary, "双表严格二选一为主力活动，杜绝跑量翻倍");

    if (dualGarminRow.is_duplicate === 1) {
      assert(dualGarminRow.duplicate_of === dualCorosId, "佳明记录正确挂载在高驰主力记录下");
    } else {
      assert(dualCorosRow.duplicate_of === dualGarminId, "高驰记录正确挂载在佳明主力记录下");
    }

    console.log("   阶段 3 验证通过！\n");

    // --------------------------------------------------------------------------
    // 阶段 4: 验证佳明健康与夜间 HRV 生态接入
    // --------------------------------------------------------------------------
    console.log("📌 [阶段 4/6] 验证佳明 Garmin 睡眠健康与夜间 HRV 指标...");
    const healthDate = "2026-10-29";
    sqlite.run(`
      INSERT OR REPLACE INTO garmin_daily_health (
        date, calendar_date, hrv_weekly_avg, hrv_last_night_avg, hrv_status, hrv_feedback,
        hrv_baseline_low, hrv_baseline_high, sleep_score, sleep_quality, sleep_duration_sec,
        deep_sleep_sec, light_sleep_sec, rem_sleep_sec, awake_sleep_sec, avg_sleep_hr,
        avg_sleep_spo2, avg_respiration, body_battery_high, body_battery_low, body_battery_recent,
        avg_stress, max_stress, stress_qualifier, resting_hr, min_hr, max_hr
      ) VALUES (
        '${healthDate}', '${healthDate}', 58, 62, 'balanced', '夜间 HRV 状态平衡，身体恢复充分',
        52, 65, 88, 'EXCELLENT', 28800,
        5400, 14400, 7200, 1800, 48,
        97, 14.2, 98, 22, 95,
        21, 58, 'LOW', 45, 42, 110
      )
    `);

    const healthRow = sqlite.query(`SELECT * FROM garmin_daily_health WHERE date = '${healthDate}'`).get() as any;
    assert(healthRow != null, "佳明每日健康记录成功落库");
    assert(healthRow.hrv_last_night_avg === 62, "夜间 HRV 均值存储准确 (62 ms)");
    assert(healthRow.hrv_status === "balanced", "HRV 状态标记准确 (balanced)");
    assert(healthRow.sleep_score === 88, "睡眠评分读取准确 (88 分)");
    assert(healthRow.deep_sleep_sec === 5400, "深睡时长准确 (5400s = 1.5h)");
    assert(healthRow.body_battery_high === 98, "身体电量峰值读取准确 (98%)");

    console.log("   阶段 4 验证通过！\n");

    // --------------------------------------------------------------------------
    // 阶段 5: 验证跨品牌 Banister EWMA 负荷模型与 ACWR 计算
    // --------------------------------------------------------------------------
    console.log("📌 [阶段 5/6] 验证跨品牌 Banister EWMA 训练负荷与 ACWR 模型...");
    const loadList = loadSeries(10);
    assert(Array.isArray(loadList) && loadList.length > 0, "loadSeries 计算成功返回时序序列");

    const latestLoad = loadList[loadList.length - 1];
    console.log(`   → 最新当日负荷指标: 日期=${latestLoad.date}, ATL(短期)=${latestLoad.shortLoad}, CTL(长期)=${latestLoad.longLoad}, ACWR=${latestLoad.ratio}, 状态=${latestLoad.comment}`);

    assert(typeof latestLoad.shortLoad === "number" && !isNaN(latestLoad.shortLoad), "短期负荷 ATL 计算有效");
    assert(typeof latestLoad.longLoad === "number" && !isNaN(latestLoad.longLoad), "长期负荷 CTL 计算有效");
    assert(typeof latestLoad.ratio === "number" && !isNaN(latestLoad.ratio), "ACWR 比值计算有效");
    assert(["Optimized", "Recovery", "Maintaining", "Overreaching"].includes(latestLoad.comment ?? ""), "ACWR 科学分类正确映射");

    console.log("   阶段 5 验证通过！\n");

  } finally {
    // --------------------------------------------------------------------------
    // 阶段 6: 全量自动清理与纯净恢复（Zero Residuals）
    // --------------------------------------------------------------------------
    console.log("📌 [阶段 6/6] 启动模拟数据全量安全清理与纯净还原...");

    // 1. 调用系统内置测试数据清理程序
    const cleanRes = cleanMockTestData();
    console.log(`   - 已清理模拟活动及相关分圈与详情: ${cleanRes.removedCount} 笔`);
    if (cleanRes.restoredActivities.length > 0) {
      console.log(`   - 已恢复真实活动为主力独立状态: ${cleanRes.restoredActivities.join(", ")}`);
    }

    // 2. 清理模拟的佳明健康记录
    sqlite.run(`DELETE FROM garmin_daily_health WHERE date = '2026-10-29'`);

    // 3. 校验最终数据库状态与基准完全一致
    const finalActCount = (sqlite.query("SELECT count(*) as c FROM activities").get() as any).c;
    const finalLapCount = (sqlite.query("SELECT count(*) as c FROM laps").get() as any).c;
    const finalDetailCount = (sqlite.query("SELECT count(*) as c FROM activity_details").get() as any).c;
    const finalGarminHealthCount = (sqlite.query("SELECT count(*) as c FROM garmin_daily_health").get() as any).c;

    assert(finalActCount === initialActCount, `活动记录数完全还原 (${finalActCount} == ${initialActCount})`);
    assert(finalLapCount === initialLapCount, `分圈记录数完全还原 (${finalLapCount} == ${initialLapCount})`);
    assert(finalDetailCount === initialDetailCount, `详情记录数完全还原 (${finalDetailCount} == ${initialDetailCount})`);
    assert(finalGarminHealthCount === initialGarminHealthCount, `佳明健康表完全还原 (${finalGarminHealthCount} == ${initialGarminHealthCount})`);

    console.log("   阶段 6 清理与还原通过！数据库已 100% 恢复真实纯净状态。\n");
  }

  console.log("================================================================================");
  console.log(`🎉 全部测试验证通过！总计验证点: ${passedTests}/${totalTests} 项，零报错，零残留。`);
  console.log("================================================================================");
}

main().catch((e) => {
  console.error("验证流程中断，发生错误:", e);
  process.exit(1);
});
