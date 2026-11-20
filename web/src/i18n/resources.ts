// zh-CN JSON namespaces
import zhCommon from "./locales/zh-CN/common.json";
import zhNav from "./locales/zh-CN/nav.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhReadiness from "./locales/zh-CN/readiness.json";
import zhRace from "./locales/zh-CN/race.json";
import zhCoach from "./locales/zh-CN/coach.json";
import zhTraining from "./locales/zh-CN/training.json";
import zhSession from "./locales/zh-CN/session.json";
import zhAerobic from "./locales/zh-CN/aerobic.json";
import zhSync from "./locales/zh-CN/sync.json";
import zhProfile from "./locales/zh-CN/profile.json";
import zhHeader from "./locales/zh-CN/header.json";
import zhConnect from "./locales/zh-CN/connect.json";

// en JSON namespaces
import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enSettings from "./locales/en/settings.json";
import enReadiness from "./locales/en/readiness.json";
import enRace from "./locales/en/race.json";
import enCoach from "./locales/en/coach.json";
import enTraining from "./locales/en/training.json";
import enSession from "./locales/en/session.json";
import enAerobic from "./locales/en/aerobic.json";
import enSync from "./locales/en/sync.json";
import enProfile from "./locales/en/profile.json";
import enHeader from "./locales/en/header.json";
import enConnect from "./locales/en/connect.json";

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
    aerobic: zhAerobic,
    sync: zhSync,
    profile: zhProfile,
    header: zhHeader,
    connect: zhConnect,
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
    aerobic: enAerobic,
    sync: enSync,
    profile: enProfile,
    header: enHeader,
    connect: enConnect,
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
    aerobic: enAerobic,
    sync: enSync,
    profile: enProfile,
    header: enHeader,
    connect: enConnect,
  },
} as const;

export type Locale = "zh-CN" | "en-US";
export type AppTranslations = typeof resources["zh-CN"];
