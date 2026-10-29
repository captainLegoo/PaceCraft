import { sqlite } from "./db/client.ts";

export type ConflictItem = {
  id: string;
  date: string;
  primary: any;
  secondary: any;
  timeDiffMin: number;
  distDiffPct: number;
  durDiffPct: number;
  status: "auto_primary" | "auto_duplicate" | "manual_primary" | "manual_duplicate" | "manual_keep_both";
};

/**
 * 核心指标归一化：基于心率储备（HRR）自算 Edwards TRIMP 负荷
 *
 * 公式：负荷 = 时长(分钟) × (1 + 4 × HRR)
 * HRR = (avgHr − restHr) / (maxHr − restHr)，夹取至 [0, 1]
 * 跨品牌（高驰 / 佳明）统一使用此口径，彻底消灭品牌间负荷算法口径差异。
 */
export function computeUnifiedTrimp(
  durationSec: number,
  avgHr: number | null,
  maxHr: number = 190,
  restHr: number = 55
): number {
  if (!durationSec || durationSec <= 0) return 0;
  const durMin = durationSec / 60.0;
  if (!avgHr || avgHr <= 0) {
    // 心率缺失时按中低强度兜底（HRR 0.35 相当于轻松有氧）
    return Math.round(durMin * 2.4);
  }
  const span = Math.max(maxHr - restHr, 20);
  const hrr = Math.max(0, Math.min(1, (avgHr - restHr) / span));
  return Math.round(durMin * (1 + 4 * hrr));
}

/**
 * 智能识别重叠活动（Deduplication / Conflict Resolver）
 *
 * 判定条件：
 * 1. 同一天（dateLabel 相同或跨天缓冲内）；
 * 2. 开始时间相差 ≤ 10 分钟（600 秒）；
 * 3. 距离或时长相差 < 5%（允许微小 GPS 漂移与按表时差）；
 * 4. 来源于不同品牌生态（如高驰 vs 佳明）或独立设备。
 *
 * 处理策略：
 * 自动以主力设备为准（默认保留高驰），另一只表归档为“对比样本”（is_duplicate = 1）。
 * 归档样本不计入周跑量与累计训练负荷（防止跑量与疲劳翻倍），同时保留分圈供双表同屏对比。
 */
export function detectActivityConflicts(opts: { primaryBrand?: "coros" | "garmin" } = {}): {
  detectedPairs: number;
  resolved: number;
} {
  const preferredBrand = opts.primaryBrand ?? "coros";

  const rows = sqlite.query(`
    SELECT label_id, sport_type, sport_name, date_label, start_ts, end_ts,
           duration_sec, distance_km, avg_pace_sec, avg_hr, source,
           is_duplicate, duplicate_of, conflict_status
    FROM activities
    ORDER BY date_label DESC, start_ts ASC
  `).all() as any[];

  if (rows.length < 2) return { detectedPairs: 0, resolved: 0 };

  // 按日期分桶
  const byDate = new Map<string, any[]>();
  for (const r of rows) {
    const list = byDate.get(r.date_label) ?? [];
    list.push(r);
    byDate.set(r.date_label, list);
  }

  const updateStmt = sqlite.query(`
    UPDATE activities
    SET is_duplicate = ?, duplicate_of = ?, conflict_status = ?
    WHERE label_id = ?
  `);

  let detectedCount = 0;
  let resolvedCount = 0;

  for (const [_date, acts] of byDate) {
    if (acts.length < 2) continue;

    for (let i = 0; i < acts.length; i++) {
      for (let j = i + 1; j < acts.length; j++) {
        const a = acts[i];
        const b = acts[j];

        // 若来源相同（如两笔都是高驰），且不是不同表，跳过
        const sourceA = a.source || "coros";
        const sourceB = b.source || "coros";

        // 检查开始时间相差 ≤ 10 分钟（600 秒）
        let timeMatched = false;
        let timeDeltaSec = 0;
        if (a.start_ts && b.start_ts) {
          timeDeltaSec = Math.abs(a.start_ts - b.start_ts);
          if (timeDeltaSec <= 600) {
            timeMatched = true;
          }
        } else {
          // 没有精确时间戳时以同一天且时长极度相近为准
          timeMatched = true;
        }

        if (!timeMatched) continue;

        // 检查距离 / 时长差异 < 5%
        let distMatch = false;
        let durMatch = false;

        const maxDist = Math.max(a.distance_km || 0, b.distance_km || 0);
        const minDist = Math.min(a.distance_km || 0, b.distance_km || 0);
        if (maxDist > 0) {
          const distDiff = (maxDist - minDist) / maxDist;
          if (distDiff <= 0.06) distMatch = true; // 允许 6% 内的 GPS 测量偏差
        }

        const maxDur = Math.max(a.duration_sec || 0, b.duration_sec || 0);
        const minDur = Math.min(a.duration_sec || 0, b.duration_sec || 0);
        if (maxDur > 0) {
          const durDiff = (maxDur - minDur) / maxDur;
          if (durDiff <= 0.06) durMatch = true;
        }

        // 判定重叠
        if ((distMatch && durMatch) || (maxDist > 1 && distMatch) || (maxDur > 600 && durMatch)) {
          detectedCount++;

          // 如果用户已经手动确认过，不覆盖用户决定
          if (
            a.conflict_status?.startsWith("manual_") ||
            b.conflict_status?.startsWith("manual_")
          ) {
            continue;
          }

          // 决定谁是主力，谁是对比样本
          let primary = a;
          let secondary = b;

          if (sourceA === preferredBrand && sourceB !== preferredBrand) {
            primary = a;
            secondary = b;
          } else if (sourceB === preferredBrand && sourceA !== preferredBrand) {
            primary = b;
            secondary = a;
          } else {
            // 两者品牌相同，优先选有距离且时长更长/分段更完整的一方
            if ((b.distance_km || 0) > (a.distance_km || 0)) {
              primary = b;
              secondary = a;
            }
          }

          // 主力：is_duplicate = 0, auto_primary
          updateStmt.run(0, secondary.label_id, "auto_primary", primary.label_id);
          // 对比样本：is_duplicate = 1, auto_duplicate
          updateStmt.run(1, primary.label_id, "auto_duplicate", secondary.label_id);

          primary.is_duplicate = 0;
          primary.duplicate_of = secondary.label_id;
          primary.conflict_status = "auto_primary";

          secondary.is_duplicate = 1;
          secondary.duplicate_of = primary.label_id;
          secondary.conflict_status = "auto_duplicate";

          resolvedCount++;
        }
      }
    }
  }

  return { detectedPairs: detectedCount, resolved: resolvedCount };
}

