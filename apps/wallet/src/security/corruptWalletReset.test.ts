import assert from "node:assert/strict";
import test from "node:test";
import { WalletRepository, MANIFEST_KEY, type SecureStorageAdapter } from "../storage/walletRepository";
import { createPlatformSecureStorage } from "../storage/secureStoragePolicy";
import { WalletOperationLifecycle } from "./operationLifecycle";
import { CorruptWalletResetController } from "./corruptWalletReset";

// Synthetic account material is only held by this fake native adapter. No device
// or OS authentication is claimed by these fault-injected module fixtures.
const A="0".repeat(63)+"1",B="0".repeat(63)+"2";
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve}}
async function fixture(){
  const values=new Map<string,string>(),events:Array<{method:string;key:string}>=[];
  const state={now:0,authorizations:0,authorize:async()=>{},before:async(_method:string,_key:string)=>{},after:async(_method:string,_key:string)=>{}};
  const storage=createPlatformSecureStorage({WHEN_UNLOCKED_THIS_DEVICE_ONLY:7,
    async getItemAsync(key){events.push({method:"get",key});const value=values.get(key)??null;await state.before("get",key);await state.after("get",key);return value},
    async setItemAsync(key,value){events.push({method:"set",key});await state.before("set",key);values.set(key,value);await state.after("set",key)},
    async deleteItemAsync(key){events.push({method:"delete",key});await state.before("delete",key);values.delete(key);await state.after("delete",key)},
  });
  const repository=new WalletRepository(storage),input={label:"Synthetic A",createdAt:"2026-09-06T00:00:00.000Z",backupConfirmed:true};
  const manifest=await repository.addAccount({...input,secretHex:A});
  const original=values.get(MANIFEST_KEY)!,corrupt=JSON.stringify({...JSON.parse(original),corrupt:true});values.set(MANIFEST_KEY,corrupt);
  const operations=new WalletOperationLifecycle(()=>state.now);operations.setAccount(manifest.selectedAccountId);
  const controller=new CorruptWalletResetController(repository,operations,async()=>{state.authorizations++;await state.authorize()});
  const unsubscribe=operations.subscribe(()=>controller.cancel());events.length=0;
  return{state,values,events,storage,repository,input,manifest,original,corrupt,operations,controller,unsubscribe};
}
const deletes=(f:Awaited<ReturnType<typeof fixture>>)=>f.events.filter(e=>e.method==="delete");

test("reset captures corrupt state before consent, authenticates once, and deletes only the reviewed state",async()=>{
  const f=await fixture(),review=await f.controller.prepare();assert.equal(f.state.authorizations,0);assert.equal(deletes(f).length,0);
  assert.deepEqual(Object.keys(review),["kind"]);await f.controller.confirm(review);
  assert.equal(f.state.authorizations,1);assert.equal(f.values.has(MANIFEST_KEY),false);
  assert.equal([...f.values.keys()].some(key=>key.startsWith("ynx.wallet.account.auth.v3.")),false);
  await assert.rejects(()=>f.controller.confirm(review),/Review.*again/);f.controller.cancel();f.unsubscribe();
});

test("readable or absent metadata cannot be selected by the destructive reset path",async()=>{
  for(const absent of [false,true]){const f=await fixture();if(absent)f.values.delete(MANIFEST_KEY);else f.values.set(MANIFEST_KEY,f.original);
    await assert.rejects(()=>f.controller.prepare(),/readable/);assert.equal(f.state.authorizations,0);assert.equal(deletes(f).length,0);f.unsubscribe();}
});

test("caller-supplied review or omitted guard cannot authorize reset",async()=>{
  const f=await fixture();await assert.rejects(()=>f.repository.resetCorruptStorage({kind:"corrupt-wallet-reset"},()=>{}),/Review.*again/);
  await assert.rejects(()=>f.repository.resetCorruptStorage({kind:"corrupt-wallet-reset"},undefined as any),/authorization/);
  assert.equal(deletes(f).length,0);f.unsubscribe();
});

test("OS cancellation does not delete and another explicit confirmation can use the same reviewed snapshot",async()=>{
  const f=await fixture(),review=await f.controller.prepare();f.state.authorize=async()=>{throw new Error("Synthetic OS user cancel")};
  await assert.rejects(()=>f.controller.confirm(review),/user cancel/);assert.equal(deletes(f).length,0);assert.equal(f.values.get(MANIFEST_KEY),f.corrupt);
  f.state.authorize=async()=>{};await f.controller.confirm(review);assert.equal(f.state.authorizations,2);f.controller.cancel();f.unsubscribe();
});

