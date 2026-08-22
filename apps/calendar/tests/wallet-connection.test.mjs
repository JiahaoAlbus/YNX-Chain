import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  calendarWalletState,
  connectCalendarWallet,
  restoreCalendarWallet,
  restoreCalendarWalletAfterLateInjection,
  switchCalendarWalletAccount,
  WALLET_INSTALLATION_OPTIONS,
  YNX_TESTNET_ADD_CHAIN,
} from "../web/wallet-connection.js";

const account = "0x1111111111111111111111111111111111111111";

function provider({chainId = "0x1917", reject = false, kind = "metamask"} = {}) {
  let chain = chainId;
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    isMetaMask: kind === "metamask",
    isYNXWallet: kind === "ynx",
    providerInfo: {rdns: kind === "ynx" ? "com.ynx.wallet" : "io.metamask"},
    on(type, listener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, value) { for (const listener of listeners.get(type) ?? []) listener(value); },
    async request(input) {
      calls.push(structuredClone(input));
      if (input.method === "eth_requestAccounts") {
        if (reject) throw Object.assign(new Error("User rejected"), {code: 4001});
        return [account];
      }
      if (input.method === "eth_accounts") return [account];
      if (input.method === "wallet_requestPermissions") return [{parentCapability: "eth_accounts"}];
      if (input.method === "eth_chainId") return chain;
      if (input.method === "wallet_switchEthereumChain") {
        if (chain === "0x999") throw Object.assign(new Error("Unknown chain"), {code: 4902});
        chain = input.params[0].chainId; return null;
      }
      if (input.method === "wallet_addEthereumChain") { chain = input.params[0].chainId; return null; }
      throw new Error(`Unexpected ${input.method}`);
    },
  };
}

function browser(announcements = [], injected = undefined) {
  const listeners = new Map();
  return {
    ethereum: injected,
    document: {readyState: "complete"},
    Event,
    addEventListener(type, listener) { const group = listeners.get(type) ?? new Set(); group.add(listener); listeners.set(type, group); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      if (event.type === "eip6963:requestProvider") {
        for (const detail of announcements) for (const listener of listeners.get("eip6963:announceProvider") ?? []) listener({type: "eip6963:announceProvider", detail});
      }
      return true;
    },
  };
}

function announcement(wallet, kind, suffix) {
  return {
    info: {
      uuid: `00000000-0000-4000-8000-0000000000${suffix}`,
      name: kind === "ynx" ? "YNX Wallet" : "MetaMask",
      rdns: kind === "ynx" ? "com.ynx.wallet" : "io.metamask",
    },
    provider: wallet,
  };
}

test("Calendar prefers announced YNX Wallet and closes pending connect state", async () => {
  const ynx = provider({kind: "ynx"});
  const metamask = provider();
  const result = await connectCalendarWallet(browser([
    announcement(metamask, "metamask", "01"),
    announcement(ynx, "ynx", "02"),
  ]), {timeoutMs: 0});
  assert.equal(result.account, account);
  assert.equal(result.chainId, "0x1917");
  assert.equal(result.walletName, "YNX Wallet");
  assert.equal(result.standardConnection, "CONNECTED");
  assert.equal(result.productSession, "PRIVATE_SERVICE_DEGRADED");
  assert.equal(result.connectionState.chooserOpen, false);
  assert.equal(result.connectionState.pendingIntent, null);
  assert.equal(result.connectionState.privateService, "degraded");
  assert.equal(metamask.calls.length, 0);
});

test("Calendar adds and verifies YNX Testnet without a direct browser RPC probe", async () => {
  const wallet = provider({chainId: "0x999"});
  const result = await connectCalendarWallet(browser([], wallet), {timeoutMs: 0});
  assert.equal(result.chainId, "0x1917");
  assert.deepEqual(wallet.calls.find((call) => call.method === "wallet_addEthereumChain").params[0], YNX_TESTNET_ADD_CHAIN);
  assert.equal(wallet.calls.some((call) => call.method === "eth_requestAccounts"), true);
});

test("refresh restores an approved account without another approval request", async () => {
  const wallet = provider();
  const restored = await restoreCalendarWallet(browser([], wallet), {timeoutMs: 0});
  assert.equal(restored.standardConnection, "CONNECTED");
  assert.equal(restored.connectionState.chooserOpen, false);
  assert.equal(wallet.calls.some((call) => call.method === "eth_requestAccounts"), false);
  assert.equal(wallet.calls.some((call) => call.method === "eth_accounts"), true);
});

