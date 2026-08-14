import assert from "node:assert/strict";
import { test } from "node:test";
import { digestHex, walletIdentity } from "@ynx-chain/wallet-auth";
import { AuthorizationAuditStore, AUTHORIZATION_AUDIT_KEY } from "./authorizationAudit";
import type { SecureStorageAdapter } from "../storage/walletRepository";

class MemoryStorage implements SecureStorageAdapter{values=new Map<string,string>();async getItem(key:string){return this.values.get(key)??null}async setItem(key:string,value:string){this.values.set(key,value)}async deleteItem(key:string){this.values.delete(key)}}
class ControlledStorage extends MemoryStorage{
  private blocker:null|{started:()=>void;released:Promise<void>}=null;
  blockNextWrite(){let started!:()=>void,release!:()=>void;const startedPromise=new Promise<void>(resolve=>{started=resolve}),released=new Promise<void>(resolve=>{release=resolve});this.blocker={started,released};return{started:startedPromise,release}}
  override async setItem(key:string,value:string){const blocker=this.blocker;this.blocker=null;if(blocker){blocker.started();await blocker.released}await super.setItem(key,value)}
}
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

test("dismissed revocation attempt cannot append an audit mutation",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.append(request,{action:"intent-approved",account,at:"2026-07-15T11:59:59.000Z"});
  await store.append(request,{action:"approval-returned",account,at:"2026-07-15T12:00:00.000Z"});
  const before=storage.values.get(AUTHORIZATION_AUDIT_KEY);
  await assert.rejects(store.revoke((await store.load())[0]!.requestDigest,"2026-07-15T12:01:00.000Z",()=>{throw new Error("backgrounded")}),/backgrounded/);
  assert.equal(storage.values.get(AUTHORIZATION_AUDIT_KEY),before);
});

test("concurrent approve and reject decisions linearize to the first persisted terminal choice",async()=>{
  const approvedStorage=new ControlledStorage(),approvedStore=new AuthorizationAuditStore(approvedStorage),approvalBlock=approvedStorage.blockNextWrite();
  const approved=approvedStore.append(request,{action:"intent-approved",account,at:"2026-07-15T12:00:00.000Z"});
  await approvalBlock.started;
  const lateReject=approvedStore.append(request,{action:"request-rejected",account,at:"2026-07-15T12:00:00.001Z"});
  approvalBlock.release();await approved;await assert.rejects(lateReject,/already decided/);
  assert.deepEqual((await approvedStore.load()).map(record=>record.action),["intent-approved"]);

  const rejectedStorage=new ControlledStorage(),rejectedStore=new AuthorizationAuditStore(rejectedStorage),rejectionBlock=rejectedStorage.blockNextWrite();
  const rejected=rejectedStore.append(request,{action:"request-rejected",account,at:"2026-07-15T12:00:01.000Z"});
  await rejectionBlock.started;
  const lateApprove=rejectedStore.append(request,{action:"intent-approved",account,at:"2026-07-15T12:00:01.001Z"});
  rejectionBlock.release();await rejected;await assert.rejects(lateApprove,/already decided/);
  assert.deepEqual((await rejectedStore.load()).map(record=>record.action),["request-rejected"]);
});

test("authorization audit persists only public binding metadata and no secret or callback payload",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage),accountSecret="audit-secret-canary",signatureResponse="signed-callback-canary";
  await store.append(request,{action:"intent-approved",account,at:"2026-07-15T12:00:00.000Z",accountSecret,signatureResponse} as any);
  const raw=storage.values.get(AUTHORIZATION_AUDIT_KEY)!;
  for(const forbidden of [accountSecret,signatureResponse,request.nonce,request.productDeviceKey,request.callback,request.purpose])assert.equal(raw.includes(forbidden),false,`audit leaked ${forbidden}`);
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(),["account","action","at","bundleId","expiresAt","hash","previousHash","productClientId","requestDigest","schemaVersion","scopes","sequence"].sort());
});

test("callback audit stays on the intent account and decisions survive store reconstruction",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage),otherAccount=walletIdentity(`${"00".repeat(31)}02`).account;
  await store.append(request,{action:"intent-approved",account,at:"2026-07-15T12:00:00.000Z"});
  const restarted=new AuthorizationAuditStore(storage);
  await assert.rejects(restarted.append(request,{action:"request-rejected",account,at:"2026-07-15T12:00:01.000Z"}),/already decided/);
  await assert.rejects(restarted.append(request,{action:"approval-returned",account:otherAccount,at:"2026-07-15T12:00:02.000Z"}),/account differs/);
  assert.deepEqual((await restarted.load()).map(record=>[record.action,record.account]),[["intent-approved",account]]);
});

