import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { REDIRECT_PORT } from "../config.ts";
import {
  buildAuthorizeUrl,
  clearTokens,
  createPkce,
  exchangeCode,
  loadTokens,
  registerClient,
  saveTokens,
  type AccountMismatchInfo,
} from "./oauth.ts";
import { callTool } from "./mcp.ts";
import { upsertUserProfile } from "./user-profile.ts";
import { sqlite, switchProfileDatabase } from "../db/client.ts";
import { users } from "../db/schema.ts";
import {
  getActiveProfileId,
  setActiveProfileId,
  createNewProfile,
  updateProfileMeta,
  getProfileTokenPath,
  getProfileDbPath,
} from "../profile-manager.ts";

let activeServer: Server | null = null;
let activeTimer: Timer | null = null;
let lastBackendOpenTime = 0;
let lastBackendOpenUrl = "";

export function openExternalUrl(url: string) {
  if (!url) return;
  const now = Date.now();
  if (url === lastBackendOpenUrl && now - lastBackendOpenTime < 1200) {
    return;
  }
  lastBackendOpenTime = now;
  lastBackendOpenUrl = url;

  try {
    if (process.platform === "darwin") {
      const openBin = existsSync("/usr/bin/open") ? "/usr/bin/open" : "open";
      execFile(openBin, [url], (err) => {
        if (err) console.warn("macOS openExternalUrl error:", err);
      });
    } else if (process.platform === "win32") {
      // 在 Windows 下避免使用 cmd /c（cmd 会把 & 识别为命令分隔符导致 URL 查询参数被截断）
      // 使用 PowerShell 的 Start-Process，用单引号字面量传参，100% 完整保留所有 query 参数
      const escaped = url.replace(/'/g, "''");
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${escaped}'`],
        (err) => {
          if (err) {
            // 兜底：使用 rundll32 url.dll,FileProtocolHandler
            execFile("rundll32", ["url.dll,FileProtocolHandler", url]);
          }
        },
      );
    } else {
      execFile("xdg-open", [url]);
    }
  } catch (err) {
    console.warn("自动调起默认浏览器失败:", err);
  }
}

export async function cancelAuthFlow(): Promise<{ ok: boolean }> {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (activeServer) {
    const s = activeServer;
    activeServer = null;
    try {
      s.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
        setTimeout(resolve, 300);
      });
    } catch {}
  }
  return { ok: true };
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type AuthStatus = {
  connected: boolean;
  nickname: string | null;
  expiresAt: number | null;
  expired: boolean;
  mismatch?: AccountMismatchInfo | null;
};

