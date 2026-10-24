import { homedir } from "node:os";
import { join } from "node:path";
import { getProfileDbPath, getProfileDir, getProfileTokenPath, ROOT_DATA_DIR } from "./profile-manager.ts";

/**
 * 显式锁定中国区 issuer。
 * 网关 https://mcp.coros.com 会按出口 IP 猜集群（实测从本机解析到 EU），
 * 账号是 trainingcn 的就必须走 mcpcn，否则 token 与数据都对不上。
 */
export const ISSUER = process.env.COROS_ISSUER ?? "https://mcpcn.coros.com";
export const MCP_URL = process.env.COROS_MCP_URL ?? `${ISSUER}/mcp`;

export const SCOPES = "openid offline_access mcp.tools";
// OAuth 客户端名。COROS 侧按「客户端名 + 回调地址」识别授权来源，
// 写具体人名没有意义，反而让开源实例看起来像某个人的私有应用。
export const CLIENT_NAME = "COROS Local Dashboard";
export const REDIRECT_PORT = Number(process.env.COROS_REDIRECT_PORT ?? 43123);
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

export const BASE_DATA_DIR = ROOT_DATA_DIR;

/** 动态获取当前跑友档案的目录与文件路径 */
export const getDataDir = () => getProfileDir();
export const getDbPath = () => getProfileDbPath();
export const getTokenPath = () => getProfileTokenPath();

/** 兼容旧代码引用常量：每次访问自动动态获取当前档案路径 */
export const DATA_DIR = {
  toString: () => getProfileDir(),
  [Symbol.toPrimitive]: () => getProfileDir(),
} as unknown as string;

export const DB_PATH = {
  toString: () => getProfileDbPath(),
  [Symbol.toPrimitive]: () => getProfileDbPath(),
} as unknown as string;

export const TOKEN_PATH = {
  toString: () => getProfileTokenPath(),
  [Symbol.toPrimitive]: () => getProfileTokenPath(),
} as unknown as string;

export const SERVER_PORT = Number(process.env.PORT ?? 43124);
/**
 * 监听地址。默认只绑回环 —— 本服务没有任何鉴权，
 * 绑 0.0.0.0 等于把全部训练数据暴露给同一个网络里的任何设备。
 * 需要局域网访问时用 HOST=0.0.0.0 显式打开。
 */
export const SERVER_HOST = process.env.HOST ?? "127.0.0.1";
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:43125";

/** token 剩余寿命低于这个秒数就提前刷新，避免请求打到一半过期 */
export const TOKEN_REFRESH_MARGIN_SEC = 120;

/** 官方限制：FIT 下载 + 下载链接查询共用 50 个 / 24 小时 */
export const FIT_DAILY_LIMIT = 50;
