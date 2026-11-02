import { classify, detectSets, detectSetsFromLaps, fmtDistLabel } from "../intervals.ts";

let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✅ ${label}`);
  else { fail++; console.log(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

console.log("\n▸ 1. 单次记录内的 1km × 6 结构化间歇跑（带热身、慢跑休息、冷身，总距离 10.4km）");
{
  const singleActIntervalLaps = [
    { lapIndex: 1, distanceM: 2000, timeSec: 660, avgHr: 142 }, // 热身 2km 5:30/km
    { lapIndex: 2, distanceM: 1000, timeSec: 220, avgHr: 168 }, // 1km 3:40
    { lapIndex: 3, distanceM: 400,  timeSec: 160, avgHr: 145 }, // 休息 400m 6:40
    { lapIndex: 4, distanceM: 1000, timeSec: 218, avgHr: 171 }, // 1km 3:38
    { lapIndex: 5, distanceM: 400,  timeSec: 165, avgHr: 148 }, // 休息 400m
    { lapIndex: 6, distanceM: 1000, timeSec: 222, avgHr: 173 }, // 1km 3:42
    { lapIndex: 7, distanceM: 400,  timeSec: 170, avgHr: 150 }, // 休息 400m
    { lapIndex: 8, distanceM: 1000, timeSec: 219, avgHr: 175 }, // 1km 3:39
    { lapIndex: 9, distanceM: 400,  timeSec: 168, avgHr: 152 }, // 休息 400m
    { lapIndex: 10, distanceM: 1000, timeSec: 216, avgHr: 177 }, // 1km 3:36
    { lapIndex: 11, distanceM: 400,  timeSec: 165, avgHr: 150 }, // 休息 400m
    { lapIndex: 12, distanceM: 1000, timeSec: 214, avgHr: 179 }, // 1km 3:34
    { lapIndex: 13, distanceM: 400,  timeSec: 150, avgHr: 140 }, // 冷身 400m
  ];
  const setsF = detectSetsFromLaps(singleActIntervalLaps);
  check("从分圈准确识别出 1 组间歇", setsF.length === 1, setsF);
  check("识别出 1km × 6 组", setsF[0]?.distanceLabel === "1km" && setsF[0]?.reps === 6, setsF[0]);
  check("工作组平均配速 ≈ 3:38 (218s)", Math.abs((setsF[0]?.avgPaceSec ?? 0) - 218) < 3, setsF[0]?.avgPaceSec);
  check("组间休息提取准确 ≈ 165s", Math.abs((setsF[0]?.restSec ?? 0) - 165) < 5, setsF[0]?.restSec);

  // 单次记录（acts.length === 1），总距离 10.4km
  const actsF = [{ distanceKm: 10.4, durationSec: 2727, labelId: "L_ACT_INT" }];
  const clsF = classify(actsF, setsF, 10.4, singleActIntervalLaps);
  check("单次记录间歇跑不再被粗暴识别为中等距离跑，而是正确分类为「间歇训练」", clsF.classification === "间歇训练", clsF);
  check("理由列出单场识别出的组次", /单场 1 组重复：1km×6组/.test(clsF.reason), clsF.reason);
}

console.log("\n▸ 2. 操场 400m × 8 间歇跑（短间歇，组间慢跑 200m）");
{
  const trackLaps = [
    { lapIndex: 1, distanceM: 1600, timeSec: 520, avgHr: 138 }, // 热身 1.6km
  ];
  for (let i = 0; i < 8; i++) {
    trackLaps.push({ lapIndex: trackLaps.length + 1, distanceM: 400, timeSec: 84 + (i%2)*2, avgHr: 165 + i });
    trackLaps.push({ lapIndex: trackLaps.length + 1, distanceM: 200, timeSec: 90, avgHr: 135 });
  }
  trackLaps.push({ lapIndex: trackLaps.length + 1, distanceM: 1200, timeSec: 420, avgHr: 135 }); // 冷身

  const setsTrack = detectSetsFromLaps(trackLaps);
  check("识别出 400m 间歇组", setsTrack.length === 1 && setsTrack[0]?.distanceLabel === "400m", setsTrack);
  check("组数为 8 组", setsTrack[0]?.reps === 8, setsTrack[0]?.reps);
  check("配速约为 3:33 (213s/km)", Math.abs((setsTrack[0]?.avgPaceSec ?? 0) - 213) < 3, setsTrack[0]?.avgPaceSec);

  const actsTrack = [{ distanceKm: 6.0, durationSec: 1600, labelId: "L_TRACK" }];
  const clsTrack = classify(actsTrack, setsTrack, 6.0, trackLaps);
  check("分类为间歇训练", clsTrack.classification === "间歇训练", clsTrack);
}

console.log("\n▸ 3. 巡航间歇 2km × 3 组（长间歇）");
{
  const cruiseLaps = [
    { lapIndex: 1, distanceM: 2000, timeSec: 660, avgHr: 140 }, // 热身 5:30
    { lapIndex: 2, distanceM: 2000, timeSec: 480, avgHr: 168 }, // 2km 4:00
    { lapIndex: 3, distanceM: 1000, timeSec: 330, avgHr: 146 }, // 1km 慢 5:30
    { lapIndex: 4, distanceM: 2000, timeSec: 478, avgHr: 171 }, // 2km 3:59
    { lapIndex: 5, distanceM: 1000, timeSec: 335, avgHr: 148 }, // 1km 慢
    { lapIndex: 6, distanceM: 2000, timeSec: 475, avgHr: 174 }, // 2km 3:57
    { lapIndex: 7, distanceM: 1500, timeSec: 510, avgHr: 142 }, // 冷身
  ];
  const setsCruise = detectSetsFromLaps(cruiseLaps);
  check("识别出 2km 间歇组", setsCruise.length === 1 && setsCruise[0]?.distanceLabel === "2km", setsCruise);
  check("组数为 3 组", setsCruise[0]?.reps === 3, setsCruise[0]?.reps);
}

console.log("\n▸ 4. 单次 10km 匀速跑（每公里计圈，绝不误判为间歇跑）");
{
  const steadyLaps = [
    { lapIndex: 1, distanceM: 1000, timeSec: 305, avgHr: 145 },
    { lapIndex: 2, distanceM: 1000, timeSec: 302, avgHr: 148 },
    { lapIndex: 3, distanceM: 1000, timeSec: 300, avgHr: 150 },
    { lapIndex: 4, distanceM: 1000, timeSec: 298, avgHr: 152 },
    { lapIndex: 5, distanceM: 1000, timeSec: 299, avgHr: 153 },
    { lapIndex: 6, distanceM: 1000, timeSec: 301, avgHr: 154 },
    { lapIndex: 7, distanceM: 1000, timeSec: 297, avgHr: 155 },
    { lapIndex: 8, distanceM: 1000, timeSec: 295, avgHr: 156 },
    { lapIndex: 9, distanceM: 1000, timeSec: 293, avgHr: 157 },
    { lapIndex: 10, distanceM: 1000, timeSec: 288, avgHr: 160 },
  ];
  const setsG = detectSetsFromLaps(steadyLaps);
  check("匀速稳态跑不识别出间歇工作组", setsG.length === 0, setsG);

  const actsG = [{ distanceKm: 10.0, durationSec: 2978, labelId: "L_ACT_STEADY" }];
  const clsG = classify(actsG, setsG, 10.0, steadyLaps);
  check("匀速 10km 跑正确归类为「中等距离跑」", clsG.classification === "中等距离跑", clsG);
}

console.log(fail === 0 ? "\n✅ 全部通过\n" : `\n❌ ${fail} 项失败\n`);
process.exit(fail === 0 ? 0 : 1);
