import { env } from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = env.TCQ_API_PROXY_TARGET || "http://127.0.0.1:5000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: false,
      },
    },
  },
});
