import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { resources, type Locale, type AppTranslations, type TxKey } from "./resources";

const STORAGE_KEY = "coros-dashboard-locale";

const dictionaries: Record<Locale, AppTranslations> = {
  "zh-CN": resources["zh-CN"],
  "en-US": resources["en-US"],
};

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (saved && (saved === "zh-CN" || saved === "en-US")) {
    return saved;
  }
  const browserLang = navigator.language?.toLowerCase() || "";
  if (browserLang.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (keyPath: TxKey, params?: Record<string, string | number>) => string;
  isZh: boolean;
  isEn: boolean;
  dict: AppTranslations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
    } catch {}
  };

  const toggleLocale = () => {
    setLocale(locale === "zh-CN" ? "en-US" : "zh-CN");
  };

  useEffect(() => {
    try {
      document.documentElement.lang = locale;
    } catch {}
  }, [locale]);

  const dict = useMemo(() => dictionaries[locale] || dictionaries["zh-CN"], [locale]);

  const t = useMemo(() => {
    return (keyPath: TxKey, params?: Record<string, string | number>): string => {
      const keys = keyPath.split(".");
      let current: any = dict;

      for (const k of keys) {
        if (current && typeof current === "object" && k in current) {
          current = current[k];
        } else {
          // 兜底查中文字典
          let fallback: any = dictionaries["zh-CN"];
          for (const fbKey of keys) {
            if (fallback && typeof fallback === "object" && fbKey in fallback) {
              fallback = fallback[fbKey];
            } else {
              fallback = null;
              break;
            }
          }
          current = fallback || keyPath;
          break;
        }
      }

      if (typeof current !== "string") {
        return keyPath;
      }

      let res = current;
      if (params) {
        for (const [pKey, pVal] of Object.entries(params)) {
          res = res.replaceAll(`{${pKey}}`, String(pVal));
        }
      }
      return res;
    };
  }, [dict]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    toggleLocale,
    t,
    isZh: locale === "zh-CN",
    isEn: locale === "en-US",
    dict,
  }), [locale, dict, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}

import { IconGlobe } from "../icons";

/** 紧凑的快捷语言切换按钮（可在暗/明模式与各端自适应） */
export function LanguageToggle() {
  const { toggleLocale, isZh } = useI18n();

  return (
    <button
      className="sidebar-ctrl-btn"
      onClick={toggleLocale}
      title={isZh ? "Switch to English" : "切换为简体中文"}
      aria-label={isZh ? "Switch to English" : "切换为简体中文"}
    >
      <span className="ctrl-icon" aria-hidden>
        <IconGlobe size={14} />
      </span>
      <span>{isZh ? "English" : "中文"}</span>
    </button>
  );
}

/** 设置页使用的语言选项卡片 */
export function LanguageSettingsCard() {
  const { locale, setLocale, dict } = useI18n();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12,
        marginTop: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setLocale("zh-CN")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderRadius: 10,
          border: locale === "zh-CN" ? "2px solid var(--accent)" : "1px solid var(--border)",
          background: locale === "zh-CN" ? "rgba(90, 125, 0, 0.12)" : "var(--surface)",
          color: "var(--text)",
          cursor: "pointer",
          fontWeight: locale === "zh-CN" ? 600 : 400,
          textAlign: "left",
          transition: "all 0.2s ease",
        }}
      >
        <span style={{ fontSize: 20 }}>🇨🇳</span>
        <div>
          <div style={{ fontSize: 14 }}>{dict.settings.langLabelZh}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
            {locale === "zh-CN" ? "适用于国内跑者" : "For Chinese runners"}
          </div>
        </div>
      </button>

      <button
        type="button"
        onClick={() => setLocale("en-US")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderRadius: 10,
          border: locale === "en-US" ? "2px solid var(--accent)" : "1px solid var(--border)",
          background: locale === "en-US" ? "rgba(90, 125, 0, 0.12)" : "var(--surface)",
          color: "var(--text)",
          cursor: "pointer",
          fontWeight: locale === "en-US" ? 600 : 400,
          textAlign: "left",
          transition: "all 0.2s ease",
        }}
      >
        <span style={{ fontSize: 20 }}>🇺🇸</span>
        <div>
          <div style={{ fontSize: 14 }}>{dict.settings.langLabelEn}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
            {locale === "zh-CN" ? "适用于海外与英文用户" : "For Global & English Users"}
          </div>
        </div>
      </button>
    </div>
  );
}

export * from "./resources";
