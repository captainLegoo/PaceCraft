/**
 * 解析层自测 —— 校验 server/src/coros/parse.ts 对 COROS MCP 返回文本的解析。
 *
 * 数据源是**本地探针快照** ~/.coros-dashboard/probe/*.txt（由 CLI 探针工具落盘）。
 * 快照里是使用者自己的真实数据，所以这个文件里**不写任何具体数值**，只断言两类性质：
 *
 *   1. 结构不变量 —— 单位换算（厘米→米）、字段区间（如心率 30–230）、
 *      字段间一致性（如「结束时间戳 − 开始时间戳 = 记录时长」、
 *      「配速 × 距离 ≈ 时长」、「4 项成绩预测随距离单调递增」）。
 *   2. 与原始文本对照 —— 解析出的条数/数值必须和文本里实际写的一致。
 *
 * 这样换一台机器、换一份探针快照都能跑，不会因为「某一天的数据变了」而误报
 * （老版本把某个人的成绩写死成期望值，快照一更新就整片飘红）。
 * 缺探针文件时按「跳过」处理，而不是抛异常。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import {
  parseActivityDetail,
  parseDailyHealth,
  parseFitness,
  parseLapData,
  parseRecovery,
  parseSleep,
  parseSportRecords,
  parseTrainingLoad,
  unescape,
} from "../coros/parse.ts";

const PROBE = join(DATA_DIR, "probe");

let failures = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300));
  }
}

/** 读探针快照；文件不存在时记一次跳过并返回 null */
function probe(name: string): string | null {
  const path = join(PROBE, `${name}.txt`);
  if (!existsSync(path)) {
    skipped++;
    console.log(`  ⚠️  跳过（缺快照）：${path}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

/** 数值为空时视为「该项未提供」，不算越界 */
const inRange = (v: number | null | undefined, lo: number, hi: number) =>
  v == null || (v >= lo && v <= hi);

// ---------------- querySportRecords ----------------
console.log("\n▸ querySportRecords");
const rawRecs = probe("querySportRecords");
const recs = rawRecs ? parseSportRecords(rawRecs) : null;
if (recs) {
  const text = unescape(rawRecs!);
  check(`解析出 ${recs.length} 条记录`, recs.length > 0);

  // 与原始文本对照：每条记录恰好一个 LabelId，块数必须对得上
  const rawLabels = (text.match(/LabelId:/g) ?? []).length;
  check(`条数与原始文本的 LabelId 数一致（${rawLabels}）`, recs.length === rawLabels, {
    parsed: recs.length,
    text: rawLabels,
  });

  check(
    "labelId 均为非空数字串",
    recs.every((r) => /^\d+$/.test(r.labelId)),
    recs.find((r) => !/^\d+$/.test(r.labelId)),
  );
  check(
    "date 为 8 位 yyyyMMdd 且与 dateLabel 一致",
    recs.every((r) => /^\d{8}$/.test(r.date) && r.date === r.dateLabel.replace(/-/g, "")),
    recs.find((r) => r.date !== r.dateLabel.replace(/-/g, "")),
  );
  check(
    "sportType 为非负整数",
    recs.every((r) => Number.isInteger(r.sportType) && r.sportType >= 0),
    recs.find((r) => !Number.isInteger(r.sportType) || r.sportType < 0),
  );
  check(
    "平均心率落在 30–230 区间",
    recs.every((r) => inRange(r.avgHr, 30, 230)),
    recs.find((r) => !inRange(r.avgHr, 30, 230)),
  );
  check(
    "每条结束时间戳 > 开始时间戳",
    recs.every((r) => (r.endTimestamp ?? 0) > (r.startTimestamp ?? 0)),
    recs.filter((r) => (r.endTimestamp ?? 0) <= (r.startTimestamp ?? 0)).length,
  );
  // 回归项：endTimestamp 曾落在「没有冒号」的片段里，按 " | " 切分时会整块丢掉
  const textEnds = (text.match(/endTimestamp=\d+/g) ?? []).length;
  check(
    `原始文本里的 endTimestamp 一个都没丢（${textEnds}）`,
    recs.filter((r) => r.endTimestamp != null).length >= textEnds &&
      recs.every((r) => r.endTimestamp != null),
    {
      text: textEnds,
      parsedNonNull: recs.filter((r) => r.endTimestamp != null).length,
      missing: recs.filter((r) => r.endTimestamp == null).length,
    },
  );
  // 墙钟窗口 ≥ 记录时长：多出来的部分是中途暂停，不可能为负（留 2s 取整余量）
  check(
    "结束 − 开始 ≥ 记录时长（差值代表暂停）",
    recs.every((r) => (r.endTimestamp ?? 0) - (r.startTimestamp ?? 0) >= (r.durationSec ?? 0) - 2),
    recs.find((r) => (r.endTimestamp ?? 0) - (r.startTimestamp ?? 0) < (r.durationSec ?? 0) - 2),
  );

  // 三个字段由 COROS 各自独立给出，正常情况下应自洽：配速 × 距离 ≈ 时长
  const withDist = recs.filter(
    (r) => (r.distanceKm ?? 0) > 1 && r.avgPaceSec != null && r.durationSec != null,
  );
  const paceSelfConsistent = (r: (typeof withDist)[number]) =>
    Math.abs(r.avgPaceSec! * r.distanceKm! - r.durationSec!) < r.distanceKm! + 2;
  check(
    `配速 × 距离 ≈ 时长（${withDist.length} 条带距离记录）`,
    withDist.length > 0 && withDist.every(paceSelfConsistent),
    withDist.find((r) => !paceSelfConsistent(r)),
  );

  check(
    "经纬度成对出现",
    recs.every((r) => (r.lat == null) === (r.lon == null)),
    recs.find((r) => (r.lat == null) !== (r.lon == null)),
  );
}

// ---------------- getActivityDetail ----------------
console.log("\n▸ getActivityDetail");
const rawDetail = probe("getActivityDetail");
if (rawDetail) {
  // labelId 只做回传校验，取记录里的第一条即可，不写死某一次活动
  const labelId = recs?.[0]?.labelId ?? "probe-label";
  const detail = parseActivityDetail(rawDetail, labelId);
  check("解析成功", detail !== null);
  if (detail) {
    const t = unescape(rawDetail);
    const grab = (re: RegExp) => {
      const m = t.match(re);
      return m ? Number(m[1]) : null;
    };
    check("labelId 原样回传", detail.labelId === labelId, detail.labelId);
    check(
      "训练负荷与文本一致",
      detail.trainingLoad === grab(/Training Load:\s*([\d.]+)/),
      { parsed: detail.trainingLoad, text: grab(/Training Load:\s*([\d.]+)/) },
    );
    check(
      "有氧 TE 与文本一致",
      detail.aerobicTe === grab(/Aerobic TE:\s*([\d.]+)/),
      { parsed: detail.aerobicTe, text: grab(/Aerobic TE:\s*([\d.]+)/) },
    );
    check(
      "平均心率与文本一致",
      detail.avgHr === grab(/Average Heart Rate:\s*(\d+)/),
      { parsed: detail.avgHr, text: grab(/Average Heart Rate:\s*(\d+)/) },
    );
    check(
      "TE 值落在 0–5.5（COROS 量表上限）",
      inRange(detail.aerobicTe, 0, 5.5) && inRange(detail.anaerobicTe, 0, 5.5),
      { a: detail.aerobicTe, an: detail.anaerobicTe },
    );
    check(
      "训练负荷为非负数",
      detail.trainingLoad == null || detail.trainingLoad >= 0,
      detail.trainingLoad,
    );
    check("平均心率落在 30–230 区间", inRange(detail.avgHr, 30, 230), detail.avgHr);
  }
}

// ---------------- queryActivityLapData (JSON) ----------------
console.log("\n▸ queryActivityLapData (JSON)");
const rawLap = probe("queryActivityLapData");
if (rawLap) {
  const lap = parseLapData(rawLap);
  check("解析成功", lap !== null);
  if (lap) {
    let payload: any = null;
    try {
      payload = JSON.parse(rawLap);
    } catch {
      /* 解析失败时下面的对照会整体跳过 */
    }

    const groups: any[] = Array.isArray(payload?.lapGroups)
      ? payload.lapGroups.filter((g: any) => Array.isArray(g.laps))
      : [];
    // 解析器应挑「圈数最多」的那一组 = 最细可用粒度
    const chosen = groups.length
      ? [...groups].sort((a, b) => b.laps.length - a.laps.length)[0]
      : null;
    const source: any[] = chosen ? chosen.laps : Array.isArray(payload?.laps) ? payload.laps : [];

    check(`分圈数 > 0（${lap.laps.length}）`, lap.laps.length > 0);
    if (chosen) {
      const maxLaps = Math.max(...groups.map((g) => g.laps.length));
      check(
        "取到的是圈数最多的一组（最细粒度）",
        lap.laps.length === maxLaps,
        { chosen: lap.laps.length, max: maxLaps },
      );
      check(
        "标称圈距 = 原始 lapDistance / 100（厘米→米）",
        Math.abs((lap.lapDistanceM ?? 0) - Number(chosen.lapDistance ?? 0) / 100) < 1e-9,
        { parsed: lap.lapDistanceM, raw: chosen.lapDistance },
      );
    }
    check(
      "列定义已保留且非空",
      lap.columns.length > 0,
      lap.columns.length,
    );
    check("labelId 与原始 JSON 一致", lap.labelId === String(payload?.labelId ?? ""), lap.labelId);
    check(
      "sportType 与原始 JSON 一致",
      lap.sportType === Number(payload?.sportType ?? -1),
      lap.sportType,
    );
    check(
      "单圈距离 = 原始 distance / 100（厘米→米）",
      source.length === lap.laps.length &&
        lap.laps.every((l, i) => Math.abs(l.distanceM - Number(source[i].distance ?? 0) / 100) < 1e-9),
      lap.laps[0],
    );
    check(
      "步幅 = 原始 avgStrideLength / 100（厘米→米）",
      source.length === lap.laps.length &&
        lap.laps.every(
          (l, i) => Math.abs(l.avgStrideM - Number(source[i].avgStrideLength ?? 0) / 100) < 1e-9,
        ),
      lap.laps[0],
    );
    check(
      "累计时间单调不减",
      lap.laps.every((l, i) => i === 0 || l.totalLengthSec >= lap.laps[i - 1]!.totalLengthSec),
      lap.laps.find((l, i) => i > 0 && l.totalLengthSec < lap.laps[i - 1]!.totalLengthSec),
    );
    check(
      "分段心率落在 0 或 30–230 区间",
      lap.laps.every((l) => l.avgHr === 0 || inRange(l.avgHr, 30, 230)),
      lap.laps.find((l) => l.avgHr !== 0 && !inRange(l.avgHr, 30, 230)),
    );
    check(
      "分段平均心率 ≤ 峰值心率",
      lap.laps.every((l) => l.avgHr === 0 || l.maxHr === 0 || l.avgHr <= l.maxHr),
      lap.laps.find((l) => l.avgHr !== 0 && l.maxHr !== 0 && l.avgHr > l.maxHr),
    );
  }
}

// ---------------- queryTrainingLoadAssessment ----------------
console.log("\n▸ queryTrainingLoadAssessment");
const rawLoad = probe("queryTrainingLoadAssessment");
if (rawLoad) {
  const load = parseTrainingLoad(rawLoad);
  const rawDays = (unescape(rawLoad).match(/^\d{4}-\d{2}-\d{2}$/gm) ?? []).length;
  check(`解析出 ${load.length} 天`, load.length > 0);
  check(`天数与原始文本一致（${rawDays}）`, load.length === rawDays, {
    parsed: load.length,
    text: rawDays,
  });
  check(
    "日期均为 yyyy-mm-dd",
    load.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date)),
    load.find((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p.date)),
  );
  check(
    "短期/长期负荷为非负数",
    load.every((p) => (p.shortLoad ?? 0) >= 0 && (p.longLoad ?? 0) >= 0),
    load.find((p) => (p.shortLoad ?? 0) < 0 || (p.longLoad ?? 0) < 0),
  );
  const withRatio = load.filter(
    (p) => p.ratio != null && p.shortLoad != null && p.longLoad != null && p.longLoad !== 0,
  );
  check(
    `负荷比 ≈ 短期 / 长期（${withRatio.length} 天）`,
    withRatio.length > 0 &&
      withRatio.every((p) => Math.abs(p.ratio! - p.shortLoad! / p.longLoad!) < 0.02),
    withRatio.find((p) => Math.abs(p.ratio! - p.shortLoad! / p.longLoad!) >= 0.02),
  );
  check(
    "日期按时间倒序",
    load.every((p, i) => i === 0 || p.date < load[i - 1]!.date),
    load.find((p, i) => i > 0 && p.date >= load[i - 1]!.date),
  );
}

// ---------------- queryFitnessAssessmentOverview ----------------
console.log("\n▸ queryFitnessAssessmentOverview");
const rawFit = probe("queryFitnessAssessmentOverview");
if (rawFit) {
  const fit = parseFitness(rawFit);
  const preds = [fit.pred5kSec, fit.pred10kSec, fit.predHalfSec, fit.predMarathonSec];

  check("VO2max 为正数", (fit.vo2max ?? 0) > 0, fit.vo2max);
  check("四项成绩预测齐全且为正", preds.every((p) => p != null && p > 0), preds);
  // 距离越远用时越长，解析错位会立刻破坏这个单调性
  check(
    "预测时长随距离单调递增（5k < 10k < 半马 < 全马）",
    preds.every((p, i) => i === 0 || (p ?? 0) > (preds[i - 1] ?? 0)),
    preds,
  );

  const tp = unescape(rawFit).match(/Threshold Pace:\s*(\d+):(\d+)/);
  check(
    "阈值配速与文本一致（分:秒 → 秒）",
    tp ? fit.thresholdPaceSec === Number(tp[1]) * 60 + Number(tp[2]) : true,
    { parsed: fit.thresholdPaceSec, text: tp?.[0] },
  );
  check(
    "阈值配速快于半马预测均配（阈值配速 × 21.0975 < 半马预测）",
    fit.thresholdPaceSec != null &&
      fit.predHalfSec != null &&
      fit.thresholdPaceSec * 21.0975 < fit.predHalfSec,
    { threshold: fit.thresholdPaceSec, half: fit.predHalfSec },
  );
}

// ---------------- queryRecoveryStatus ----------------
console.log("\n▸ queryRecoveryStatus");
const rawRec = probe("queryRecoveryStatus");
if (rawRec) {
  const rec = parseRecovery(rawRec);
  check("恢复度落在 0–100", inRange(rec.recoveryPct, 0, 100), rec.recoveryPct);
  check(
    "有恢复等级文本",
    typeof rec.level === "string" && rec.level.length > 0,
    rec.level,
  );
  check(
    "恢复度与文本一致",
    rec.recoveryPct === Number(unescape(rawRec).match(/Recovery:\s*(\d+)/)?.[1]),
    rec.recoveryPct,
  );
}

// ---------------- queryDailyHealthData ----------------
console.log("\n▸ queryDailyHealthData");
const rawHealth = probe("queryDailyHealthData");
if (rawHealth) {
  const health = parseDailyHealth(rawHealth);
  const rawDays = (unescape(rawHealth).match(/^---\s*\d{8}\s*---$/gm) ?? []).length;
  check(`解析出 ${health.length} 天`, health.length > 0);
  check(`天数与原始文本的日期块一致（${rawDays}）`, health.length === rawDays, {
    parsed: health.length,
    text: rawDays,
  });
  check(
    "日期均为 8 位数字",
    health.every((h) => /^\d{8}$/.test(h.date)),
    health.find((h) => !/^\d{8}$/.test(h.date)),
  );
  check(
    "静息心率已带入每一行",
    health.every((h) => inRange(h.restingHr, 30, 120)),
    health[0],
  );
  check(
    "HRV 基线已带入每一行",
    health.every((h) => inRange(h.hrvBaseline, 5, 200)),
    health[0],
  );
  check("步数为非负数", health.every((h) => (h.steps ?? 0) >= 0), health[0]);
  check(
    "头部两个全局值在各行保持一致",
    health.every(
      (h) => h.restingHr === health[0]!.restingHr && h.hrvBaseline === health[0]!.hrvBaseline,
    ),
    health,
  );
}

// ---------------- querySleepOverview ----------------
console.log("\n▸ querySleepOverview");
const rawSleep = probe("querySleepOverview");
if (rawSleep) {
  const sleep = parseSleep(rawSleep);
  const rawDays = (unescape(rawSleep).match(/^\d{4}-\d{2}-\d{2}$/gm) ?? []).length;
  check(`解析出 ${sleep.length} 天`, sleep.length > 0);
  check(`天数与原始文本一致（${rawDays}）`, sleep.length === rawDays, {
    parsed: sleep.length,
    text: rawDays,
  });
  check(
    "available 与文本里的 not available 标记相反",
    sleep.every((s) => s.available === !/not available/i.test(s.raw)),
    sleep.find((s) => s.available === /not available/i.test(s.raw)),
  );
  check(
    "标记为不可用的日期不带睡眠评分",
    sleep.every((s) => s.available || !s.sleepScore),
    sleep.filter((s) => !s.available).map((s) => s.sleepScore),
  );
}

console.log(
  failures === 0
    ? `\n✅ 全部通过${skipped ? `（${skipped} 项因缺探针快照被跳过）` : ""}\n`
    : `\n❌ ${failures} 项失败${skipped ? `（另有 ${skipped} 项跳过）` : ""}\n`,
);
process.exit(failures === 0 ? 0 : 1);
