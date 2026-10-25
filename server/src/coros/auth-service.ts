import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { REDIRECT_PORT } from "../config.ts";
import {
  buildAuthorizeUrl,
  clearTokens,
  createPkce,
  exchangeCode,
  loadTokens,
  registerClient,
  saveTokens,
} from "./oauth.ts";
import { callTool } from "./mcp.ts";
import { sqlite } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { getActiveProfileId, updateProfileMeta } from "../profile-manager.ts";

let activeServer: Server | null = null;
let activeTimer: Timer | null = null;

export function openExternalUrl(url: string) {
  try {
    if (process.platform === "darwin") {
      execFile("open", [url]);
    } else if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url]);
    } else {
      execFile("xdg-open", [url]);
    }
  } catch (err) {
    console.warn("自动调起默认浏览器失败:", err);
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type AuthStatus = {
  connected: boolean;
  nickname: string | null;
  expiresAt: number | null;
  expired: boolean;
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
    nickname,
    expiresAt: tokens.expiresAt ?? null,
    expired,
  };
}

export function disconnectAuth(): { ok: boolean } {
  clearTokens();
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (activeServer) {
    try {
      activeServer.close();
    } catch {}
    activeServer = null;
  }
  return { ok: true };
}

export async function startAuthFlow(): Promise<{ authorizeUrl: string }> {
  // 1. 如果已有等待中的回调服务，先行清理
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (activeServer) {
    try {
      activeServer.close();
    } catch {}
    activeServer = null;
  }

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
      saveTokens(tokens);

      // 尝试静默拉取用户基本信息存入 users 表
      try {
        const raw = await callTool("queryUserInfo", {});
        const num = (re: RegExp) => Number(raw.match(re)?.[1] ?? NaN);
        sqlite.query(`
          INSERT INTO users (height_cm, weight_kg, birthday, gender, nickname, raw)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(nickname) DO UPDATE SET
            height_cm = excluded.height_cm,
            weight_kg = excluded.weight_kg,
            birthday  = excluded.birthday,
            gender    = excluded.gender,
            raw       = excluded.raw
        `).run(
          num(/Height:\s*([\d.]+)/), num(/Weight:\s*([\d.]+)/),
          raw.match(/Birthday:\s*(\S+)/)?.[1] ?? null,
          raw.match(/Gender:\s*(\w+)/)?.[1] ?? null,
          (raw.match(/Nickname:\s*(.+)/)?.[1] ?? "").replace(/["'\s]+"?\s*$/, "") || null,
          raw,
        );

        const nick = (raw.match(/Nickname:\s*(.+)/)?.[1] ?? "").replace(/["'\s]+"?\s*$/, "") || null;
        if (nick) {
          try {
            updateProfileMeta(getActiveProfileId(), { nickname: nick, name: nick });
          } catch {}
        }
      } catch (profileErr) {
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
        activeServer.close();
        activeServer = null;
      }
    }
  });

  activeTimer = setTimeout(() => {
    if (activeServer) {
      activeServer.close();
      activeServer = null;
    }
    activeTimer = null;
  }, TIMEOUT_MS);

  await new Promise<void>((resolve, reject) => {
    activeServer?.listen(REDIRECT_PORT, "127.0.0.1", () => resolve());
    activeServer?.on("error", (e) => reject(e));
  });

  // 在系统默认浏览器中自动调起 COROS 官方授权页面
  openExternalUrl(authorizeUrl);

  return { authorizeUrl };
}
