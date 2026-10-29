import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getDataDir, getGarminTokenPath } from "../config.ts";
import type { GarminAuthStatus, GarminMultiAuthStatus, GarminRegion, GarminTokenSet, GarminTokensMap } from "./types.ts";

export const GARMIN_GLOBAL_HOST = "https://personal.connectapi.garmin.com";
export const GARMIN_CN_HOST = "https://personal.connectapi.garmin.cn";
export const GARMIN_TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

export function getGarminHost(region: GarminRegion): string {
  return region === "cn" ? GARMIN_CN_HOST : GARMIN_GLOBAL_HOST;
}

function ensureDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function loadGarminTokensMap(): GarminTokensMap {
  const tokenPath = getGarminTokenPath();
  if (!existsSync(tokenPath)) return {};
  try {
    const raw = readFileSync(tokenPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed) return {};
    // 兼容旧版单一对象格式（根节点直接是 apiKey）
    if (typeof parsed.apiKey === "string") {
      const reg: GarminRegion = parsed.region === "global" ? "global" : "cn";
      const migrated: GarminTokensMap = { [reg]: parsed };
      saveGarminTokensMap(migrated);
      return migrated;
    }
    return parsed as GarminTokensMap;
  } catch {
    return {};
  }
}

export function saveGarminTokensMap(map: GarminTokensMap) {
  ensureDir();
  const tokenPath = getGarminTokenPath();
  writeFileSync(tokenPath, JSON.stringify(map, null, 2), { mode: 0o600 });
  try {
    chmodSync(tokenPath, 0o600);
  } catch {}
}

export function saveGarminTokens(tokens: GarminTokenSet) {
  const map = loadGarminTokensMap();
  map[tokens.region] = tokens;
  saveGarminTokensMap(map);
}

export function loadGarminTokens(region?: GarminRegion): GarminTokenSet | null {
  const map = loadGarminTokensMap();
  if (region) return map[region] ?? null;
  return map.cn ?? map.global ?? null;
}

export function clearGarminTokens(region?: GarminRegion | "all") {
  const tokenPath = getGarminTokenPath();
  if (!existsSync(tokenPath)) return;
  if (!region || region === "all") {
    try {
      rmSync(tokenPath);
    } catch {}
    return;
  }
  const map = loadGarminTokensMap();
  delete map[region];
  if (!map.cn && !map.global) {
    try {
      rmSync(tokenPath);
    } catch {}
  } else {
    saveGarminTokensMap(map);
  }
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const jsonStr = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export async function requestTokenWithApiKey(
  apiKey: string,
  region: GarminRegion,
): Promise<{ accessToken: string; expiresAt: number; garminGuid?: string }> {
  const host = getGarminHost(region);
  const url = `${host}${GARMIN_TOKEN_PATH}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${apiKey.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Garmin auth request failed (${res.status}): ${body || res.statusText}`);
  }

  // Garmin returns either raw JWT string or JSON with access_token
  const text = (await res.text()).trim();
  let accessToken = "";
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      accessToken = parsed.access_token || parsed.token || text;
    } catch {
      accessToken = text;
    }
  } else {
    accessToken = text.replace(/^"|"$/g, "");
  }

  if (!accessToken) {
    throw new Error("Garmin 未返回有效 Access Token");
  }

  const payload = parseJwt(accessToken);
  const expiresAt = typeof payload?.exp === "number" ? payload.exp : Math.floor(Date.now() / 1000) + 86400;
  const garminGuid = typeof payload?.garmin_guid === "string" ? payload.garmin_guid : undefined;

  return { accessToken, expiresAt, garminGuid };
}

/**
 * 校验并连接 Garmin 账号：支持自动探测国区/国际区，或者手动指定区域
 */
