import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Dev: the PullUp API server (packages/server) runs on :4174; Vite proxies /api.
export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: { "/api": `http://127.0.0.1:${process.env.PULLUP_API_PORT ?? 4174}` },
  },
});