export function getAuthStatus(): AuthStatus {
  const tokens = loadTokens();
  if (!tokens || !tokens.accessToken) {
    return {
      connected: false,
      nickname: null,
      expiresAt: null,
      expired: false,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const expired = Boolean(tokens.expiresAt && tokens.expiresAt <= now);

  let nickname: string | null = null;
  try {
    const userRow = sqlite.query("SELECT nickname FROM users LIMIT 1").get() as { nickname: string | null } | null;
    if (userRow?.nickname) {
      nickname = userRow.nickname;
    }
  } catch {
    // 忽略数据库查询偶发异常
  }

  return {
    connected: true,
    nickname: tokens.mismatch ? tokens.mismatch.incomingNickname : nickname,
    expiresAt: tokens.expiresAt ?? null,
    expired,
    mismatch: tokens.mismatch ?? null,
  };
}

export async function disconnectAuth(): Promise<{ ok: boolean }> {
  clearTokens();
  await cancelAuthFlow();
  try {
    updateProfileMeta(getActiveProfileId(), { nickname: null });
  } catch {}
  return { ok: true };
}

export async function startAuthFlow(): Promise<{ authorizeUrl: string }> {
  // 1. 如果已有等待中的回调服务，先行清理并等待彻底释放端口
  await cancelAuthFlow();

  // 2. 动态注册客户端与准备 PKCE
  const { clientId } = await registerClient();
  const { verifier, challenge } = createPkce();
  const state = b64url(randomBytes(16));
  const authorizeUrl = await buildAuthorizeUrl(clientId, challenge, state);

  // 3. 在 43123 启动临时回调服务
  const TIMEOUT_MS = 5 * 60 * 1000;

  activeServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${REDIRECT_PORT}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end("Not Found");
      return;
    }

    const err = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const gotState = url.searchParams.get("state");

    const renderHtml = (ok: boolean, title: string, desc: string) => {
      const color = ok ? "#10b981" : "#ef4444";
      const icon = ok ? "✓" : "✗";
      return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>COROS 授权 - ${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 36px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${color}20;
      color: ${color};
      font-size: 28px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    h2 { margin: 0 0 10px 0; font-size: 22px; font-weight: 600; }
    p { margin: 0 0 20px 0; color: #94a3b8; font-size: 14px; line-height: 1.6; }
    .btn {
      display: inline-block;
      background: #2563eb;
      color: #fff;
      padding: 10px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${icon}</div>
    <h2>${title}</h2>
    <p>${desc}</p>
    ${ok ? '<p style="color:#64748b;font-size:12px;">窗口即将自动关闭，或可直接切换回应用</p>' : ''}
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'COROS_AUTH_RESULT', ok: ${ok} }, '*');
    }
    ${ok ? "setTimeout(() => { window.close(); }, 2500);" : ""}
  </script>
</body>
</html>`;
    };

    if (err || gotState !== state || !code) {
      const msg = err ? `COROS 返回错误：${err}` : (gotState !== state ? "安全校验 state 不匹配，请重试" : "缺少授权码");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtml(false, "授权未完成", msg));
      return;
    }

    try {
      const tokens = await exchangeCode(clientId, code, verifier);

      // 尝试静默拉取用户基本信息存入 users 表
      try {
        const raw = await callTool("queryUserInfo", {});
        const nick = (raw.match(/Nickname:\s*(.+)/)?.[1] ?? "").replace(/["'\s]+"?\s*$/, "") || null;

        // 检查本档案是否已有历史运动数据和不同的跑友记录（防串号数据隔离）
        const existingUser = sqlite.query("SELECT nickname FROM users LIMIT 1").get() as { nickname: string | null } | null;
        const existingCount = (sqlite.query("SELECT count(*) as c FROM activities").get() as { c: number } | null)?.c ?? 0;
        const existingNick = existingUser?.nickname;

        if (existingNick && nick && existingNick !== nick && existingCount > 0) {
          // 账号不一致且已有数据！记录待处理 mismatch，不直接覆盖旧数据
          tokens.mismatch = {
            existingNickname: existingNick,
            incomingNickname: nick,
            activityCount: existingCount,
            rawUserInfo: raw,
          };
          saveTokens(tokens);
        } else {
          // 账号一致（或本档案无历史运动记录），直接保存并写入
          delete tokens.mismatch;
          saveTokens(tokens);

          const finalNick = upsertUserProfile(raw, nick);
          if (finalNick) {
            try {
              updateProfileMeta(getActiveProfileId(), { nickname: finalNick });
            } catch {}
          }
        }
      } catch (profileErr) {
        saveTokens(tokens);
        console.warn("拉取用户昵称失败（不影响主授权）:", profileErr);
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtml(true, "已成功连接 COROS", "授权凭证已安全保存在本地。现在可以返回训练看板开始使用了！"));
    } catch (exchangeErr) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtml(false, "换取 Token 失败", (exchangeErr as Error).message));
    } finally {
      if (activeTimer) clearTimeout(activeTimer);
      activeTimer = null;
      if (activeServer) {
        const s = activeServer;
        activeServer = null;
        try {
          s.closeAllConnections?.();
          s.close();
        } catch {}
      }
    }
  });

  activeTimer = setTimeout(() => {
    cancelAuthFlow();
  }, TIMEOUT_MS);

  // 带重试机制的端口监听（防止系统 socket 处于 TIME_WAIT 状态时偶发 EADDRINUSE）
  let lastErr: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onErr = (e: any) => reject(e);
        activeServer!.once("error", onErr);
        activeServer!.listen(REDIRECT_PORT, "127.0.0.1", () => {
          activeServer!.removeListener("error", onErr);
          resolve();
        });
      });
      lastErr = null;
      break;
    } catch (e: any) {
      lastErr = e;
      const isPortInUse =
        e.code === "EADDRINUSE" ||
        (typeof e.message === "string" && e.message.includes("in use"));
      if (isPortInUse && attempt < 4) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw e;
    }
  }
  if (lastErr) throw lastErr;

  // 在系统默认浏览器中自动调起 COROS 官方授权页面
  openExternalUrl(authorizeUrl);

  return { authorizeUrl };
}

export function resolveAccountMismatch(action: "create_new" | "overwrite" | "merge"): {
  ok: boolean;
  activeId: string;
} {
  const tokens = loadTokens();
  if (!tokens || !tokens.mismatch) {
    throw new Error("当前档案并无待处理的账号不一致问题");
  }

  const { incomingNickname, rawUserInfo } = tokens.mismatch;
  const currentProfileId = getActiveProfileId();

  if (action === "create_new") {
    // 0. 读取原档案的 AI 配置与运动白名单配置，以便新档案继承
    let aiRow: any = null;
    let syncRow: any = null;
    try {
      aiRow = sqlite.query("SELECT * FROM ai_settings WHERE id = 1 LIMIT 1").get();
      syncRow = sqlite.query("SELECT * FROM sync_settings WHERE id = 1 LIMIT 1").get();
    } catch {}

    // 1. 为新授权账号自动建立独立档案
    const newProfile = createNewProfile(incomingNickname);

    // 2. 将 token（剥离 mismatch 标记）迁移至新档案
    const cleanTokens = { ...tokens };
    delete cleanTokens.mismatch;
    const newTokenPath = getProfileTokenPath(newProfile.id);
    writeFileSync(newTokenPath, JSON.stringify(cleanTokens, null, 2), { mode: 0o600 });

    // 3. 原档案解除待处理授权，保留所有原有历史数据
    clearTokens();

    // 4. 切换到新档案及其独立数据库
    setActiveProfileId(newProfile.id);
    switchProfileDatabase(getProfileDbPath(newProfile.id));

    // 5. 继承原档案的 AI 配置与运动类型设置（实现开箱即用）
    try {
      if (aiRow) {
        sqlite.query(`
          INSERT INTO ai_settings (id, provider, base_url, api_key, model, temperature, max_tokens, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            model = excluded.model,
            temperature = excluded.temperature,
            max_tokens = excluded.max_tokens,
            updated_at = unixepoch()
        `).run(aiRow.provider, aiRow.base_url, aiRow.api_key, aiRow.model, aiRow.temperature, aiRow.max_tokens);
      }
      if (syncRow) {
        sqlite.query(`
          INSERT INTO sync_settings (id, sport_type_codes, updated_at)
          VALUES (1, ?, unixepoch())
          ON CONFLICT(id) DO UPDATE SET
            sport_type_codes = excluded.sport_type_codes,
            updated_at = unixepoch()
        `).run(syncRow.sport_type_codes);
      }
    } catch {}

    // 6. 初始化新档案的 users 表与元信息
    if (rawUserInfo) {
      const finalNick = upsertUserProfile(rawUserInfo, incomingNickname);
      updateProfileMeta(newProfile.id, { nickname: finalNick ?? incomingNickname });
    }

    return { ok: true, activeId: newProfile.id };
  }

  if (action === "overwrite") {
    // 抹除当前档案的历史训练数据
    const tables = [
      "activities", "activity_details", "laps", "training_load",
      "daily_health", "sleep", "heart_rate", "stress",
      "fitness", "recovery", "ai_reports", "ai_session_reports",
      "ai_week_reports", "ai_chat", "sync_log", "fit_quota", "scheduled_workouts", "users"
    ];
    sqlite.transaction(() => {
      for (const table of tables) {
        try {
          sqlite.query(`DELETE FROM ${table}`).run();
        } catch {}
      }
    })();

    if (rawUserInfo) {
      upsertUserProfile(rawUserInfo, incomingNickname);
    }
    updateProfileMeta(currentProfileId, { nickname: incomingNickname });

    const cleanTokens = { ...tokens };
    delete cleanTokens.mismatch;
    saveTokens(cleanTokens);

    return { ok: true, activeId: currentProfileId };
  }

  if (action === "merge") {
    if (rawUserInfo) {
      upsertUserProfile(rawUserInfo, incomingNickname);
    }
    updateProfileMeta(currentProfileId, { nickname: incomingNickname });

    const cleanTokens = { ...tokens };
    delete cleanTokens.mismatch;
    saveTokens(cleanTokens);

    return { ok: true, activeId: currentProfileId };
  }

  throw new Error(`未知操作: ${action}`);
}
