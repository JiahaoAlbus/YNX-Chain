import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectWalletTransportURL } from "../src/wallet-transport-policy.js";

test("WalletConnect URIs stay in the DApp Browser and fail closed when no relay/session runtime is configured", () => {
  const result = inspectWalletTransportURL("wc:topic@2?relay-protocol=irn&symKey=secret");
  assert.deepEqual(result, {
    intercept: true,
    code: "WALLETCONNECT_NOT_CONFIGURED",
    message: "WalletConnect is not configured in this preview. The request was not opened; no account, session, signature, or transaction was created."
  });
});

test("bare, legacy, malformed and otherwise non-canonical Wallet URIs are rejected without a handoff", () => {
  assert.equal(inspectWalletTransportURL("ynxwallet://authorize").code, "CANONICAL_WALLET_REQUEST_REQUIRED");
  assert.equal(inspectWalletTransportURL("ynxwallet://authorize?request=too-short").code, "CANONICAL_WALLET_REQUEST_REQUIRED");
  assert.equal(inspectWalletTransportURL("ynxwallet://authorize?request=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&extra=1").code, "CANONICAL_WALLET_REQUEST_REQUIRED");
  assert.equal(inspectWalletTransportURL("ynx-wallet://authorize?request=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").code, "CANONICAL_WALLET_SCHEME_REQUIRED");
  assert.equal(inspectWalletTransportURL("ynxwallet://wrong?request=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").code, "CANONICAL_WALLET_ROUTE_REQUIRED");
});

test("complete canonical-shaped URI is held for an approved native bridge instead of being parsed or approved by the browser", () => {
  const result = inspectWalletTransportURL("ynxwallet://authorize?request=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(result.code, "CANONICAL_WALLET_BRIDGE_UNAVAILABLE");
  assert.match(result.message, /no account, session, signature, or transaction was created/i);
});

test("Electron DApp Browser intercepts transport on navigation, redirects, and popup attempts without a browser-side approval path", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const policy = await readFile(new URL("../src/wallet-transport-policy.js", import.meta.url), "utf8");
  const preload = await readFile(new URL("../src/preload.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const guide = await readFile(new URL("../../../docs/ecosystem/WALLETCONNECT_GUIDE.md", import.meta.url), "utf8");
  assert.match(main, /inspectWalletTransportURL/);
  for (const token of ["will-navigate", "will-redirect", "setWindowOpenHandler"]) {
    assert.match(main, new RegExp(token));
  }
  assert.match(policy, /WALLETCONNECT_NOT_CONFIGURED/);
  assert.doesNotMatch(main, /JSON\.parse\(new URL\(url\)\.searchParams\.get\("request"\)\)/);
  assert.doesNotMatch(main, /approved-for-wallet-handoff/);
  assert.doesNotMatch(preload, /authorizeWallet/);
  assert.doesNotMatch(renderer, /showWalletRequest/);
  assert.doesNotMatch(renderer, /Approve Wallet handoff/);
  assert.match(renderer, /no approved canonical Wallet transport bridge/);
  assert.match(guide, /WALLETCONNECT_NOT_CONFIGURED/);
  assert.match(guide, /eth_chainId.*0x1917/);
});
