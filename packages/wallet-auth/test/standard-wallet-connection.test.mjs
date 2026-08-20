import assert from "node:assert/strict";
import { test } from "node:test";
import { EIP1193_PROVIDER_CODE, Eip1193ProviderError, StandardWalletConnection } from "../src/index.js";
import * as standardSubpath from "@ynx-chain/wallet-auth/standard-wallet-connection";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
function provider(handler) { const listeners = new Map(); return { request: handler, on(event, listener) { listeners.set(event, listener); }, emit(event, value) { listeners.get(event)?.(value); } }; }
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

function providerCode(expected) { return (error) => error instanceof Eip1193ProviderError && error.code === expected; }
