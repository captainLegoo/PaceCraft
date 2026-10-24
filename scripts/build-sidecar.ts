import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const binDir = join(root, "src-tauri", "binaries");
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

const arch = process.arch; // "arm64" | "x64"
const platform = process.platform; // "darwin" | "win32" | "linux"

let targetTriple = "";
let bunTarget = "";
let ext = "";

if (platform === "darwin") {
  if (arch === "arm64") {
    targetTriple = "aarch64-apple-darwin";
    bunTarget = "bun-darwin-arm64";
  } else {
    targetTriple = "x86_64-apple-darwin";
    bunTarget = "bun-darwin-x64";
  }
} else if (platform === "win32") {
  targetTriple = "x86_64-pc-windows-msvc";
  bunTarget = "bun-windows-x64";
  ext = ".exe";
} else {
  targetTriple = "x86_64-unknown-linux-gnu";
  bunTarget = "bun-linux-x64";
}

const finalTriple = process.env.TAURI_TARGET_TRIPLE || targetTriple;
const finalBunTarget = process.env.BUN_TARGET || bunTarget;
const outName = `server-${finalTriple}${ext}`;
const outPath = join(binDir, outName);

console.log(`▸ 正在将后端编译为单文件 Sidecar [${finalTriple}]...`);
const cmd = [
  "build",
  "--compile",
  "--minify",
  `--target=${finalBunTarget}`,
  "./server/src/index.ts",
  `--outfile=${outPath}`,
];

const res = spawnSync("bun", cmd, { cwd: root, stdio: "inherit" });
if (res.status !== 0) {
  console.error(`✗ 编译后端 Sidecar 失败`);
  process.exit(res.status ?? 1);
}
console.log(`✓ 后端 Sidecar 已就绪: ${outPath}`);
