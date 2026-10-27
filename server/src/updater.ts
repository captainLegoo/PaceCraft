/**
 * 软件更新智能路由服务
 * 1. 自动探测用户 IP 出网归属地（国内 CN 走镜像，海外走官方直连）
 * 2. 代理拉取 latest.json 并动态为各平台安装包链接注入最优加速前缀
 */

export type NetworkRegion = {
  region: "CN" | "GLOBAL";
  country: string;
  ip: string;
  route: "proxy" | "direct";
};

// 内存缓存 10 分钟，避免高频请求 trace
let cachedRegion: { data: NetworkRegion; expiresAt: number } | null = null;

export async function detectRegion(): Promise<NetworkRegion> {
  const now = Date.now();
  if (cachedRegion && cachedRegion.expiresAt > now) {
    return cachedRegion.data;
  }

  let country = "UNKNOWN";
  let ip = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const text = await res.text();
      const locMatch = text.match(/loc=([A-Z]{2})/);
      const ipMatch = text.match(/ip=([^\s]+)/);
      if (locMatch) country = locMatch[1];
      if (ipMatch) ip = ipMatch[1];
    }
  } catch {
    // 接口超时或断网兜底：检测系统时区
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (tz.includes("Shanghai") || tz.includes("Chongqing") || tz.includes("Urumqi") || tz.includes("Harbin")) {
        country = "CN";
      }
    } catch {}
  }

  const isCN = country === "CN";
  const result: NetworkRegion = {
    region: isCN ? "CN" : "GLOBAL",
    country,
    ip,
    route: isCN ? "proxy" : "direct",
  };

  cachedRegion = {
    data: result,
    expiresAt: now + 10 * 60 * 1000,
  };

  return result;
}

// 缓存用户选择的 preferredRoute（"auto" | "proxy" | "direct"）
let preferredRoute: "auto" | "proxy" | "direct" = "auto";

export function setPreferredRoute(route: "auto" | "proxy" | "direct") {
  preferredRoute = route;
}

export function getPreferredRoute() {
  return preferredRoute;
}

const GITHUB_REPO = "captainLegoo/PaceCraft";
const OFFICIAL_LATEST_JSON = `https://github.com/${GITHUB_REPO}/releases/latest/download/latest.json`;
const PROXY_MIRRORS = [
  "https://ghproxy.net/",
  "https://mirror.ghproxy.com/",
];

export async function fetchUpdateManifest(preferred?: string) {
  const chosen = (preferred || preferredRoute) as "auto" | "proxy" | "direct";
  const regionInfo = await detectRegion();
  const shouldUseProxy = chosen === "proxy" || (chosen === "auto" && regionInfo.region === "CN");

  if (!shouldUseProxy) {
    // 海外/官方线路：直接拉取官方清单
    try {
      const res = await fetch(OFFICIAL_LATEST_JSON);
      if (res.ok) {
        const data = await res.json();
        return { status: 200, data, routeUsed: "direct", region: regionInfo };
      }
      return { status: res.status, data: null, routeUsed: "direct", region: regionInfo };
    } catch (err: any) {
      return { status: 502, error: err?.message, data: null, routeUsed: "direct", region: regionInfo };
    }
  }

  // 国内线路：走国内镜像代理拉取
  for (const proxy of PROXY_MIRRORS) {
    try {
      const proxyUrl = `${proxy}${OFFICIAL_LATEST_JSON}`;
      const res = await fetch(proxyUrl, {
        headers: { "User-Agent": "PaceCraft-Updater" },
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        // 给 platforms 里的下载链接注入加速代理前缀，让大文件下载也走加速
        if (data && data.platforms && typeof data.platforms === "object") {
          for (const key of Object.keys(data.platforms)) {
            const platform = data.platforms[key];
            if (platform && platform.url && typeof platform.url === "string") {
              if (!platform.url.startsWith("http")) continue;
              if (!platform.url.startsWith(proxy)) {
                platform.url = `${proxy}${platform.url}`;
              }
            }
          }
        }
        return { status: 200, data, routeUsed: "proxy", region: regionInfo };
      }
    } catch {
      // 尝试下一个镜像
    }
  }

  // 镜像均超时则降级尝试官方直连
  try {
    const res = await fetch(OFFICIAL_LATEST_JSON);
    if (res.ok) {
      const data = await res.json();
      return { status: 200, data, routeUsed: "direct-fallback", region: regionInfo };
    }
  } catch {}

  return { status: 404, data: null, routeUsed: "failed", region: regionInfo };
}
