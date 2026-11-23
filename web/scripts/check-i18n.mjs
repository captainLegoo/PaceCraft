#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const zhDir = path.join(webRoot, "src", "i18n", "locales", "zh-CN");
const enDir = path.join(webRoot, "src", "i18n", "locales", "en");

let hasErrors = false;

// 1. 读取语言包目录
const readNamespaceFiles = (dir) => {
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const data = {};
  for (const f of files) {
    const ns = f.replace(/\.json$/, "");
    try {
      data[ns] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch (e) {
      console.error(`❌ JSON parse error in ${f}:`, e.message);
      hasErrors = true;
    }
  }
  return data;
};

const zhData = readNamespaceFiles(zhDir);
const enData = readNamespaceFiles(enDir);

const zhNamespaces = Object.keys(zhData).sort();
const enNamespaces = Object.keys(enData).sort();

// 2. 检查 Namespace 文件列表对称性
const missingEnNs = zhNamespaces.filter((ns) => !enNamespaces.includes(ns));
const missingZhNs = enNamespaces.filter((ns) => !zhNamespaces.includes(ns));

if (missingEnNs.length > 0) {
  console.error(`❌ 英文缺失命名空间 JSON 文件: ${missingEnNs.join(", ")}`);
  hasErrors = true;
}
if (missingZhNs.length > 0) {
  console.error(`❌ 中文缺失命名空间 JSON 文件: ${missingZhNs.join(", ")}`);
  hasErrors = true;
}

// 3. 检查每个 Namespace 内的 key 对称性
const zhKeys = new Set();
const enKeys = new Set();

for (const ns of zhNamespaces) {
  const zhNsKeys = Object.keys(zhData[ns] || {});
  for (const k of zhNsKeys) zhKeys.add(`${ns}.${k}`);

  if (enData[ns]) {
    const enNsKeys = Object.keys(enData[ns] || {});
    for (const k of enNsKeys) enKeys.add(`${ns}.${k}`);

    const missingInEn = zhNsKeys.filter((k) => !enNsKeys.includes(k));
    const missingInZh = enNsKeys.filter((k) => !zhNsKeys.includes(k));

    if (missingInEn.length > 0) {
      console.error(`❌ 命名空间 [${ns}] 英文缺失词条:`);
      missingInEn.forEach((k) => console.error(`    - ${ns}.${k}`));
      hasErrors = true;
    }
    if (missingInZh.length > 0) {
      console.error(`❌ 命名空间 [${ns}] 中文缺失词条:`);
      missingInZh.forEach((k) => console.error(`    - ${ns}.${k}`));
      hasErrors = true;
    }
  }
}

// 4. 扫描源码中所有的 t("...") 调用
const scanFiles = (dir) => {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        results.push(...scanFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }
  return results;
};

const srcFiles = scanFiles(path.join(webRoot, "src"));
const callPattern = /\bt\(\s*["']([a-zA-Z0-9_.-]+)["']/g;
const missingInDictionary = [];

for (const filePath of srcFiles) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let match;
    while ((match = callPattern.exec(line)) !== null) {
      const key = match[1];
      // 必须带命名空间点号
      if (key.includes(".")) {
        if (!zhKeys.has(key)) {
          const relPath = path.relative(webRoot, filePath);
          missingInDictionary.push({
            file: `${relPath}:${lineIdx + 1}`,
            key,
          });
          hasErrors = true;
        }
      }
    }
  }
}

if (missingInDictionary.length > 0) {
  console.error("❌ 代码中使用了在词典中不存在的 key:");
  for (const item of missingInDictionary) {
    console.error(`    ${item.file} -> t("${item.key}")`);
  }
}

if (hasErrors) {
  console.error("\n💥 i18n 静态检查未通过，请补全缺失词条后重新提交！");
  process.exit(1);
} else {
  console.log(
    `✅ i18n 检查全部通过！已验证 ${zhKeys.size} 个词条，中英文命名空间完全对称，代码引用 100% 匹配。`
  );
  process.exit(0);
}
