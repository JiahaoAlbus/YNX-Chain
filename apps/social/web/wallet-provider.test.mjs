import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { attachWalletLifecycle, connectWallet, restoreWallet, selectProvider } from "./wallet-provider.js";

function target(details) {
  const listeners = new Map();
  return {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(event) {
      if (event.type === "eip6963:requestProvider") for (const detail of details) listeners.get("eip6963:announceProvider")?.({ detail });
    },
    setTimeout(callback) { callback(); },
  };
}

test("selects exact YNX and MetaMask providers without substitution", () => {
  const ynx = { info: { uuid: "ynx", name: "YNX Wallet", rdns: "com.ynx.wallet" }, provider: { isYNXWallet: true } };
  const metamask = { info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" }, provider: { isMetaMask: true } };
  assert.equal(selectProvider([ynx, metamask], "ynx").detail, ynx);
  assert.equal(selectProvider([ynx, metamask], "metamask").detail, metamask);
  assert.equal(selectProvider([metamask], "ynx").code, "YNX_WALLET_NOT_FOUND");
  const ambiguous = { info: { uuid: "bad", name: "YNX Wallet", rdns: "com.ynx.wallet" }, provider: { isYNXWallet: true, isMetaMask: true } };
  assert.equal(selectProvider([ambiguous], "ynx").code, "YNX_WALLET_NOT_FOUND");
  assert.equal(selectProvider([ambiguous], "metamask").code, "METAMASK_NOT_FOUND");
});

test("connects MetaMask and adds then verifies YNX Testnet", async () => {
  const calls = [];
  let chain = "0x1";
  const provider = {
    isMetaMask: true,
    async request(input) {
      calls.push(input.method);
      if (input.method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (input.method === "eth_chainId") return chain;
      if (input.method === "wallet_switchEthereumChain") {
        if (!calls.includes("wallet_addEthereumChain")) throw Object.assign(new Error("missing"), { code: 4902 });
        chain = "0x1917";
        return null;
      }
      if (input.method === "wallet_addEthereumChain") return null;
      throw new Error(input.method);
    },
  };
  const result = await connectWallet("metamask", target([{ info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" }, provider }]));
  assert.equal(result.ok, true);
  assert.equal(result.chainId, "0x1917");
  assert.deepEqual(calls, ["eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]);
});

test("no provider returns an on-page result without navigation", async () => {
  assert.deepEqual(await connectWallet("ynx", target([])), { ok: false, code: "YNX_WALLET_NOT_FOUND" });
});

test("connection progress never destroys the wallet option markup", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /button\.textContent\s*=/);
  assert.match(source, /setAttribute\("aria-busy", "true"\)/);
  assert.match(source, /removeAttribute\("aria-busy"\)/);
});

test("discovers late EIP-6963 providers and legacy provider arrays", async () => {
  const ynxProvider = { isYNXWallet: true, request() {} };
  const legacy = target([]);
  legacy.ethereum = { providers: [ynxProvider] };
  const restored = await restoreWallet("ynx", {
    ...legacy,
    ethereum: { providers: [{ ...ynxProvider, async request({ method }) { return method === "eth_accounts" ? ["0x2222222222222222222222222222222222222222"] : "0x1917"; } }] },
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.wallet, "ynx");
});

test("refresh restore uses eth_accounts and eth_chainId without requesting authority", async () => {
  const calls = [];
  const provider = { isMetaMask: true, async request({ method }) { calls.push(method); return method === "eth_accounts" ? ["0x3333333333333333333333333333333333333333"] : "0x1917"; } };
  const restored = await restoreWallet("metamask", { ...target([]), ethereum: provider });
  assert.equal(restored.ok, true);
  assert.deepEqual(calls, ["eth_accounts", "eth_chainId"]);
});

test("provider events preserve connection until empty accounts or disconnect", () => {
  const listeners = new Map();
  const provider = { on(type, fn) { listeners.set(type, fn); }, removeListener(type) { listeners.delete(type); } };
  const observed = [];
  const detach = attachWalletLifecycle(provider, {
    onAccountsChanged: (accounts) => observed.push(["accounts", accounts]),
    onChainChanged: (chain) => observed.push(["chain", chain]),
    onDisconnect: () => observed.push(["disconnect"]),
  });
  listeners.get("accountsChanged")(["0x4444444444444444444444444444444444444444"]);
  listeners.get("chainChanged")("0x1917");
  listeners.get("disconnect")();
  assert.deepEqual(observed, [["accounts", ["0x4444444444444444444444444444444444444444"]], ["chain", "0x1917"], ["disconnect"]]);
  detach();
  assert.equal(listeners.size, 0);
});

test("web flow uses distinct logos and forbids custom-scheme or blank-tab launch", async () => {
  const [html, app, provider] = await Promise.all([
    readFile(new URL("./index.html", import.meta.url), "utf8"),
    readFile(new URL("./app.js", import.meta.url), "utf8"),
    readFile(new URL("./wallet-provider.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /assets\/ynx-wallet\.svg/);
  assert.match(html, /assets\/metamask\.svg/);
  assert.match(html, /wallet-switch-account/);
  assert.match(html, /wallet-revoke/);
  assert.match(html, /wallet-disconnect/);
  assert.doesNotMatch(`${html}\n${app}\n${provider}`, /window\.open|ynxwallet:|target=["']_blank/i);
  assert.match(app, /Private Social service degraded\. Standard wallet connection remains active/);
  assert.match(app, /if \(state\.provider\)/);
  assert.match(provider, /https:\/\/rpc\.ynxweb4\.com\/evm/);
});
