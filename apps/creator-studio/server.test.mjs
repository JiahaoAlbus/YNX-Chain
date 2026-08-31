import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 4329;
const root = new URL(".", import.meta.url);
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "ignore", "ignore"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/video/studio/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Creator Studio test server did not become ready");
}

test("server preserves the deployed /video/studio/ subpath for page and assets", async t => {
  t.after(() => child.kill());
  await waitForServer();
  for (const [path, contentType] of [
    ["/video/studio/", "text/html"],
    ["/video/studio/app.js", "text/javascript"],
    ["/video/studio/assets/ynx-logo.png", "image/png"],
    ["/video/studio/i18n/catalog.json", "application/json"],
    ["/video/studio/wallet-auth/callback", "text/html"],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") || "", new RegExp(contentType), path);
  }
});
