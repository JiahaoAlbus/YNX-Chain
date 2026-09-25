import assert from "node:assert/strict";
import test from "node:test";
import { createHostedVaultStore } from "../src/hosted-vault-store.js";

async function boundedFailure(promise, code) {
  await assert.rejects(Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("STILL_PENDING")), 300))]), error => error.code === code);
}
test("asynchronous IndexedDB open error and blocked upgrade reject instead of hanging", async () => {
  for (const signal of ["onerror", "onblocked"]) {
    const factory = { open() { const request = {}; queueMicrotask(() => request[signal]()); return request; } };
    await boundedFailure(createHostedVaultStore(factory).read(), "HOSTED_STORAGE_UNAVAILABLE");
  }
});
test("failed IndexedDB transaction cannot be interpreted as an absent vault", async () => {
  const factory = { open() { const request = {}; queueMicrotask(() => { request.result = { objectStoreNames: { contains: () => true }, transaction() { throw new Error("denied"); } }; request.onsuccess(); }); return request; } };
  await boundedFailure(createHostedVaultStore(factory).read(), "HOSTED_STORAGE_UNAVAILABLE");
});
