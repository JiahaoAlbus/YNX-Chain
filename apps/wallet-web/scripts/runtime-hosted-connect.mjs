import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { p256 } from "@noble/curves/nist.js";
import registry from "../vendor/product-session-registry-b754ffc42.json" with { type: "json" };
import { createProductSessionRequest, encodeProductSessionWalletURL, parseProductSessionReturnURL } from "@ynx-chain/wallet-auth-card-provider-v2";
import { createEncryptedVault } from "../src/extension-vault.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist", "hosted");
const password = "synthetic QA password 2026";
function financePrivateRequest() {
  const now = new Date(), token = () => randomBytes(32).toString("base64url");
  const value = createProductSessionRequest(registry, { productId: "finance", platform: "web", deviceId: `web_${token()}`, deviceKey: Buffer.from(p256.getPublicKey(Buffer.alloc(32, 0x42), true)).toString("base64url"), scopes: ["finance.pay.read"], purpose: "Read Finance testnet payment information after an explicit Wallet approval.", nonce: token(), state: token() }, now);
  return { value, url: encodeProductSessionWalletURL(registry, value, now) };
}
const browser = await chromium.launch({ headless: true });
async function routeFixture(context) {
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
}
async function financePage(context) {
  const finance = await context.newPage();
  await finance.goto("https://finance.ynxweb4.com/qa");
  await finance.evaluate(async () => {
    const { createHostedWalletAdapter } = await import("/adapter.js");
    window.ynxAdapter = createHostedWalletAdapter();
    document.querySelector("#connect").onclick = () => { window.ynxConnection = window.ynxAdapter.connect(); };
  });
  return finance;
}
try {
  const context = await browser.newContext({ acceptDownloads: true });
  await routeFixture(context);
  const finance = await financePage(context);
  assert.equal(await finance.evaluate(() => window.ynxAdapter.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1917" }] })), null);
  assert.equal(await finance.evaluate(async () => { try { await window.ynxAdapter.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }); return "accepted"; } catch (error) { return error.code; } }), "INVALID_CHAIN_PARAMS");
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
  const backup = await download;
  assert.match(backup.suggestedFilename(), /^ynx-wallet-encrypted-0x[0-9a-f]{40}\.json$/u);
  const backupBytes = await readFile(await backup.path());
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
  await context.close();
  const fresh = await browser.newContext({ acceptDownloads: true });
  await routeFixture(fresh);
  const restoredFinance = await financePage(fresh);
  const restoredPopup = fresh.waitForEvent("page");
  await restoredFinance.locator("#connect").click();
  const restoredWallet = await restoredPopup;
  await restoredWallet.locator("#setup").waitFor({ state: "visible" });
  await restoredWallet.locator("#backup-import-file").setInputFiles({ name: "ynx-wallet-encrypted.json", mimeType: "application/json", buffer: backupBytes });
  await restoredWallet.locator("#backup-import-password").fill("incorrect synthetic password");
  await restoredWallet.locator("#backup-import-confirm").check();
  await restoredWallet.locator("#backup-import-form button[type=submit]").click();
  await restoredWallet.locator("#status").filter({ hasText: "Backup was not restored" }).waitFor();
  assert.equal(await restoredFinance.evaluate(() => window.ynxAdapter.connected), false);
  await restoredWallet.locator("#backup-import-file").setInputFiles({ name: "ynx-wallet-encrypted.json", mimeType: "application/json", buffer: backupBytes });
  await restoredWallet.locator("#backup-import-password").fill(password);
  await restoredWallet.locator("#backup-import-form button[type=submit]").click();
  await restoredWallet.locator("#review").waitFor({ state: "visible" });
  assert.equal(await restoredWallet.locator("#account-evm").textContent(), account);
  await restoredWallet.locator("#approve").click();
  assert.equal((await restoredFinance.evaluate(() => window.ynxConnection))[0], account);
  const privateApproval = financePrivateRequest();
  await restoredFinance.evaluate(url => { window.privateOutcome = window.ynxAdapter.request({ method: "ynx_requestProductSessionV2", params: [url] }); }, privateApproval.url);
  await restoredWallet.locator("#review").waitFor({ state: "visible" });
  await restoredWallet.locator("#approval-password").fill(password);
  await restoredWallet.locator("#approve").click();
  const privateReturn = await restoredFinance.evaluate(() => window.privateOutcome);
  assert.equal(parseProductSessionReturnURL(registry, privateApproval.value, privateReturn.returnUrl).status, "ready");
  const rejectedRequest = financePrivateRequest();
  await restoredFinance.evaluate(url => { window.rejectedPrivate = window.ynxAdapter.request({ method: "ynx_requestProductSessionV2", params: [url] }); }, rejectedRequest.url);
  await restoredWallet.locator("#review").waitFor({ state: "visible" });
  await restoredWallet.locator("#reject").click();
  const rejectedReturn = await restoredFinance.evaluate(() => window.rejectedPrivate);
  assert.equal(parseProductSessionReturnURL(registry, rejectedRequest.value, rejectedReturn.returnUrl).status, "user-rejected");
  const repeated = await restoredFinance.evaluate(async url => { try { await window.ynxAdapter.request({ method: "ynx_requestProductSessionV2", params: [url] }); return "unexpected"; } catch (error) { return error.code; } }, privateApproval.url);
  assert.equal(repeated, "HOSTED_REQUEST_REPLAYED_OR_STORAGE_UNAVAILABLE");
  const second = await createEncryptedVault({ password, secretHex: "42".repeat(32) });
  await restoredWallet.locator("#account-switch-section details").evaluate(node => { node.open = true; });
  await restoredWallet.locator("#add-account-file").setInputFiles({ name: "second-encrypted.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(second)) });
  await restoredWallet.locator("#add-account-password").fill(password);
  await restoredWallet.locator("#add-account-form button[type=submit]").click();
  await restoredWallet.waitForFunction(expected => [...document.querySelector("#account-select").options].some(option => option.value === expected), second.account);
  await restoredWallet.locator("#account-select").selectOption(second.account);
  await restoredWallet.locator("#switch-account").click();
  await restoredFinance.waitForFunction(() => window.ynxAdapter.connected === false);
  assert.deepEqual(await restoredFinance.evaluate(() => window.ynxAdapter.request({ method: "eth_accounts" })), []);
  await restoredWallet.close();
  const switchedPopup = fresh.waitForEvent("page");
  await restoredFinance.locator("#connect").click();
  const switchedWallet = await switchedPopup;
  await switchedWallet.locator("#review").waitFor({ state: "visible" });
  assert.equal(await switchedWallet.locator("#account-evm").textContent(), second.account);
  await switchedWallet.locator("#approve").click();
  assert.equal((await restoredFinance.evaluate(() => window.ynxConnection))[0], second.account);
  console.log(JSON.stringify({ isolatedBrowser: "Chromium", hostedVaultCreatedAndReadBack: true, backupAcknowledgementBeforeConnect: true, zeroBalanceConnectionNoRpcRequired: true, account, chainId: "0x1917", explicitSignatureRejection: true, refreshDisconnected: true, wrongBackupPasswordRejected: true, encryptedBackupRestoresSamePublicAccount: true, privateV2SignedReturnLocallyVerified: true, privateV2Rejection: true, privateV2ReplayRejected: true, accountSwitchRequiresFreshApproval: true, gatewayVerified: false, publicDeploymentVerified: false }));
  await fresh.close();
} finally { await browser.close(); }
