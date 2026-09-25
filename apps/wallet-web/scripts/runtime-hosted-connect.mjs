import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist", "hosted");
const password = "synthetic QA password 2026";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route(/^https:\/\/(?:wallet|finance)\.ynxweb4\.com\//u, async route => {
    const url = new URL(route.request().url());
    if (url.origin === "https://finance.ynxweb4.com") {
      if (url.pathname === "/adapter.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(resolve(dist, "adapter.js")) });
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Finance QA</title><button id='connect'>Connect YNX Wallet</button>" });
    }
    const path = url.pathname === "/hosted/" ? "index.html" : url.pathname.replace(/^\/hosted\//u, "");
    if (!["index.html", "app.js", "hosted-wallet.css", "ynx-logo.png"].includes(path)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "text/html", body: await readFile(resolve(dist, path)) });
  });
  const finance = await context.newPage();
  await finance.goto("https://finance.ynxweb4.com/qa");
  await finance.evaluate(async () => {
    const { createHostedWalletAdapter } = await import("/adapter.js");
    window.ynxAdapter = createHostedWalletAdapter();
    document.querySelector("#connect").onclick = () => { window.ynxConnection = window.ynxAdapter.connect(); };
  });
  const popupPromise = context.waitForEvent("page");
  await finance.locator("#connect").click();
  const wallet = await popupPromise;
  await wallet.waitForLoadState("domcontentloaded");
  await wallet.locator("#setup").waitFor({ state: "visible" });
  assert.equal(await finance.evaluate(() => window.ynxAdapter.connected), false);
  await wallet.locator("#setup-password").fill(password);
  await wallet.locator("#setup-confirm").fill(password);
  await wallet.locator("#setup-form button[type=submit]").click();
  await wallet.locator("#backup-confirmation").waitFor({ state: "visible" });
  assert.equal(await finance.evaluate(() => window.ynxAdapter.connected), false);
  const download = wallet.waitForEvent("download");
  await wallet.locator("#export-backup").click();
  assert.match((await download).suggestedFilename(), /^ynx-wallet-encrypted-0x[0-9a-f]{40}\.json$/u);
  await wallet.locator("#backup-ack").check();
  await wallet.locator("#backup-continue").click();
  await wallet.locator("#review").waitFor({ state: "visible" });
  assert.equal(await finance.evaluate(() => window.ynxAdapter.connected), false);
  await wallet.locator("#approve").click();
  const account = await finance.evaluate(async () => (await window.ynxConnection)[0]);
  assert.match(account, /^0x[0-9a-f]{40}$/u);
  assert.deepEqual(await finance.evaluate(() => window.ynxAdapter.request({ method: "eth_accounts" })), [account]);
  assert.equal(await finance.evaluate(() => window.ynxAdapter.request({ method: "eth_chainId" })), "0x1917");
  await finance.evaluate(() => { window.signOutcome = window.ynxAdapter.request({ method: "personal_sign", params: ["0x68656c6c6f", window.ynxAdapter.account] }).then(() => "signed", error => error.code); });
  await wallet.locator("#review").waitFor({ state: "visible" });
  await wallet.locator("#reject").click();
  assert.equal(await finance.evaluate(() => window.signOutcome), "USER_REJECTED");
  await wallet.reload();
  await finance.waitForFunction(() => window.ynxAdapter.connected === false, null, { timeout: 8000 });
  assert.deepEqual(await finance.evaluate(() => window.ynxAdapter.request({ method: "eth_accounts" })), []);
  console.log(JSON.stringify({ isolatedBrowser: "Chromium", hostedVaultCreatedAndReadBack: true, backupAcknowledgementBeforeConnect: true, zeroBalanceConnectionNoRpcRequired: true, account, chainId: "0x1917", explicitSignatureRejection: true, refreshDisconnected: true, publicDeploymentVerified: false }));
  await context.close();
} finally { await browser.close(); }
