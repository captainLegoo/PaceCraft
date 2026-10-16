/** 训练性质判定引擎的单元测试 */
import { classifySession, thresholdHrLine, QUALITY_MIN_SEC, type SessionLap } from "../training-focus.ts";
import type { Threshold } from "../prediction/engine.ts";

let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
  if (!ok) fail++;
};

// 构造一组回归参数（数值只为测试用，不对应任何人的实测值）：
// 判定线 = a + b × 阈值配速 − 容差 = 300 + (−0.44)×300 − 2 = 166 bpm
const THR: Threshold = {
  paceSec: 300, hr: 168, hrMax: 185,
  a: 300, b: -0.44, samples: 1800, r2: 0.5, method: "测试",
};
const LINE = thresholdHrLine(THR); // = 166

/** 造 N 个 1km 圈 */
function laps(spec: { hr: number; sec: number; km?: number }[]): SessionLap[] {
  return spec.map((s) => ({
    distanceM: (s.km ?? 1) * 1000, timeSec: s.sec, avgHr: s.hr, maxHr: s.hr + 3,
  }));
}
const min = (n: number, hr: number, sec = 60) => Array.from({ length: n }, () => ({ hr, sec }));

console.log("\n▸ 判定线来自回归，不是写死值");
check(`判定线 ${LINE.toFixed(1)} bpm（由回归系数与阈值配速算出）`, Math.abs(LINE - 166) < 1.5, LINE);
check("回归系数为 0 时无判定线", thresholdHrLine({ ...THR, a: 0, b: 0 }) === 0);

console.log("\n▸ 强度课：有氧为主 + 足量阈值区时间");
{
  // 60 分钟有氧 + 12 分钟 168bpm（超阈值线 166）→ 强度课
  const r = classifySession(laps([...min(20, 145, 180), ...min(12, 168, 60)]), THR);
  check(`阈值区 12 分钟 > ${QUALITY_MIN_SEC / 60} 分钟 → 判为强度课`, r.isQuality, r.evidence);
  check("阈值区时长计算正确", r.thresholdSec === 12 * 60, r.thresholdSec);
}
{
  // 同样 12 分钟，但心率 160（低于判定线）→ 不算
  const r = classifySession(laps([...min(20, 145, 180), ...min(12, 160, 60)]), THR);
  check("心率没到判定线的 12 分钟 → 不算强度课", !r.isQuality, `峰值圈均 ${r.peakLapHr}`);
}
{
  // 刚好卡线：9 分钟 168 → 不算；11 分钟 → 算
  const r9 = classifySession(laps([...min(20, 145, 180), ...min(9, 168, 60)]), THR);
  const r11 = classifySession(laps([...min(20, 145, 180), ...min(11, 168, 60)]), THR);
  check("9 分钟 → 不算", !r9.isQuality);
  check("11 分钟 → 算", r11.isQuality);
}

console.log("\n▸ 渐进长跑：末段心率抬升但强度不足");
{
  // 心率从 125 渐进到 169，只有末尾两圈越过判定线，阈值区不足 10 分钟
  const prog: number[] = [125, 136, 143, 147, 148, 149, 153, 152, 154, 156, 158, 159, 159, 161, 162, 162, 164, 164, 165, 167, 169];
  const r = classifySession(laps(prog.map((hr) => ({ hr, sec: 266 }))), THR);
  check(`阈值区 ${Math.round(r.thresholdSec / 60)} 分钟 < 10 → 不算专门强度课`, !r.isQuality, r.evidence);
  check(`峰值圈均 ${r.peakLapHr} bpm 记录正确`, r.peakLapHr === 169, r.peakLapHr);
}

console.log("\n▸ 间歇课：分圈距离记 0 也不能被漏掉");
{
  // COROS 对间歇课只记时间+心率，distanceM 全为 0
  const interval: SessionLap[] = [
    ...Array.from({ length: 6 }, () => ({ distanceM: 0, timeSec: 130, avgHr: 140, maxHr: 155 })),
    ...Array.from({ length: 6 }, () => ({ distanceM: 0, timeSec: 130, avgHr: 175, maxHr: 181 })),
  ];
  const r = classifySession(interval, THR);
  check("零距离分圈仍能判定为强度课", r.isQuality, r.evidence);
  check(`阈值区 ${Math.round(r.thresholdSec / 60)} 分钟（6×130s）`, Math.round(r.thresholdSec / 60) === 13, r.thresholdSec);
}

console.log("\n▸ 样本不足时不硬判");
{
  const short = classifySession(laps(min(3, 170, 60)), THR);
  check("总时长 <20 分钟 → usable=false", !short.usable, short.evidence);
  const few = classifySession(laps(min(2, 170, 600)), THR);
  check("有效分圈 <3 → usable=false", !few.usable, few.evidence);
  const noHr = classifySession(laps(min(30, 0, 120)), THR);
  check("无心率数据 → usable=false", !noHr.usable, noHr.evidence);
}

console.log("\n▸ 轻松跑不会被误判");
{
  // 90 分钟全程 145–162 bpm 的长距离：末段偏高但从未到阈值
  const easy: number[] = Array.from({ length: 45 }, (_, i) => 140 + Math.floor(i / 9));
  const r = classifySession(laps(easy.map((hr) => ({ hr, sec: 120 }))), THR);
  check("90 分钟有氧长跑 → 不是强度课", !r.isQuality, `阈值区 ${Math.round(r.thresholdSec / 60)} 分钟`);
}

console.log("\n▸ 回归变化时判定线自动跟随");
{
  const faster: Threshold = { ...THR, paceSec: 220 };
  const l1 = thresholdHrLine(THR);
  const l2 = thresholdHrLine(faster);
  check(`阈值配速变快 → 判定线随之提高（${l1.toFixed(1)} → ${l2.toFixed(1)} bpm）`, l2 > l1);
  // 同样心率，在更快的阈值配速下不再算「在阈值区」
  const rSlow = classifySession(laps(min(30, 170, 60)), THR);
  const rFast = classifySession(laps(min(30, 170, 60)), faster);
  check("同一心率在更快阈值下判定更严", rSlow.isQuality && !rFast.isQuality);
}

console.log(fail === 0 ? "\n✅ 全部通过\n" : `\n❌ ${fail} 项失败\n`);
process.exit(fail === 0 ? 0 : 1);
