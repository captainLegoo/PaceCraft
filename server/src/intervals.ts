export type SessionSet = {
  /** 例如 "1km" / "800m" */
  distanceLabel: string;
  reps: number;
  avgDurationSec: number;
  avgPaceSec: number;
  avgHr: number | null;
  /** 组间最短休息（秒），无法推断时为 null */
  restSec: number | null;
  distanceTolerance: number;
  paceTolerance: number;
};

export function round(n: number, digits: number) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function fmtDistLabel(km: number): string {
  // GPS 抖动会让 1.00km 的组测成 0.99km，直接显示就是刺眼的「990m」。
  // 所以 ≥0.95km 归整到 0.1km，不足 1km 归整到 50m。
  if (km >= 0.95) {
    const v = Math.round(km * 10) / 10;
    return `${v.toFixed(v % 1 === 0 ? 0 : 1)}km`;
  }
  return `${Math.round((km * 1000) / 50) * 50}m`;
}

/**
 * 识别「n 组等长重复跑」（跨独立 activity 记录）。
 * 间歇训练被手表拆成多条记录后，同组内距离和配速高度一致，
 * 而不同组（1km 组 vs 800m 组）差异明显，所以用滑动比较而不是聚类。
 */
export function detectSets(items: { a: any; d: any }[]): SessionSet[] {
  const sets: SessionSet[] = [];
  let i = 0;

  while (i < items.length) {
    const first = items[i];
    const d0 = first.a.distanceKm ?? 0;
    if (d0 <= 0) { i++; continue; }

    let j = i + 1;
    let distTol = 0, paceTol = 0;

    while (j < items.length) {
      const d = items[j].a.distanceKm ?? 0;
      const distDelta = Math.abs(d - d0) / d0;
      const p0 = first.a.avgPaceSec, p1 = items[j].a.avgPaceSec;
      const paceDelta = p0 && p1 ? Math.abs(p1 - p0) / p0 : 0;
      // GPS 抖动会让等长记录有几米误差，12% / 20% 是实测下来不误并也不漏并的区间
      if (distDelta > 0.12 || paceDelta > 0.2) break;
      distTol = Math.max(distTol, distDelta);
      paceTol = Math.max(paceTol, paceDelta);
      j++;
    }

    const group = items.slice(i, j);
    if (group.length >= 2) {
      const distSum = group.reduce((s, x) => s + (x.a.distanceKm ?? 0), 0);
      const durSum = group.reduce((s, x) => s + (x.a.durationSec ?? 0), 0);
      let hrS = 0, hrW = 0;
      for (const x of group) {
        if (x.a.avgHr) { hrS += x.a.avgHr * (x.a.durationSec ?? 0); hrW += x.a.durationSec ?? 0; }
      }
      // 组间休息 = 下一组开始 - 上一组结束
      const rests: number[] = [];
      for (let k = 1; k < group.length; k++) {
        const prevEnd = group[k - 1].a.endTs ??
          (group[k - 1].a.startTs != null ? group[k - 1].a.startTs + (group[k - 1].a.durationSec ?? 0) : 0);
        const g = (group[k].a.startTs ?? 0) - prevEnd;
        if (Number.isFinite(g) && g >= 0) rests.push(g);
      }
      sets.push({
        distanceLabel: fmtDistLabel(d0),
        reps: group.length,
        avgDurationSec: Math.round(durSum / group.length),
        avgPaceSec: Math.round((durSum / Math.max(distSum, 0.01))),
        avgHr: hrW > 0 ? Math.round(hrS / hrW) : null,
        restSec: rests.length ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null,
        distanceTolerance: round(distTol, 3),
        paceTolerance: round(paceTol, 3),
      });
      i = j;
    } else {
      i++;
    }
  }
  return sets;
}

/**
 * 从单次训练的逐圈数据（Laps）中识别结构化间歇跑（如 1km×6组、400m×10组等）。
 *
 * 核心生理学判据：
 * 1. 间歇跑由高强度「工作组（Work）」与低强度「恢复/休息段（Rest）」交替组成；
 * 2. 匀速稳态跑的分圈（如常规 10km 每公里计圈）配速高度平稳（CV < 0.10 且极差 < 20%），绝对不能误判为间歇；
 * 3. 工作组之间必须存在速度显著降低的慢摇圈、休息圈或停顿时间，且工作组配速必须显著快于全场或恢复段。
 */
