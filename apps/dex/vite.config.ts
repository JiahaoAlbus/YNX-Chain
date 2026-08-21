import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ynx-chain/wallet-auth/src/canonical.js": resolve("node_modules/@ynx-chain/wallet-auth/src/canonical.js"),
      "@ynx-chain/wallet-auth/src/authorize-launcher.js": resolve("node_modules/@ynx-chain/wallet-auth/src/authorize-launcher.js"),
      "@ynx-chain/wallet-auth/src/protocol.js": resolve("node_modules/@ynx-chain/wallet-auth/src/protocol.js"),
      "@ynx-chain/wallet-auth/src/crypto.js": resolve("node_modules/@ynx-chain/wallet-auth/src/crypto.js"),
      "@ynx-chain/wallet-auth/src/deep-link.js": resolve("node_modules/@ynx-chain/wallet-auth/src/deep-link.js"),
    },
  },
  server: {
    port: 4176,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6439",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/accounts": "http://127.0.0.1:27626",
      "/dex": "http://127.0.0.1:27626",
      "/v1": "http://127.0.0.1:6436",
      "/health": "http://127.0.0.1:6436",
      "/version": "http://127.0.0.1:6436",
    },
  },
  preview: { port: 4176, strictPort: true },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: "./src/test-setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