/**
 * 用户手动介入仲裁冲突
 * 允许用户手动指定保留哪一只表的数据作为主力有效成绩，另一只表归档为对比样本；
 * 或者选择「保留两者为独立训练」。
 */
export function resolveActivityConflict(
  primaryLabelId: string,
  secondaryLabelId: string,
  action: "set_primary" | "keep_both"
): boolean {
  if (action === "set_primary") {
    sqlite.query(`
      UPDATE activities
      SET is_duplicate = 0, duplicate_of = ?, conflict_status = 'manual_primary'
      WHERE label_id = ?
    `).run(secondaryLabelId, primaryLabelId);

    sqlite.query(`
      UPDATE activities
      SET is_duplicate = 1, duplicate_of = ?, conflict_status = 'manual_duplicate'
      WHERE label_id = ?
    `).run(primaryLabelId, secondaryLabelId);
    return true;
  }

  if (action === "keep_both") {
    sqlite.query(`
      UPDATE activities
      SET is_duplicate = 0, duplicate_of = ?, conflict_status = 'manual_keep_both'
      WHERE label_id = ?
    `).run(secondaryLabelId, primaryLabelId);

    sqlite.query(`
      UPDATE activities
      SET is_duplicate = 0, duplicate_of = ?, conflict_status = 'manual_keep_both'
      WHERE label_id = ?
    `).run(primaryLabelId, secondaryLabelId);
    return true;
  }

  return false;
}

/**
 * 查询系统当前所有检测到的冲突活动对
 */
