import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { api } from "./api";

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

/**
 * 跨端统一唤起系统默认浏览器打开外部网页。
 * 1. 桌面端 (Tauri)：优先通过 Tauri 原生 Shell 插件 open 打开；
 * 2. 伴生服务兜底：通过 /api/open-external 调用系统命令（macOS /usr/bin/open，Windows PowerShell Start-Process）；
 * 3. 网页模式兜底：降级使用 window.open。
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;

  if (isTauriEnv()) {
    try {
      await shellOpen(url);
      return;
    } catch (e) {
      console.warn("Tauri shell open fallback:", e);
    }
  }

  try {
    const res = await api.openExternal(url);
    if (res?.ok) return;
  } catch (e) {
    console.warn("Backend openExternal fallback:", e);
  }

  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    console.error("Failed to open external url:", e);
  }
}
