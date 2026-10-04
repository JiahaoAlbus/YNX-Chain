import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductSessionRequest, productSessionRequestDigest, walletIdentity } from "@ynx-chain/wallet-auth";
import { AuthorizationAuditStore, AUTHORIZATION_AUDIT_KEY } from "./authorizationAudit";
import { PRODUCT_SESSION_REGISTRY } from "./registry";
import type { MobileProductSessionRequest } from "./productSessionController";
import type { SecureStorageAdapter } from "../storage/walletRepository";

class MemoryStorage implements SecureStorageAdapter{values=new Map<string,string>();async getItem(key:string){return this.values.get(key)??null}async setItem(key:string,value:string){this.values.set(key,value)}async deleteItem(key:string){this.values.delete(key)}}
const account=walletIdentity(`${"00".repeat(31)}01`).account;
const now=new Date("2026-07-15T12:00:00.000Z");
const request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:"pay",platform:"android",deviceId:"test-device-001",deviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",scopes:["account:read"],purpose:"Link account",nonce:"n".repeat(32),state:"s".repeat(32)},now) as MobileProductSessionRequest;
const review={id:productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,now),request,account:{...walletIdentity("0".repeat(63)+"1"),label:"Test",backupConfirmed:true,createdAt:now.toISOString()}};

test("signature intent, callback, and revocation form a persistent hash-chained audit",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.appendProductSession(review,{action:"intent-approved",account,at:"2026-07-15T12:00:00.000Z"});
  await store.appendProductSession(review,{action:"approval-returned",account,at:"2026-07-15T12:00:01.000Z"});
  await store.revoke((await store.load())[0]!.requestDigest,"2026-07-15T12:01:00.000Z");
  const restarted=new AuthorizationAuditStore(storage),records=await restarted.load();
  assert.equal(records.length,3);assert.equal(records[1]?.previousHash,records[0]?.hash);
  assert.deepEqual(await restarted.revokedRequestDigests(),[records[0]?.requestDigest]);
  assert.equal(JSON.stringify(records).includes("secret"),false);
});

test("authorization audit rejects field, binding, and hash tamper",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.appendProductSession(review,{action:"request-rejected",account,at:"2026-07-15T12:00:00.000Z"});
  const original=JSON.parse(storage.values.get(AUTHORIZATION_AUDIT_KEY)!);
  storage.values.set(AUTHORIZATION_AUDIT_KEY,JSON.stringify([{...original[0],account:walletIdentity(`${"00".repeat(31)}02`).account}]));
  await assert.rejects(store.load(),/hash chain/);
  storage.values.set(AUTHORIZATION_AUDIT_KEY,JSON.stringify([{...original[0],unknown:true}]));
  await assert.rejects(store.load(),/schema/);
});
