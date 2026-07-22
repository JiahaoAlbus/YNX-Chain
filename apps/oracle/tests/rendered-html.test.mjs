import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/oracle") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the independent Oracle product route", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>YNX Oracle \| Verifiable market data · YNX Oracle<\/title>/i);
  assert.match(html, /Price evidence, not price promises/);
  assert.match(html, /Public endpoint not configured/);
  assert.match(html, /No sample price is shown/);
  assert.match(html, /ynx\.oracle\.v1/);
  assert.match(html, /href="\/manifest\.webmanifest"/);
  assert.doesNotMatch(html, /Codex|worktree|example\.com|fake price/i);
});

test("root route also exposes the Oracle documentation surface", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /YNX MARKET DATA CONTROL PLANE/);
});
