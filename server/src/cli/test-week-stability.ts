/**
 * 回归测试：训练状态的周度统计**不能随「一天内的时刻」变化**。
 *
 * 背景（真实事故）：
 *   周分桶原来写成 `weeksAgo = (now - 活动日) ÷ 7 天取整` 再折回某个周一。
 *   `now` 带着当前时刻、活动日是 0 点，相减除 7 天取整得到的是「距今几个 7 天」
 *   而不是「属于哪个自然周」—— 于是最近 7 天内的训练不管属于哪一周，
 *   全被算进「本周」；而且 `now - 活动日` 一跨过 7 天整，所有训练会集体「跳」到
 *   另一个周。
 *
 *   实测：10-13 那次 12.08km 昨晚被算进本周（今早才归位），
 *   近 4 周周均 66.2→64.2、趋势 +21.1%→+7.4%、训练调整 −3.0%→−1.0%，
 *   成绩预测凭空慢了 3 分 42 秒 —— 而那期间他一条新训练都没同步进来。
 *
 * 跑法：bun run src/cli/test-week-stability.ts
 */
import { currentTrainingState, collectRaceAnchors, predictMarathon, evaluateLongRunPrep } from "../race-briefing.ts";
import { db } from "../db/client.ts";
import { activities } from "../db/schema.ts";
import { isoWeek } from "../analytics.ts";

let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✅ ${label}`);
  else { fail++; console.log(`  ❌ ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

const RealDate = Date;

/** 把全局 Date 钉在某个瞬间（构造器无参时返回该时刻，Date.now() 也返回它） */
function pin(iso: string) {
  const fixed = new RealDate(iso).getTime();
  // @ts-expect-error 测试打桩
  globalThis.Date = class extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as any));
    }
    static now() { return fixed; }
  } as any;
}
const unpin = () => { globalThis.Date = RealDate as any; };

const day = new RealDate();
const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 所有有距离的训练（与 currentTrainingState 的取数口径一致） */
const rows = db.select({ d: activities.dateLabel, km: activities.distanceKm })
  .from(activities).all().filter((a) => (a.km ?? 0) > 0);

/** 自然周序号（独立于服务端实现再写一遍，避免用同一份代码自证） */
const idxOf = (weekStart: string) =>
  Math.floor((Math.round(new RealDate(`${weekStart}T00:00:00Z`).getTime() / 86400000) - 4) / 7);

// ---------------- 1. 同一日历日、不同时刻 → 结果必须完全一致 ----------------
console.log("\n▸ 同一日历日的不同时刻，结果必须一致");

const times = [
  `${today}T00:05:00`,
  `${today}T06:00:00`,
  `${today}T12:00:00`,
  `${today}T18:30:00`,
  `${today}T23:59:59`,
];

const snapshots: string[] = [];
for (const t of times) {
  pin(t);
  snapshots.push(JSON.stringify(currentTrainingState()));
}
unpin();

check(`${times.length} 个时刻算出同一个训练状态`, new Set(snapshots).size === 1, snapshots);
if (new Set(snapshots).size > 1) {
  times.forEach((t, i) => console.log(`     ${t} → ${snapshots[i]}`));
}

// ---------------- 2. 窗口右端锚定在「最近一次训练」：没新数据就不许变 ----------------
console.log("\n▸ 窗口锚定在最近一次训练：没有新数据 → 指标冻结；跨天也不许自己漂");

/** 本周周一 00:00（本地） */
function thisMonday(d: Date): Date {
  const x = new RealDate(d.getTime());
  const daysBack = (x.getDay() + 6) % 7; // 周一=0
  x.setDate(x.getDate() - daysBack);
  x.setHours(0, 0, 0, 0);
  return x;
}
const monday = thisMonday(day);

