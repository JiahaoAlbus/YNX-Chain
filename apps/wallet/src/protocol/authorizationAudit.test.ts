import assert from "node:assert/strict";
import { test } from "node:test";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { AuthorizationAuditStore, AUTHORIZATION_AUDIT_KEY } from "./authorizationAudit";
import type { SecureStorageAdapter } from "../storage/walletRepository";

class MemoryStorage implements SecureStorageAdapter{values=new Map<string,string>();async getItem(key:string){return this.values.get(key)??null}async setItem(key:string,value:string){this.values.set(key,value)}async deleteItem(key:string){this.values.delete(key)}}
const account=walletIdentity(`${"00".repeat(31)}01`).account;
const request:any={version:"1",nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",chainId:"ynx_6423-1",requestingProduct:"social",productClientId:"ynx-social-v1",bundleId:"com.ynx.social",productDeviceAlgorithm:"p256-sha256",productDeviceKey:"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",callback:"ynx-social://com.ynx.social",scopes:["account:read","profile:link"],purpose:"Link account",issuedAt:"2026-07-15T11:59:00.000Z",expiresAt:"2026-07-15T12:04:00.000Z"};

test("signature intent, callback, and revocation form a persistent hash-chained audit",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.append(request,{action:"intent-approved",account,at:"2026-07-15T12:00:00.000Z"});
  await store.append(request,{action:"approval-returned",account,at:"2026-07-15T12:00:01.000Z"});
  await store.revoke((await store.load())[0]!.requestDigest,"2026-07-15T12:01:00.000Z");
  const restarted=new AuthorizationAuditStore(storage),records=await restarted.load();
  assert.equal(records.length,3);assert.equal(records[1]?.previousHash,records[0]?.hash);
  assert.deepEqual(await restarted.revokedRequestDigests(),[records[0]?.requestDigest]);
  assert.equal(JSON.stringify(records).includes("secret"),false);
});

test("authorization audit rejects field, binding, and hash tamper",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.append(request,{action:"request-rejected",account,at:"2026-07-15T12:00:00.000Z"});
  const original=JSON.parse(storage.values.get(AUTHORIZATION_AUDIT_KEY)!);
  storage.values.set(AUTHORIZATION_AUDIT_KEY,JSON.stringify([{...original[0],account:walletIdentity(`${"00".repeat(31)}02`).account}]));
  await assert.rejects(store.load(),/hash chain/);
  storage.values.set(AUTHORIZATION_AUDIT_KEY,JSON.stringify([{...original[0],unknown:true}]));
  await assert.rejects(store.load(),/schema/);
});
