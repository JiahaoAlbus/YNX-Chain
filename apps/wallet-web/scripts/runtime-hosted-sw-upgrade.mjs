import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { historicalPwaFixture } from "./pwa-upgrade-browser-harness.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function exactOldRelease(path) {
  const archive = await readFile(path), archiveSha256 = sha256(archive);
  assert.equal(archiveSha256,"478e155646f7e269e7b075666362b904b57ad949ae101c3d5319f48aca76d5eb","0.1.3 release archive changed");
  const names = execFileSync("unzip",["-Z1",path],{encoding:"utf8"}).trim().split("\n");
  assert.ok(names.includes("sw.js") && names.includes("build-identity.json"));
  assert.ok(names.every(name => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)),"release archive contains an unexpected path");
  const files = Object.fromEntries(names.map(name => [name,execFileSync("unzip",["-p",path,name],{maxBuffer:10_000_000})]));
  const sourceCommit = JSON.parse(files["build-identity.json"]).sourceCommit;
  assert.equal(sourceCommit,"31f3ef16d3812870e0c3d23350565fd592482227");
  assert.equal(sha256(files["sw.js"]),"b2a2b514c823bcf00a3f5ad82d914a0aab58d39738de7471a8457681799fc4f3");
  return { files, sourceCommit, workerSha256: sha256(files["sw.js"]), archiveSha256, fixtureClass:"exact 0.1.3 prerelease ZIP bytes; public installed worker not verified" };
}
const old = process.env.YNX_OLD_PWA_ZIP ? await exactOldRelease(process.env.YNX_OLD_PWA_ZIP) : await historicalPwaFixture("2f55f7924");
const hostedFiles = ["index.html","hosted-wallet.css","ynx-logo.png","app.js","adapter.js"];
const hostedHashes = {};
for (const file of hostedFiles) {
  const built = await readFile(resolve(root,"dist","hosted",file));
  const published = await readFile(resolve(root,"dist","pwa","hosted",file));
  assert.deepEqual(published,built,`published hosted asset differs: ${file}`);
  hostedHashes[file] = createHash("sha256").update(published).digest("hex");
}
let phase = "old";
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://fixture").pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  const resourceName = pathname === "/hosted/" ? "index.html" : name;
  response.setHeader("cache-control", "no-store");
  response.setHeader("service-worker-allowed", "/");
  let bytes;
  try {
    if (pathname.startsWith("/hosted/")) bytes = await readFile(resolve(root, "dist", "pwa", "hosted", pathname.slice(8) || "index.html"));
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
  console.log(JSON.stringify({ isolatedBrowser: "Chromium", previousWorkerSource: old.sourceCommit, previousWorkerSHA256: old.workerSha256, previousArchiveSHA256: old.archiveSha256 ?? null, previousFixtureClass: old.fixtureClass, oldServiceWorkerControlled: true, updatedWorkerHostedRouteNetworkOnly: true, hostedPageNotCompanionShell: true, publishedHostedHashes: hostedHashes, publicDeploymentVerified: false }));
  await context.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
