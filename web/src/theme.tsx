import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

export type Theme = "dark" | "light";

const KEY = "coros-dashboard-theme";

function readInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * 主题：优先用用户上次的选择，没有就跟随系统。
 * 真正生效的代码在 index.html 的内联脚本里（先于 React 跑，避免刷新时闪白/闪黑）。
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    apply(theme);
    window.localStorage.setItem(KEY, theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#e8e7e3" : "#1a1d23");
  }, [theme]);

  // 用户没手动选过时，系统切换也跟着走
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (window.localStorage.getItem(KEY)) return;
      const next: Theme = mq.matches ? "light" : "dark";
      setTheme(next);
      apply(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    isLight: theme === "light",
  };
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const light = theme === "light";
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      title={light ? "切到黑夜模式" : "切到白天模式"}
      aria-label={light ? "切到黑夜模式" : "切到白天模式"}
    >
      <span className="theme-icon" aria-hidden>{light ? <IconSun size={15} /> : <IconMoon size={15} />}</span>
      <span>{light ? "白天" : "黑夜"}</span>
    </button>
  );
}
