import { useState, useCallback, useRef } from "react";

/**
 * 跨平台安全复制文本至剪贴板
 * 优先调用现代 navigator.clipboard API，遇到权限受限或非安全上下文时自动降级到 execCommand。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. 尝试现代 Clipboard API
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级到传统机制
    }
  }

  // 2. 传统 DOM input 选中兜底
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * React 剪贴板 Hook
 * 提供平滑的复制状态切换（默认 2 秒后自动重置为未复制）。
 *
 * @param timeout 恢复未复制状态的延时毫秒数，默认 2000ms
 */
export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const success = await copyText(text);
      if (success) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        setCopied(true);
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, timeout);
      }
      return success;
    },
    [timeout]
  );

  return { copied, copy };
}