/** 钉在「今天之后第 n 天」，看窗口会不会自己往下漂 */
const futurePin = (n: number, hour = 1) => {
  const d = new RealDate(monday.getTime() + n * 86400000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const daily: { label: string; weeklyKm4: number; trendPct: number | null }[] = [];
for (let i = 0; i < 10; i++) {
  pin(futurePin(i));
  const st = currentTrainingState();
  daily.push({
    label: st.asOf,
    weeklyKm4: st.weeklyKm4,
    trendPct: st.trendPct,
  });
}
unpin();

check(
  "窗口锚点 = 最近一次训练的日期（不是今天）",
  daily[0].label === daily[daily.length - 1].label,
  { first: daily[0].label, last: daily[daily.length - 1].label },
);
check(
  "往后 10 天不新增数据 → weeklyKm4 纹丝不动",
  new Set(daily.map((d) => d.weeklyKm4)).size === 1,
  daily,
);
check(
  "往后 10 天不新增数据 → 趋势纹丝不动",
  new Set(daily.map((d) => d.trendPct)).size === 1,
  daily,
);

// 反证：如果窗口是「滚动到今天」，往后 10 天一定会漂
{
  const km28 = (right: string) => {
    const cut = new RealDate(`${right}T00:00:00`);
    cut.setDate(cut.getDate() - 28);
    const cutLabel = `${cut.getFullYear()}-${pad2(cut.getMonth() + 1)}-${pad2(cut.getDate())}`;
    return rows.filter((r) => r.d! > cutLabel && r.d! <= right).reduce((s, r) => s + (r.km ?? 0), 0);
  };
  const anchor = daily[0].label;
  const anchored = Math.round((km28(anchor) / 4) * 10) / 10;
  const rolled = Math.round((km28(today) / 4) * 10) / 10;
  check(
    `锚定值 ${anchored}km ≠ 滚动到今天的值 ${rolled}km（证明实现用的是锚定）`,
    anchored !== rolled && Math.abs(currentTrainingState().weeklyKm4 - anchored) < 0.05,
    { anchored, rolled, got: currentTrainingState().weeklyKm4, today, anchor },
  );
}

// ---------------- 3. 窗口口径 = 滚动 28 天（右端锚定在最近一次训练） ----------------
console.log("\n▸ 窗口口径：滚动 28 天");
const anchor = currentTrainingState().asOf;

/** 以 anchor 为右端的滚动窗口跑量 */
const kmSince = (days: number) => {
  const cut = new RealDate(`${anchor}T00:00:00`);
  cut.setDate(cut.getDate() - days);
  const cutLabel = `${cut.getFullYear()}-${pad2(cut.getMonth() + 1)}-${pad2(cut.getDate())}`;
  return rows
    .filter((r) => r.d! > cutLabel && r.d! <= anchor)
    .reduce((s, r) => s + (r.km ?? 0), 0);
};
const expectWeeklyKm4 = kmSince(28) / 4;
const expectWeeklyKm8 = kmSince(56) / 8;
const expectTrend =
  (kmSince(28) - kmSince(14)) > 0
    ? (((kmSince(14) / 2) - ((kmSince(28) - kmSince(14)) / 2)) / ((kmSince(28) - kmSince(14)) / 2)) * 100
    : null;

const st = currentTrainingState();
check(
  `weeklyKm4 = 滚动 28 天跑量 ÷ 4（${kmSince(28).toFixed(1)} ÷ 4）`,
  Math.abs(st.weeklyKm4 - expectWeeklyKm4) < 0.05,
  { got: st.weeklyKm4, expect: Number(expectWeeklyKm4.toFixed(1)) },
);
check(
  `weeklyKm8 = 滚动 56 天跑量 ÷ 8（${kmSince(56).toFixed(1)} ÷ 8）`,
  Math.abs(st.weeklyKm8 - expectWeeklyKm8) < 0.05,
  { got: st.weeklyKm8, expect: Number(expectWeeklyKm8.toFixed(1)) },
);
check(
  "趋势 = 近 14 天 vs 前 14 天",
  st.trendPct != null && expectTrend != null && Math.abs(st.trendPct - expectTrend) < 0.1,
  { got: st.trendPct, expect: expectTrend?.toFixed(1) },
);
check(
  "窗口包含最近一次训练（刚跑完的那场要算数）",
  rows.some((r) => r.d === anchor) ? kmSince(28) > 0 : true,
  { anchor, km28: kmSince(28) },
);

// ---------------- 4. 各字段取值合法 ----------------
console.log("\n▸ 字段取值合法");
check("weeklyKm4 是有限非负数", Number.isFinite(st.weeklyKm4) && st.weeklyKm4 >= 0, st.weeklyKm4);
check("weeklyKm8 是有限非负数", Number.isFinite(st.weeklyKm8) && st.weeklyKm8 >= 0, st.weeklyKm8);
check("trendPct 是有限数或 null", st.trendPct == null || Number.isFinite(st.trendPct), st.trendPct);
check("easyPct 在 0~100", st.easyPct == null || (st.easyPct >= 0 && st.easyPct <= 100), st.easyPct);

// ---------------- 4b. 截止日期口径统一 ----------------
console.log("\n▸ 截止日期口径");
const daysBetween = (a: string, b: string) =>
  Math.round(
    (new RealDate(`${b}T00:00:00`).getTime() - new RealDate(`${a}T00:00:00`).getTime()) / 86400000,
  );
check(
  "负荷比的截止日期不晚于窗口锚点（两个数字同一时点）",
  st.loadAsOf == null || st.loadAsOf <= st.asOf,
  { loadAsOf: st.loadAsOf, asOf: st.asOf },
);
check("距上次训练天数 ≥ 0", st.daysSinceAnchor >= 0, st.daysSinceAnchor);
check(
  "距上次训练天数与日期差一致",
  st.daysSinceAnchor === daysBetween(st.asOf, today),
  { got: st.daysSinceAnchor, expect: daysBetween(st.asOf, today), asOf: st.asOf, today },
);
check(
  "距上次训练天数不随时刻变化",
  (() => {
    const s = times.map((t) => {
      pin(t);
      const v = currentTrainingState().daysSinceAnchor;
      unpin();
      return v;
    });
    return new Set(s).size === 1;
  })(),
);

// ---------------- 5. 成绩预测同样不随时刻变化 ----------------
console.log("\n▸ 成绩预测同样不随时刻变化");
const anchors = collectRaceAnchors();
const preds: number[] = [];
for (const t of times) {
  pin(t);
  preds.push(predictMarathon(anchors, currentTrainingState(), 4.2, 16)?.bestSec ?? -1);
}
unpin();
check("各时刻的预测值相同", new Set(preds).size === 1, preds);

// 没有新数据时，往后过了几天，预测值也不能自己变
const futurePreds: number[] = [];
for (let i = 0; i < 5; i++) {
  pin(futurePin(i));
  futurePreds.push(predictMarathon(anchors, currentTrainingState(), 4.2, 16)?.bestSec ?? -1);
}
unpin();
check("往后 5 天不新增数据 → 预测值也不变", new Set(futurePreds).size === 1, futurePreds);

// ---------------- 6. 长距离准备度：窗口内「有没有」≥28km，而不是「最近那一场是不是」 ----------------
console.log("\n▸ 长距离准备度判据");
const CUTOFF = "2026-10-01"; // 假装窗口从这天开始
{
  // 3 天前 33km，今天 26km —— 旧逻辑只看今天这场，会误判「准备不足」
  const r = evaluateLongRunPrep(
    [{ date: "2026-10-17", km: 33 }, { date: "2026-10-20", km: 26 }],
    CUTOFF,
  );
  check("窗口内有 33km 时，即使今天跑 26km 也算准备充足", r.ready?.km === 33 && r.adjustPct === 0, r);
  check("effect 说的是窗口内那次长的，不是今天这场短的", r.effect.includes("33km"), r.effect);
}
{
  // 窗口内只有 26km → 准备不足，+2%
  const r = evaluateLongRunPrep([{ date: "2026-10-20", km: 26 }], CUTOFF);
  check("窗口内只有 26km → 保守 +2%", r.ready === null && r.max?.km === 26 && r.adjustPct === 2, r);
}
{
  // 33km 在窗口外（太久以前）→ 不算数
  const r = evaluateLongRunPrep([{ date: "2026-06-01", km: 33 }], CUTOFF);
  check("窗口外的 33km 不算数 → +3%", r.ready === null && r.adjustPct === 3, r);
}
{
  // 窗口内完全没有长距离 → +3%
  const r = evaluateLongRunPrep([{ date: "2026-10-20", km: 12 }], CUTOFF);
  check("窗口内没有 ≥25km → +3%", r.ready === null && r.max === null && r.adjustPct === 3, r);
}
{
  // 真实数据：10-17 的 33km 应该在窗口内
  const st2 = currentTrainingState();
  check("真实数据里 33km 长距离被识别为准备充足", st2.longRun.ready?.km === 33, st2.longRun);
}

console.log(fail === 0 ? "\n全部通过 ✅" : `\n${fail} 项失败 ❌`);
if (fail > 0) process.exit(1);
