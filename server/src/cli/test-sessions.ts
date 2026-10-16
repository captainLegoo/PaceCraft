import { classify, detectSets } from "../analytics.ts";

let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✅ ${label}`);
  else { fail++; console.log(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

/** 造一条模拟记录 */
function act(distanceKm: number, durationSec: number, startTs: number, hr: number, paceJitter = 0) {
  const avgPaceSec = distanceKm > 0 ? durationSec / distanceKm * (1 + paceJitter) : 0;
  return {
    a: {
      labelId: `L${startTs}`, distanceKm, durationSec, startTs,
      endTs: startTs + durationSec, avgHr: hr, avgPaceSec,
    },
    d: { trainingLoad: Math.round(durationSec / 30), elevGain: 5, avgCadence: 182 },
  };
}

/** 典型间歇场景：1km×10 + 800m×10 + 400m×2，前面一段热身 */
function buildIntervalSession() {
  const items: { a: any; d: any }[] = [];
  let t = 1780000000;

  // 热身 2km
  items.push(act(2.0, 600, t, 140)); t += 600 + 60;

  // 1km × 10 组，目标 3:52/km，组间休息 60s
  for (let i = 0; i < 10; i++) {
    const d = 1.0 + (i % 2 ? 0.01 : -0.01);           // GPS 抖动 ±10m
    const dur = d * 232 * (1 + (i % 3) * 0.004);      // 配速轻微漂移
    items.push(act(d, Math.round(dur), t, 160 + (i > 6 ? 6 : 0))); // 后段心率漂 +6
    t += Math.round(dur) + 60;
  }

  // 800m × 10 组，2:40/km，组间休息 45s
  for (let i = 0; i < 10; i++) {
    const d = 0.8 + (i % 2 ? 0.008 : -0.008);
    const dur = d * 160 * (1 + (i % 4) * 0.005);
    items.push(act(d, Math.round(dur), t, 165 + (i > 6 ? 7 : 0)));
    t += Math.round(dur) + 45;
  }

  // 400m × 2 组，1:35/km，组间休息 90s
  for (let i = 0; i < 2; i++) {
    const dur = 0.4 * 95;
    items.push(act(0.4, Math.round(dur), t, 172));
    t += Math.round(dur) + 90;
  }
  return items;
}

console.log("\n▸ 场景 A：1k×10 + 800m×10 + 400m×2 + 热身");
const A = buildIntervalSession();
const setsA = detectSets(A);
check(`识别出 3 组（实际 ${setsA.length}）`, setsA.length === 3, setsA.map((s) => `${s.distanceLabel}×${s.reps}`));
check("第 1 组 = 1km × 10", setsA[0]?.distanceLabel === "1km" && setsA[0]?.reps === 10, setsA[0]);
check("第 2 组 = 800m × 10", setsA[1]?.distanceLabel === "800m" && setsA[1]?.reps === 10, setsA[1]);
check("第 3 组 = 400m × 2", setsA[2]?.distanceLabel === "400m" && setsA[2]?.reps === 2, setsA[2]);
check("热身 2km 未被误判为组", !setsA.some((s) => s.reps > 1 && s.distanceLabel.startsWith("2")));
check("1km 组平均配速 ≈ 3:52", Math.abs((setsA[0]?.avgPaceSec ?? 0) - 232) < 3, setsA[0]?.avgPaceSec);
check("800m 组平均配速 ≈ 2:40", Math.abs((setsA[1]?.avgPaceSec ?? 0) - 160) < 3, setsA[1]?.avgPaceSec);
check("400m 组平均配速 ≈ 1:35", Math.abs((setsA[2]?.avgPaceSec ?? 0) - 95) < 4, setsA[2]?.avgPaceSec);
check("1km 组组间休息 ≈ 60s", Math.abs((setsA[0]?.restSec ?? 0) - 60) <= 2, setsA[0]?.restSec);
check("800m 组组间休息 ≈ 45s", Math.abs((setsA[1]?.restSec ?? 0) - 45) <= 2, setsA[1]?.restSec);
check("1km 组后段心率漂移被捕捉（均值 160~166）", (setsA[0]?.avgHr ?? 0) >= 160 && (setsA[0]?.avgHr ?? 0) <= 167, setsA[0]?.avgHr);
const clsA = classify(A.map((x) => x.a), setsA, A.reduce((s, x) => s + x.a.distanceKm, 0));
check(`分类为间歇训练（实际「${clsA.classification}」）`, clsA.classification === "间歇训练", clsA);
check("分类依据列出全部三组", /1km×10组/.test(clsA.reason) && /800m×10组/.test(clsA.reason) && /400m×2组/.test(clsA.reason), clsA.reason);

console.log("\n▸ 场景 B：单次 20K 长距离（不应识别出组）");
const B = [act(20, 6600, 1780100000, 150)];
const setsB = detectSets(B);
check("无组", setsB.length === 0, setsB);
const clsB = classify(B.map((x) => x.a), setsB, 20);
check(`分类为长距离跑（实际「${clsB.classification}」）`, clsB.classification === "长距离跑", clsB);

console.log("\n▸ 场景 C：8.12km + 4.00km 两段（不同距离，不应算一组）");
const C = [act(8.12, 2235, 1780200000, 154), act(4.0, 1116, 1780202275, 160)];
const setsC = detectSets(C);
check("无组", setsC.length === 0, setsC);
const clsC = classify(C.map((x) => x.a), setsC, 12.12);
check(`分类为组合训练（实际「${clsC.classification}」）`, clsC.classification === "组合训练", clsC);

console.log("\n▸ 场景 D：带 GPS 噪声的 1km×5");
const D: { a: any; d: any }[] = [];
let td = 1780300000;
for (let i = 0; i < 5; i++) {
  const noise = [0.985, 1.012, 0.994, 1.021, 0.978][i];   // ±2% GPS 噪声
  const dur = 235 * noise;
  D.push(act(1.0 * noise, Math.round(dur), td, 162));
  td += Math.round(dur) + 70;
}
const setsD = detectSets(D);
check(`识别为 1km × 5（实际 ${setsD[0]?.distanceLabel}×${setsD[0]?.reps}）`, setsD.length === 1 && setsD[0].reps === 5, setsD);
check("平均配速仍准确 ≈ 3:55", Math.abs((setsD[0]?.avgPaceSec ?? 0) - 235) < 5, setsD[0]?.avgPaceSec);

console.log("\n▸ 场景 E：累计时间轴偏移（startTs 单位是秒，不能再除 1000）");
{
  const { buildSessions, sessionLaps } = await import("../analytics.ts");
  const s = buildSessions().find((x: any) => x.activityCount > 1);
  if (!s) { console.log("  ⏭  库里没有多记录场次，跳过"); }
  else {
    const l = sessionLaps(s.labelIds);
    const offsets = [...new Set(l.map((x: any) => x.offsetSec))].sort((a, b) => a - b);
    check(`产生 ${offsets.length} 段不同偏移 ${JSON.stringify(offsets)}`, offsets.length === s.activityCount, offsets);
    check("第一条记录偏移为 0", offsets[0] === 0, offsets[0]);
    const lastOffset = offsets[offsets.length - 1];
    check(`后续记录偏移 > 60 秒（实际 ${lastOffset}s）`, lastOffset > 60, lastOffset);
    check("elapsedSec 严格递增", l.every((x: any, i: number) => i === 0 || x.elapsedSec > l[i - 1].elapsedSec));
    check("曲线末端 ≥ 场次总时长（含休息）", l[l.length - 1].elapsedSec >= s.totals.durationSec, { end: l[l.length - 1].elapsedSec, dur: s.totals.durationSec });
  }
}

console.log(fail === 0 ? "\n✅ 全部通过\n" : `\n❌ ${fail} 项失败\n`);
process.exit(fail === 0 ? 0 : 1);
