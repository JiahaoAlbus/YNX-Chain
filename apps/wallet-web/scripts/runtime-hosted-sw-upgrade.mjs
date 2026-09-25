import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { historicalPwaFixture } from "./pwa-upgrade-browser-harness.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const old = await historicalPwaFixture("2f55f7924");
let phase = "old";
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://fixture").pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  const resourceName = pathname === "/hosted/" ? "index.html" : name;
  response.setHeader("cache-control", "no-store");
  response.setHeader("service-worker-allowed", "/");
  let bytes;
  try {
    if (pathname.startsWith("/hosted/")) bytes = await readFile(resolve(root, "dist", "hosted", pathname.slice(8) || "index.html"));
    else if (phase === "old") bytes = old.files[name];
    else bytes = await readFile(resolve(root, "dist", "pwa", name));
    if (!bytes) throw new Error("missing");
    response.setHeader("content-type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" })[extname(resourceName)] ?? "application/octet-stream");
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js", { scope: "/", type: "module" }); await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  phase = "current";
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const changed = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("CONTROLLER_CHANGE_TIMEOUT")), 15000); navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(); }, { once: true }); });
    await registration.update(); await changed;
  });
  // The policy resource must be the new source after controller change.
  await page.waitForFunction(async () => {
    const response = await fetch("/service-worker-policy.js", { cache: "no-store" });
    return response.ok && (await response.text()).includes('url.pathname === "/hosted"');
  });
  await page.goto(`${origin}/hosted/`);
  assert.equal(await page.title(), "YNX Wallet · Connect");
  assert.match(await page.locator("#status").textContent(), /registered product/u);
  console.log(JSON.stringify({ isolatedBrowser: "Chromium", historicalWorkerSource: old.sourceCommit, historicalWorkerSHA256: old.workerSha256, oldServiceWorkerControlled: true, updatedWorkerHostedRouteNetworkOnly: true, hostedPageNotCompanionShell: true, publicDeploymentVerified: false }));
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
