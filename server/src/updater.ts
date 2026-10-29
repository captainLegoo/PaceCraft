import { join, dirname } from "node:path";
import { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync, renameSync } from "node:fs";
import { execFile } from "node:child_process";
import { ROOT_DATA_DIR } from "./profile-manager.ts";

/**
 * 软件更新智能路由与版本检测服务
 * 1. 自动探测用户 IP 出网归属地（国内 CN 走镜像，海外走官方直连）
 * 2. 代理拉取 latest.json 并动态为各平台安装包链接注入最优加速前缀
 * 3. 服务端安全代理 GitHub Release 检测，避免前端触发 403 频率限制
 * 4. 内置桌面客户端安装包后台极速下载、进度监测与安装程序直启
 */

export type NetworkRegion = {
  region: "CN" | "GLOBAL";
  country: string;
  ip: string;
  route: "proxy" | "direct";
};

export type PlatformAsset = {
  name: string;
  downloadUrl: string;
  rawUrl: string;
  size?: number;
  platform: "windows" | "macos" | "linux" | "unknown";
};

export type CheckReleaseResult = {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseNotes: string;
  publishedAt?: string;
  downloadUrl: string;
  routeUsed: string;
  platformAsset?: PlatformAsset | null;
  assets?: Array<{ name: string; downloadUrl: string; rawUrl?: string; size?: number }>;
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

export function getTargetPlatform(override?: string): "windows" | "macos" | "linux" {
  if (override === "windows" || override === "macos" || override === "linux") return override;
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function selectPlatformAsset(
  rawAssets: any[],
  platform: "windows" | "macos" | "linux",
  shouldUseProxy: boolean,
  tag: string,
  cleanVersion: string
): PlatformAsset | null {
  let matched: any = null;

  if (platform === "windows") {
    matched =
      rawAssets.find((a) => typeof a.name === "string" && /setup\.exe$/i.test(a.name)) ||
      rawAssets.find((a) => typeof a.name === "string" && /\.msi$/i.test(a.name)) ||
      rawAssets.find((a) => typeof a.name === "string" && /\.exe$/i.test(a.name));
  } else if (platform === "macos") {
    matched =
      rawAssets.find((a) => typeof a.name === "string" && /\.dmg$/i.test(a.name)) ||
      rawAssets.find((a) => typeof a.name === "string" && /\.app\.tar\.gz$/i.test(a.name));
  } else if (platform === "linux") {
    matched =
      rawAssets.find((a) => typeof a.name === "string" && /\.appimage$/i.test(a.name)) ||
      rawAssets.find((a) => typeof a.name === "string" && /\.deb$/i.test(a.name));
  }

  if (matched) {
    const rawUrl = matched.browser_download_url || "";
    const downloadUrl = shouldUseProxy && rawUrl ? `https://ghproxy.net/${rawUrl}` : rawUrl;
    return {
      name: matched.name,
      rawUrl,
      downloadUrl,
      size: matched.size,
      platform,
    };
  }

  // 兜底构建目标平台的标准发布文件名
  const fallbackTag = tag || `v${cleanVersion}`;
  let fallbackName = "";
  if (platform === "windows") {
    fallbackName = `PaceCraft_${cleanVersion}_x64-setup.exe`;
  } else if (platform === "macos") {
    fallbackName = `PaceCraft_${cleanVersion}_aarch64.dmg`;
  } else {
    fallbackName = `PaceCraft_${cleanVersion}_amd64.AppImage`;
  }

  const rawUrl = `https://github.com/${GITHUB_REPO}/releases/download/${fallbackTag}/${fallbackName}`;
  const downloadUrl = shouldUseProxy ? `https://ghproxy.net/${rawUrl}` : rawUrl;

  return {
    name: fallbackName,
    rawUrl,
    downloadUrl,
    size: undefined,
    platform,
  };
}

// 版本检测缓存，缓存 3 分钟，防止短时间内高频重复请求 GitHub API
let cachedReleaseCheck: { data: CheckReleaseResult; expiresAt: number } | null = null;

export async function checkLatestRelease(
  currentVersion: string,
  preferred?: string,
  force = false,
  platformOverride?: string
): Promise<CheckReleaseResult> {
  const now = Date.now();
  if (!force && cachedReleaseCheck && cachedReleaseCheck.expiresAt > now) {
    return cachedReleaseCheck.data;
  }

  const chosen = (preferred || preferredRoute) as "auto" | "proxy" | "direct";
  const regionInfo = await detectRegion();
  const shouldUseProxy = chosen === "proxy" || (chosen === "auto" && regionInfo.region === "CN");
  const cleanCurrent = currentVersion.replace(/^v/, "").trim();
  const targetPlatform = getTargetPlatform(platformOverride);

  let tag = "";
  let body = "";
  let publishedAt = "";
  let htmlUrl = `https://github.com/${GITHUB_REPO}/releases`;
  let routeUsed = shouldUseProxy ? "proxy" : "direct";
  let rawAssets: any[] = [];

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
        signal: AbortSignal.timeout(3500),
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
          if (Array.isArray(item.assets)) {
            rawAssets = item.assets;
          }
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
          signal: AbortSignal.timeout(3500),
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

  const platformAsset = selectPlatformAsset(rawAssets, targetPlatform, shouldUseProxy, tag, cleanLatest);
  const allAssets = rawAssets.map((a) => {
    const rawUrl = a.browser_download_url || "";
    return {
      name: a.name,
      rawUrl,
      downloadUrl: shouldUseProxy && rawUrl ? `https://ghproxy.net/${rawUrl}` : rawUrl,
      size: a.size,
    };
  });

  const result: CheckReleaseResult = {
    hasUpdate,
    latestVersion: cleanLatest,
    currentVersion: cleanCurrent,
    releaseNotes: body || (hasUpdate ? "包含最新性能优化与功能更新。" : "当前运行版本已是最新。"),
    publishedAt,
    downloadUrl: htmlUrl,
    routeUsed,
    platformAsset,
    assets: allAssets,
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

export type DownloadState = {
  status: "idle" | "downloading" | "completed" | "error";
  downloaded: number;
  total: number;
  percent: number;
  speed: number;
  fileName: string;
  filePath: string;
  error?: string;
};

let currentDownloadState: DownloadState = {
  status: "idle",
  downloaded: 0,
  total: 0,
  percent: 0,
  speed: 0,
  fileName: "",
  filePath: "",
};

let activeDownloadController: AbortController | null = null;
let lastSpeedCalcTime = 0;
let lastDownloadedBytes = 0;

export async function startInstallerDownload(options?: {
  url?: string;
  fileName?: string;
  platform?: "windows" | "macos" | "linux";
  force?: boolean;
}): Promise<DownloadState> {
  const updatesDir = join(ROOT_DATA_DIR, "updates");
  if (!existsSync(updatesDir)) {
    mkdirSync(updatesDir, { recursive: true });
  }

  // 若当前正在下载且未强制重开，直接返回当前状态
  if (currentDownloadState.status === "downloading" && !options?.force) {
    return currentDownloadState;
  }

  // 取消正在进行的下载
  if (activeDownloadController) {
    activeDownloadController.abort();
    activeDownloadController = null;
  }

  let targetUrl = options?.url;
  let targetFileName = options?.fileName;
  let expectedSize = 0;

  if (!targetUrl || !targetFileName) {
    const releaseInfo = await checkLatestRelease("0.0.0", undefined, true, options?.platform);
    if (!releaseInfo.platformAsset) {
      throw new Error("未能找到适合当前操作系统的安装包资源");
    }
    targetUrl = releaseInfo.platformAsset.downloadUrl;
    targetFileName = releaseInfo.platformAsset.name;
    expectedSize = releaseInfo.platformAsset.size || 0;
  }

  const destinationPath = join(updatesDir, targetFileName);

  // 检查是否本地已经完整下载过（大小匹配）
  if (existsSync(destinationPath)) {
    try {
      const stat = statSync(destinationPath);
      if (
        (expectedSize > 0 && stat.size === expectedSize) ||
        (expectedSize === 0 && stat.size > 5 * 1024 * 1024)
      ) {
        currentDownloadState = {
          status: "completed",
          downloaded: stat.size,
          total: stat.size,
          percent: 100,
          speed: 0,
          fileName: targetFileName,
          filePath: destinationPath,
        };
        return currentDownloadState;
      }
    } catch {}
  }

  const tempFilePath = `${destinationPath}.download`;

  currentDownloadState = {
    status: "downloading",
    downloaded: 0,
    total: expectedSize,
    percent: 0,
    speed: 0,
    fileName: targetFileName,
    filePath: destinationPath,
    error: undefined,
  };

  const controller = new AbortController();
  activeDownloadController = controller;
  lastSpeedCalcTime = Date.now();
  lastDownloadedBytes = 0;

  // 异步后台拉取安装包
  (async () => {
    try {
      const urlsToTry: string[] = [];
      if (targetUrl.startsWith("http")) {
        urlsToTry.push(targetUrl);
      }

      // 如果有代理前缀，提炼原始 GitHub 地址作为后备
      const rawMatch = targetUrl.match(/https:\/\/github\.com\/.+$/);
      if (rawMatch && !urlsToTry.includes(rawMatch[0])) {
        urlsToTry.push(rawMatch[0]);
      } else if (targetUrl.startsWith("https://github.com/")) {
        // 如果是原始地址，提炼代理镜像前置优先尝试
        urlsToTry.unshift(`https://ghproxy.net/${targetUrl}`);
        urlsToTry.push(`https://mirror.ghproxy.com/${targetUrl}`);
      }

      let response: Response | null = null;

      for (const url of urlsToTry) {
        if (controller.signal.aborted) break;
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "PaceCraft-Updater/1.0",
            },
          });
          if (res.ok && res.body) {
            response = res;
            break;
          }
        } catch (e: any) {
          if (controller.signal.aborted) return;
          console.warn(`Fetch update from ${url} failed, trying next mirror:`, e?.message);
        }
      }

      if (!response || !response.body) {
        throw new Error("无法连接到安装包下载节点，请检查网络");
      }

      const contentLength = Number(response.headers.get("content-length")) || expectedSize || 0;
      currentDownloadState.total = contentLength;

      const reader = response.body.getReader();
      const fileStream = createWriteStream(tempFilePath);

      let downloaded = 0;

      while (true) {
        if (controller.signal.aborted) {
          fileStream.destroy();
          try {
            if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
          } catch {}
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          downloaded += value.length;
          fileStream.write(Buffer.from(value));

          const now = Date.now();
          const timeDiff = (now - lastSpeedCalcTime) / 1000;
          if (timeDiff >= 0.5) {
            const bytesDiff = downloaded - lastDownloadedBytes;
            currentDownloadState.speed = Math.round(bytesDiff / timeDiff);
            lastDownloadedBytes = downloaded;
            lastSpeedCalcTime = now;
          }

          currentDownloadState.downloaded = downloaded;
          if (contentLength > 0) {
            currentDownloadState.percent = Math.min(99, Math.round((downloaded / contentLength) * 100));
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end(() => resolve());
        fileStream.on("error", reject);
      });

      if (existsSync(destinationPath)) {
        try {
          unlinkSync(destinationPath);
        } catch {}
      }
      renameSync(tempFilePath, destinationPath);

      currentDownloadState.status = "completed";
      currentDownloadState.downloaded = downloaded;
      currentDownloadState.total = downloaded;
      currentDownloadState.percent = 100;
      currentDownloadState.speed = 0;
      currentDownloadState.filePath = destinationPath;
      activeDownloadController = null;
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.error("Installer download error:", err);
      try {
        if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
      } catch {}
      currentDownloadState.status = "error";
      currentDownloadState.error = err?.message || "下载中断，请重试";
      activeDownloadController = null;
    }
  })();

  return currentDownloadState;
}

export function getInstallerDownloadProgress(): DownloadState {
  return currentDownloadState;
}

export function cancelInstallerDownload(): boolean {
  if (activeDownloadController) {
    activeDownloadController.abort();
    activeDownloadController = null;
    currentDownloadState.status = "idle";
    return true;
  }
  return false;
}

export function launchInstaller(filePath?: string): { ok: boolean; message?: string } {
  const target = filePath || currentDownloadState.filePath;
  if (!target || !existsSync(target)) {
    return { ok: false, message: "安装包文件不存在，请重新下载" };
  }

  try {
    if (process.platform === "win32") {
      const escaped = target.replace(/'/g, "''");
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${escaped}'`],
        (err) => {
          if (err) {
            execFile("cmd", ["/c", "start", "", target]);
          }
        }
      );
      return { ok: true };
    } else if (process.platform === "darwin") {
      execFile("open", [target], (err) => {
        if (err) console.warn("Failed to open DMG:", err);
      });
      return { ok: true };
    } else {
      execFile("xdg-open", [target], (err) => {
        if (err) console.warn("Failed to xdg-open installer:", err);
      });
      return { ok: true };
    }
  } catch (err: any) {
    return { ok: false, message: err?.message || "启动安装程序失败" };
  }
}

export function openContainingFolder(filePath?: string): { ok: boolean; message?: string } {
  const target = filePath || currentDownloadState.filePath;
  if (!target || !existsSync(target)) {
    return { ok: false, message: "文件不存在" };
  }

  try {
    if (process.platform === "win32") {
      execFile("explorer.exe", [`/select,${target}`]);
      return { ok: true };
    } else if (process.platform === "darwin") {
      execFile("open", ["-R", target]);
      return { ok: true };
    } else {
      execFile("xdg-open", [dirname(target)]);
      return { ok: true };
    }
  } catch (err: any) {
    return { ok: false, message: err?.message || "打开所在文件夹失败" };
  }
}
