import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist", "hosted");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route(/^https:\/\/(?:wallet|finance)\.ynxweb4\.com\//u, async route => {
    const url = new URL(route.request().url());
    if (url.origin === "https://finance.ynxweb4.com") {
      if (url.pathname === "/adapter.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(resolve(dist, "adapter.js")) });
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><button id='connect'>Connect YNX Wallet</button>" });
    }
    const path = url.pathname === "/hosted/" ? "index.html" : url.pathname.replace(/^\/hosted\//u, "");
    if (!["index.html", "app.js", "hosted-wallet.css", "ynx-logo.png"].includes(path)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "text/html", body: await readFile(resolve(dist, path)) });
  });
  const finance = await context.newPage();
  await finance.goto("https://finance.ynxweb4.com/qa");
  await finance.evaluate(async () => {
    const { createHostedWalletAdapter } = await import("/adapter.js");
    window.adapter = createHostedWalletAdapter();
    const open = window.open.bind(window);
    window.open = (...args) => {
      const encoded = new URL(args[0]).hash.slice("#connect=".length);
      window.lastRequest = JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")));
      window.lastPopup = open(...args);
      return window.lastPopup;
    };
    document.querySelector("#connect").onclick = () => { window.connection = window.adapter.connect().then(() => "connected", error => error.code); };
  });

  const firstPopup = context.waitForEvent("page");
  await finance.locator("#connect").click();
  const first = await firstPopup;
  await first.locator("#setup").waitFor({ state: "visible" });
  assert.match(await first.locator("#status").innerText(), /Create or import/u);
  await finance.evaluate(() => window.lastPopup.postMessage({ ...window.lastRequest, protocol: "ynx-hosted-wallet/v1", type: "request", method: "wallet_disconnect", params: [], nonce: "A".repeat(32), messageId: crypto.randomUUID().replaceAll("-", ""), expiresAt: Date.now() + 30_000 }, "https://wallet.ynxweb4.com"));
  await first.waitForTimeout(100);
  assert.equal(await first.locator("#setup").isVisible(), true, "wrong nonce cannot cancel");
  await first.evaluate(() => window.dispatchEvent(new MessageEvent("message", { source: window.opener, origin: "https://unregistered.example", data: { protocol: "ynx-hosted-wallet/v1", type: "request", method: "wallet_disconnect", params: [] } })));
  assert.equal(await first.locator("#setup").isVisible(), true, "wrong origin cannot cancel");
  const firstRequest = await finance.evaluate(() => window.lastRequest);
  await finance.evaluate(() => window.adapter.disconnect());
  assert.equal(await finance.evaluate(() => window.connection), "HOSTED_DISCONNECTED");
  await first.locator("#status").filter({ hasText: "Disconnected" }).waitFor();
  assert.equal(await first.locator("#setup").isVisible(), false, "cancelled popup cannot still invite account creation");
  assert.equal(await finance.evaluate(() => window.adapter.connected), false);

  const secondPopup = context.waitForEvent("page");
  await finance.locator("#connect").click();
  const second = await secondPopup;
  await second.locator("#setup").waitFor({ state: "visible" });
  assert.equal(await first.locator("#setup").isVisible(), false, "old popup remains cancelled after retry");
  const password = "synthetic QA password 2026";
  await second.locator("#setup-password").fill(password);
  await second.locator("#setup-confirm").fill(password);
  await second.locator("#setup-form button[type=submit]").click();
  await second.locator("#backup-confirmation").waitFor({ state: "visible" });
  const download = second.waitForEvent("download");
  await second.locator("#export-backup").click();
  await download;
  await second.locator("#backup-ack").check();
  await second.locator("#backup-continue").click();
  await second.locator("#review").waitFor({ state: "visible" });
  await finance.evaluate(() => window.adapter.disconnect());
  await second.locator("#status").filter({ hasText: "Disconnected" }).waitFor();
  assert.equal(await second.locator("#review").isVisible(), false, "cancelled approval cannot still be accepted");
  assert.equal(await finance.evaluate(() => window.connection), "HOSTED_DISCONNECTED");

  const thirdPopup = context.waitForEvent("page");
  await finance.locator("#connect").click();
  const third = await thirdPopup;
  await third.locator("#review").waitFor({ state: "visible" });
  await first.evaluate(request => window.opener.postMessage({ ...request, protocol: "ynx-hosted-wallet/v1", type: "connected", account: "0x" + "11".repeat(20), chainId: "0x1917", sessionExpiresAt: Date.now() + 60_000, replyTo: crypto.randomUUID().replaceAll("-", ""), messageId: crypto.randomUUID().replaceAll("-", ""), expiresAt: Date.now() + 30_000 }, request.origin), firstRequest);
  assert.equal(await finance.evaluate(() => window.adapter.connected), false, "old popup cannot approve the new request");
  await third.locator("#approve").click();
  assert.equal(await finance.evaluate(() => window.connection), "connected");
  await finance.evaluate(() => window.adapter.disconnect());
  await third.locator("#status").filter({ hasText: "Disconnected" }).waitFor();
  await context.close();
  console.log(JSON.stringify({ browser: "Chromium", beforeApprovalCancel: true, approvalWaitCancel: true, wrongNonceAndOriginIgnored: true, stalePopupDisabled: true, retryIsolated: true, oldPopupCannotApproveRetry: true }));
} finally {
  await browser.close();
}
