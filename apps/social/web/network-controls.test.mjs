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
      textContent: "", dataset: {}, hidden: true, disabled: false, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute() {}, removeAttribute() {}, close() {}, showModal() {}, focus() {}, scrollIntoView() {},
    });
    return elements.get(id);
  };
  const storage = overrides.storage ?? new Map();
  const context = vm.createContext({
    ...wallet, ...overrides, document: { getElementById: get },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    restoreWallet: overrides.restoreWallet ?? (async () => ({ ok: false })),
  });
  vm.runInContext(source, context);
  return { get, context, storage, click: (id) => get(id).handlers.click({ currentTarget: get(id) }),
    connect(provider) { context.result = { provider, account: address, chainId: "0x1", wallet: "ynx" }; vm.runInContext("setConnected(result)", context); },
  };
}

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
  const ui = app({ restoreWallet: () => pending.promise });
  await ui.click("wallet-disconnect");
  pending.resolve({ ok: true, provider: { request() {} }, account: address, chainId: "0x1917", wallet: "ynx" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ui.get("connected-panel").hidden, true);
});

test("unsupported revoke shows manual guidance and keeps local connection", async () => {
  const ui = app({ revokeWallet: async () => { throw Object.assign(new Error("unsupported"), { code: 4200 }); } });
  ui.connect({ request() {} });
  await ui.click("wallet-revoke");
  assert.equal(ui.get("connected-panel").hidden, false);
  assert.match(ui.get("connected-wallet-status").textContent, /Remove this site's access in your wallet/);
});