test("audit capacity and oversized storage fail closed without corrupting the existing chain",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.append(request,{action:"request-rejected",account,at:"2026-07-15T12:00:00.000Z"});
  const seed=JSON.parse(storage.values.get(AUTHORIZATION_AUDIT_KEY)!)[0],records:any[]=[];
  for(let sequence=1;sequence<=1000;sequence++){
    const unsigned={...seed,sequence,requestDigest:sequence.toString(16).padStart(64,"0"),previousHash:records.at(-1)?.hash??null};delete unsigned.hash;
    records.push({...unsigned,hash:digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned)});
  }
  const full=JSON.stringify(records);storage.values.set(AUTHORIZATION_AUDIT_KEY,full);
  await assert.rejects(store.append({...request,nonce:"other_nonce_abcdefghijklmnopqrstuv"},{action:"request-rejected",account,at:"2026-07-15T12:01:00.000Z"}),/capacity is exhausted/);
  assert.equal(storage.values.get(AUTHORIZATION_AUDIT_KEY),full);
  assert.equal((await new AuthorizationAuditStore(storage).load()).length,1000);

  storage.values.set(AUTHORIZATION_AUDIT_KEY," ".repeat(1024*1024+1));
  await assert.rejects(new AuthorizationAuditStore(storage).load(),/too large/);
});

test("restart rejects semantically impossible audit history even when hashes are recomputed",async()=>{
  const storage=new MemoryStorage(),store=new AuthorizationAuditStore(storage);
  await store.append(request,{action:"request-rejected",account,at:"2026-07-15T12:00:00.000Z"});
  const seed=JSON.parse(storage.values.get(AUTHORIZATION_AUDIT_KEY)!)[0];
  const rehash=(unsigned:any)=>({...unsigned,hash:digestHex("YNX_WALLET_AUTH_AUDIT_V1",unsigned)});

  const {hash:ignored,...base}=seed;
  storage.values.set(AUTHORIZATION_AUDIT_KEY,JSON.stringify([rehash({...base,action:"approval-returned"})]));
  await assert.rejects(new AuthorizationAuditStore(storage).load(),/no approval intent/);

  const intentUnsigned={...base,action:"intent-approved"},intent=rehash(intentUnsigned),conflictUnsigned={...base,sequence:2,at:"2026-07-15T12:00:01.000Z",action:"request-rejected",previousHash:intent.hash};
  storage.values.set(AUTHORIZATION_AUDIT_KEY,JSON.stringify([intent,rehash(conflictUnsigned)]));
  await assert.rejects(new AuthorizationAuditStore(storage).load(),/conflicting decisions/);
  assert.ok(ignored);
});

test("concurrent audit append and duplicate revoke serialize without lost records",async()=>{
  const storage=new ControlledStorage(),store=new AuthorizationAuditStore(storage),appendBlock=storage.blockNextWrite();
  const approved=store.append(request,{action:"intent-approved",account,at:"2026-07-15T12:00:00.000Z"});
  await appendBlock.started;
  const returned=store.append(request,{action:"approval-returned",account,at:"2026-07-15T12:00:01.000Z"});
  appendBlock.release();
  await Promise.all([approved,returned]);
  let records=await store.load();
  assert.deepEqual(records.map(item=>[item.sequence,item.action]),[[1,"intent-approved"],[2,"approval-returned"]]);
  assert.equal(records[1]!.previousHash,records[0]!.hash);

  const revokeBlock=storage.blockNextWrite(),digest=records[0]!.requestDigest;
  const first=store.revoke(digest,"2026-07-15T12:01:00.000Z");
  await revokeBlock.started;
  const duplicate=store.revoke(digest,"2026-07-15T12:01:01.000Z");
  revokeBlock.release();
  await first;
  await assert.rejects(duplicate,/already revoked/);
  records=await store.load();
  assert.deepEqual(records.map(item=>[item.sequence,item.action]),[[1,"intent-approved"],[2,"approval-returned"],[3,"approval-revoked"]]);
});
