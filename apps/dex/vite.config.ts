import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 4176, strictPort: true, proxy: { "/v1": "http://127.0.0.1:6436", "/health": "http://127.0.0.1:6436", "/version": "http://127.0.0.1:6436" } },
  preview: { port: 4176, strictPort: true },
  build: { sourcemap: true, target: "es2022" },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", include: ["src/**/*.test.{ts,tsx}"] }
});
