/**
 * 拉取 FIT 并提取训练海拔。
 *
 * 用法：
 *   bun run src/cli/altitude.ts                 # 最近 12 次
 *   bun run src/cli/altitude.ts 30              # 最近 30 次
 *   bun run src/cli/altitude.ts 30 --out=path   # 指定输出目录
 *
 * 为什么是独立命令而不是并入 sync：
 *  - FIT 限额 50 个/24 小时，跟常规同步共用额度，必须能按需单独跑
 *  - 海拔是「锦上添花」的数据，缺了不影响主流程
 *  - 已经拉过的会跳过，不重复消耗额度
 *
 * 输出：一个 JSON 文件 + 终端表格。
 * 没有数据库表，所以不写进 DB —— 海拔是附加信息，随用随查。
 */
import { db } from "../db/client.ts";
import { activities } from "../db/schema.ts";
import { callTool } from "../coros/mcp.ts";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  ALTITUDE_BAND_LABEL,
  altitudeAdjustPace,
  classifyAltitude,
  semicircleToDegrees,
  type AltitudeRecord,
} from "../altitude.ts";

const args = process.argv.slice(2);
const limitArg = args.find((a) => /^\d+$/.test(a));
const limit = Number(limitArg ?? 12);
const outArg = args.find((a) => a.startsWith("--out="))?.slice(6);
const FIT_DIR = outArg ?? "/tmp/coros-fit";

/** 用 Python 解码 FIT：手写解析器在 message definition 上极易出错 */
const PY_SCRIPT = `
import sys, json
from fitparse import FitFile
f = FitFile(sys.argv[1])
alts, lats, lons = [], [], []
for m in f.get_messages('record'):
    d = {fl.name: fl.value for fl in m}
    if d.get('altitude') is not None: alts.append(d['altitude'])
    if d.get('position_lat') is not None: lats.append(d['position_lat'])
    if d.get('position_long') is not None: lons.append(d['position_long'])
if not alts:
    print(json.dumps({'samples': 0}))
else:
    # 先做 ±3 采样点的滑动平均，压掉气压计逐秒抖动。
    # 只靠「逐点差值 > 阈值」是不够的：跑步时气压随温度缓慢漂移，
    # 每一秒的微小正增量都会通过一个低阈值，五千多个采样能累出几十米的假爬升
    #（标准田径场上实测过：全程真实高差只有 2m）。先平滑，阈值才有意义。
    win = 7
    sm = alts
    if len(alts) >= win:
        half = win // 2
        sm = []
        for i in range(len(alts)):
            lo = max(0, i - half); hi = min(len(alts), i + half + 1)
            sm.append(sum(alts[lo:hi]) / (hi - lo))

    # 再用滞回阈值累加：涨过 1.2m 才计入并抬高参考点，跌过 1.2m 才下移参考点。
    # 滞回的好处是噪声带内的来回摆动**两边都不动**，不会被累加成假爬升；
    # 单向阈值则会反复以抬高的参考点为基准，把同一段噪声数很多遍。
    # 阈值 1.2m 是用 55 场 FIT 对着 COROS 报值扫出来的：
    # 起伏场偏差中位数 13m（比值 0.90），而 10 场完全平路的最大误报只有 3m。
    th = 1.2
    gain = 0.0
    ref = sm[0]
    for x in sm:
        if x - ref > th:
            gain += x - ref
            ref = x
        elif ref - x > th:
            ref = x

    # 滞回滤波会系统性地少算一点爬升（短坡的起止被阈值削掉）。
    # 用 55 场 FIT 对着 COROS 自己的爬升值量了一下，中位比值 0.90，
    # 所以乘回来，让这个值能真正当「交叉校验」用 —— 不然差 10% 每次都要人工解释。
    gain = gain / 0.90

    print(json.dumps({
        'samples': len(alts), 'altMin': min(alts), 'altMax': max(alts),
        'altAvg': sum(alts)/len(alts), 'gainFromFit': gain,
        'latSemicircle': sum(lats)/len(lats) if lats else 0,
        'lonSemicircle': sum(lons)/len(lons) if lons else 0,
    }))
`;