export function detectSetsFromLaps(rawLaps: any[]): SessionSet[] {
  const clean = rawLaps
    .filter((l) => (l.distanceM ?? 0) > 0 && (l.timeSec ?? 0) > 0)
    .sort((a, b) => (a.lapIndex ?? 0) - (b.lapIndex ?? 0));

  if (clean.length < 3) return [];

  const laps = clean.map((l, idx) => {
    const km = l.distanceM / 1000;
    const paceSec = l.timeSec / km;
    return {
      idx,
      lapIndex: l.lapIndex ?? idx + 1,
      km,
      distanceM: l.distanceM,
      timeSec: l.timeSec,
      paceSec,
      avgHr: l.avgHr ?? null,
      startTs: l.startTs,
      raw: l,
    };
  });

  const totalDist = laps.reduce((s, x) => s + x.km, 0);
  const totalTime = laps.reduce((s, x) => s + x.timeSec, 0);
  if (totalDist <= 0 || totalTime <= 0) return [];
  const overallAvgPace = totalTime / totalDist;

  // 1. 配速离散度检验
  const paces = laps.map((x) => x.paceSec);
  const meanPace = paces.reduce((a, b) => a + b, 0) / paces.length;
  const variance = paces.reduce((a, b) => a + (b - meanPace) ** 2, 0) / paces.length;
  const cvPace = Math.sqrt(variance) / meanPace;

  const maxPace = Math.max(...paces);
  const minPace = Math.min(...paces);
  // 若全场分圈配速极其平稳（变异系数 CV < 0.10 且最大与最小配速极差 < 20%），说明是匀速稳态跑，坚决不误判
  if (cvPace < 0.10 && (maxPace - minPace) / meanPace < 0.20) {
    return [];
  }

  // 2. 候选工作组检测
  const sets: SessionSet[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < laps.length; i++) {
    if (usedIndices.has(i)) continue;
    const ref = laps[i];
    if (ref.km < 0.15) continue; // 太短的误触圈不作为基准

    const candidateGroup = [ref];
    const candidateIndices = [i];

    for (let j = 0; j < laps.length; j++) {
      if (i === j || usedIndices.has(j)) continue;
      const target = laps[j];

      const distDelta = Math.abs(target.km - ref.km) / ref.km;
      const distAbsDelta = Math.abs(target.km - ref.km);
      const paceDelta = Math.abs(target.paceSec - ref.paceSec) / ref.paceSec;

      // 距离容差：相对 15% 或绝对 120m（容忍操场内道/外道或 GPS 微小漂移）
      const distOk = distDelta <= 0.15 || distAbsDelta <= 0.12;
      // 配速容差：18%
      const paceOk = paceDelta <= 0.18;

      if (distOk && paceOk) {
        candidateGroup.push(target);
        candidateIndices.push(j);
      }
    }

    // 组数门槛：长间歇 (>= 1.4km) 允许 >= 2 组；短间歇 (< 1.4km) 要求 >= 3 组
    const minReps = ref.km >= 1.4 ? 2 : 3;
    if (candidateGroup.length < minReps) continue;

    const grpDistSum = candidateGroup.reduce((s, x) => s + x.km, 0);
    const grpDurSum = candidateGroup.reduce((s, x) => s + x.timeSec, 0);
    const grpAvgPace = grpDurSum / Math.max(grpDistSum, 0.01);

    // 检验是否为高强度工作组：
    // 条件 A：工作组平均配速比全场平均配速快至少 8%
    const fasterThanAvg = (overallAvgPace - grpAvgPace) / overallAvgPace >= 0.08;
    // 条件 B：工作组之外存在显著慢速圈（比工作组慢 >= 25%）或静止休息
    const nonGroupLaps = laps.filter((_, idx) => !candidateIndices.includes(idx));
    const hasSlowRest = nonGroupLaps.some(
      (x) => (x.paceSec - grpAvgPace) / grpAvgPace >= 0.25 || x.paceSec > 480
    );

    if (!fasterThanAvg && !hasSlowRest) continue;

    // 计算组间休息时间
    const sortedGroup = [...candidateGroup].sort((a, b) => a.idx - b.idx);
    const rests: number[] = [];
    for (let k = 1; k < sortedGroup.length; k++) {
      const prev = sortedGroup[k - 1];
      const curr = sortedGroup[k];
      if (curr.idx === prev.idx + 1) {
        if (curr.startTs != null && prev.startTs != null) {
          const gap = curr.startTs - (prev.startTs + prev.timeSec);
          if (gap > 5) rests.push(gap);
        }
      } else {
        let restDur = 0;
        for (let m = prev.idx + 1; m < curr.idx; m++) {
          restDur += laps[m].timeSec;
        }
        if (restDur > 0) rests.push(restDur);
      }
    }

    // 生理学核心判据：间歇跑各工作组之间必须存在休息/恢复（慢跑恢复圈或停顿时间），
    // 若各分圈之间连续无间隔，属于连续稳态跑（如 1km 自动计圈的常规慢跑），坚决不误判为间歇
    if (rests.length === 0) continue;

    let hrS = 0, hrW = 0;
    for (const x of sortedGroup) {
      if (x.avgHr) { hrS += x.avgHr * x.timeSec; hrW += x.timeSec; }
    }

    let maxDistTol = 0, maxPaceTol = 0;
    for (const x of sortedGroup) {
      maxDistTol = Math.max(maxDistTol, Math.abs(x.km - ref.km) / ref.km);
      maxPaceTol = Math.max(maxPaceTol, Math.abs(x.paceSec - ref.paceSec) / ref.paceSec);
    }

    sets.push({
      distanceLabel: fmtDistLabel(ref.km),
      reps: sortedGroup.length,
      avgDurationSec: Math.round(grpDurSum / sortedGroup.length),
      avgPaceSec: Math.round(grpAvgPace),
      avgHr: hrW > 0 ? Math.round(hrS / hrW) : null,
      restSec: rests.length ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null,
      distanceTolerance: round(maxDistTol, 3),
      paceTolerance: round(maxPaceTol, 3),
    });

    for (const idx of candidateIndices) usedIndices.add(idx);
  }

  return sets;
}

