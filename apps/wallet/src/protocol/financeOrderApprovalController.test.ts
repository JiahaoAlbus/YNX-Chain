import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFinanceOrderApprovalRequest, encodeFinanceOrderApprovalWalletURL,
  parseFinanceOrderApprovalReturnURL, walletIdentity,
  type FinanceOrderApprovalUnsigned,
} from "@ynx-chain/wallet-auth";
import { FINANCE_ORDER_APPROVAL_REPLAY_KEY, FinanceOrderApprovalController } from "./financeOrderApprovalController";
import { PRODUCT_SESSION_REGISTRY as registry } from "./registry";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";

const vector = JSON.parse(readFileSync(new URL("../../../../packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json", import.meta.url), "utf8")).positive;
const SECRET = vector.testOnlyPublicSecretScalarHex as string;
const NOW = Date.parse("2026-09-19T09:00:30.000Z");
const account: WalletAccount = { ...walletIdentity(SECRET), label: "Synthetic Finance", backupConfirmed: true, createdAt: new Date(NOW).toISOString() };
const other: WalletAccount = { ...walletIdentity("0".repeat(63) + "2"), label: "Other", backupConfirmed: true, createdAt: new Date(NOW).toISOString() };
const unsigned = vector.unsigned as FinanceOrderApprovalUnsigned;

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(values = new Map<string, string>()) {
  const state = { now: NOW, selected: account as WalletAccount | null, secret: SECRET, keys: 0, times: 0, failTime: false, opens: [] as string[], writes: [] as string[], failOpen: false, dropWrite: false, afterGet: null as null | (() => Promise<void>), afterSet: null as null | ((raw: string) => Promise<void>), keyGate: null as ReturnType<typeof deferred> | null, keyStarted: deferred() };
  const storage: SecureStorageAdapter = {
    async getItem(key) { assert.equal(key, FINANCE_ORDER_APPROVAL_REPLAY_KEY); const value = values.get(key) ?? null; await state.afterGet?.(); return value; },
    async setItem(key, value) { assert.equal(key, FINANCE_ORDER_APPROVAL_REPLAY_KEY); state.writes.push(value); if (!state.dropWrite) values.set(key, value); await state.afterSet?.(value); },
    async deleteItem() { throw new Error("Finance approval journal must never be deleted"); },
  };
  const controller = () => new FinanceOrderApprovalController({
    storage, selectedAccount: () => state.selected, currentTime: async assertCurrent => { assertCurrent(); state.times++; if (state.failTime) throw new Error("Auth time unavailable"); return new Date(state.now); },
    withAccountSecret: async (id, assertCurrent, use) => { assert.equal(id, account.account); assertCurrent(); state.keys++; state.keyStarted.resolve(); await state.keyGate?.promise; assertCurrent(); return use(state.secret, assertCurrent); },
    openURL: async url => { state.opens.push(url); if (state.failOpen) throw new Error("Callback unavailable"); },
  });
  const request = (change: Partial<FinanceOrderApprovalUnsigned> = {}) => createFinanceOrderApprovalRequest({ ...unsigned, ...change }, new Date(state.now));
  const url = (value = request()) => encodeFinanceOrderApprovalWalletURL(value, new Date(state.now));
  return { state, values, controller, request, url };
}

test("approves the exact frozen Sandbox order and returns no broker execution claim", async () => {
  const f = fixture(), c = f.controller(), request = f.request(), review = await c.receive(f.url(request));
  assert.equal(review.request.unsigned.order.symbol, "ACME"); assert.equal(f.state.keys, 0);
  await c.approve(review.id);
  assert.equal(f.state.keys, 1); assert.equal(f.state.opens.length, 1); assert.equal(c.current, null);
  const result = parseFinanceOrderApprovalReturnURL(registry, f.state.opens[0]!, request, new Date(f.state.now));
  assert.equal(result.status, "approved");
  if (result.status !== "approved") assert.fail("Expected approval");
  assert.deepEqual(result.approval.order, unsigned.order);
  assert.equal(f.state.writes.some(raw => raw.includes(SECRET)), false);
  assert.deepEqual(f.state.writes.map(raw => JSON.parse(raw).records[0].status), ["reserved", "approved"]);
});