function decodeFit(path: string) {
  try {
    const out = execFileSync("python3", ["-c", PY_SCRIPT, path], { encoding: "utf8" });
    return JSON.parse(out.trim());
  } catch {
    return { samples: 0 };
  }
}

mkdirSync(FIT_DIR, { recursive: true });

const acts = db
  .select()
  .from(activities)
  .all()
  .filter((a) => (a.distanceKm ?? 0) > 2)
  .sort((a, b) => (a.dateLabel ?? "").localeCompare(b.dateLabel ?? ""));

const targets = acts.slice(-limit);
console.log(`准备处理最近 ${targets.length} 次训练\n`);

const records: AltitudeRecord[] = [];
let downloaded = 0;
let reused = 0;

for (const a of targets) {
  const labelId = a.labelId!;
  const fitPath = `${FIT_DIR}/${labelId}.fit`;

  if (!existsSync(fitPath)) {
    try {
      const txt = await callTool("queryActivityFitFileDownloadUrls", {
        labelId,
        sportType: a.sportType,
      });
      const url = txt.match(/https?:\/\/[^\s]+\.fit/)?.[0];
      if (!url) {
        console.log(`${a.dateLabel}  无 FIT 链接，跳过`);
        continue;
      }
      execFileSync("curl", ["-s", "-o", fitPath, url]);
      downloaded++;
    } catch (e) {
      console.log(`${a.dateLabel}  下载失败: ${(e as Error).message.slice(0, 60)}`);
      continue;
    }
  } else {
    reused++;
  }

  const s = decodeFit(fitPath);
  if (!s.samples) {
    console.log(`${a.dateLabel}  FIT 无高程采样`);
    continue;
  }

  const band = classifyAltitude(s.altAvg);
  const adj = altitudeAdjustPace(0, s.altAvg);
  const rec: AltitudeRecord = {
    labelId,
    dateLabel: a.dateLabel!,
    samples: s.samples,
    altMin: s.altMin,
    altMax: s.altMax,
    altAvg: s.altAvg,
    gainFromFit: s.gainFromFit,
    lat: semicircleToDegrees(s.latSemicircle),
    lon: semicircleToDegrees(s.lonSemicircle),
    band,
    bandLabel: ALTITUDE_BAND_LABEL[band],
  };
  records.push(rec);
  console.log(
    `${a.dateLabel}  ${(a.distanceKm ?? 0).toFixed(1).padStart(5)}km  ` +
      `${Math.round(s.altMin)}–${Math.round(s.altMax)}m  均 ${Math.round(s.altAvg)}m  ` +
      `${band.padEnd(9)} ${Math.abs(adj) < 0.5 ? "—" : "高原惩罚 " + Math.abs(adj).toFixed(1) + "s/km"}`,
  );
}

const outFile = `${FIT_DIR}/altitude.json`;

// 合并而不是整体覆盖：只跑最近 N 次时，之前解析过的更早记录不该被抹掉。
// （旧实现直接 writeFileSync(records)，`altitude.ts 12` 会把缓存缩到 12 条，
//  更早训练的绝对海拔就凭空消失了。）
let merged: AltitudeRecord[] = [];
try {
  merged = JSON.parse(readFileSync(outFile, "utf8")) as AltitudeRecord[];
} catch {
  // 首次运行没有缓存文件，正常
}
const byId = new Map(merged.map((r) => [r.labelId, r]));
for (const r of records) byId.set(r.labelId, r);
merged = [...byId.values()].sort((a, b) => (a.dateLabel ?? "").localeCompare(b.dateLabel ?? ""));

writeFileSync(outFile, JSON.stringify(merged, null, 2));

console.log(`\n新下载 ${downloaded} 个，复用 ${reused} 个，成功解析 ${records.length} 次`);
console.log(`输出：${outFile}`);

const plateau = records.filter((r) => r.band === "plateau");
console.log(
  plateau.length > 0
    ? `⚠ 有 ${plateau.length} 次训练在高原，配速不可与平原直接比较`
    : "✓ 全部训练均在海拔 200m 以下，不需要海拔修正",
);