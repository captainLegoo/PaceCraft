import { chromium } from "playwright-core";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const iconsDir = join(root, "src-tauri", "icons");
mkdirSync(iconsDir, { recursive: true });

async function main() {
  console.log("▸ 正在生成应用图标...");
  const svgPath = join(root, "web", "public", "favicon.svg");
  const basePng = join(iconsDir, "icon-1024.png");

  // 找系统 Chrome 或 Edge
  const browserPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  const executablePath = browserPaths.find((p) => existsSync(p));

  if (!executablePath) {
    console.warn("未找到 Chrome/Edge 浏览器，跳过高精度图标生成");
    return;
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.goto(`file://${svgPath}`);
  await page.screenshot({ path: basePng, omitBackground: true });
  await browser.close();

  // 使用 macOS sips 生成各尺寸
  const sizes = [
    { name: "32x32.png", size: 32 },
    { name: "128x128.png", size: 128 },
    { name: "128x128@2x.png", size: 256 },
    { name: "icon.png", size: 512 },
  ];

  for (const s of sizes) {
    execSync(`sips -z ${s.size} ${s.size} "${basePng}" --out "${join(iconsDir, s.name)}" >/dev/null 2>&1`);
  }

  // 生成 macOS icon.icns
  const iconsetDir = join(iconsDir, "AppIcon.iconset");
  mkdirSync(iconsetDir, { recursive: true });
  const iconsetSizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const sz of iconsetSizes) {
    execSync(`sips -z ${sz} ${sz} "${basePng}" --out "${join(iconsetDir, `icon_${sz}x${sz}.png`)}" >/dev/null 2>&1`);
  }
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${join(iconsDir, "icon.icns")}" >/dev/null 2>&1`);
  } catch {}

  // 兜底一个 icon.ico
  copyFileSync(join(iconsDir, "32x32.png"), join(iconsDir, "icon.ico"));

  console.log("✓ 图标资源已生成至: src-tauri/icons/");
}

main().catch(console.error);
