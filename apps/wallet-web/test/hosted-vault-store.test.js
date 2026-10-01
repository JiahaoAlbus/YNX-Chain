import assert from "node:assert/strict";
import test from "node:test";
import { createHostedVaultStore } from "../src/hosted-vault-store.js";

async function boundedFailure(promise, code) {
  await assert.rejects(Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("STILL_PENDING")), 300))]), error => error.code === code);
}
test("asynchronous IndexedDB open error and blocked upgrade reject instead of hanging", async () => {
  for (const signal of ["onerror", "onblocked"]) {
    const factory = { open() { const request = {}; queueMicrotask(() => request[signal]()); return request; } };
    await boundedFailure(createHostedVaultStore(factory).read(), signal === "onblocked" ? "HOSTED_STORAGE_UPGRADE_BLOCKED" : "HOSTED_STORAGE_UNAVAILABLE");
  }
});
test("failed IndexedDB transaction cannot be interpreted as an absent vault", async () => {
  const factory = { open() { const request = {}; queueMicrotask(() => { request.result = { objectStoreNames: { contains: () => true }, transaction() { throw new Error("denied"); } }; request.onsuccess(); }); return request; } };
  await boundedFailure(createHostedVaultStore(factory).read(), "HOSTED_STORAGE_UNAVAILABLE");
});
test("compatibility open preserves an existing higher-version vault after VersionError",async()=>{
  const calls=[];
  const factory={open(name,version){calls.push(version);const request={};queueMicrotask(()=>{if(version!==undefined){request.error={name:'VersionError'};request.onerror();}else{request.result={objectStoreNames:{contains:()=>true},transaction(){throw new Error('isolated read failure');}};request.onsuccess();}});return request;}};
  await boundedFailure(createHostedVaultStore(factory).read(),'HOSTED_STORAGE_UNAVAILABLE');
  assert.deepEqual(calls,[4,undefined]);
});
test('blocked request late success closes its handle and the same store can explicitly retry',async()=>{
  let opens=0,closed=0;
  const factory={open(){opens++;const request={};queueMicrotask(()=>{request.onblocked();queueMicrotask(()=>{request.result={close(){closed++;}};request.onsuccess();});});return request;}};
  const store=createHostedVaultStore(factory);
  await boundedFailure(store.read(),'HOSTED_STORAGE_UPGRADE_BLOCKED');
  await boundedFailure(store.read(),'HOSTED_STORAGE_UPGRADE_BLOCKED');
  await new Promise(resolve=>queueMicrotask(resolve));assert.equal(opens,2);assert.equal(closed,2);
});
