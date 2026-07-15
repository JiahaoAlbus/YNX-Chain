import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PermissionStore, ReplayGuard, originPartition, reviewTransaction, selectAiContext, validateWalletRequest } from "../src/index.js";

test("origin permissions are isolated and persisted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ynx-permissions-"));
  const path = join(dir, "permissions.json");
  const store = new PermissionStore(path);
  await store.decide("https://a.example/page", "camera", "allow");
  assert.equal(await store.get("https://a.example", "camera"), "allow");
  assert.equal(await store.get("https://b.example", "camera"), "ask");
  assert.notEqual(originPartition("https://a.example"), originPartition("https://b.example"));
  assert.equal(JSON.parse(await readFile(path)).origins["https://a.example"].camera.decision, "allow");
});

test("private permission state never reaches disk and is discarded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ynx-private-"));
  const path = join(dir, "permissions.json");
  const store = new PermissionStore(path);
  await store.decide("https://a.example", "microphone", "allow", { privateSessionId: "p1" });
  assert.equal(await store.get("https://a.example", "microphone", { privateSessionId: "p1" }), "allow");
  store.forgetPrivateSession("p1");
  assert.equal(await store.get("https://a.example", "microphone", { privateSessionId: "p1" }), "ask");
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("wallet callback, scope, chain and replay boundaries fail closed", () => {
  const now = Date.now();
  const request = { version: "1", requestId: "request_123456789", chainId: "ynx_6423-1", origin: "https://dapp.example", callback: "https://dapp.example/wallet/callback", account: "ynx1abcdefghijklmnopqrstuv", scopes: ["account:read"], issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), purpose: "Connect account" };
  const policy = { allowedCallbacks: { "https://dapp.example": [request.callback] }, allowedScopes: { "https://dapp.example": ["account:read"] } };
  assert.equal(validateWalletRequest(request, policy, now).origin, "https://dapp.example");
  assert.throws(() => validateWalletRequest({ ...request, callback: "https://evil.example/cb" }, policy, now), /mismatch/);
  assert.throws(() => validateWalletRequest({ ...request, scopes: ["transaction:sign"] }, policy, now), /not allowed/);
  const guard = new ReplayGuard();
  guard.consume(request.requestId, request.expiresAt, now);
  assert.throws(() => guard.consume(request.requestId, request.expiresAt, now), /replayed/);
});

test("transaction review displays exact YNXT values", () => {
  const review = reviewTransaction({ from: "ynx1abcdefghijklmnopqrstuv", to: "ynx1zyxwvutsrqponmlkjihgf", amount: "2.5", asset: "YNXT", fee: "0.01", data: "0x1234" });
  assert.equal(review.amount, "2.5");
  assert.match(review.warnings[0], /contract data/);
});

test("AI context rejects private, history and wallet identity", () => {
  const page = { authorized: true, private: false, url: "https://docs.example/a", title: "A", text: "Page" };
  assert.equal(selectAiContext({ action: "summarize-page", currentPage: page }).pages.length, 1);
  assert.throws(() => selectAiContext({ action: "summarize-page", currentPage: { ...page, private: true } }), /private/);
  assert.throws(() => selectAiContext({ action: "summarize-page", currentPage: page, includeHistory: true }), /sensitive/);
});
