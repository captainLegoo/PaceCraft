import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { REDIRECT_PORT } from "../config.ts";
import {
  buildAuthorizeUrl,
  clearTokens,
  createPkce,
  exchangeCode,
  loadTokens,
  registerClient,
  saveTokens,
} from "../coros/oauth.ts";
import { callToolJson, listTools } from "../coros/mcp.ts";

const TIMEOUT_MS = 5 * 60 * 1000;

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function waitForCode(state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for COROS login"));
    }, TIMEOUT_MS);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${REDIRECT_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }

      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");

      const finish = (ok: boolean, message: string) => {
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>COROS</title>` +
            `<body style="font-family:system-ui;padding:40px;text-align:center">` +
            `<h2>${ok ? "✅ 已连接 COROS" : "❌ 授权失败"}</h2>` +
            `<p>${message}</p>` +
            `<p style="color:#888">可以关闭这个标签页了。</p></body>`,
        );
        clearTimeout(timer);
        server.close();
        ok ? resolve(code!) : reject(new Error(message));
      };

      if (err) return finish(false, `COROS 返回错误：${err}`);
      if (gotState !== state) return finish(false, "state 校验失败，请重新发起登录");
      if (!code) return finish(false, "回调中没有授权码");
      finish(true, "授权成功，token 已保存到本地。");
    });

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      console.log(`\n  回调服务已启动：http://127.0.0.1:${REDIRECT_PORT}/callback`);
    });
    server.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `无法监听端口 ${REDIRECT_PORT}：${(e as Error).message}\n` +
            `换个端口重试：COROS_REDIRECT_PORT=43130 bun run auth`,
        ),
      );
    });
  });
}

async function main() {
  console.log("→ 注册 OAuth 客户端（动态注册，无需审批）…");
  const { clientId } = await registerClient();
  console.log(`  client_id: ${clientId}`);

  const { verifier, challenge } = createPkce();
  const state = b64url(randomBytes(16));
  const authorizeUrl = await buildAuthorizeUrl(clientId, challenge, state);

  console.log("\n" + "=".repeat(72));
  console.log("  在浏览器里打开下面这个链接，登录并授权：");
  console.log("=".repeat(72));
  console.log(`\n  ${authorizeUrl}\n`);
  console.log("  授权完成后会自动跳回来，不用手动操作。等待中…\n");

  const code = await waitForCode(state);
  console.log("→ 收到授权码，换取 token…");
  const tokens = await exchangeCode(clientId, code, verifier);
  saveTokens(tokens);

  console.log("\n✅ 授权成功。token 已保存（有效期至 " + new Date(tokens.expiresAt * 1000).toLocaleString("zh-CN") + "）");

  // 冒烟测试：确认这个 token 真的能读到数据
  console.log("→ 冒烟测试…");
  const me = await callToolJson("queryUserInfo", {});
  console.log("  queryUserInfo:", JSON.stringify(me).slice(0, 300));

  const tools = await listTools(true);
  console.log(`  可用工具数：${tools.length}`);
}

const already = loadTokens();
if (already) clearTokens();
main().catch((err) => {
  console.error("\n❌ 登录失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
