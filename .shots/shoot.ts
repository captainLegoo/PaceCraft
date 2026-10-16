/**
 * 本地 UI 截图工具（开发用）。
 *
 * 用法（先在仓库根目录起服务）：
 *   bun run shoot                                     # 默认截 http://127.0.0.1:43124
 *   SHOT_BASE=http://127.0.0.1:43125 bun run shoot    # 截 Vite dev
 *
 * 浏览器怎么找：CHROME_EXE > playwright 自己认的路径 > 在 ~/Library/Caches/ms-playwright
 * 里挑一份最新的 chromium-*。最后这步是必要的 —— playwright-core 的版本号和缓存里
 * 实际下载的 revision 经常对不上（例如期望 chromium-1243 但装的是 chromium-1223）。
 * 装浏览器：bunx playwright install chromium
 *
 * 输出落在 `.shots/*.png`。截图里有本人真实训练数据，**不要提交**
 * （`.shots/*` 已在 .gitignore，只放行本脚本）。有页面报错会打印并以非 0 退出。
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.SHOT_BASE ?? "http://127.0.0.1:43124";
const OUT = new URL(".", import.meta.url).pathname; // → .shots/

/** chromium 在各平台缓存里的相对路径。 */
const CHROME_REL = [
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-linux/chrome",
];

/** 返回一份可执行文件；undefined 表示交给 playwright 自己决定。 */
function resolveChrome(): string | undefined {
  if (process.env.CHROME_EXE) return process.env.CHROME_EXE;
  if (existsSync(chromium.executablePath())) return undefined; // 版本对得上
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  return readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.slice("chromium-".length)) - Number(a.slice("chromium-".length)))
    .flatMap((d) => CHROME_REL.map((rel) => join(cache, d, rel)))
    .find(existsSync);
}

const exe = resolveChrome();
console.log(exe ? `浏览器: ${exe}` : "浏览器: 交给 playwright 自己找");

const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

async function shoot(name: string, wait = 2000) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log(`  ✓ ${name}.png`);
}

/** 逐个点侧边栏导航（`web/src/App.tsx` 的 NAV）截图。 */
async function shootTabs(tabs: [file: string, label: string][]) {
  for (const [name, label] of tabs) {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: new RegExp(label) }).first().click();
    await shoot(name);
  }
}

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await shoot("01-training");
await shootTabs([
  ["02-prediction", "自建预测"],
  ["03-race", "赛事路线"],
  ["04-prep", "备赛体检"],
  ["05-fitness", "体能"],
  ["06-health", "恢复"],
  ["07-settings", "设置"],
]);

if (errors.length === 0) console.log("\n控制台错误: 无");
else {
  console.log(`\n控制台错误 (${errors.length}):\n  ${errors.slice(0, 8).join("\n  ")}`);
  process.exitCode = 1;
}

await browser.close();
