import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/runtime": "http://127.0.0.1:4187" },
  },
  build: { sourcemap: true, target: "es2022" },
});
