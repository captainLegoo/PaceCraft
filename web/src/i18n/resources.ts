// zh-CN JSON namespaces
import zhCommon from "./locales/zh-CN/common.json";
import zhNav from "./locales/zh-CN/nav.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhReadiness from "./locales/zh-CN/readiness.json";
import zhRace from "./locales/zh-CN/race.json";
import zhCoach from "./locales/zh-CN/coach.json";
import zhTraining from "./locales/zh-CN/training.json";
import zhSession from "./locales/zh-CN/session.json";

// en JSON namespaces
import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enSettings from "./locales/en/settings.json";
import enReadiness from "./locales/en/readiness.json";
import enRace from "./locales/en/race.json";
import enCoach from "./locales/en/coach.json";
import enTraining from "./locales/en/training.json";
import enSession from "./locales/en/session.json";

export const resources = {
  "zh-CN": {
    common: zhCommon,
    nav: zhNav,
    settings: zhSettings,
    readiness: zhReadiness,
    race: zhRace,
    coach: zhCoach,
    training: zhTraining,
    session: zhSession,
  },
  "en-US": {
    common: enCommon,
    nav: enNav,
    settings: enSettings,
    readiness: enReadiness,
    race: enRace,
    coach: enCoach,
    training: enTraining,
    session: enSession,
  },
  "en": {
    common: enCommon,
    nav: enNav,
    settings: enSettings,
    readiness: enReadiness,
    race: enRace,
    coach: enCoach,
    training: enTraining,
    session: enSession,
  },
} as const;

export type Locale = "zh-CN" | "en-US";
export type AppTranslations = typeof resources["zh-CN"];
