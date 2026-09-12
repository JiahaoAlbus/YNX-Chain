import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { EIP1193_PROVIDER_CODE, Eip1193ProviderError, StandardWalletConnection } from "../src/index.js";
import * as standardSubpath from "@ynx-chain/wallet-auth/standard-wallet-connection";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
function provider(handler) { return Object.assign(new EventEmitter(), { request: handler }); }
function connection(wallet) { return new StandardWalletConnection({ provider: wallet, origin: "https://external.example", metadata: { name: "External EVM DApp", url: "https://external.example" } }); }

test("standard EIP-1193 connection needs no Gateway, registry, Product Session, device proof or YNX callback", async () => {
  assert.equal(standardSubpath.StandardWalletConnection, StandardWalletConnection);
  assert.equal(Object.hasOwn(standardSubpath, "ProductSessionGatewayKernel"), false);
  const calls = []; const wallet = provider(async (input) => { calls.push(input); return input.method === "eth_requestAccounts" ? [ACCOUNT] : "0x1917"; });
  const session = await connection(wallet).connect();
  assert.deepEqual(calls, [{ method: "eth_requestAccounts" }, { method: "eth_chainId" }]);
  assert.equal(session.transport, "eip1193"); assert.equal(session.selectedAccount, ACCOUNT); assert.equal(session.selectedChain, "0x1917");
  assert.equal("productSession" in session, false); assert.equal("deviceProof" in session, false); assert.equal("ynxAddress" in session, false);
});

test("standard transport allows approved EIP-1193 requests, but rejects raw eth_sign and unknown methods", async () => {
  const calls = []; const wallet = provider(async (input) => { calls.push(input); return "ok"; }); const client = connection(wallet);
  assert.equal(await client.request({ method: "personal_sign", params: ["0x01", ACCOUNT] }), "ok");
  await assert.rejects(client.request({ method: "eth_sign", params: [ACCOUNT, "0x01"] }), providerCode(4200));
  await assert.rejects(client.request({ method: "wallet_sendCalls", params: [] }), providerCode(4200));
  assert.deepEqual(calls, [{ method: "personal_sign", params: ["0x01", ACCOUNT] }]);
});

test("provider errors retain EIP-1193 codes and do not collapse into a YNX Gateway failure", async () => {
  for (const code of [4001, 4100, 4200, 4900, 4901, 4902]) {
    const client = connection(provider(async () => { throw Object.assign(new Error("provider refusal"), { code }); }));
    await assert.rejects(client.request({ method: "eth_accounts" }), providerCode(code));
  }
});