export async function connectGarmin(
  apiKey: string,
  preferredRegion: "auto" | "global" | "cn" = "auto",
): Promise<GarminAuthStatus> {
  const key = apiKey.trim();
  if (!key) throw new Error("请输入 Garmin Personal API Key");

  const regionsToTry: GarminRegion[] =
    preferredRegion === "auto" ? ["global", "cn"] : [preferredRegion];

  let lastError: Error | null = null;
  let successData: { accessToken: string; expiresAt: number; garminGuid?: string; region: GarminRegion } | null = null;

  for (const region of regionsToTry) {
    try {
      const data = await requestTokenWithApiKey(key, region);
      successData = { ...data, region };
      break;
    } catch (err) {
      lastError = err as Error;
    }
  }

  if (!successData) {
    throw new Error(
      lastError?.message?.includes("NotFoundException")
        ? "API Key 在指定区域不存在，请检查是否选对了国际区/中国区"
        : `连接失败：${lastError?.message || "未知错误"}`
    );
  }

  // 尝试拉取一次用户活动获取名称
  let userFullName: string | undefined;
  let ownerDisplayName: string | undefined;
  try {
    const actRes = await fetch(
      `${getGarminHost(successData.region)}/activitylist-service/activities/search/activities?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${successData.accessToken}`,
        },
      }
    );
    if (actRes.ok) {
      const acts = await actRes.json();
      if (Array.isArray(acts) && acts.length > 0 && acts[0]) {
        userFullName = acts[0].ownerFullName;
        ownerDisplayName = acts[0].ownerDisplayName;
      }
    }
  } catch {}

  const tokenSet: GarminTokenSet = {
    apiKey: key,
    accessToken: successData.accessToken,
    expiresAt: successData.expiresAt,
    region: successData.region,
    garminGuid: successData.garminGuid,
    userFullName,
    ownerDisplayName,
  };

  saveGarminTokens(tokenSet);

  return {
    connected: true,
    region: tokenSet.region,
    userFullName: tokenSet.userFullName || null,
    garminGuid: tokenSet.garminGuid || null,
    expiresAt: tokenSet.expiresAt,
    expired: false,
  };
}

export async function getGarminAccessToken(preferredRegion?: GarminRegion): Promise<{ token: string; region: GarminRegion }> {
  const tokens = loadGarminTokens(preferredRegion);
  if (!tokens || !tokens.apiKey) {
    throw new Error(preferredRegion ? `尚未连接 Garmin (${preferredRegion === "cn" ? "中国区" : "国际区"}) 账号` : "尚未连接 Garmin 账号");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // 如果还有超过 5 分钟有效期，直接返回
  if (tokens.accessToken && tokens.expiresAt - nowSec > 300) {
    return { token: tokens.accessToken, region: tokens.region };
  }

  // 临近过期或已过期，自动使用 API Key 换新 token
  const refreshed = await requestTokenWithApiKey(tokens.apiKey, tokens.region);
  tokens.accessToken = refreshed.accessToken;
  tokens.expiresAt = refreshed.expiresAt;
  if (refreshed.garminGuid) tokens.garminGuid = refreshed.garminGuid;
  saveGarminTokens(tokens);

  return { token: tokens.accessToken, region: tokens.region };
}

export function getGarminAuthStatus(region?: GarminRegion): GarminAuthStatus {
  const tokens = loadGarminTokens(region);
  if (!tokens || !tokens.apiKey) {
    return {
      connected: false,
      region: region ?? null,
      userFullName: null,
      garminGuid: null,
      expiresAt: null,
      expired: false,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expired = Boolean(tokens.expiresAt && tokens.expiresAt <= nowSec);

  return {
    connected: true,
    region: tokens.region,
    userFullName: tokens.userFullName || null,
    garminGuid: tokens.garminGuid || null,
    expiresAt: tokens.expiresAt || null,
    expired,
  };
}

export function getGarminMultiAuthStatus(): GarminMultiAuthStatus {
  const cn = getGarminAuthStatus("cn");
  const global = getGarminAuthStatus("global");
  return {
    connected: cn.connected || global.connected,
    cn,
    global,
  };
}

export function disconnectGarmin(region?: GarminRegion | "all"): { ok: boolean } {
  clearGarminTokens(region);
  return { ok: true };
}
