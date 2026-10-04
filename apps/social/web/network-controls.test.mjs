import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import * as wallet from "./wallet-provider.js";

const source = (await readFile(new URL("./app.js", import.meta.url), "utf8")).replace(/^import .*;\n/, "");
const address = "0x1111111111111111111111111111111111111111";
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function app(overrides = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", dataset: {}, style: {}, attributes: new Map(), hidden: true, disabled: false, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      removeAttribute(name) { this.attributes.delete(name); },
      querySelectorAll(selector) {
        if (id === "wallet-dialog" && selector === ".wallet-option") {
          return ["mobile", "hosted", "ynx", "metamask"].map(kind => get("connect-" + kind));
        }
        throw new Error("Unsupported UI fixture selector: " + selector);
      },
      close() { this.open = false; }, showModal() { this.open = true; }, focus() {}, scrollIntoView() {},
    });
    return elements.get(id);
  };
  const storage = overrides.storage ?? new Map();
  const windowEvents = new EventTarget();
  const context = vm.createContext({
    ...wallet,
    // These tests isolate UI intent ordering. SDK behavior has separate tests;
    // tests that exercise the actual SDK override these lifecycle seams below.
    attachWalletLifecycle: () => () => {}, disconnectWallet: () => {},
    // app.js registers pagehide on the browser global. Preserve that hook in
    // this VM without running a page lifecycle during network-control tests.
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
    window: { location: { origin: "https://social.ynxweb4.com" } },
    ...overrides, document: { getElementById: get },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    restoreWallet: overrides.restoreWallet ?? (async () => ({ ok: false })),
  });
  vm.runInContext(source, context);
  return { get, context, storage, windowEvents, click: (id) => get(id).handlers.click({ currentTarget: get(id) }),
    connect(provider) { context.result = { provider, account: address, chainId: "0x1", wallet: "ynx" }; vm.runInContext("setConnected(result)", context); },
  };
}

test("browser pagehide dispatches the registered transport suspension hook", () => {
  const events = [];
  const ui = app({ socialTransports: () => ({ suspend: () => events.push("suspend") }) });
  ui.windowEvents.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(events, ["suspend"]);
});

for (const mode of ["switch", "add", "reject", "bad-readback"]) {
  test(`network control: ${mode}, without account authorization`, async () => {
    const calls = [];
    let chain = "0x1", added = false;
    const provider = { async request(input) {
      calls.push(input);
      if (input.method === "eth_chainId") return chain;
      assert.equal(input.params[0].chainId, "0x1917");
      if (input.method === "wallet_addEthereumChain") { added = true; return null; }
      assert.equal(input.method, "wallet_switchEthereumChain");
      if (mode === "reject") throw Object.assign(new Error("rejected"), { code: 4001 });
      if (mode === "add" && !added) throw Object.assign(new Error("missing"), { code: 4902 });
      if (mode !== "bad-readback") chain = "0x1917";
      return null;
    } };
    const ui = app();
    ui.connect(provider);
    assert.equal(calls.length, 0);
    await ui.click("wallet-switch-network");
    assert.deepEqual(calls.map((c) => c.method), mode === "add"
      ? ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]
      : mode === "reject" ? ["eth_chainId", "wallet_switchEthereumChain"]
      : ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
    assert.equal(ui.get("connected-panel").hidden, false);
    assert.equal(ui.get("wallet-switch-network").disabled, false);
    assert.equal(ui.get("connected-wallet-status").dataset.tone, ["reject", "bad-readback"].includes(mode) ? "warning" : "success");
    if (mode === "reject") assert.match(ui.get("connected-wallet-status").textContent, /rejected/);
    if (mode === "bad-readback") assert.match(ui.get("connected-chain").textContent, /0x1$/);
    else if (mode !== "reject") assert.match(ui.get("connected-chain").textContent, /0x1917$/);
  });
}

test("late network readback after disconnect cannot restore the panel", async () => {
  const pending = deferred();
  const ui = app({ ensureYNXChain: () => pending.promise });
  ui.connect({ request() {} });
  const operation = ui.click("wallet-switch-network");
  await ui.click("wallet-disconnect");
  pending.resolve("0x1917");
  await operation;
  assert.equal(ui.get("connected-panel").hidden, true);
  assert.match(ui.get("connected-wallet-status").textContent, /disconnected locally/);
});

test("network action has explicit markup and visible status outside the chooser", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="wallet-switch-network" type="button">Switch to YNX Testnet/);
  assert.ok(html.indexOf('id="connected-wallet-status"') < html.indexOf('<dialog'));
});

test("older connect must not overwrite a later explicit wallet choice", async () => {
  const first = deferred(), second = deferred();
  const ui = app({ connectWallet: (kind) => kind === "ynx" ? first.promise : second.promise });
  const firstAttempt = vm.runInContext('connect("ynx", byId("connect-ynx"))', ui.context);
  const secondAttempt = vm.runInContext('connect("metamask", byId("connect-metamask"))', ui.context);
  const result = { ok: true, provider: { request() {} }, account: address, chainId: "0x1917" };
  second.resolve({ ...result, wallet: "metamask" });
  await secondAttempt;
  first.resolve({ ...result, wallet: "ynx" });
  await firstAttempt;
  assert.equal(ui.get("connected-wallet-name").textContent, "MetaMask");
});

