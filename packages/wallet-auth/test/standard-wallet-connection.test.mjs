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
