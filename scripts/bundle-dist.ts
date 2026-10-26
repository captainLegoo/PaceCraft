import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const distDir = join(root, "web", "dist");
const outFile = join(root, "server", "src", "embedded-dist.ts");

if (!existsSync(distDir)) {
  console.error("✗ web/dist 不存在，请先执行 bun run build:web");
  process.exit(1);
}

function getMime(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function scan(dir: string, base = ""): { path: string; mime: string; base64: string }[] {
  let results: { path: string; mime: string; base64: string }[] = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    // Normalize path separators to forward slash for web URLs
    const rel = (base ? `${base}/${item}` : item).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      results = results.concat(scan(full, rel));
    } else {
      results.push({
        path: rel,
        mime: getMime(rel),
        base64: readFileSync(full).toString("base64"),
      });
    }
  }
  return results;
}

const files = scan(distDir);
const mapEntries = files.map((f) => `  ${JSON.stringify(f.path)}: { mime: ${JSON.stringify(f.mime)}, base64: ${JSON.stringify(f.base64)} }`);

const code = `// 自动生成文件（通过 bun run build:embed），请勿手动修改。
// 将前端静态资源直接内嵌至后端二进制中，保证单文件 Sidecar 脱离源码目录亦可开箱即用。
export const EMBEDDED_DIST: Record<string, { mime: string; base64: string }> = {
${mapEntries.join(",\n")}
};
`;

writeFileSync(outFile, code, "utf8");
console.log(`✓ 成功将前端静态资源（${files.length} 个文件）内嵌至: ${outFile}`);
