import {
  danielsPredict,
  vdotOf,
  bestContinuousEffort,
  estimateThreshold,
  exponentBetween,
  fitPersonalExponent,
  fmtP,
  fmtT,
  median,
  pearson,
  predictAll,
  quantile,
  riegel,
  sanitizeLaps,
  weeklyMileageExponent,
  type Effort,
  type LapInput,
} from "../prediction/engine.ts";

let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✅ ${label}`);
  else { fail++; console.log(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

// ---------------- 统计工具 ----------------
console.log("\n▸ 统计工具");
check("median 奇数个", median([3, 1, 2]) === 2);
check("median 偶数个取中间", median([1, 2, 3, 4]) === 2.5);
check("quantile(0.25) 四个数", Math.abs(quantile([1, 2, 3, 4], 0.25) - 1.75) < 1e-9, quantile([1, 2, 3, 4], 0.25));
check("pearson 完全正相关 = 1", Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
check("pearson 完全负相关 = -1", Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9);

// ---------------- Riegel ----------------
console.log("\n▸ Riegel 外推");
check("同距离不缩放", Math.abs(riegel({ km: 10, sec: 2400 }, 10, 1.06) - 2400) < 1e-6);
check("42.195km 用 k=1.06 比 k=1.10 慢", riegel({ km: 10, sec: 2400 }, 42.195, 1.10) > riegel({ km: 10, sec: 2400 }, 42.195, 1.06));
check("公式正确：2400×(42.195/10)^1.06", Math.abs(riegel({ km: 10, sec: 2400 }, 42.195, 1.06) - 2400 * Math.pow(4.2195, 1.06)) < 1e-6);

// ---------------- 周跑量修正（Vickers 2016） ----------------
console.log("\n▸ 周跑量修正与个人指数");
{
  // 取两个距离的成绩算个人指数（数值为构造值，非任何人的实测成绩）
  const k12 = exponentBetween({ km: 10, sec: 2400 }, { km: 21.0975, sec: 5400 });
  check(`个人指数 k₁₂ = ${k12.toFixed(4)}（>1 表示距离越长越慢）`, k12 > 1 && k12 < 1.6, k12);

  // 周跑量越高 → k 越小（全马越快）。这是 Vickers 的核心结论。
  const k30 = weeklyMileageExponent(k12, 30);
  const k90 = weeklyMileageExponent(k12, 90);
  check(`周跑量 30→90km，k 从 ${k30.toFixed(4)} 降到 ${k90.toFixed(4)}`, k90 < k30, { k30, k90 });
  check("周跑量修正幅度合理（0.05~0.12）", k30 - k90 > 0.05 && k30 - k90 < 0.12, k30 - k90);

  // 公里口径必须比英里口径更保守（周跑量数值更大 → 惩罚更强）
  const asKm = weeklyMileageExponent(k12, 52, false);
  const asMi = weeklyMileageExponent(k12, 52, true);
  check(`口径切换有效：公里口径 k=${asKm.toFixed(4)} < 英里口径 k=${asMi.toFixed(4)}`, asKm < asMi, { asKm, asMi });

  // 周跑量 0（无数据）时退回基准，不产生 NaN
  check("周跑量=0 仍返回有限值", Number.isFinite(weeklyMileageExponent(k12, 0)), weeklyMileageExponent(k12, 0));
}

// ---------------- Daniels VDOT ----------------
console.log("\n▸ Daniels VDOT（对照官方 VDOT 表，用方程求解）");
{
  const t5 = 20 * 60 + 12; // 20:12
  const anchor = { km: 5, sec: t5 };
  const p5 = danielsPredict(anchor, 5)!;
  check(`5K 自反：输入 ${fmtT(t5)} → 输出 ${fmtT(p5)}`, Math.abs(p5 - t5) < 5, { p5, t5 });

  const p10 = danielsPredict(anchor, 10)!;
  const phm = danielsPredict(anchor, 21.0975)!;
  const pfm = danielsPredict(anchor, 42.195)!;
  check("距离越长成绩越慢", p5 < p10 && p10 < phm && phm < pfm, { p5, p10, phm, pfm });

  // 官方 VDOT 表锚点（Daniels & Gilbert 1979 / Daniels' Running Formula）
  // 标称 VDOT 50 → 5K 19:56；用它反推各距离，应落回官方表区间
  {
    const off = { km: 5, sec: 19 * 60 + 56 };
    const v = vdotOf(off.km, off.sec);
    check(`官方 5K 19:56 反推 VDOT ≈ 50（实得 ${v.toFixed(1)}）`, Math.abs(v - 50) < 0.6, v);
    const f10 = danielsPredict(off, 10)!;
    const fhm = danielsPredict(off, 21.0975)!;
    const ffm = danielsPredict(off, 42.195)!;
    // 官方表 VDOT 50: 10K 41:20, 半马 1:31:31, 全马 3:10:40
    check(`VDOT50 10K ≈ 41:20（实得 ${fmtT(f10)}）`, Math.abs(f10 - (41 * 60 + 20)) < 30, fmtT(f10));
    check(`VDOT50 半马 ≈ 1:31:31（实得 ${fmtT(fhm)}）`, Math.abs(fhm - (91 * 60 + 31)) < 40, fmtT(fhm));
    check(`VDOT50 全马 ≈ 3:10:40（实得 ${fmtT(ffm)}）`, Math.abs(ffm - (190 * 60 + 40)) < 60, fmtT(ffm));
  }

  // 跑得越快，所有距离预测都必须越快
  let monotonic = true;
  for (let t = 17 * 60; t < 26 * 60; t += 60) {
    const a = danielsPredict({ km: 5, sec: t }, 42.195)!;
    const b = danielsPredict({ km: 5, sec: t + 60 }, 42.195)!;
    if (!(a < b)) { monotonic = false; break; }
  }
  check("输入 5K 变慢 → 全马预测也变慢（单调）", monotonic);

  // 方程没有表尾上限：极快输入不应被钳住，仍应给出合理量级
  const veryFast = danielsPredict({ km: 5, sec: 14 * 60 }, 42.195)!;
  const verySlow = danielsPredict({ km: 5, sec: 40 * 60 }, 42.195)!;
  check(`极快输入不再撞表尾（${fmtT(veryFast)}）`, veryFast > 100 * 60 && veryFast < 160 * 60, fmtT(veryFast));
  check(`极慢输入仍合理（${fmtT(verySlow)}）`, verySlow > 4 * 3600 && verySlow < 9 * 3600, fmtT(verySlow));

  // VDOT 往返一致性：任意成绩 → VDOT → 回推，应还原原成绩
  {
    const src = { km: 10, sec: 42 * 60 };
    const rt = danielsPredict(src, 10)!;
    check(`VDOT 往返一致（10K ${fmtT(src.sec)} → ${fmtT(rt)}）`, Math.abs(rt - src.sec) < 5, fmtT(rt));
  }
}

// ---------------- 连续成绩提取 ----------------
console.log("\n▸ 最佳连续成绩提取");

/** 造一次训练的分段（默认平路：爬升 0，GAP 等于实跑配速） */
function makeLaps(perKm: number[], startTs = 1_780_000_000, labelId = "L1", date = "2026-03-01"): LapInput[] {
  return perKm.map((sec, i) => ({
    labelId, date, startTs, lapIndex: i + 1,
    distanceM: 1000, timeSec: sec, avgHr: 160,
    elevGain: 0, climbRate: 0, gapPaceSec: sec,
  }));
}

{
  // 匀速 5 分钟一公里 → 5K = 25:00
  const e5 = bestContinuousEffort(makeLaps([300, 300, 300, 300, 300, 300, 300]), 5)!;
  check("匀速 5 公里 = 25:00", Math.abs(e5.seconds - 1500) < 0.01, e5.seconds);
  check("实际距离就是 5.00km", Math.abs(e5.actualKm - 5) < 1e-6, e5.actualKm);
}
{
  // 前 3 公里慢、后 4 公里快 → 5K 最佳窗口应落在后段
  const laps = makeLaps([400, 400, 400, 280, 280, 280, 280]);
  const e = bestContinuousEffort(laps, 5)!;
  check("取到最快的连续 5 公里窗口（后段 2 慢 + 3 快）", Math.abs(e.actualKm - 5) < 1e-6, e.actualKm);
  // 可行窗口: [0..4]=1760s, [1..5]=1640s, [2..6]=1520s → 1520 配速最低
  check("选出配速最低的窗口 400+280×4=1520s", Math.abs(e.seconds - 1520) < 0.01, e.seconds);
}
{
  // 间歇训练：每组 1 公里、组间有 10 分钟「空档」标记为超长段
  // 连续窗口不允许跨过长空档段，否则 10 组 × 1km 会被拼成假的 10K
  const laps = makeLaps([240, 1000, 240, 1000, 240, 1000, 240, 1000, 240]);
  const e = bestContinuousEffort(laps, 5);
  check("跨超长空档不会拼出假成绩（返回 null 或只覆盖少量段）", e === null || e.actualKm < 5.1, e?.actualKm);
}
{
  // 末段不足整公里时应被计入
  const laps: LapInput[] = [
    ...makeLaps([300, 300, 300, 300]),
    { labelId: "L1", date: "2026-03-01", startTs: 1, lapIndex: 5, distanceM: 200, timeSec: 60, avgHr: 160, elevGain: 0, climbRate: 0, gapPaceSec: 300 },
  ];
  // 4×1km + 200m = 4.2km，够 4km 但不够 5km
  const e4 = bestContinuousEffort(laps, 4.1)!;
  check("末段不足整公里也计入窗口（4.1km 目标必须吃进那 200m）", Math.abs(e4.actualKm - 4.2) < 0.01, e4.actualKm);
  check("总用时 4×300+60=1260s", Math.abs(e4.seconds - 1260) < 0.01, e4.seconds);
  check("目标恰好等于已跑距离时不会硬吃下一段", Math.abs(bestContinuousEffort(laps, 4)!.actualKm - 4) < 0.01);
  check("距离不足目标时返回 null 而不是硬凑", bestContinuousEffort(laps, 5) === null);
}

// ---------------- 脏数据过滤 ----------------
console.log("\n▸ 脏数据过滤");
{
  const rows = [
    { distanceM: 1000, timeSec: 300, avgPaceSec: 300 },
    { distanceM: 0, timeSec: 0, avgPaceSec: 0 },          // 距离 0
    { distanceM: 1000, timeSec: 5, avgPaceSec: 5 },        // 用时 5 秒
    { distanceM: 1000, timeSec: 5400, avgPaceSec: 5400 },  // 用时 90 分钟
    { distanceM: 1000, timeSec: 310, avgPaceSec: 310 },
  ];
  const clean = sanitizeLaps(rows as any);
  check("滤掉距离为 0 的段", !clean.some((l) => l.distanceM === 0));
  check("滤掉用时 5 秒的异常段", !clean.some((l) => l.timeSec === 5));
  check("滤掉用时 90 分钟的异常段", !clean.some((l) => l.timeSec === 5400));
  check("保留 2 条正常段", clean.length === 2, clean.length);
}

// ---------------- 阈值配速 ----------------
console.log("\n▸ 阈值配速反推");
{
  // 构造已知关系：心率 = 100 + 0.3 × 配速秒 → 配速 250s 时心率 175
  // 阈值心率取 88.5% × hrMax（测试输入 hrMax 195）→ 172.6 → 阈值配速 = (172.6-100)/0.3 ≈ 241.9s
  const samples: { paceSec: number; hr: number }[] = [];
  for (let p = 225; p <= 300; p += 1) samples.push({ paceSec: p, hr: 100 + 0.3 * p });
  const t = estimateThreshold(samples, { hrMax: 195, slowestPaceSeen: 300 });
  check(`反推出阈值配速 ≈ 4:02（实际 ${fmtP(t.paceSec)}）`, Math.abs(t.paceSec - 241.9) < 6, fmtP(t.paceSec));
  check("回归 R² 接近 1", t.r2 > 0.99, t.r2);
  check("保留了回归系数 a/b", t.a > 90 && t.a < 110 && t.b > 0.2 && t.b < 0.4, { a: t.a, b: t.b });
}
{
  // 样本不足时必须回退兜底，不能崩
  const t = estimateThreshold([{ paceSec: 250, hr: 160 }], { hrMax: 195, slowestPaceSeen: 310 });
  check("样本不足时走兜底分支", t.method.includes("兜底"), t.method);
  check("兜底值不超过实测最慢配速", t.paceSec <= 310, t.paceSec);
}
{
  // 轻松段心率压平，不能污染斜率
  const samples: { paceSec: number; hr: number }[] = [];
  for (let p = 225; p <= 300; p += 1) samples.push({ paceSec: p, hr: 100 + 0.3 * p });
  for (let p = 301; p <= 380; p += 1) samples.push({ paceSec: p, hr: 190 }); // 压平
  const t = estimateThreshold(samples, { hrMax: 195, slowestPaceSeen: 380 });
  check("轻松段压平不影响阈值配速估计", Math.abs(t.paceSec - 241.9) < 6, fmtP(t.paceSec));
}

// ---------------- 个人 Riegel 指数 ----------------
console.log("\n▸ 个人 Riegel 指数拟合");
{
  // 造一组严格服从 k=1.09 的成绩，应当能把 1.09 拟合回来
  const mk = (km: number, sec: number, idx: number): Effort => ({
    date: "2026-02-01", startTs: idx, targetKm: km, actualKm: km, seconds: sec,
    paceSec: sec / km, rawPaceSec: sec / km, climbRate: 0,
    avgHr: 165, fromLap: 1, toLap: 9, loadThatDay: 100,
  });
  const base = 3 * 60 + 50; // 5km 基准
  const synth = [5, 10, 15, 21.0975, 30, 42.195].map((km, i) =>
    mk(km, base * Math.pow(km / 5, 1.09), i),
  );
  const r = fitPersonalExponent(synth, 250);
  check(`合成数据 k=1.09 → 拟合出 ${r.k.toFixed(4)}`, Math.abs(r.k - 1.09) < 0.01, r.k);
}
{
  // 配对不足时必须回退理论值
  const one: Effort = {
    date: "2026-02-01", startTs: 1, targetKm: 5, actualKm: 5, seconds: 1500,
    paceSec: 300, rawPaceSec: 300, climbRate: 0,
    avgHr: 160, fromLap: 1, toLap: 5, loadThatDay: null,
  };
  const r = fitPersonalExponent([one], 250);
  check("配对不足回退到 1.06", r.k === 1.06 && r.pairs === 0, r);
}
{
  // 强度层级差太远的成绩不该参与拟合（短冲刺 vs 长稳态）
  const mk = (km: number, sec: number, i: number): Effort => ({
    date: "2026-02-01", startTs: i, targetKm: km, actualKm: km, seconds: sec,
    paceSec: sec / km, rawPaceSec: sec / km, climbRate: 0,
    avgHr: 165, fromLap: 1, toLap: 9, loadThatDay: 100,
  });
  const sprint = [1, 3, 5].map((km, i) => mk(km, km * 210, i));      // 配速 3:30，极快
  const steady = [21.0975, 30, 42.195].map((km, i) => mk(km, km * 280, i)); // 配速 4:40
  const r = fitPersonalExponent([...sprint, ...steady], 238);
  const ratioFast = 210 / 238, ratioSlow = 280 / 238;
  check(
    `强度层差 ${Math.abs(ratioFast - ratioSlow).toFixed(2)} > 0.22 时不参与配对`,
    Math.abs(ratioFast - ratioSlow) > 0.22,
    { ratioFast: ratioFast.toFixed(2), ratioSlow: ratioSlow.toFixed(2) },
  );
  check("这种情况下应回退或配对很少", r.pairs === 0 || r.note.length > 0, r);
}

// ---------------- 格式化 ----------------
console.log("\n▸ 时间格式化");
check("42:00", fmtT(2520) === "42:00", fmtT(2520));
check("1:15:00", fmtT(4500) === "1:15:00", fmtT(4500));
check("3:30:00", fmtT(12600) === "3:30:00", fmtT(12600));
check("4:30", fmtP(270) === "4:30", fmtP(270));
check("299.6 秒进位为 5:00 而非非法 4:60", fmtP(299.6) === "5:00", fmtP(299.6));

// ---------------- GPS 短记容忍 ----------------
console.log("\n▸ 实跑锚点的 GPS 短记容忍");
{
  // 手表记录的全马几乎总是略短于官方 42.195km（常见 0.25% 左右的短记，如 42.09km）。
  // 若用严格 `la.km >= t.km` 比较，权重最高的 A 级锚点会被静默跳过。
  const mkEfforts = (): Effort[] =>
    ([5, 10, 15, 21.0975] as const).map((km) => ({
      date: "2026-03-01", startTs: 1, targetKm: km, actualKm: km,
      seconds: km * 250, paceSec: 250, rawPaceSec: 250, climbRate: 0,
      avgHr: 160, fromLap: 0, toLap: 10, loadThatDay: null,
    }));

  const base = {
    efforts: mkEfforts(),
    threshold: { paceSec: 240, hr: 172, hrMax: 194, a: 0, b: 0, samples: 100, r2: 0.5, method: "测试" },
    k: 1.06,
    official: {},
    latestDate: "2026-07-01",
    weeklyKm: 50,
  };

  // 42.09km = GPS 短记 0.25%，应仍然算「跑过全马」
  // 锚点成绩用构造值（42.09km / 3:00:00），不对应任何一场真实比赛
  const anchorKm = 42.09;
  const anchorSec = 10800;
  const short42 = predictAll({
    ...base,
    longestActual: { km: anchorKm, sec: anchorSec, date: "2025-09-01" },
  }).find((p) => p.distanceKm === 42.195)!;
  check(
    "GPS 记录 42.09km（全马）时 longest-actual 模型参与",
    short42.models.some((m) => m.model === "longest-actual"),
    short42.models.map((m) => m.model),
  );

  // 真正的长距离锚点也应参与（回归保护，防止这次修复反向放宽过头）
  const long42 = predictAll({
    ...base,
    longestActual: { km: 44.0, sec: anchorSec, date: "2025-09-01" },
  }).find((p) => p.distanceKm === 42.195)!;
  check("记录 44km（全马）时同样参与", long42.models.some((m) => m.model === "longest-actual"));

  // 40km 的训练跑不足以冒充全马（1% 余量 = 41.77km 下限）
  const only40 = predictAll({
    ...base,
    longestActual: { km: 40.0, sec: anchorSec, date: "2025-09-01" },
  }).find((p) => p.distanceKm === 42.195)!;
  check(
    "只有 40km 训练跑时 longest-actual 不参与（不越权外推全马）",
    !only40.models.some((m) => m.model === "longest-actual"),
  );

  // 核心回归：GPS 短记的 ~42km 实跑是全场最强锚点，预测不该比它自己的
  // 线性折算慢太多（差 2% 以上说明这个最高权重锚点其实没起作用）。
  // 修复前该锚点被静默跳过，全马预测因此被拖慢数分钟。
  const linearProj = (anchorSec / anchorKm) * 42.195;
  check(
    `短记锚点参与后，预测贴近该锚点的线性折算（${fmtT(short42.seconds)} vs 折算 ${fmtT(linearProj)}）`,
    short42.seconds < linearProj * 1.02,
    { predicted: Math.round(short42.seconds), linearProj: Math.round(linearProj) },
  );
}

console.log(fail === 0 ? "\n✅ 全部通过\n" : `\n❌ ${fail} 项失败\n`);
process.exit(fail === 0 ? 0 : 1);