test("rejects without key access and restores the exact durable callback", async () => {
  const f = fixture(), c = f.controller(), request = f.request(), review = await c.receive(f.url(request)); f.state.failOpen = true;
  await assert.rejects(c.reject(review.id), /Callback/); assert.equal(f.state.keys, 0); const original = f.state.opens[0]!;
  c.cancel(); const next = f.controller(), restored = await next.receive(f.url(request)); f.state.failOpen = false; await next.retryReturn(restored.id);
  assert.equal(f.state.opens[1], original); assert.equal(parseFinanceOrderApprovalReturnURL(registry, original, request, new Date(unsigned.issuedAt)).status, "rejected");
});

test("approved callback failure reloads the exact request proof and never signs twice", async () => {
  const f = fixture(), c = f.controller(), request = f.request(), review = await c.receive(f.url(request)); f.state.now += 45_000; f.state.failOpen = true;
  await assert.rejects(c.approve(review.id), /Callback/); const saved = JSON.parse(f.values.get(FINANCE_ORDER_APPROVAL_REPLAY_KEY)!).records[0];
  assert.equal(saved.approval.issuedAt, unsigned.issuedAt);
  const restart = fixture(f.values); restart.state.now = NOW + 60_000; const next = restart.controller(), old = await next.receive(restart.url(request));
  await assert.rejects(next.approve(old.id), /local decision/); await next.retryReturn(old.id);
  assert.equal(restart.state.opens[0], saved.returnURL); assert.equal(restart.state.keys, 0); assert.equal(restart.state.writes.length, 0);
});

test("creates a separately signed unused-proof revocation and persists it before return", async () => {
  const f = fixture(), c = f.controller(), request = f.request(), review = await c.receive(f.url(request)); f.state.failOpen = true;
  await assert.rejects(c.approve(review.id)); assert.equal(c.canRevoke(review.id), true); f.state.failOpen = false; f.state.now += 1_000;
  await c.revokeUnused(review.id); assert.equal(f.state.keys, 2); assert.deepEqual(f.state.writes.map(raw => JSON.parse(raw).records[0].status), ["reserved", "approved", "revoked"]);
  const approval = JSON.parse(f.state.writes[1]!).records[0].approval;
  assert.equal(parseFinanceOrderApprovalReturnURL(registry, f.state.opens.at(-1)!, request, new Date(f.state.now), approval).status, "revoked");
});

test("account mismatch, missing backup and wrong decrypted key fail before a signature", async () => {
  const f = fixture(); f.state.selected = other; await assert.rejects(f.controller().receive(f.url()), /exact Wallet account/);
  f.state.selected = { ...account, backupConfirmed: false }; const c = f.controller(), review = await c.receive(f.url()); await assert.rejects(c.approve(review.id), /backup/); assert.equal(f.state.keys, 0);
  const wrong = fixture(); wrong.state.secret = "0".repeat(63) + "2"; const wc = wrong.controller(), wr = await wc.receive(wrong.url()); await assert.rejects(wc.approve(wr.id), /Stored signing account/); assert.equal(wrong.state.writes.length, 0);
});

test("unavailable Auth time fails closed before Wallet reads the signing key", async () => {
  const f = fixture(), c = f.controller(), review = await c.receive(f.url()); f.state.failTime = true;
  await assert.rejects(c.approve(review.id), /Auth time/); assert.equal(f.state.keys, 0); assert.equal(f.state.writes.length, 0); assert.equal(f.state.opens.length, 0);
});

test("expiry during reservation persistence cannot create or store a signed approval", async () => {
  const f = fixture(), c = f.controller(), review = await c.receive(f.url());
  f.state.afterSet = async raw => { if (JSON.parse(raw).records[0].status === "reserved") f.state.now = Date.parse(unsigned.expiresAt); };
  await assert.rejects(c.approve(review.id), /active|expired/i);
  assert.equal(f.state.opens.length, 0); assert.equal(f.state.writes.length, 1);
  const row = JSON.parse(f.values.get(FINANCE_ORDER_APPROVAL_REPLAY_KEY)!).records[0]; assert.equal(row.status, "reserved"); assert.equal(row.approval, null);
});

