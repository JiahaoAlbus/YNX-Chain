import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { attachWalletLifecycle, discoverWalletProviders } from "./wallet-auth.js";
import {
  createStandardWalletConnectState,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_CONNECT_STATE_AUTHORITY,
} from "./standard-wallet-connect-state.js";

const load = name => readFile(new URL(name, import.meta.url), "utf8");
const accountA = "0x1111111111111111111111111111111111111111";

test("Creator consumes the exact shared Standard Wallet reducer boundary", () => {
  assert.equal(STANDARD_WALLET_CONNECT_STATE_AUTHORITY.sourceCommit, "98c6d5d784d212df8981a53b17118a511e246ad2");
  let state = createStandardWalletConnectState();
  state = reduceStandardWalletConnectState(state, { type: "BEGIN", pendingIntent: "creatorwalletintent1" });
  state = reduceStandardWalletConnectState(state, { type: "PROVIDER_SELECTED", provider: { request() {} }, providerKind: "ynx-wallet" });
  state = reduceStandardWalletConnectState(state, { type: "ACCOUNT_APPROVED", account: accountA });
  state = reduceStandardWalletConnectState(state, { type: "CHAIN_CONFIRMED", chainId: "0x1917" });
  assert.equal(state.status, "connected");

  state = reduceStandardWalletConnectState(state, { type: "PRIVATE_SESSION_DEGRADED" });
  assert.equal(state.status, "connected");
  assert.equal(state.privateService, "degraded");
  state = reduceStandardWalletConnectState(state, { type: "OPEN_CHOOSER" });
  assert.equal(state.chooserMode, "connection-details");
  assert.deepEqual(state.chooserActions, ["disconnect", "switch-account", "close"]);
  state = reduceStandardWalletConnectState(state, { type: "DISCONNECT" });
  assert.equal(state.status, "idle");
  assert.equal(state.account, null);
});

test("late legacy injection is re-read after ethereum#initialized", async () => {
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  const scope = {
    document: Object.assign(documentEvents, { readyState: "complete" }),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    setTimeout,
  };
  setTimeout(() => {
    scope.ethereum = { isMetaMask: true, request() {} };
    events.dispatchEvent(new Event("ethereum#initialized"));
  }, 25);
  const found = await discoverWalletProviders(scope, 250);
  assert.equal(found.metamask?.kind, "metamask");
  assert.equal(found.metamask?.name, "MetaMask");
  assert.ok(found.diagnostics.eip6963RequestDispatches >= 2);
});

test("empty accountsChanged disconnects instead of becoming an invalid-account error", () => {
  const listeners = new Map();
  const provider = {
    on(type, listener) { listeners.set(type, listener); },
    removeListener(type) { listeners.delete(type); },
  };
  let observed = null;
  const lifecycle = attachWalletLifecycle(provider, { onAccountsChanged(accounts) { observed = accounts; } });
  listeners.get("accountsChanged")([]);
  assert.deepEqual(observed, []);
  lifecycle.detach();
});

test("wallet UI uses distinct image assets and same-tab provider flow", async () => {
  const [html, app, auth, callback, release, ynxLogo, metamaskLogo, brandLogo] = await Promise.all([
    load("index.html"), load("app.js"), load("wallet-auth.js"), load("wallet-callback.html"), load("product-release.json"), load("assets/ynx-wallet.svg"), load("assets/metamask.svg"), readFile(new URL("../../assets/brand/ynx-logo.png", import.meta.url)),
  ]);
  assert.match(html, /id="wallet-details"/);
  assert.match(html, /id="wallet-switch-account"/);
  assert.match(html, /id="wallet-detail-disconnect"/);
  assert.match(html, /src="assets\/ynx-logo\.png"/);
  assert.match(html, /alt="YNX"/);
  assert.ok(brandLogo.length > 1000, "official YNX logo asset is unexpectedly empty");
  assert.match(app, /assets\/ynx-wallet\.svg/);
  assert.match(app, /assets\/metamask\.svg/);
  assert.match(ynxLogo, /YNX Wallet/);
  assert.match(metamaskLogo, /MetaMask/);
  assert.match(auth, /ethereum#initialized/);
  assert.match(auth, /DISCOVERY_PHASES_MS[^\n]*250[^\n]*750[^\n]*1500/);
  for (const identity of ["ynx_6423-1", "6423", "0x1917", "YNXT"]) {
    assert.match(`${app}\n${auth}`, new RegExp(identity, "i"), `missing YNX Testnet identity: ${identity}`);
  }
  assert.doesNotMatch(`${app}\n${auth}`, /9102|0x238e|ynx_9102/i);
  assert.doesNotMatch(`${app}\n${auth}\n${html}`, /window\.open|ynxwallet:|target=["']_blank/i);
  assert.match(callback, /candidate\.origin === location\.origin/);
  assert.equal(JSON.parse(release).currentSourceBoundPublic, false);
});
