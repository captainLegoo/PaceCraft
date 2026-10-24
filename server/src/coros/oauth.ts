import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CLIENT_NAME,
  getDataDir,
  getTokenPath,
  ISSUER,
  REDIRECT_PORT,
  REDIRECT_URI,
  SCOPES,
  TOKEN_REFRESH_MARGIN_SEC,
} from "../config.ts";

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number; // epoch seconds
  scope?: string;
  clientId?: string;
  issuer: string;
};

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  end_session_endpoint?: string;
};

export class OAuthError extends Error {}

let discoveryCache: Discovery | null = null;

export async function discover(force = false): Promise<Discovery> {
  if (discoveryCache && !force) return discoveryCache;
  const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!res.ok) throw new OAuthError(`discovery failed: ${res.status}`);
  const body = (await res.json()) as Discovery;
  if (!body.authorization_endpoint || !body.token_endpoint) {
    throw new OAuthError("discovery response missing OAuth endpoints");
  }
  discoveryCache = body;
  return body;
}

// ---------- token persistence ----------

function ensureDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function saveTokens(tokens: TokenSet) {
  ensureDir();
  const tokenPath = getTokenPath();
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

export function loadTokens(): TokenSet | null {
  const tokenPath = getTokenPath();
  if (!existsSync(tokenPath)) return null;
  try {
    return JSON.parse(readFileSync(tokenPath, "utf8")) as TokenSet;
  } catch {
    return null;
  }
}

export function clearTokens() {
  const tokenPath = getTokenPath();
  if (existsSync(tokenPath)) writeFileSync(tokenPath, "{}", { mode: 0o600 });
}

// ---------- PKCE ----------

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---------- dynamic client registration ----------

export type ClientRegistration = { clientId: string; registeredAt: number };

export async function registerClient(): Promise<ClientRegistration> {
  const res = await fetch(`${ISSUER}/connect/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });
  if (!res.ok) {
    throw new OAuthError(`client registration failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new OAuthError("client registration response missing client_id");
  return { clientId: body.client_id, registeredAt: Math.floor(Date.now() / 1000) };
}

// ---------- authorization code flow ----------

export async function buildAuthorizeUrl(clientId: string, challenge: string, state: string) {
  const { authorization_endpoint } = await discover();
  const url = new URL(authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(clientId: string, code: string, verifier: string) {
  const { token_endpoint } = await discover();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // 绝不能把 token/错误详情里的敏感串打出来
    throw new OAuthError(`token exchange failed: ${res.status} ${String(body.error ?? "unknown")}`);
  }
  return toTokenSet(body, clientId);
}

export async function refreshTokens(current: TokenSet): Promise<TokenSet> {
  if (!current.refreshToken) throw new OAuthError("no refresh_token available, please login again");
  const { token_endpoint } = await discover();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: current.clientId ?? "",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new OAuthError(`token refresh failed: ${res.status} ${String(body.error ?? "unknown")}`);
  }
  const next = toTokenSet(body, current.clientId);
  // 服务端有时不返回新的 refresh_token，必须沿用旧的
  next.refreshToken = next.refreshToken ?? current.refreshToken;
  return next;
}

function toTokenSet(body: Record<string, unknown>, clientId?: string): TokenSet {
  const accessToken = body.access_token;
  if (typeof accessToken !== "string") throw new OAuthError("token response missing access_token");
  const expiresIn = Number(body.expires_in ?? 3600);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    expiresAt: Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 3600),
    scope: typeof body.scope === "string" ? body.scope : undefined,
    clientId,
    issuer: ISSUER,
  };
}

// ---------- the one call everything else goes through ----------

let inflightRefresh: Promise<TokenSet> | null = null;

/** 返回一个保证未过期的 access token；必要时静默刷新。 */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new OAuthError("not connected to COROS, run: bun run auth");

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt - now > TOKEN_REFRESH_MARGIN_SEC) return tokens.accessToken;

  if (!inflightRefresh) {
    inflightRefresh = refreshTokens(tokens)
      .then((next) => {
        saveTokens(next);
        return next;
      })
      .finally(() => {
        inflightRefresh = null;
      });
  }
  return (await inflightRefresh).accessToken;
}

export { REDIRECT_PORT, REDIRECT_URI };
