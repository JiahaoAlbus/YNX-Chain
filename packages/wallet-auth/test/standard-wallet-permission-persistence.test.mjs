import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryStandardWalletPermissionStorage,
  serializeStandardWalletPermissionSnapshot,
  StandardWalletProviderEngine,
  StandardWalletProviderError,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const ORIGIN = "https://external-dapp.example";
const SIGNATURE = `0x${"12".repeat(65)}`;
const HASH = `0x${"34".repeat(32)}`;

function engine(storage, overrides = {}) {
  return new StandardWalletProviderEngine({
    origin: ORIGIN,
    walletAccounts: [ACCOUNT, OTHER],
    approveAccounts: async () => [ACCOUNT],
    permissionStorage: storage,
    signMessage: async () => SIGNATURE,
    signTypedData: async () => SIGNATURE,
    sendTransaction: async () => HASH,
    ...overrides,
  });
}

test("approved account authority is origin-bound, canonical and restored after restart", async () => {
  const storage = new InMemoryStandardWalletPermissionStorage();
  const first = engine(storage);
  assert.deepEqual(await first.request({ method: "eth_requestAccounts" }), [ACCOUNT]);

  let prompted = 0;
  const restarted = engine(storage, { approveAccounts: async () => { prompted += 1; throw new Error("must not prompt during restore"); } });
  const events = [];
  restarted.on("accountsChanged", (value) => events.push(["accountsChanged", value]));
  restarted.on("connect", (value) => events.push(["connect", value]));
  assert.equal((await restarted.restorePermissions()).connected, true);
  assert.deepEqual(await restarted.request({ method: "eth_accounts" }), [ACCOUNT]);
  assert.equal(prompted, 0);
  assert.deepEqual(events.map(([name]) => name), ["accountsChanged", "connect"]);

  const anotherOrigin = new StandardWalletProviderEngine({
    origin: "https://another-dapp.example",
    walletAccounts: [ACCOUNT],
    approveAccounts: async () => [ACCOUNT],
    permissionStorage: storage,
  });
  assert.equal((await anotherOrigin.restorePermissions()).connected, false);
  assert.deepEqual(await anotherOrigin.request({ method: "eth_accounts" }), []);
});

test("wallet_revokePermissions clears durable authority and emits the canonical disconnect transition", async () => {
  const storage = new InMemoryStandardWalletPermissionStorage();
  const provider = engine(storage);
  const events = [];
  provider.on("accountsChanged", (value) => events.push(["accountsChanged", value]));
  provider.on("disconnect", (value) => events.push(["disconnect", value]));
  await provider.request({ method: "eth_requestAccounts" });
  events.length = 0;
  assert.equal(await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }), null);
  assert.deepEqual(events.map(([name]) => name), ["accountsChanged", "disconnect"]);
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
  await assert.rejects(provider.request({ method: "personal_sign", params: ["0x00", ACCOUNT] }), rpcCode(4100));

  const restarted = engine(storage);
  assert.equal((await restarted.restorePermissions()).connected, false);
  assert.deepEqual(await restarted.request({ method: "eth_accounts" }), []);
});

test("account rejection creates no authority and callback errors never fabricate signing or transaction success", async () => {
  const storage = new InMemoryStandardWalletPermissionStorage();
  const rejected = engine(storage, { approveAccounts: async () => { const error = new Error("user said no"); error.code = 4001; throw error; } });
  await assert.rejects(rejected.request({ method: "eth_requestAccounts" }), rpcCode(4001));
  assert.deepEqual(await rejected.request({ method: "eth_accounts" }), []);
  assert.equal((await engine(storage).restorePermissions()).connected, false);

  const provider = engine(storage, {
    signMessage: async () => { const error = new Error("declined"); error.code = 4001; throw error; },
    signTypedData: async () => { throw new Error("secure signer unavailable"); },
    sendTransaction: async () => "not-a-transaction-hash",
  });
  await provider.request({ method: "eth_requestAccounts" });
  await assert.rejects(provider.request({ method: "personal_sign", params: ["0x00", ACCOUNT] }), rpcCode(4001));
  await assert.rejects(provider.request({ method: "eth_signTypedData_v4", params: [ACCOUNT, { domain: {}, types: { Mail: [] }, primaryType: "Mail", message: {} }] }), rpcCode(-32603));
  await assert.rejects(provider.request({ method: "eth_sendTransaction", params: [{ from: ACCOUNT, to: OTHER, value: "0x1" }] }), rpcCode(-32603));
});