test("manual disconnect persists on reload until explicit Connect", async () => {
  const ui = app();
  ui.connect({ request() {} });
  await ui.click("wallet-disconnect");
  let restores = 0;
  const reloaded = app({ storage: ui.storage, restoreWallet: async () => { restores++; return { ok: false }; } });
  await Promise.resolve();
  assert.equal(restores, 0);
  assert.equal(reloaded.get("connected-panel").hidden, true);
  await reloaded.click("hero-connect-wallet");
  assert.equal(ui.storage.has("ynx.social.standard-wallet.disconnected"), false);
});

test("late startup restore cannot undo a manual disconnect", async () => {
  const pending = deferred();
  const ui = app({ storage: new Map([["ynx.social.standard-wallet.kind", "ynx"]]), restoreWallet: () => pending.promise });
  await ui.click("wallet-disconnect");
  pending.resolve({ ok: true, provider: { request() {} }, account: address, chainId: "0x1917", wallet: "ynx" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ui.get("connected-panel").hidden, true);
});

test("unsupported revoke shows manual guidance and keeps local connection", async () => {
  const ui = app({ revokeWallet: async () => ({ status: "unsupported", permissionRevoked: false, locallyDisconnected: false }) });
  ui.connect({ request() {} });
  await ui.click("wallet-revoke");
  assert.equal(ui.get("connected-panel").hidden, false);
  assert.match(ui.get("connected-wallet-status").textContent, /Remove this site's access in your wallet/);
});

test("actual SDK revoke events cannot hide confirmed UI outcome", async () => {
  const listeners = new Map();
  const methods = [];
  let accounts = [address];
  const provider = {
    isMetaMask: true,
    on(event, fn) { listeners.set(event, fn); },
    removeListener(event) { listeners.delete(event); },
    async request({method}) {
      methods.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return accounts;
      if (method === "eth_chainId") return "0x1917";
      if (method === "wallet_revokePermissions") { accounts = []; listeners.get("accountsChanged")?.([]); return null; }
      if (method === "wallet_getPermissions") return accounts.length ? [{ parentCapability: "eth_accounts" }] : [];
      throw new Error(method);
    },
  };
  const ui = app({window: { ethereum: provider, location: { origin: "https://social.ynxweb4.com" } }, attachWalletLifecycle: wallet.attachWalletLifecycle, disconnectWallet: wallet.disconnectWallet});
  await vm.runInContext('connect("metamask", byId("connect-metamask"))', ui.context);
  assert.equal(ui.get("connected-panel").hidden, false);
  await ui.click("wallet-revoke");
  assert.equal(ui.get("connected-panel").hidden, true, JSON.stringify({status:ui.get("connected-wallet-status").textContent,methods}));
  assert.match(ui.get("connected-wallet-status").textContent, /empty accounts confirmed/);
  assert.deepEqual(methods.slice(-3), ["wallet_revokePermissions", "eth_accounts", "wallet_getPermissions"]);
});

for (const action of ["manual-disconnect", "later-wallet-choice"]) {
  test(`pending revoke cannot overwrite ${action}`, async () => {
    const pending = deferred();
    const nextProvider = { request() {} };
    const nextAccount = "0x2222222222222222222222222222222222222222";
    const ui = app({
      revokeWallet: () => pending.promise,
      connectWallet: async kind => ({ ok: true, wallet: kind, provider: nextProvider, account: nextAccount, chainId: "0x1917" }),
    });
    ui.connect({ request() {} });
    const revocation = ui.click("wallet-revoke");
    if (action === "manual-disconnect") {
      await ui.click("wallet-disconnect");
      assert.equal(ui.get("connected-panel").hidden, true);
    } else {
      await vm.runInContext('connect("metamask", byId("connect-metamask"))', ui.context);
      assert.equal(ui.get("connected-panel").hidden, false);
      assert.equal(ui.get("connected-wallet-name").textContent, "MetaMask");
      assert.equal(ui.get("connected-account").textContent, nextAccount);
    }
    const selectedStatus = ui.get("connected-wallet-status").textContent;
    pending.resolve({ status: "revoked", permissionRevoked: true, locallyDisconnected: true });
    await revocation;
    assert.equal(ui.get("connected-wallet-status").textContent, selectedStatus, "old result cannot publish a confirmation into the newer intent");
    assert.equal(ui.get("connected-panel").hidden, action === "manual-disconnect");
    if (action === "later-wallet-choice") {
      assert.equal(ui.get("connected-wallet-name").textContent, "MetaMask");
      assert.equal(ui.get("connected-account").textContent, nextAccount);
    }
  });
}
