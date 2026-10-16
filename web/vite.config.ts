import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = "http://127.0.0.1:43124";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 43125,
    // 开发时把 /api 代理到后端，这样和生产一样是同源，不需要 CORS
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
