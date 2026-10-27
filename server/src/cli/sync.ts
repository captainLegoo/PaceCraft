import { syncAll } from "../coros/sync.ts";

const daysArg = process.argv.find((a) => a.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 365;
const noLaps = process.argv.includes("--no-laps");

console.log(`→ 开始同步（最近 ${days} 天${noLaps ? "，跳过分圈" : ""}）…`);
const t0 = Date.now();

try {
  const r = await syncAll({ days, withLaps: !noLaps });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✅ 同步完成，用时 ${secs}s`);
  console.log(`   活动      ${r.activities} 条`);
  console.log(`   单次详情  ${r.details} 条`);
  console.log(`   分圈      ${r.lapRows} 行`);
  console.log(`   训练负荷  ${r.loadDays} 天`);
  console.log(`   每日健康  ${r.healthDays} 天`);
  console.log(`   睡眠      ${r.sleepDays} 天`);
  console.log(`   FIT 配额剩余 ${r.fitQuotaLeft}/50`);

  if (r.errors.length > 0) {
    console.log(`\n⚠️  ${r.errors.length} 个错误：`);
    for (const e of r.errors.slice(0, 15)) console.log(`   - ${e}`);
    if (r.errors.length > 15) console.log(`   ... 还有 ${r.errors.length - 15} 条`);
  }
} catch (e) {
  console.error("\n❌ 同步失败：", e instanceof Error ? e.message : e);
  process.exit(1);
}