test("account removal invalidates the restored connection", async () => {
  const wallet = provider();
  await restoreCalendarWallet(browser([], wallet), {timeoutMs: 0});
  wallet.emit("accountsChanged", []);
  assert.equal(calendarWalletState().status, "disconnected");
  assert.equal(calendarWalletState().account, null);
});

test("connected Calendar can request an account change without reopening discovery", async () => {
  const wallet = provider();
  await restoreCalendarWallet(browser([], wallet), {timeoutMs: 0});
  const switched = await switchCalendarWalletAccount();
  assert.equal(switched.standardConnection, "CONNECTED");
  assert.equal(switched.account, account);
  assert.equal(switched.chainId, "0x1917");
  assert.equal(wallet.calls.filter((call) => call.method === "wallet_requestPermissions").length, 1);
  assert.equal(switched.connectionState.chooserOpen, false);
});

test("rejection and unavailable injection fail closed with truthful codes", async () => {
  await assert.rejects(connectCalendarWallet(browser([], provider({reject: true})), {timeoutMs: 0}), (error) => error.code === "WALLET_USER_REJECTED");
  await assert.rejects(connectCalendarWallet(browser(), {timeoutMs: 0}), (error) => error.code === "PROVIDER_NOT_INJECTED" && error.details.downloads === WALLET_INSTALLATION_OPTIONS);
  assert.equal(calendarWalletState().chooserOpen, false);
  assert.equal(calendarWalletState().status, "disconnected");
  assert.equal(calendarWalletState().pendingIntent, null);
  assert.equal(calendarWalletState().providerKind, null);
  assert.equal(calendarWalletState().account, null);
  assert.equal(calendarWalletState().chainId, null);
});

test("provider announced after the initial 160ms window restores read-only", async () => {
  const wallet = provider();
  const announcements = [];
  const scope = browser(announcements);
  setTimeout(() => {
    announcements.push(announcement(wallet, "metamask", "03"));
    scope.dispatchEvent({type: "eip6963:announceProvider", detail: announcements[0]});
  }, 170);
  const restored = await restoreCalendarWalletAfterLateInjection(scope);
  assert.equal(restored.standardConnection, "CONNECTED");
  assert.equal(restored.chainId, "0x1917");
  assert.equal(wallet.calls.some((call) => call.method === "eth_accounts"), true);
  assert.equal(wallet.calls.some((call) => call.method === "eth_chainId"), true);
  assert.equal(wallet.calls.some((call) => call.method === "eth_requestAccounts"), false);
});

test("ethereum initialized signal triggers bounded read-only rediscovery", async () => {
  const wallet = provider();
  const scope = browser();
  setTimeout(() => {
    scope.ethereum = wallet;
    scope.dispatchEvent(new Event("ethereum#initialized"));
  }, 5);
  const restored = await restoreCalendarWalletAfterLateInjection(scope, {timeoutMs: 0, retryDelays: [10, 20, 30]});
  assert.equal(restored.standardConnection, "CONNECTED");
  assert.equal(wallet.calls.some((call) => call.method === "eth_requestAccounts"), false);
});

test("late injection recovery never navigates or launches a custom scheme", () => {
  const source = readFileSync(new URL("../web/wallet-connection.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.open|location\.(?:href|assign|replace)|ynxwallet:/);
});

test("accepted shared Provider and connect-state sources are byte-identical", () => {
  const files = {
    "wallet-provider-discovery.js": "94875a262b7422f3153ecfd7cbe4bde2c7884239bc9f1003a1e6f86ca74b08ed",
    "standard-wallet-connect-state.js": "72558116f22625c6e9abf363b9dd16a7b1b80c93d88099be531cb63e70a62b92",
  };
  for (const [name, expected] of Object.entries(files)) {
    const actual = createHash("sha256").update(readFileSync(new URL(`../web/ynx-wallet-contract/${name}`, import.meta.url))).digest("hex");
    assert.equal(actual, expected, name);
  }
});

test("previous accepted browser-safe SDK remains byte-identical to its manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../web/ynx-dapp-connect-sdk/manifest.json", import.meta.url)));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = createHash("sha256").update(readFileSync(new URL(`../web/ynx-dapp-connect-sdk/${name}`, import.meta.url))).digest("hex");
    assert.equal(actual, expected, name);
  }
  assert.equal(manifest.productSessionIncluded, false);
});