export function classify(
  acts: any[],
  sets: SessionSet[],
  distanceKm: number,
  laps: any[] = []
): { classification: string; reason: string } {
  const shortOnly = acts.every((a) => (a.distanceKm ?? 0) < 2);
  const setCount = sets.reduce((s, x) => s + x.reps, 0);

  // 无论是跨 activity 还是单场 activity 内部分圈识别出的重复组，
  // 只要识别到明确的间歇组次（如 1km×6组、800m×8组等）：
  if (sets.length > 0) {
    const isMultiActInterval = acts.length > 1 && setCount >= acts.length * 0.6;
    const isSingleActInterval = acts.length === 1;
    if (isMultiActInterval || isSingleActInterval) {
      const desc = sets.map((s) => `${s.distanceLabel}×${s.reps}组`).join(" + ");
      return {
        classification: "间歇训练",
        reason: acts.length === 1
          ? `分圈识别到单场 ${sets.length} 组重复：${desc}`
          : `识别到 ${sets.length} 组重复：${desc}`,
      };
    }
  }

  if (acts.length === 1) {
    if (distanceKm >= 15) return { classification: "长距离跑", reason: `单次 ${distanceKm.toFixed(1)}km` };
    if (distanceKm >= 8) return { classification: "中等距离跑", reason: `单次 ${distanceKm.toFixed(1)}km` };
    return { classification: "单次训练", reason: `单次 ${distanceKm.toFixed(1)}km` };
  }

  if (shortOnly) return { classification: "多次短距离", reason: `${acts.length} 条记录，单条均不足 2km` };
  return { classification: "组合训练", reason: `${acts.length} 条记录，距离与配速各不相同` };
}
