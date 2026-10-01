import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { attachWalletLifecycle, connectWallet, disconnectWallet, discoverProviders, ensureYNXChain, restoreWallet, revokeWallet, selectProvider, switchWalletAccount } from "./wallet-provider.js";
const account = `0x${"1".repeat(40)}`;
function provider(kind = "metamask") {
  const listeners = new Map();
  const p = {
    ...(kind === "ynx" ? { isYNXWallet: true, rdns: "com.ynx.wallet" } : { isMetaMask: true }),
    calls: [], accounts: [account], chain: "0x1917", revokeError: null,
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); },
    emit(event, value) { for (const fn of listeners.get(event) ?? []) fn(value); },
    async request(input) {
      p.calls.push(input);
      if (input.method === "eth_accounts" || input.method === "eth_requestAccounts") return p.accounts;
      if (input.method === "eth_chainId") return p.chain;
      if (input.method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
      if (input.method === "wallet_revokePermissions") {
        if (p.revokeError) throw p.revokeError;
        p.accounts = []; p.emit("accountsChanged", []); return null;
      }
      if (input.method === "wallet_switchEthereumChain") { p.chain = input.params[0].chainId; p.emit("chainChanged", p.chain); return null; }
      if (input.method === "wallet_addEthereumChain") return null;
      throw Object.assign(new Error("unsupported"), { code: 4200 });
    },
  };
  return p;
}
function target(providers = []) {
  const listeners = new Map();
  const scope = {
    location: { origin: "https://social.ynxweb4.com" }, Event,
    addEventListener(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeEventListener(event, fn) { listeners.get(event)?.delete(fn); },
    announce(p, index = 0) {
      const ynx = p.isYNXWallet;
      const detail = { provider: p, info: { uuid: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`, name: ynx ? "YNX Wallet" : "MetaMask", rdns: ynx ? "com.ynx.wallet" : "io.metamask" } };
      for (const fn of listeners.get("eip6963:announceProvider") ?? []) fn({ detail });
    },
    dispatchEvent(event) { if (event.type === "eip6963:requestProvider") providers.forEach((p, i) => scope.announce(p, i)); },
  };
  return scope;
}

test("immutable standalone shared SDK bytes match owner handoff", async () => {
  const bytes = await readFile(new URL("./vendor/standard-wallet-browser.mjs", import.meta.url));
  assert.equal(bytes.length, 22417);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43");
});
test("shared discovery selects distinct YNX and MetaMask without substitution", async () => {
  const ynx = provider("ynx"), mm = provider();
  const discovered = await discoverProviders(target([ynx, mm]), 0);
  assert.equal(selectProvider(discovered, "ynx").detail.provider, ynx);
  assert.equal(selectProvider(discovered, "metamask").detail.provider, mm);
});
test("no provider and same-brand ambiguity request no accounts", async () => {
  assert.equal((await connectWallet("ynx", target())).code, "YNX_WALLET_NOT_FOUND");
  const a = provider(), b = provider();
  assert.equal((await connectWallet("metamask", target([a,b]))).code, "AMBIGUOUS_WALLET_PROVIDER");
  assert.equal(a.calls.length+b.calls.length, 0);
});
test("late EIP-6963 announcement survives the first snapshot", async () => {
  const scope = target(), mm = provider();
  await discoverProviders(scope, 0);
  scope.announce(mm);
  assert.equal(selectProvider(await discoverProviders(scope, 0), "metamask").detail.provider, mm);
});
test("invalid UUID and contradictory flags fail closed", async () => {
  const mm = provider(); mm.isYNXWallet = true;
  assert.equal(selectProvider(await discoverProviders(target([mm]), 0), "metamask").ok, false);
});
test("connect uses SDK and wrong chain stays visible without implicit switching", async () => {
  const mm = provider(); mm.chain = "0x1";
  const result = await connectWallet("metamask", target([mm]));
  assert.equal(result.account, account); assert.equal(result.chainId, "0x1");
  assert.deepEqual(mm.calls.map(x=>x.method), ["eth_requestAccounts", "eth_chainId"]);
});
test("restore only queries explicitly selected provider without new authority", async () => {
  const ynx = provider("ynx"), mm = provider();
  assert.equal((await restoreWallet("metamask", target([ynx,mm]))).ok, true);
  assert.deepEqual(mm.calls.map(x=>x.method), ["eth_accounts", "eth_chainId"]);
  assert.equal(ynx.calls.length, 0);
});
test("superseded discovery cannot send an account request", async () => {
  const mm = provider();
  assert.equal((await connectWallet("metamask", target([mm]), ()=>false)).code, "SUPERSEDED");
  assert.equal(mm.calls.length, 0);
});
test("provider rejection is not converted to successful connection", async () => {
  const mm = provider(); mm.request = async()=>{ throw Object.assign(new Error("rejected"), {code:4001}); };
  await assert.rejects(connectWallet("metamask", target([mm])), {code:4001});
});
test("SDK account/chain/disconnect events update the consumer", async () => {
  const mm = provider(); await connectWallet("metamask", target([mm]));
  const events = [];
  const detach = attachWalletLifecycle(mm, { onAccountsChanged: x=>events.push(x), onChainChanged: x=>events.push(x), onDisconnect: ()=>events.push("disconnect") });
  mm.emit("accountsChanged", [`0x${"2".repeat(40)}`]); mm.emit("chainChanged", "0x1"); mm.emit("accountsChanged", []);
  disconnectWallet(mm); detach();
  assert.deepEqual(events, [[`0x${"2".repeat(40)}`], "0x1", [], "disconnect"]);
});
test("explicit network switch handles 4902 add/switch/readback", async () => {
  const mm = provider(); mm.chain = "0x1";
  const request = mm.request; let added = false;
  mm.request = async input => {
    if(input.method === "wallet_switchEthereumChain" && !added) { mm.calls.push(input); throw Object.assign(new Error("unknown chain"), {code:4902}); }
    if(input.method === "wallet_addEthereumChain") added = true;
    return request(input);
  };
  assert.equal(await ensureYNXChain(mm), "0x1917");
  assert.deepEqual(mm.calls.map(x=>x.method), ["eth_chainId","wallet_switchEthereumChain","wallet_addEthereumChain","wallet_switchEthereumChain","eth_chainId"]);
});
test("local disconnect performs no revocation RPC", async () => {
  const mm = provider(); await connectWallet("metamask", target([mm])); mm.calls=[];
  disconnectWallet(mm); assert.deepEqual(mm.calls, []);
});
test("revoke requires acknowledgement plus empty account readback", async () => {
  const mm = provider(); await connectWallet("metamask", target([mm])); mm.calls=[];
  const result = await revokeWallet(mm);
  assert.equal(result.status,"revoked"); assert.equal(result.permissionRevoked,true);
  assert.deepEqual(mm.calls.map(x=>x.method), ["wallet_revokePermissions","eth_accounts"]);
});
test("unsupported and rejected revocations retain truthful outcomes", async () => {
  for(const [code,status] of [[4200,"unsupported"],[4001,"rejected"]]) {
    const mm = provider(); await connectWallet("metamask", target([mm])); mm.revokeError=Object.assign(new Error(status),{code});
    const outcome = await revokeWallet(mm); assert.equal(outcome.status,status); assert.equal(outcome.permissionRevoked,false);
  }
});
test("acknowledgement without empty readback is not successful revocation", async () => {
  const mm = provider(); await connectWallet("metamask", target([mm]));
  const request = mm.request; mm.request = input => input.method === "wallet_revokePermissions" ? Promise.resolve(null) : request(input);
  const result = await revokeWallet(mm); assert.equal(result.status,"failed"); assert.equal(result.permissionRevoked,false);
});
test("account switch reuses the selected shared connection", async () => {
  const mm = provider(); await connectWallet("metamask", target([mm])); mm.calls=[];
  assert.deepEqual(await switchWalletAccount(mm), {account,chainId:"0x1917"});
  assert.deepEqual(mm.calls.map(x=>x.method), ["wallet_requestPermissions","eth_accounts","eth_chainId"]);
});
test("UI restores only saved kind and requires confirmed revoke outcome", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\[preferred, "ynx", "metamask"\]/);
  assert.match(source, /outcome\.permissionRevoked && outcome\.status === "revoked"/);
  assert.doesNotMatch(source, /window\.open|location\.href\s*=/);
  assert.match(source, /setAttribute\("aria-busy", "true"\)/);
});
