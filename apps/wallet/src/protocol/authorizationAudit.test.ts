import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductSessionRequest, productSessionRequestDigest, walletIdentity,digestHex } from "@ynx-chain/wallet-auth";
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
test('independent audit owners sharing original storage cannot overwrite either concurrent event',async()=>{
 const storage=new MemoryStorage(),a=new AuthorizationAuditStore(storage),b=new AuthorizationAuditStore(storage);
 await Promise.all([a.appendProductSession(review,{action:'intent-approved',account,at:now.toISOString()}),b.appendProductSession(review,{action:'request-rejected',account,at:now.toISOString()})]);
 const records=await new AuthorizationAuditStore(storage).load();assert.equal(records.length,2);assert.equal(records[1]!.sequence,2);assert.equal(records[1]!.previousHash,records[0]!.hash);assert.deepEqual(new Set(records.map(row=>row.action)),new Set(['intent-approved','request-rejected']));
});
test('queued revocation and append preserve both events and duplicate revoke remains once-only',async()=>{
 const storage=new MemoryStorage(),a=new AuthorizationAuditStore(storage),b=new AuthorizationAuditStore(storage);await a.appendProductSession(review,{action:'approval-returned',account,at:now.toISOString()});
 const result=await Promise.allSettled([a.revoke(review.id,now.toISOString()),b.appendProductSession(review,{action:'intent-approved',account,at:now.toISOString()}),b.revoke(review.id,now.toISOString())]);assert.equal(result.filter(row=>row.status==='fulfilled').length,2);assert.match((result.find(row=>row.status==='rejected') as PromiseRejectedResult).reason.message,/already revoked/);
 const rows=await a.load();assert.equal(rows.length,3);assert.equal(rows.filter(row=>row.action==='approval-revoked').length,1);assert.equal(rows[2]!.previousHash,rows[1]!.hash);
});
test('lost audit write ACK permits readback only and never repeats the failed mutation',async()=>{
 const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage),set=storage.setItem.bind(storage),failure=Error('QA_POST_COMMIT_ACK');let writes=0;storage.setItem=async(key,value)=>{writes++;await set(key,value);throw failure;};
 await assert.rejects(store.appendProductSession(review,{action:'intent-approved',account,at:now.toISOString()}),error=>error===failure);const rows=await new AuthorizationAuditStore(storage).load();assert.equal(rows.length,1);assert.equal(rows[0]!.action,'intent-approved');assert.equal(writes,1);
});
test('audit history capacity refuses before overwriting its last readable generation',async()=>{
 const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);await store.appendProductSession(review,{action:'intent-approved',account,at:now.toISOString()});const {hash:ignored,...base}=(await store.load())[0]!,rows:any[]=[];
 for(let i=0;i<1000;i++){const unsigned={...base,sequence:i+1,previousHash:rows.at(-1)?.hash??null};rows.push({...unsigned,hash:digestHex('YNX_WALLET_AUTH_AUDIT_V1',unsigned)});}const text=JSON.stringify(rows);storage.values.set(AUTHORIZATION_AUDIT_KEY,text);let writes=0;storage.setItem=async()=>{writes++;};
 await assert.rejects(store.appendProductSession(review,{action:'request-rejected',account,at:now.toISOString()}),/capacity/);assert.equal(writes,0);assert.equal(storage.values.get(AUTHORIZATION_AUDIT_KEY),text);assert.equal((await store.load()).length,1000);
});
