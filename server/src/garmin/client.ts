import { inflateRawSync } from "node:zlib";
import { getGarminAccessToken, getGarminHost } from "./auth.ts";
import type { GarminActivitySummary } from "./types.ts";

/**
 * 从 Garmin ZIP 响应中提取 .fit 文件内容（读取 Central Directory，支持流式 Data Descriptor）
 */
export function extractFitFromZip(zipBuffer: Buffer): Buffer | null {
  // 查找 End of Central Directory (EOCD): 0x06054b50 (PK\x05\x06)
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = zipBuffer.lastIndexOf(eocdSignature);
  if (eocdOffset === -1) return null;

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(p) !== 0x02014b50) break;

    const compression = zipBuffer.readUInt16LE(p + 10);
    const compSize = zipBuffer.readUInt32LE(p + 20);
    const fnLen = zipBuffer.readUInt16LE(p + 28);
    const extraLen = zipBuffer.readUInt16LE(p + 30);
    const commentLen = zipBuffer.readUInt16LE(p + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(p + 42);
    const fileName = zipBuffer.subarray(p + 46, p + 46 + fnLen).toString("utf8");

    // 定位本地文件数据偏移
    const localFnLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFnLen + localExtraLen;
    const compressedData = zipBuffer.subarray(dataStart, dataStart + compSize);

    if (fileName.toLowerCase().endsWith(".fit")) {
      if (compression === 0) {
        return Buffer.from(compressedData);
      } else if (compression === 8) {
        return inflateRawSync(compressedData);
      }
    }

    p += 46 + fnLen + extraLen + commentLen;
  }
  return null;
}

export async function garminFetch(
  path: string,
  options: RequestInit = {},
  preferredRegion?: GarminRegion,
): Promise<Response> {
  const { token, region } = await getGarminAccessToken(preferredRegion);
  const host = getGarminHost(region);
  const url = `${host}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json, text/plain, */*");
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  return res;
}

/**
 * Garmin 官方 API 单次查询最大只允许 limit <= 50，超过 50 会直接报 500 Internal Server Error。
 */
export async function searchGarminActivities(
  limit = 25,
  start = 0,
  region?: GarminRegion,
): Promise<GarminActivitySummary[]> {
  const safeLimit = Math.min(Math.max(1, limit), 50);
  const res = await garminFetch(
    `/activitylist-service/activities/search/activities?limit=${safeLimit}&start=${start}`,
    {},
    region,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Garmin 活动列表获取失败 (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as GarminActivitySummary[];
}

export type FetchGarminOptions = {
  region?: GarminRegion;
  maxTotal?: number;
  onBatch?: (count: number) => void;
  stopWhenExists?: (activityId: number | string) => boolean;
};

/**
 * 自动分页抓取 Garmin 活动：
 * - 规避单次请求 limit > 50 导致的 500 错误
 * - 支持 stopWhenExists 智能早停（增量同步时遇到本地已有记录立即停止翻页，1秒完成）
 */
export async function fetchAllGarminActivities(
  opts: number | FetchGarminOptions = 100,
  legacyOnBatch?: (count: number) => void,
): Promise<GarminActivitySummary[]> {
  const options: FetchGarminOptions =
    typeof opts === "number" ? { maxTotal: opts, onBatch: legacyOnBatch } : opts;

  const maxTotal = options.maxTotal ?? 100;
  const region = options.region;
  const onBatch = options.onBatch;
  const stopWhenExists = options.stopWhenExists;
  const batchSize = 25; // 采用 25 每页，平稳安全
  const results: GarminActivitySummary[] = [];
  let start = 0;

  while (results.length < maxTotal) {
    const fetchLimit = Math.min(batchSize, maxTotal - results.length);
    const batch = await searchGarminActivities(fetchLimit, start, region);
    if (!batch || batch.length === 0) break;

    let hitExisting = false;
    for (const act of batch) {
      if (stopWhenExists && stopWhenExists(act.activityId)) {
        hitExisting = true;
        break;
      }
      results.push(act);
    }

    onBatch?.(results.length);
    if (hitExisting || batch.length < fetchLimit) break;
    start += batch.length;
    // 页面间微小间隔，避免触发网关频率保护
    await new Promise((r) => setTimeout(r, 120));
  }

  return results;
}

/**
 * 下载 Garmin 原始 .FIT 文件，带有网络断开重试与异常容错
 */
export async function downloadGarminFit(
  activityId: number | string,
  region?: GarminRegion,
  retries = 2,
): Promise<Buffer | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await garminFetch(`/download-service/files/activity/${activityId}`, {}, region);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Garmin FIT 下载失败 (${res.status})`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuffer);

      // 如果直接是 FIT 文件（头部通常为 0x0E ... .FIT）
      if (zipBuffer.length > 14 && zipBuffer.subarray(8, 12).toString("ascii") === ".FIT") {
        return zipBuffer;
      }

      // 从 ZIP 中解压出 .fit
      return extractFitFromZip(zipBuffer);
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  return null;
}