test("account, chain and disconnect events update only the standard connection lifecycle", async () => {
  const wallet = provider(async (input) => input.method === "eth_requestAccounts" ? [ACCOUNT] : "0x1917"); const client = connection(wallet);
  const events = []; client.subscribe((event) => events.push(event)); await client.connect();
  wallet.emit("accountsChanged", ["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"]);
  assert.equal(client.current.selectedAccount, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  wallet.emit("chainChanged", "0x1"); assert.equal(client.current.selectedChain, "0x1");
  wallet.emit("disconnect", { code: 4900 }); assert.equal(client.current, null);
  assert.deepEqual(events.map(({ event }) => event), ["accountsChanged", "chainChanged", "disconnect"]);
});

test("malformed origins, metadata and account results fail closed", async () => {
  const wallet = provider(async () => []);
  assert.throws(() => new StandardWalletConnection({ provider: wallet, origin: "http://external.example", metadata: { name: "DApp", url: "https://external.example" } }), providerCode(4100));
  assert.throws(() => new StandardWalletConnection({ provider: wallet, origin: "https://external.example", metadata: { name: "DApp", url: "http://other.example" } }), providerCode(4100));
  await assert.rejects(connection(wallet).connect(), providerCode(4100));
});

test("disconnect or account revocation cannot be overwritten by an outstanding connect", async () => {
  for (const cancel of [client => client.disconnect(), (_client, wallet) => wallet.emit("disconnect", { code: 4900 }), (_client, wallet) => wallet.emit("accountsChanged", [])]) {
    const chain = Promise.withResolvers(), queryingChain = Promise.withResolvers();
    const wallet = provider(async ({ method }) => {
      if (method === "eth_requestAccounts") return [ACCOUNT];
      queryingChain.resolve(); return chain.promise;
    });
    const client = connection(wallet), connecting = client.connect();
    const rejected = assert.rejects(connecting, providerCode(4100));
    await queryingChain.promise;
    cancel(client, wallet); chain.resolve("0x1917");
    await rejected;
    assert.equal(client.current, null);
  }
});

test("connect reconciles account and chain changes received while its RPC reads are pending", async () => {
  const chain = Promise.withResolvers(), queryingChain = Promise.withResolvers();
  const wallet = provider(async ({ method }) => {
    if (method === "eth_requestAccounts") return [ACCOUNT];
    queryingChain.resolve(); return chain.promise;
  });
  const client = connection(wallet), connecting = client.connect();
  await queryingChain.promise;
  const nextAccount = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  wallet.emit("accountsChanged", [nextAccount]);
  wallet.emit("chainChanged", "0xA");
  chain.resolve("0x1917");
  const session = await connecting;
  assert.equal(session.selectedAccount, nextAccount);
  assert.equal(session.selectedChain, "0xa");
});

test("account revocation preserves accountsChanged without inventing an RPC disconnect", async () => {
  const wallet = provider(async ({ method }) => method === "eth_requestAccounts" ? [ACCOUNT] : "0x1917");
  const client = connection(wallet), events = [];
  client.subscribe(event => events.push(event));
  await client.connect(); wallet.emit("accountsChanged", []);
  assert.equal(client.current, null);
  assert.deepEqual(events, [{ event: "accountsChanged", value: [] }]);
  assert.equal(await client.request({ method: "eth_chainId" }), "0x1917");
});

test("local disconnect removes only its listeners and reconnect attaches them once", async () => {
  const wallet = provider(async ({ method }) => method === "eth_requestAccounts" ? [ACCOUNT] : "0x1917");
  const otherListener = () => {};
  wallet.on("accountsChanged", otherListener);
  const client = connection(wallet), events = [];
  client.subscribe(event => events.push(event));
  await client.connect(); client.disconnect();
  assert.deepEqual(wallet.listeners("accountsChanged"), [otherListener]);
  wallet.emit("chainChanged", "0x1");
  assert.deepEqual(events.map(({ event }) => event), ["disconnect"]);
  await client.connect();
  assert.equal(wallet.listenerCount("accountsChanged"), 2);
  wallet.emit("accountsChanged", [ACCOUNT]);
  assert.deepEqual(events.map(({ event }) => event), ["disconnect", "accountsChanged"]);
});

test("provider reconnection remains observable after a transport disconnect", async () => {
  const wallet = provider(async ({ method }) => method === "eth_requestAccounts" ? [ACCOUNT] : "0x1917");
  const client = connection(wallet), events = [];
  client.subscribe(event => events.push(event));
  await client.connect();
  wallet.emit("disconnect", { code: 4900 });
  wallet.emit("connect", { chainId: "0x1917" });
  assert.equal(client.current, null);
  assert.deepEqual(events.map(({ event }) => event), ["disconnect", "connect"]);
  assert.equal((await client.connect()).selectedAccount, ACCOUNT);
});

test("connect rejects malformed chain results before creating a session", async () => {
  for (const chain of [6423, "6423", "0x01917", null]) {
    const client = connection(provider(async ({ method }) => method === "eth_requestAccounts" ? [ACCOUNT] : chain));
    await assert.rejects(client.connect(), providerCode(4901));
    assert.equal(client.current, null);
  }
});

function providerCode(expected) { return (error) => error instanceof Eip1193ProviderError && error.code === expected; }

const OTHER_ACCOUNT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const deferred = () => Promise.withResolvers();

test("restore silently uses only its constructor-selected provider", async () => {
  const calls = [], otherCalls = [];
  const config = { provider: provider(async input => { calls.push(input); return input.method === "eth_accounts" ? [ACCOUNT] : "0xA"; }), origin: "https://external.example", metadata: { name: "DApp", url: "https://external.example" } };
  const client = new StandardWalletConnection(config); config.provider = provider(async input => otherCalls.push(input));
  const session = await client.restore();
  assert.equal(session.selectedAccount, ACCOUNT); assert.equal(session.selectedChain, "0xa");
  assert.equal("productSession" in session, false);
  assert.deepEqual(calls, [{ method: "eth_accounts" }, { method: "eth_chainId" }]); assert.deepEqual(otherCalls, []);
});

test("restore empty and malformed reads never request permission", async () => {
  for (const [accounts, chain, error] of [[[], "0x1", null], [null, "0x1", 4100], [["bad"], "0x1", 4100], [[ACCOUNT], "0x01", 4901]]) {
    const calls = []; const client = connection(provider(async ({ method }) => { calls.push(method); return method === "eth_accounts" ? accounts : chain; }));
    if (error) await assert.rejects(client.restore(), providerCode(error)); else assert.equal(await client.restore(), null);
    assert.equal(client.current, null); assert.equal(calls.some(m => m !== "eth_accounts" && m !== "eth_chainId"), false);
    if (Array.isArray(accounts) && !accounts.length) assert.deepEqual(calls, ["eth_accounts"]);
  }
  let accounts = [ACCOUNT]; const client = connection(provider(async ({ method }) => method === "eth_chainId" ? "0x1" : accounts));
  await client.connect(); accounts = []; assert.equal(await client.restore(), null); assert.equal(client.current, null);
});

test("restore is fenced at both awaits by disconnect, provider revocation and newer intents", async () => {
  for (const stage of ["eth_accounts", "eth_chainId"]) for (const action of ["local", "provider", "revoked", "connect", "restore"]) {
    const pending = deferred(), entered = deferred(); let hold = true;
    const wallet = provider(async ({ method }) => { if (hold && method === stage) { hold = false; entered.resolve(); return pending.promise; } return method === "eth_chainId" ? "0xa" : [OTHER_ACCOUNT]; });
    const client = connection(wallet), old = client.restore(), rejected = assert.rejects(old, providerCode(4100)); await entered.promise;
    if (action === "local") client.disconnect(); else if (action === "provider") wallet.emit("disconnect", { code: 4900 }); else if (action === "revoked") wallet.emit("accountsChanged", []); else await client[action]();
    pending.resolve(stage === "eth_accounts" ? [ACCOUNT] : "0x1917"); await rejected;
    assert.equal(client.current?.selectedAccount ?? null, ["connect", "restore"].includes(action) ? OTHER_ACCOUNT : null);
  }
});

test("stale restore rejection and removed event handlers cannot affect a fresh session", async () => {
  const pending = deferred(); let wait = true;
  const wallet = provider(async ({ method }) => wait ? pending.promise : method === "eth_chainId" ? "0x1" : [OTHER_ACCOUNT]);
  const client = connection(wallet), oldHandler = wallet.listeners("accountsChanged")[0];
  const old = client.restore(), rejected = assert.rejects(old, providerCode(4100)); client.disconnect(); wait = false;
  await client.restore(); oldHandler([]); pending.reject(Object.assign(Error("old refusal"), { code: 4001 })); await rejected;
  assert.equal(client.current.selectedAccount, OTHER_ACCOUNT); assert.equal(wallet.listenerCount("accountsChanged"), 1);
});

test("restore reconciles account and chain events while chain read is pending", async () => {
  const pending = deferred(), entered = deferred();
  const wallet = provider(async ({ method }) => { if (method === "eth_chainId") { entered.resolve(); return pending.promise; } return [ACCOUNT]; });
  const client = connection(wallet), restoring = client.restore(); await entered.promise;
  wallet.emit("accountsChanged", [OTHER_ACCOUNT]); wallet.emit("chainChanged", "0xA"); pending.resolve("0x1917");
  const session = await restoring; assert.equal(session.selectedAccount, OTHER_ACCOUNT); assert.equal(session.selectedChain, "0xa");
});

test("explicit revoke requires acknowledgement and empty readback; expected provider events do not cancel it", async () => {
  for (const acknowledgement of [null, {}]) {
    const calls = [], pending = deferred(), entered = deferred(); let revoked = false;
    const wallet = provider(async input => { calls.push(input); if (input.method === "wallet_revokePermissions") { revoked = true; wallet.emit("accountsChanged", []); wallet.emit("disconnect", { code: 4900 }); entered.resolve(); return pending.promise; } return input.method === "eth_chainId" ? "0x1917" : revoked ? [] : [ACCOUNT]; });
    const client = connection(wallet); await client.connect(); calls.length = 0;
    const first = client.revoke(); assert.equal(client.revoke(), first); await entered.promise; assert.equal(client.revoke(), first); pending.resolve(acknowledgement);
    assert.deepEqual(await first, { status: "revoked", permissionRevoked: true, locallyDisconnected: true });
    assert.equal(client.current, null); assert.equal(wallet.listenerCount("accountsChanged"), 0);
    assert.deepEqual(calls, [{ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }, { method: "eth_accounts" }]);
  }
});

test("revoke unsupported, rejected and failed outcomes preserve local state", async () => {
  for (const [code, status, normalized] of [[4200, "unsupported", 4200], [-32601, "unsupported", 4200], ["-32601", "unsupported", 4200], [4001, "rejected", 4001], [4100, "failed", 4100], [-32000, "failed", 4900]]) {
    const calls = []; const wallet = provider(async ({ method }) => { calls.push(method); if (method === "wallet_revokePermissions") throw Object.assign(Error("refusal"), { code }); return method === "eth_chainId" ? "0x1917" : [ACCOUNT]; });
    const client = connection(wallet), session = await client.connect(); calls.length = 0;
    const r = await client.revoke(); assert.equal(r.status, status); assert.equal(r.error.code, normalized); assert.equal(r.permissionRevoked, false); assert.equal(r.locallyDisconnected, false); assert.equal(client.current, session);
    assert.deepEqual(calls, ["wallet_revokePermissions"]); assert.equal(wallet.listenerCount("accountsChanged"), 1);
  }
});

test("revoke readback failure and malformed acknowledgements do not claim permission loss", async () => {
  for (const [ack, readback] of [[null, [ACCOUNT]], [null, null], [null, {}], [null, Object.assign(Error("unsupported readback"), { code: 4200 })], [undefined, []], [false, []], [true, []], [[], []], ["ok", []], [{ error: "not revoked" }, []]]) {
    const calls = []; const wallet = provider(async ({ method }) => { calls.push(method); if (method === "wallet_revokePermissions") return ack; if (method === "eth_accounts") { if (readback instanceof Error) throw readback; return readback; } return method === "eth_chainId" ? "0x1" : [ACCOUNT]; });
    const client = connection(wallet), session = await client.connect(); calls.length = 0;
    const r = await client.revoke(); assert.equal(r.status, "failed"); assert.equal(r.permissionRevoked, false); assert.equal(r.locallyDisconnected, false); assert.equal(client.current, session);
    if (ack !== null) assert.deepEqual(calls, ["wallet_revokePermissions"]);
  }
});

test("new connect at either revoke await prevents old local cleanup", async () => {
  for (const stage of ["wallet_revokePermissions", "eth_accounts"]) {
    const pending = deferred(), entered = deferred(); let hold = true;
    const wallet = provider(async ({ method }) => { if (hold && method === stage) { hold = false; entered.resolve(); return pending.promise; } return method === "wallet_revokePermissions" ? null : method === "eth_chainId" ? "0xa" : [OTHER_ACCOUNT]; });
    const client = connection(wallet); await client.connect(); const revoking = client.revoke(); await entered.promise;
    const session = await client.connect(); pending.resolve(stage === "eth_accounts" ? [] : null);
    const r = await revoking; assert.equal(r.status, "superseded"); assert.equal(r.error.code, 4100); assert.equal(r.permissionRevoked, false); assert.equal(r.locallyDisconnected, false); assert.equal(client.current, session);
  }
});

test("account event during revoke readback beats the stale empty response", async () => {
  const pending = deferred(), entered = deferred();
  const wallet = provider(async ({ method }) => { if (method === "wallet_revokePermissions") return null; if (method === "eth_accounts") { entered.resolve(); return pending.promise; } return method === "eth_chainId" ? "0x1" : [ACCOUNT]; });
  const client = connection(wallet); await client.connect(); const revoking = client.revoke(); await entered.promise;
  wallet.emit("accountsChanged", [OTHER_ACCOUNT]); pending.resolve([]);
  assert.equal((await revoking).status, "failed"); assert.equal(client.current.selectedAccount, OTHER_ACCOUNT);
});

test("local disconnect cancels a queued revoke before any RPC and remains local only", async () => {
  const calls = [], client = connection(provider(async input => calls.push(input)));
  const revoking = client.revoke(); client.disconnect(); assert.deepEqual(calls, []);
  const r = await revoking; assert.equal(r.status, "superseded"); assert.equal(r.permissionRevoked, false); assert.equal(r.locallyDisconnected, true);
});

test("old revoke finally cannot erase a replacement single flight", async () => {
  const one = deferred(), two = deferred(), enteredOne = deferred(), enteredTwo = deferred(); let count = 0;
  const wallet = provider(async ({ method }) => { if (method === "wallet_revokePermissions") { if (++count === 1) { enteredOne.resolve(); return one.promise; } enteredTwo.resolve(); return two.promise; } return []; });
  const client = connection(wallet), first = client.revoke(); await enteredOne.promise; client.disconnect();
  const second = client.revoke(); await enteredTwo.promise; one.resolve(null); assert.equal((await first).status, "superseded"); assert.equal(client.revoke(), second);
  two.resolve(null); assert.equal((await second).status, "revoked"); assert.equal(count, 2);
});

test("revoke completion may reenter connect without losing its session or listeners", async () => {
  let reconnect;
  const wallet = provider(async ({ method }) => method === "wallet_revokePermissions" ? null : method === "eth_accounts" ? [] : method === "eth_chainId" ? "0x1" : [OTHER_ACCOUNT]);
  const client = connection(wallet); await client.connect();
  client.subscribe(({ event }) => { if (event === "disconnect") reconnect = client.connect(); });
  assert.equal((await client.revoke()).status, "revoked"); await reconnect;
  assert.equal(client.current.selectedAccount, OTHER_ACCOUNT); assert.equal(wallet.listenerCount("accountsChanged"), 1);
});
