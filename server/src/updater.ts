/**
 * 软件更新智能路由与版本检测服务
 * 1. 自动探测用户 IP 出网归属地（国内 CN 走镜像，海外走官方直连）
 * 2. 代理拉取 latest.json 并动态为各平台安装包链接注入最优加速前缀
 * 3. 服务端安全代理 GitHub Release 检测，避免前端触发 403 频率限制
 */

export type NetworkRegion = {
  region: "CN" | "GLOBAL";
  country: string;
  ip: string;
  route: "proxy" | "direct";
};

export type CheckReleaseResult = {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  publishedAt?: string;
  downloadUrl: string;
  routeUsed: string;
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

// 版本检测缓存，缓存 3 分钟，防止短时间内高频重复请求 GitHub API
let cachedReleaseCheck: { data: CheckReleaseResult; expiresAt: number } | null = null;

export async function checkLatestRelease(currentVersion: string, preferred?: string): Promise<CheckReleaseResult> {
  const now = Date.now();
  if (cachedReleaseCheck && cachedReleaseCheck.expiresAt > now) {
    return cachedReleaseCheck.data;
  }

  const chosen = (preferred || preferredRoute) as "auto" | "proxy" | "direct";
  const regionInfo = await detectRegion();
  const shouldUseProxy = chosen === "proxy" || (chosen === "auto" && regionInfo.region === "CN");
  const cleanCurrent = currentVersion.replace(/^v/, "").trim();

  let tag = "";
  let body = "";
  let publishedAt = "";
  let htmlUrl = `https://github.com/${GITHUB_REPO}/releases`;
  let routeUsed = shouldUseProxy ? "proxy" : "direct";

  // 1. 优先尝试 GitHub API（支持国内代理镜像）
  const apiUrls = shouldUseProxy
    ? [
        `https://ghproxy.net/https://api.github.com/repos/${GITHUB_REPO}/releases`,
        `https://api.github.com/repos/${GITHUB_REPO}/releases`,
      ]
    : [
        `https://api.github.com/repos/${GITHUB_REPO}/releases`,
      ];

  let apiSuccess = false;
  for (const url of apiUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "PaceCraft-Desktop-App",
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (res.ok) {
        const list = (await res.json()) as any[];
        if (Array.isArray(list) && list.length > 0) {
          const item = list[0];
          tag = item.tag_name || "";
          body = item.body || "";
          publishedAt = item.published_at || "";
          htmlUrl = item.html_url || htmlUrl;
          apiSuccess = true;
          break;
        }
      }
    } catch {
      // 尝试下一个地址
    }
  }

  // 2. 若 API 触发 403 限流或网络阻断，降级通过 Releases 网页 HTML 解析（无 60次/小时 API 限制）
  if (!apiSuccess) {
    const webUrls = shouldUseProxy
      ? [
          `https://ghproxy.net/https://github.com/${GITHUB_REPO}/releases`,
          `https://github.com/${GITHUB_REPO}/releases`,
        ]
      : [`https://github.com/${GITHUB_REPO}/releases`];

    for (const url of webUrls) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        });
        if (res.ok) {
          const html = await res.text();
          // 匹配 /releases/tag/vX.Y.Z
          const tagMatch = html.match(new RegExp(`/${GITHUB_REPO}/releases/tag/(v?[0-9]+\\.[0-9]+[a-zA-Z0-9.-]*)`));
          if (tagMatch) {
            tag = tagMatch[1];
            body = "包含最新稳定性提升与功能改进。";
            htmlUrl = `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;
            break;
          }
        }
      } catch {}
    }
  }

  const cleanLatest = tag.replace(/^v/, "").trim() || cleanCurrent;
  const hasUpdate = Boolean(cleanLatest && cleanLatest !== cleanCurrent);

  const result: CheckReleaseResult = {
    hasUpdate,
    latestVersion: cleanLatest,
    currentVersion: cleanCurrent,
    releaseNotes: body || (hasUpdate ? "包含最新性能优化与功能更新。" : "当前运行版本已是最新。"),
    publishedAt,
    downloadUrl: htmlUrl,
    routeUsed,
  };

  cachedReleaseCheck = {
    data: result,
    expiresAt: now + 3 * 60 * 1000,
  };

  return result;
}

export async function fetchUpdateManifest(preferred?: string) {
  const chosen = (preferred || preferredRoute) as "auto" | "proxy" | "direct";
  const regionInfo = await detectRegion();
  const shouldUseProxy = chosen === "proxy" || (chosen === "auto" && regionInfo.region === "CN");

  // 获取可尝试的 download URLs（首先尝试 latest，若 latest 404 则尝试最新 tag）
  const manifestUrls = [OFFICIAL_LATEST_JSON];
  try {
    const releaseInfo = await checkLatestRelease("0.0.0", preferred);
    if (releaseInfo.latestVersion && releaseInfo.latestVersion !== "0.0.0") {
      manifestUrls.push(`https://github.com/${GITHUB_REPO}/releases/download/v${releaseInfo.latestVersion}/latest.json`);
      manifestUrls.push(`https://github.com/${GITHUB_REPO}/releases/download/${releaseInfo.latestVersion}/latest.json`);
    }
  } catch {}

  if (!shouldUseProxy) {
    // 海外/官方线路：直接拉取官方清单
    for (const url of manifestUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          return { status: 200, data, routeUsed: "direct", region: regionInfo };
        }
      } catch {}
    }
    return { status: 404, data: null, routeUsed: "direct", region: regionInfo };
  }

  // 国内线路：走国内镜像代理拉取
  for (const proxy of PROXY_MIRRORS) {
    for (const rawUrl of manifestUrls) {
      try {
        const proxyUrl = `${proxy}${rawUrl}`;
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
      } catch {}
    }
  }

  return { status: 404, data: null, routeUsed: "failed", region: regionInfo };
}