test("expiry during revocation journal read cannot create or store a revocation signature", async () => {
  const f = fixture(), c = f.controller(), review = await c.receive(f.url()); f.state.failOpen = true; await assert.rejects(c.approve(review.id)); f.state.failOpen = false;
  f.state.afterGet = async () => { f.state.afterGet = null; f.state.now = Date.parse(unsigned.expiresAt); };
  await assert.rejects(c.revokeUnused(review.id), /active|expired/i);
  const row = JSON.parse(f.values.get(FINANCE_ORDER_APPROVAL_REPLAY_KEY)!).records[0]; assert.equal(row.status, "approved"); assert.equal(row.revocation, null); assert.equal(f.state.opens.length, 1);
});

test("close, account switch and expiry during key access cannot sign or return", async () => {
  for (const mode of ["close", "account", "expiry"] as const) {
    const f = fixture(), c = f.controller(), review = await c.receive(f.url()); f.state.keyGate = deferred(); const pending = c.approve(review.id); await f.state.keyStarted.promise;
    if (mode === "close") c.cancel(); if (mode === "account") f.state.selected = other; if (mode === "expiry") f.state.now = Date.parse(unsigned.expiresAt);
    f.state.keyGate.resolve(); await assert.rejects(pending); assert.equal(f.state.writes.length, 0); assert.equal(f.state.opens.length, 0);
  }
});

test("adapter-shared serialization permits only one concurrent approval", async () => {
  const f = fixture(), a = f.controller(), b = f.controller(), route = f.url(), ar = await a.receive(route), br = await b.receive(route);
  f.state.keyGate = deferred(); const first = a.approve(ar.id); await f.state.keyStarted.promise; const second = b.approve(br.id); f.state.keyGate.resolve();
  const results = await Promise.allSettled([first, second]); assert.equal(results.filter(item => item.status === "fulfilled").length, 1); assert.equal(f.state.opens.length, 1);
});

test("different adapter wrappers over one native store cannot split the replay lock", async () => {
  const values = new Map<string,string>(), a = fixture(values), b = fixture(values), ac = a.controller(), bc = b.controller();
  const request = a.request(), route = a.url(request), ar = await ac.receive(route), br = await bc.receive(route);
  const results = await Promise.allSettled([ac.approve(ar.id), bc.approve(br.id)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(a.state.keys + b.state.keys, 2);
  assert.equal(a.state.opens.length + b.state.opens.length, 1);
  assert.equal(JSON.parse(values.get(FINANCE_ORDER_APPROVAL_REPLAY_KEY)!).records.length, 1);
});

test("replay correlation and persisted-data tamper fail closed", async () => {
  const f = fixture(), c = f.controller(), review = await c.receive(f.url()); f.state.failOpen = true; await assert.rejects(c.approve(review.id));
  const original = f.values.get(FINANCE_ORDER_APPROVAL_REPLAY_KEY)!;
  for (const field of ["requestId", "callbackStateHash", "nonce", "challengeId", "orderHash"] as const) {
    const data = JSON.parse(original); const target = data.records[0].request.unsigned; target[field] = field === "orderHash" || field === "callbackStateHash" ? "0".repeat(64) : field === "requestId" ? "request_77777777-7777-4777-8777-777777777777" : field === "challengeId" ? "challenge_77777777-7777-4777-8777-777777777777" : "77777777-7777-4777-8777-777777777777";
    const restart = fixture(new Map([[FINANCE_ORDER_APPROVAL_REPLAY_KEY, JSON.stringify(data)]])); await assert.rejects(restart.controller().receive(restart.url())); assert.equal(restart.state.keys, 0);
  }
});

test("uncertain journal write quarantines every adapter in the Wallet process", async () => {
  const f = fixture(), c = f.controller(), review = await c.receive(f.url()); f.state.dropWrite = true;
  await assert.rejects(c.approve(review.id)); f.state.dropWrite = false; await assert.rejects(c.approve(review.id), /uncertain/);
  const otherAdapter = fixture(f.values); await assert.rejects(otherAdapter.controller().receive(otherAdapter.url()), /uncertain/); assert.equal(f.state.opens.length, 0);
});