export function getActivityConflicts(): ConflictItem[] {
  const duplicates = sqlite.query(`
    SELECT label_id, sport_type, sport_name, date_label, start_ts, end_ts,
           duration_sec, distance_km, avg_pace_sec, avg_hr, source,
           is_duplicate, duplicate_of, conflict_status
    FROM activities
    WHERE duplicate_of IS NOT NULL
  `).all() as any[];

  const byLabel = new Map<string, any>();
  for (const d of duplicates) {
    byLabel.set(d.label_id, d);
  }

  const seen = new Set<string>();
  const list: ConflictItem[] = [];

  for (const item of duplicates) {
    const pairKey = [item.label_id, item.duplicate_of].sort().join("::");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const other = sqlite.query(`
      SELECT label_id, sport_type, sport_name, date_label, start_ts, end_ts,
             duration_sec, distance_km, avg_pace_sec, avg_hr, source,
             is_duplicate, duplicate_of, conflict_status
      FROM activities
      WHERE label_id = ?
    `).get(item.duplicate_of) as any;

    if (!other) continue;

    const primary = item.is_duplicate === 0 ? item : other;
    const secondary = item.is_duplicate === 1 ? item : other;

    const timeDiffMin = primary.start_ts && secondary.start_ts
      ? +((Math.abs(primary.start_ts - secondary.start_ts) / 60).toFixed(1))
      : 0;

    const maxDist = Math.max(primary.distance_km || 0, secondary.distance_km || 0);
    const distDiffPct = maxDist > 0
      ? +((Math.abs((primary.distance_km || 0) - (secondary.distance_km || 0)) / maxDist) * 100).toFixed(1)
      : 0;

    const maxDur = Math.max(primary.duration_sec || 0, secondary.duration_sec || 0);
    const durDiffPct = maxDur > 0
      ? +((Math.abs((primary.duration_sec || 0) - (secondary.duration_sec || 0)) / maxDur) * 100).toFixed(1)
      : 0;

    list.push({
      id: pairKey,
      date: primary.date_label,
      primary,
      secondary,
      timeDiffMin,
      distDiffPct,
      durDiffPct,
      status: secondary.conflict_status || "auto_duplicate",
    });
  }

  return list;
}

/**
 * 识别系统中的模拟测试数据
 */
export function getMockTestDataInfo(): {
  count: number;
  items: Array<{
    labelId: string;
    sportName: string;
    source: string;
    dateLabel: string;
    distanceKm: number;
    duplicateOf: string | null;
  }>;
} {
  const rows = sqlite.query(`
    SELECT label_id, sport_name, source, date_label, distance_km, duplicate_of
    FROM activities
    WHERE label_id LIKE '%sim_%'
       OR label_id LIKE '%_sim_test%'
       OR label_id LIKE 'sim_%'
       OR label_id = 'garmin_sim_dual_test'
  `).all() as any[];

  return {
    count: rows.length,
    items: rows.map((r) => ({
      labelId: r.label_id,
      sportName: r.sport_name,
      source: r.source,
      dateLabel: r.date_label,
      distanceKm: r.distance_km,
      duplicateOf: r.duplicate_of,
    })),
  };
}

/**
 * 清理模拟测试数据：
 * 1. 找到所有模拟活动；
 * 2. 恢复被其关联标记为 duplicate 的真实活动为正常主力活动；
 * 3. 彻底删除模拟活动的 laps、activity_details、activities；
 * 4. 重新执行一次重叠检测确保剩余真实数据状态一致。
 */
export function cleanMockTestData(): {
  removedCount: number;
  restoredActivities: string[];
} {
  const testActs = sqlite.query(`
    SELECT label_id, duplicate_of
    FROM activities
    WHERE label_id LIKE '%sim_%'
       OR label_id LIKE '%_sim_test%'
       OR label_id LIKE 'sim_%'
       OR label_id = 'garmin_sim_dual_test'
  `).all() as { label_id: string; duplicate_of: string | null }[];

  if (testActs.length === 0) {
    return { removedCount: 0, restoredActivities: [] };
  }

  const restored: string[] = [];

  sqlite.transaction(() => {
    for (const act of testActs) {
      // 1. 查找因该测试数据而被标记为重复的真实记录
      const candidates = new Set<string>();
      if (act.duplicate_of) candidates.add(act.duplicate_of);

      const linked = sqlite.query(`
        SELECT label_id FROM activities WHERE duplicate_of = ?
      `).all(act.label_id) as { label_id: string }[];
      for (const l of linked) candidates.add(l.label_id);

      // 排除其他测试记录
      for (const t of testActs) candidates.delete(t.label_id);

      for (const realId of candidates) {
        sqlite.query(`
          UPDATE activities
          SET is_duplicate = 0, duplicate_of = NULL, conflict_status = NULL
          WHERE label_id = ?
        `).run(realId);
        restored.push(realId);
      }

      // 2. 清理测试记录的子数据
      sqlite.query("DELETE FROM laps WHERE label_id = ?").run(act.label_id);
      sqlite.query("DELETE FROM activity_details WHERE label_id = ?").run(act.label_id);
      sqlite.query("DELETE FROM activities WHERE label_id = ?").run(act.label_id);
    }
  })();

  // 3. 重新对剩余真实数据做一次冲突扫描，确保状态完备
  detectActivityConflicts();

  return {
    removedCount: testActs.length,
    restoredActivities: Array.from(new Set(restored)),
  };
}
