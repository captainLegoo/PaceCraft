import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { api } from "./api";

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

let lastOpenTime = 0;
let lastOpenUrl = "";

/**
 * 跨端统一唤起系统默认浏览器打开外部网页。
 * 1. 防抖/防双击：同一 URL 1.2 秒内禁止重复触发，杜绝多标签页并发弹出；
 * 2. 桌面端 (Tauri)：优先通过 Tauri 原生 Shell 插件 open 打开，失败则由后端命令 /usr/bin/open 兜底；
 * 3. 网页模式 (Browser)：直接由浏览器原生打开新标签页，严禁触发后端系统级 open 命令（避免网页与系统双重打开）。
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;

  const now = Date.now();
  if (url === lastOpenUrl && now - lastOpenTime < 1200) {
    return;
  }
  lastOpenTime = now;
  lastOpenUrl = url;

  // 桌面端环境（Tauri WebView）：使用原生能力调起系统默认浏览器
  if (isTauriEnv()) {
    try {
      await shellOpen(url);
      return;
    } catch (e) {
      console.warn("Tauri shell open fallback:", e);
    }

    try {
      const res = await api.openExternal(url);
      if (res?.ok) return;
    } catch (e) {
      console.warn("Backend openExternal fallback:", e);
    }
    return;
  }

  // 纯 Web 浏览器环境：直接使用浏览器原生打开新标签页，绝对不要调用后端的 open 命令
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    console.error("Failed to open external url in browser:", e);
  }
}

export { default as ExternalLink } from "./components/ExternalLink";
