import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces, hostname } from "node:os";
import { ROOT_DATA_DIR } from "./profile-manager.ts";
import { SERVER_PORT } from "./config.ts";

const SETTINGS_FILE = join(ROOT_DATA_DIR, "lan_settings.json");

export type LanSettings = {
  enabled: boolean;
  port?: number;
};

export type LanStatus = {
  enabled: boolean;
  port: number;
  primaryIp: string | null;
  url: string | null;
  allIps: { name: string; ip: string }[];
  hostName: string;
};

// 内存态配置缓存
let currentEnabled: boolean = (() => {
  // 1. 显式环境变量优先
  if (process.env.HOST === "0.0.0.0" || process.env.LAN_ENABLED === "1") {
    return true;
  }
  // 2. 检查本地持久化设置
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
      return Boolean(data.enabled);
    }
  } catch (err) {
    console.warn("[LAN] 读取网络设置失败，回退默认设置:", err);
  }
  return false;
})();

export function isLanEnabled(): boolean {
  return currentEnabled;
}

export function setLanEnabled(enabled: boolean): LanStatus {
  currentEnabled = enabled;
  try {
    if (!existsSync(ROOT_DATA_DIR)) {
      mkdirSync(ROOT_DATA_DIR, { recursive: true, mode: 0o700 });
    }
    const data: LanSettings = { enabled };
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[LAN] 保存局域网设置失败:", err);
  }
  return getLanStatus();
}

/** 判断请求来源是否为本地回环 */
export function isLoopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const clean = addr.trim().toLowerCase();
  return (
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean === "::ffff:127.0.0.1" ||
    clean === "localhost"
  );
}

/** 获取本机局域网可访问的 IPv4 地址列表（自动过滤 VPN、代理及虚拟网卡） */
export function getLocalIpv4Addresses(): { name: string; ip: string }[] {
  const nets = networkInterfaces();
  const allNonInternal: { name: string; ip: string }[] = [];

  for (const [name, netList] of Object.entries(nets)) {
    if (!netList) continue;
    for (const net of netList) {
      // 必须是 IPv4 且非回环
      const isIpv4 = net.family === "IPv4" || (net as any).family === 4;
      if (isIpv4 && !net.internal) {
        allNonInternal.push({ name, ip: net.address });
      }
    }
  }

  // 严格过滤 VPN、代理与虚拟隧道网卡（如 utun, awdl, docker, tailscale, tun, tap 等）
  const isVirtual = (name: string) =>
    /^(utun|awdl|llw|docker|tailscale|virbr|veth|tun|tap|bridge|gif|stf|vboxnet)/i.test(name);

  const physicalOnly = allNonInternal.filter((n) => !isVirtual(n.name));

  // 优先仅返回物理网卡；只有在万一没有任何物理网卡时才兜底展示
  const candidateList = physicalOnly.length > 0 ? physicalOnly : allNonInternal;

  // 排序：Wi-Fi 与以太网优先（en*, eth*, wlan*）
  return candidateList.sort((a, b) => {
    const isPhysicalA = /^(en|eth|wlan|wi-fi|ethernet)/i.test(a.name);
    const isPhysicalB = /^(en|eth|wlan|wi-fi|ethernet)/i.test(b.name);
    if (isPhysicalA !== isPhysicalB) return isPhysicalA ? -1 : 1;

    return a.name.localeCompare(b.name);
  });
}

/** 获取局域网完整状态 */
export function getLanStatus(): LanStatus {
  const allIps = getLocalIpv4Addresses();
  const primary = allIps[0]?.ip ?? null;
  const port = SERVER_PORT;
  const url = primary ? `http://${primary}:${port}` : null;

  return {
    enabled: currentEnabled,
    port,
    primaryIp: primary,
    url,
    allIps,
    hostName: hostname(),
  };
}
