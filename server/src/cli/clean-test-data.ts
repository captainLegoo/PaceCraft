#!/usr/bin/env bun
import { cleanMockTestData, getMockTestDataInfo } from "../conflicts.ts";

const info = getMockTestDataInfo();
console.log(`\n🔍 正在扫描数据库中的模拟测试数据...`);

if (info.count === 0) {
  console.log(`✓ 当前数据库未发现模拟测试记录，所有数据均为真实记录。\n`);
  process.exit(0);
}

console.log(`⚠️ 发现 ${info.count} 条模拟测试记录：`);
for (const item of info.items) {
  console.log(`   - [${item.source.toUpperCase()}] ${item.labelId} | ${item.dateLabel} | ${item.distanceKm}km (${item.sportName})`);
}

console.log(`\n🧹 开始执行清理...`);
const res = cleanMockTestData();
console.log(`✓ 成功清理 ${res.removedCount} 条模拟测试记录及相关分圈与详情数据。`);
if (res.restoredActivities.length > 0) {
  console.log(`✓ 已恢复 ${res.restoredActivities.length} 条真实活动为主力独立状态: ${res.restoredActivities.join(", ")}`);
}
console.log(`🎉 模拟测试数据清理完毕，数据库已恢复纯净状态！\n`);
