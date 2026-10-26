import { MCP_URL } from "../config.ts";
import { getAccessToken } from "./oauth.ts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
  }
}

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

let nextId = 1;

function headers(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
}

/**
 * COROS 走的是 stateless 流：没有 Mcp-Session-Id，也不发 notifications/initialized。
 * 每个请求自带 Bearer token，响应可能是纯 JSON，也可能是 SSE 单事件。
 */
function parseBody(text: string, contentType: string | null): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (contentType?.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const dataLines = trimmed
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const last = dataLines[dataLines.length - 1];
    if (!last) throw new McpError("SSE response contained no data lines");
    return JSON.parse(last);
  }
  return JSON.parse(trimmed);
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const accessToken = await getAccessToken();
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params,
    }),
  });

  const text = await res.text();
  let payload: any;
  try {
    payload = parseBody(text, res.headers.get("content-type"));
  } catch (err) {
    throw new McpError(`failed to parse ${method} response (HTTP ${res.status})`, text.slice(0, 500));
  }

  if (!res.ok) throw new McpError(`${method} failed: HTTP ${res.status}`, payload);
  if (payload?.error) throw new McpError(`${method} failed: ${payload.error.message ?? "unknown"}`, payload.error);

  const result = payload?.result;
  if (typeof result !== "object" || result === null) {
    throw new McpError(`${method} returned no result`, payload);
  }
  return result as Record<string, unknown>;
}

export async function initialize() {
  return rpc("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "coros-dashboard", version: "0.1.0" },
  });
}

let toolCatalog: McpTool[] | null = null;

export async function listTools(force = false): Promise<McpTool[]> {
  if (toolCatalog && !force) return toolCatalog;

  await initialize();
  const tools: McpTool[] = [];
  let cursor: string | undefined;

  do {
    const result = await rpc("tools/list", cursor ? { cursor } : {});
    const page = Array.isArray(result.tools) ? (result.tools as McpTool[]) : [];
    tools.push(...page);
    cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
  } while (cursor);

  toolCatalog = tools;
  return tools;
}

export function invalidateToolCache() {
  toolCatalog = null;
}

/** 调一个 MCP 工具，返回其 content 拼接后的文本（多数工具返回 JSON 字符串）。 */
export async function callTool(name: string, args: Record<string, unknown> = {}, maxRetries = 2): Promise<string> {
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await rpc("tools/call", { name, arguments: args });
    if (result.isError) {
      throw new McpError(`tool ${name} returned isError`, result.content);
    }
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    
    // 如果命中高驰官方 API 偶发临时限流/不可用，自动退避重试
    if (text.includes("COROS API is temporarily unavailable") && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    return text;
  }
  return lastText;
}

/** 工具返回的通常是 JSON 文本，尽力解析，失败就原样返回。 */
export async function callToolJson<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const text = await callTool(name, args);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function describeTool(name: string): Promise<McpTool | undefined> {
  return (await listTools()).find((t) => t.name === name);
}
