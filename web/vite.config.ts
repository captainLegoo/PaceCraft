import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "../package.json";
import { execSync } from "node:child_process";

function resolveAppVersion(): string {
  if (process.env.VITE_APP_VERSION) {
    const v = process.env.VITE_APP_VERSION.trim();
    return v.startsWith("v") ? v : `v${v}`;
  }
  if (process.env.APP_VERSION) {
    const v = process.env.APP_VERSION.trim();
    return v.startsWith("v") ? v : `v${v}`;
  }
  try {
    const tag = execSync("git describe --tags --exact-match", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).toString().trim();
    if (tag) return tag.startsWith("v") ? tag : `v${tag}`;
  } catch {}

  if (pkg.version) {
    return pkg.version.startsWith("v") ? pkg.version : `v${pkg.version}`;
  }

  try {
    const desc = execSync("git describe --tags --always", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).toString().trim();
    if (desc) return desc.startsWith("v") ? desc : `v${desc}`;
  } catch {}

  return "v0.1.0";
}

const APP_VERSION = resolveAppVersion();
const API = "http://127.0.0.1:43124";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 43125,
    // 开发时把 /api 代理到后端，这样和生产一样是同源，不需要 CORS
    proxy: {
      "/api": {
        target: API,
        changeOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000,
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