test("noncanonical, wrong-origin and unavailable-account snapshots fail closed", async () => {
  const valid = serializeStandardWalletPermissionSnapshot({ schemaVersion: 1, origin: ORIGIN, chainId: "0x1917", accounts: [ACCOUNT] });
  for (const encoded of [
    valid.trimEnd(),
    `${valid.trimEnd()} \n`,
    JSON.stringify({ schemaVersion: 1, origin: "https://other.example", chainId: "0x1917", accounts: [ACCOUNT] }),
    JSON.stringify({ schemaVersion: 1, origin: ORIGIN, chainId: "0x1917", accounts: [OTHER], extra: true }),
  ]) {
    const storage = { load: async () => encoded, save: async () => {}, clear: async () => {} };
    await assert.rejects(engine(storage, { walletAccounts: [ACCOUNT] }).restorePermissions(), rpcCode(4100));
  }
});

test("approval persistence and inventory removal linearize without restart resurrection", async () => {
  let releaseSave;
  const saveBlocked = new Promise((resolve) => { releaseSave = resolve; });
  let saveStartedResolve;
  const saveStarted = new Promise((resolve) => { saveStartedResolve = resolve; });
  const records = new Map();
  const storage = {
    load: async ({ origin }) => records.get(origin) ?? null,
    save: async (snapshot) => { records.set(snapshot.origin, serializeStandardWalletPermissionSnapshot(snapshot)); saveStartedResolve(); await saveBlocked; },
    clear: async ({ origin }) => { records.delete(origin); },
  };
  const provider = engine(storage);
  const approval = provider.request({ method: "eth_requestAccounts" });
  await saveStarted;
  const replacement = provider.replaceWalletAccounts([OTHER]);
  releaseSave();
  await assert.rejects(approval, rpcCode(4100));
  assert.equal((await replacement).connected, false);
  assert.equal((await engine(storage, { walletAccounts: [OTHER] }).restorePermissions()).connected, false);
});

test("disconnect wins an in-flight account approval without connect events or restart resurrection", async () => {
  const storage = new InMemoryStandardWalletPermissionStorage();
  let releaseApproval;
  const blockedApproval = new Promise((resolve) => { releaseApproval = resolve; });
  const provider = engine(storage, { approveAccounts: async () => blockedApproval });
  const events = [];
  provider.on("accountsChanged", (accounts) => events.push(["accountsChanged", accounts]));
  provider.on("connect", (payload) => events.push(["connect", payload]));
  provider.on("disconnect", (payload) => events.push(["disconnect", payload]));
  const pending = provider.request({ method: "eth_requestAccounts" });
  assert.equal((await provider.disconnect()).connected, false);
  releaseApproval([ACCOUNT]);
  await assert.rejects(pending, rpcCode(4100));
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
  assert.deepEqual(events.map(([name]) => name), ["disconnect"]);
  assert.equal((await engine(storage).restorePermissions()).connected, false);
});

test("wallet_revokePermissions wins an in-flight approval without publishing any account authority", async () => {
  const storage = new InMemoryStandardWalletPermissionStorage();
  let releaseApproval;
  const blockedApproval = new Promise((resolve) => { releaseApproval = resolve; });
  const provider = engine(storage, { approveAccounts: async () => blockedApproval });
  const events = [];
  provider.on("accountsChanged", (accounts) => events.push(["accountsChanged", accounts]));
  provider.on("connect", (payload) => events.push(["connect", payload]));
  provider.on("disconnect", (payload) => events.push(["disconnect", payload]));
  const pending = provider.request({ method: "eth_requestAccounts" });
  assert.equal(await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }), null);
  releaseApproval([ACCOUNT]);
  await assert.rejects(pending, rpcCode(4100));
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
  assert.deepEqual(events, []);
  assert.equal((await engine(storage).restorePermissions()).connected, false);
});

test("durable mutation failures do not report revocation or replacement success", async () => {
  const backing = new InMemoryStandardWalletPermissionStorage();
  const provider = engine(backing);
  await provider.request({ method: "eth_requestAccounts" });
  const failing = {
    load: (input) => backing.load(input),
    save: (snapshot) => backing.save(snapshot),
    clear: async () => { throw new Error("disk unavailable"); },
  };
  const restarted = engine(failing);
  await restarted.restorePermissions();
  await assert.rejects(restarted.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }), rpcCode(4100));
  assert.deepEqual(await restarted.request({ method: "eth_accounts" }), [ACCOUNT]);
  await assert.rejects(restarted.replaceWalletAccounts([OTHER]), rpcCode(4100));
  assert.deepEqual(await restarted.request({ method: "eth_accounts" }), [ACCOUNT]);
});

function rpcCode(expected) { return (error) => error instanceof StandardWalletProviderError && error.code === expected; }
