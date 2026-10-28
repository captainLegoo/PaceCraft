import { $ } from "bun";

export async function generateReleaseNotes(currentTag?: string): Promise<string> {
  const cur = currentTag || process.env.CURRENT_TAG || "HEAD";

  // 获取前一个版本 tag
  let prevTag = "";
  try {
    const tagsOutput = await $`git tag --sort=-creatordate`.text();
    const allTags = tagsOutput
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => /^v?[0-9]+\.[0-9]+/.test(t));

    // 排除当前正在构建的 tag
    const filtered = allTags.filter((t) => t !== cur && t !== `v${cur}`);
    if (filtered.length > 0) {
      prevTag = filtered[0];
    }
  } catch {}

  const range = prevTag ? `${prevTag}..HEAD` : "HEAD~15..HEAD";

  const feats: string[] = [];
  const fixes: string[] = [];
  const others: string[] = [];

  try {
    const rawLogs = await $`git log ${range} --no-merges --pretty=format:%s`.text();
    const lines = rawLogs.split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // 提取 PR 或 commit 描述
      if (/^feat(\(.*?\))?:\s*/i.test(line)) {
        const clean = line.replace(/^feat(\(.*?\))?:\s*/i, "");
        feats.push(clean);
      } else if (/^fix(\(.*?\))?:\s*/i.test(line)) {
        const clean = line.replace(/^fix(\(.*?\))?:\s*/i, "");
        fixes.push(clean);
      } else if (/^style(\(.*?\))?:\s*/i.test(line)) {
        const clean = line.replace(/^style(\(.*?\))?:\s*/i, "");
        fixes.push(clean);
      } else if (!/^(chore|ci|test|build)(\(.*?\))?:\s*/i.test(line)) {
        others.push(line);
      }
    }
  } catch {}

  let changelog = "";

  if (feats.length > 0) {
    changelog += `### ✨ 新增特性\n`;
    for (const item of feats) {
      changelog += `- ${item}\n`;
    }
    changelog += `\n`;
  }

  if (fixes.length > 0) {
    changelog += `### 🛠 修复与改进\n`;
    for (const item of fixes) {
      changelog += `- ${item}\n`;
    }
    changelog += `\n`;
  }

  if (!changelog && others.length > 0) {
    changelog += `### 📝 更新内容\n`;
    for (const item of others) {
      changelog += `- ${item}\n`;
    }
    changelog += `\n`;
  }

  if (!changelog) {
    changelog = `### 📝 更新内容\n- 包含常规稳定性改进与性能提升。\n\n`;
  }

  const instructions = `---

### 客户端安装与运行指引
- **Windows**: 下载 \`*.exe\` 安装包安装运行
- **macOS**: 下载 \`*.dmg\` 拖入 Applications 运行

> **🍎 macOS 首次打开提示「已损坏，无法打开」？**
> 打开 Mac「终端」执行 \`xattr -cr /Applications/PaceCraft.app\`，或在「系统设置」➔「隐私与安全性」中点击「仍要打开」。
>
> **🪟 Windows 提示「Windows 已保护你的电脑 (SmartScreen)」？**
> 点击弹窗中的「更多信息」➔ 点击「仍要运行」即可正常安装。
`;

  return `${changelog}${instructions}`;
}

// 独立执行模式：生成并输出，供 GitHub Actions 管道捕获
if (import.meta.main) {
  const targetTag = process.argv[2] || process.env.CURRENT_TAG;
  const notes = await generateReleaseNotes(targetTag);
  console.log(notes);
}
