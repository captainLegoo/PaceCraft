import { chromium } from "playwright-core";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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

  // 生成 Windows icon.ico (多尺寸标准 ICO 格式，兼容 MSVC RC.EXE)
  try {
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const entries: { entry: Buffer; imgSize: number }[] = [];
    const imageBuffers: Buffer[] = [];

    for (const sz of icoSizes) {
      const tmpPng = join(iconsDir, `__tmp_${sz}.png`);
      const tmpIco = join(iconsDir, `__tmp_${sz}.ico`);
      execSync(`sips -z ${sz} ${sz} "${basePng}" --out "${tmpPng}" >/dev/null 2>&1`);
      execSync(`sips -s format ico "${tmpPng}" --out "${tmpIco}" >/dev/null 2>&1`);
      const buf = readFileSync(tmpIco);
      const count = buf.readUInt16LE(4);
      if (count === 1) {
        const entry = Buffer.from(buf.subarray(6, 22));
        const imgOffset = entry.readUInt32LE(12);
        const imgSize = entry.readUInt32LE(8);
        const imgData = buf.subarray(imgOffset, imgOffset + imgSize);
        entries.push({ entry, imgSize });
        imageBuffers.push(imgData);
      }
      try { rmSync(tmpPng); rmSync(tmpIco); } catch {}
    }

    if (entries.length > 0) {
      const header = Buffer.alloc(6);
      header.writeUInt16LE(0, 0); // reserved
      header.writeUInt16LE(1, 2); // type = icon
      header.writeUInt16LE(entries.length, 4); // count

      let currentOffset = 6 + 16 * entries.length;
      const dirBuffer = Buffer.alloc(16 * entries.length);

      for (let i = 0; i < entries.length; i++) {
        const { entry, imgSize } = entries[i];
        entry.writeUInt32LE(currentOffset, 12);
        entry.copy(dirBuffer, i * 16);
        currentOffset += imgSize;
      }

      const finalIco = Buffer.concat([header, dirBuffer, ...imageBuffers]);
      writeFileSync(join(iconsDir, "icon.ico"), finalIco);
    }
  } catch (icoErr) {
    console.warn("生成标准 icon.ico 遇到警告:", icoErr);
  }

  console.log("✓ 图标资源已生成至: src-tauri/icons/");
}

main().catch(console.error);