for(const change of ["background","account","expired"] as const)test(`${change} during OS authentication stops every deletion`,async()=>{
  const f=await fixture(),review=await f.controller.prepare(),started=deferred(),gate=deferred();f.state.authorize=async()=>{started.resolve();await gate.promise};
  const pending=f.controller.confirm(review);await started.promise;
  if(change==="background")f.operations.setAppState("background");else if(change==="account")f.operations.setAccount(null);else f.state.now=120_000;
  gate.resolve();await assert.rejects(pending,/cancelled|expired/);assert.equal(deletes(f).length,0);assert.equal(f.values.get(MANIFEST_KEY),f.corrupt);f.controller.cancel();f.unsubscribe();
});

test("a cancelled old dialog cannot act on or clear a replacement review",async()=>{
  const f=await fixture(),old=await f.controller.prepare();f.controller.cancel(old);const fresh=await f.controller.prepare();
  await assert.rejects(()=>f.controller.confirm(old),/cancelled/);f.controller.cancel(old);assert.equal(f.controller.isCurrent(fresh),true);
  assert.equal(f.state.authorizations,0);assert.equal(deletes(f).length,0);await f.controller.confirm(fresh);f.controller.cancel();f.unsubscribe();
});

test("a repaired manifest and newly added account survive a late confirmation for old corruption",async()=>{
  const f=await fixture(),review=await f.controller.prepare(),started=deferred(),gate=deferred();f.state.authorize=async()=>{started.resolve();await gate.promise};
  const pending=f.controller.confirm(review);await started.promise;f.values.set(MANIFEST_KEY,f.original);
  const fresh=await f.repository.addAccount({...f.input,label:"Synthetic B",secretHex:B});const current=f.values.get(MANIFEST_KEY);
  gate.resolve();await assert.rejects(pending,/storage changed/);assert.equal(f.values.get(MANIFEST_KEY),current);
  assert.equal((await f.repository.load()).manifest.accounts.length,2);assert.equal([...f.values.keys()].filter(k=>k.startsWith("ynx.wallet.account.auth.v3.")).length,2);
  assert.ok(fresh.selectedAccountId);assert.equal(deletes(f).length,0);f.controller.cancel();f.unsubscribe();
});

test("a different corrupt snapshot is not silently substituted after the user reviewed the first",async()=>{
  const f=await fixture(),review=await f.controller.prepare();const updated=f.corrupt+" ";f.values.set(MANIFEST_KEY,updated);
  await assert.rejects(()=>f.controller.confirm(review),/storage changed/);assert.equal(f.values.get(MANIFEST_KEY),updated);assert.equal(deletes(f).length,0);f.controller.cancel();f.unsubscribe();
});

test("mutation queue prevents an account writer passing a reset that is awaiting deletion",async()=>{
  const f=await fixture(),review=await f.controller.prepare(),started=deferred(),gate=deferred();let once=true;
  f.state.before=async(method,key)=>{if(once&&method==="delete"&&key.startsWith("ynx.wallet.account.auth.v3.")){once=false;started.resolve();await gate.promise}};
  const resetting=f.controller.confirm(review);await started.promise;let added=false;
  const addition=new WalletRepository(f.storage).addAccount({...f.input,label:"Synthetic B",secretHex:B}).then(value=>{added=true;return value});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(added,false);gate.resolve();await resetting;const fresh=await addition;
  assert.equal((await f.repository.load()).manifest.selectedAccountId,fresh.selectedAccountId);assert.equal(fresh.accounts.length,1);f.controller.cancel();f.unsubscribe();
});

test("lock after an irreversible delete stops later deletes and leaves public recovery evidence",async()=>{
  const f=await fixture(),review=await f.controller.prepare();let once=true;
  f.state.after=async(method,key)=>{if(once&&method==="delete"&&key.startsWith("ynx.wallet.account.auth.v3.")){once=false;f.operations.lock()}};
  await assert.rejects(()=>f.controller.confirm(review),/cancelled/);assert.equal(deletes(f).length,1);assert.equal(f.values.get(MANIFEST_KEY),f.corrupt);f.controller.cancel();f.unsubscribe();
});

test("forged public account identity in corruption cannot select another protected key for deletion",async()=>{
  const f=await fixture();const raw=JSON.parse(f.original);raw.accounts[0].accountPublicKey="02"+"00".repeat(32);f.values.set(MANIFEST_KEY,JSON.stringify(raw));
  const review=await f.controller.prepare();await assert.rejects(()=>f.controller.confirm(review),/identity.*verification/);assert.equal(deletes(f).length,0);f.controller.cancel();f.unsubscribe();
});
