/**
 * 窄屏视觉验收工具（开发用）。
 *
 * 用 iPhone 视口（390×844）逐页截图，并检查两件事：
 *   1. 有没有横向溢出 —— 页面上任何一个元素撑破视口，整页都会被挤变形，
 *      而且溢出的往往不是自己，而是「被旁边的元素连累」（实测过）。
 *   2. 控制台有没有报错。
 *
 * 桌面端用 `bun run shoot`。两个一起跑，改完样式先看窄屏有没有被搞坏。
 *
 * 用法（先在仓库根目录起服务）：
 *   bun run shoot:mobile                                     # 默认截 http://127.0.0.1:43124
 *   SHOT_BASE=http://127.0.0.1:43125 bun run shoot:mobile    # 截 Vite dev
 *
 * 输出落在 `.shots/m-<页面>.png`。截图里有本人真实训练数据，**不要提交**
 * （`.shots/*` 已在 .gitignore，只放行本脚本）。
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.SHOT_BASE ?? "http://127.0.0.1:43124";
const OUT = new URL(".", import.meta.url).pathname;

function resolveChrome(): string | undefined {
  if (process.env.CHROME_EXE) return process.env.CHROME_EXE;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  return readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.slice("chromium-".length)) - Number(a.slice("chromium-".length)))
    .flatMap((d) => ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].map((rel) => join(cache, d, rel)))
    .find(existsSync);
}

const exe = resolveChrome();
const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();

const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

const TAG = process.env.TAG ?? "m";

async function shoot(name: string, wait = 2200) {
  await page.waitForTimeout(wait);
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return {
      scrollW: document.documentElement.scrollWidth,
      vw,
      // 溢出的元凶通常是宽表格，但把它们逐个列出来才好定位到具体是哪张
      wideTables: [...document.querySelectorAll("table")]
        .map((t) => ({
          head: [...t.querySelectorAll("th")].map((x) => x.textContent?.trim()).join("|"),
          w: Math.round(t.getBoundingClientRect().width),
        }))
        .filter((x) => x.w > vw),
    };
  });
  await page.screenshot({ path: `${OUT}${TAG}-${name}.png`, fullPage: true });

  const bad = m.scrollW > m.vw + 1;
  console.log(`  ✓ ${TAG}-${name}.png  ${bad ? `⚠ 横向溢出 ${m.scrollW}>${m.vw}` : "ok"}`);
  m.wideTables.forEach((t) => console.log(`      宽表 ${t.w}px  [${t.head}]`));
}

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await shoot("01-training");

// 窄屏下侧边栏收在抽屉里，切页面前先点汉堡按钮拉开
for (const [file, label] of [["02-prediction", "自建预测"], ["03-race", "赛事路线"], ["05-fitness", "体能"], ["06-health", "恢复"], ["07-settings", "设置"]] as [string, string][]) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.waitForTimeout(500);
  if (file === "02-prediction") await shoot("00-drawer");
  await page.getByRole("button", { name: new RegExp(label) }).first().click();
  await shoot(file);
}

/**
 * 交互验收：截图看不出抽屉能不能开、表格滑不滑得动，这些得实际点一遍。
 * 这些都是改窄屏适配时踩过的坑，逐条钉住，免得以后改样式又改回去。
 */
const ok = (c: boolean, m: string) => console.log(`  ${c ? "✓" : "✗"} ${m}`);
const sidebarRight = () => page.evaluate(() => Math.round(document.querySelector(".sidebar")!.getBoundingClientRect().right));

console.log("\n交互：");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

ok((await sidebarRight()) <= 0, `抽屉默认收起（右边缘 ${await sidebarRight()}px）`);
await page.getByRole("button", { name: "打开菜单" }).click();
await page.waitForTimeout(400);
ok((await sidebarRight()) > 200, "点汉堡后抽屉滑入");
ok(await page.locator(".nav-scrim").isVisible(), "遮罩出现");

await page.getByRole("button", { name: /体能/ }).first().click();
await page.waitForTimeout(600);
ok((await page.locator(".page-head h2").first().textContent()) === "体能", "点导航项切页");
ok((await sidebarRight()) <= 0, "切页后抽屉自动收起");
ok(await page.evaluate(() => getComputedStyle(document.body).overflow) !== "hidden", "背景滚动已解锁");

await page.getByRole("button", { name: "打开菜单" }).click();
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
ok((await sidebarRight()) <= 0, "Esc 能关抽屉");
ok((await page.locator(".mobile-bar-title").textContent()) === "体能", "顶栏标题跟着页面走");

const slide = await page.evaluate(async () => {
  const box = document.querySelector(".table-scroll") as HTMLElement;
  const first = box.querySelector("tbody td:first-child") as HTMLElement;
  const before = first.getBoundingClientRect().left;
  box.scrollLeft = 200;
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: first.getBoundingClientRect().left };
});
ok(Math.abs(slide.before - slide.after) < 1, `横滑时首列吸附不动（${slide.before}→${slide.after}）`);
ok(await page.evaluate(() => document.querySelector(".table-scroll-wrap[data-x]") !== null), "右侧渐隐提示已挂上");

// 输入框字号必须 ≥16px，否则 iOS Safari 聚焦时会自动放大整页
await page.getByRole("button", { name: "打开菜单" }).click();
await page.getByRole("button", { name: /设置/ }).first().click();
await page.locator("input").first().waitFor({ timeout: 10000 });
const fs = await page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.querySelector("input")!).fontSize)));
ok(fs >= 16, `输入框字号 ${fs}px（iOS 需 ≥16px 才不会自动放大）`);

console.log(errors.length ? `\n控制台错误 (${errors.length}):\n  ${errors.slice(0, 6).join("\n  ")}` : "\n控制台错误: 无");
await browser.close();