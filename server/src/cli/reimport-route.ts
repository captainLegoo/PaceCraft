/**
 * 路线重导入 —— 用本地 GPX 文件覆盖库里已存的路线数据。
 *
 * 为什么需要：
 *  爬升算法的口径改过，而库里存的是**旧算法算出来的结果**。
 *  新逻辑只对新导入的文件生效，历史数据不会自己变 ——
 *  而库里存的又是抽稀后的点序列，被丢掉的海拔再也回不来了，
 *  所以只能拿原始 GPX 重新导入一次。
 *
 * 走这条路而不是点页面上的「上传轨迹文件」：命令行要求显式给出
 * **赛事 id + 文件路径**并在写库前打印赛事全名与日期，
 *  不会像在表单里那样误传到另一场上去。
 *
 * ## 默认只读
 *
 * 不加 `--apply` 就**只预览、不写库**。重新导入会覆盖已有的历史路线数据，
 * 「默认只读、显式开启写入」比反过来更不容易误操作。
 *
 * 用法：
 *   bun run src/cli/reimport-route.ts --list
 *   bun run src/cli/reimport-route.ts --id 1 --file "docs/跑步 ….gpx"           # 预览
 *   bun run src/cli/reimport-route.ts --id 1 --file "docs/跑步 ….gpx" --apply   # 写入
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../db/client.ts";
import { races } from "../db/schema.ts";
import { parseRouteFile } from "../route-file.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
/** 默认预览；必须显式 --apply 才写库 */
const apply = args.includes("--apply");

const rows = db.select().from(races).orderBy(races.date).all();

if (args.includes("--list")) {
  console.log("\n库里可重导入的赛事：\n");
  for (const r of rows) {
    const pts = r.routeData?.startsWith("[") ? "（路书路点）" : "";
    console.log(
      `  id=${String(r.id).padStart(3)}  ${r.date}  ${r.name}${pts}\n` +
        `            routeSource=${r.routeSource}  routeData=${((r.routeData?.length ?? 0) / 1024).toFixed(0)}KB`,
    );
  }
  console.log("\n用法：--id <赛事id> --file <GPX/KML 路径>\n");
  process.exit(0);
}

const id = Number(flag("id"));
const file = flag("file");
if (!Number.isInteger(id) || !file) {
  console.error("用法：bun run src/cli/reimport-route.ts --id <赛事id> --file <GPX/KML 路径> [--apply]");
  process.exit(1);
}

const row = rows.find((r) => r.id === id);
if (!row) {
  console.error(`库里没有 id=${id} 的赛事。现有：${rows.map((r) => r.id).join(", ") || "（空）"}`);
  process.exit(1);
}

let text: string;
try {
  text = readFileSync(file, "utf8");
} catch (e) {
  console.error(`读不到文件：${file}\n${(e as Error).message}`);
  process.exit(1);
}

const parsed = parseRouteFile(text, "auto");
if (parsed.error || !parsed.track) {
  console.error(`解析失败：${parsed.error ?? "未知错误"}`);
  process.exit(1);
}
const t = parsed.track;

// 旧值：直接数库里点序列的长度，不去反解旧算法
const oldPts = (() => {
  try {
    const j = JSON.parse(row.routeData ?? "null") as { points?: unknown[] } | null;
    return Array.isArray(j?.points) ? j.points.length : null;
  } catch {
    return null;
  }
})();

console.log(`\n目标赛事：${row.date}  ${row.name}  (id=${row.id})`);
console.log(`来源文件：${file}`);
console.log(`\n解析结果：${parsed.kind.toUpperCase()}  ${t.points.length} 点  ${t.sampleSpacingM}m/点  ${(t.distanceM / 1000).toFixed(2)}km`);
console.log(`爬升 ${t.gainM}m  下降 ${t.lossM}m  海拔 ${t.eleMin}~${t.eleMax}m`);
if (t.sampleSpacingM > 20) {
  console.log(`⚠️  采样间隔 ${t.sampleSpacingM}m 偏粗，爬升很可能偏低`);
}
console.log(`\n旧值：${oldPts === null ? "无法反解（旧结构）" : `${oldPts} 点`}`);
console.log(`新值：${t.points.length} 点（完整分辨率入库）`);

if (!apply) {
  console.log("\n这是预览，没有写库。确认无误后加 --apply 执行写入。\n");
  process.exit(0);
}

// 写在同一个事务里：routeData、来源标注、派生统计（gainM/lossM/distanceM/
// eleMin/eleMax/sampleSpacingM）本就在 track 对象内部，一次 UPDATE 天然原子。
// profileJson 一并置空 —— 虽然当前没有任何代码读它（画像每次现算），
// 但留着旧缓存的风险不对称：清空零成本，留着可能哪天被人接上去就出静默不一致。
const routeData = JSON.stringify(t);
const patch = {
  routeSource: "gpx",
  routeData,
  sourceNote: `${parsed.kind === "kml" ? "KML" : "GPX"} 轨迹海拔（已阈值滤波，误差 ±5-10m）｜来自 ${file.split("/").pop()}`,
  profileJson: null as string | null,
  updatedAt: Math.floor(Date.now() / 1000),
};
db.transaction((tx) => {
  tx.update(races).set(patch).where(eq(races.id, id)).run();
});

const saved = db.select().from(races).where(eq(races.id, id)).get();
if (!saved || saved.routeData !== routeData) {
  console.error("❌ 写库后校验失败：routeData 与预期不一致，已回滚。");
  process.exit(1);
}
sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");

console.log(`\n✅ 已写入 ${row.name}（${(routeData.length / 1024).toFixed(0)}KB，已校验）\n`);
