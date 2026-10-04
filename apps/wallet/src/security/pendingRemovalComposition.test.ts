import test from "node:test";
import assert from "node:assert/strict";
import {WalletRepository,MANIFEST_KEY,DELETION_JOURNAL_KEY} from "../storage/walletRepository";
import {createPlatformSecureStorage} from "../storage/secureStoragePolicy";
import {WalletOperationLifecycle} from "./operationLifecycle";
import {PendingRemovalRetryController} from "./pendingRemovalRetry";

// Real repository/controller/lifecycle with a fault-injected native adapter.
// Synthetic account material only; no OS custody or cross-process CAS proof.
async function fixture(){
  const values=new Map<string,string>(),events:Array<{method:string;key:string}>=[];
  let interrupt=false,dropClear=false,afterDelete:(key:string)=>void=()=>{};
  const storage=createPlatformSecureStorage({WHEN_UNLOCKED_THIS_DEVICE_ONLY:7,
    async getItemAsync(key){events.push({method:"get",key});return values.get(key)??null},
    async setItemAsync(key,value){events.push({method:"set",key});values.set(key,value)},
    async deleteItemAsync(key){events.push({method:"delete",key});if(interrupt&&key.startsWith("ynx.wallet.account.auth.v3."))throw Error("Controlled interrupted material deletion");if(!(dropClear&&key===DELETION_JOURNAL_KEY))values.delete(key);afterDelete(key)},
  });
  const original=new WalletRepository(storage),input={createdAt:"2026-10-04T00:00:00.000Z",backupConfirmed:true};
  const a=(await original.addAccount({...input,label:"Synthetic A",secretHex:"0".repeat(63)+"1"})).accounts[0]!;
  const bManifest=await original.addAccount({...input,label:"Synthetic B",secretHex:"0".repeat(63)+"2"}),b=bManifest.accounts[1]!;
  values.set("unrelated.original.transaction.history","controlled retained UNKNOWN bytes");
  interrupt=true;await assert.rejects(original.deleteAccount(a.account,()=>{}),/interrupted/);interrupt=false;
  const current=values.get(MANIFEST_KEY)!,journal=values.get(DELETION_JOURNAL_KEY)!;
  const bValues=[...values].filter(([key])=>key.includes(b.account));
  // New repository/controller simulates a cold in-process source composition,
  // not an OS restart or new native runtime.
  const repository=new WalletRepository(storage),operations=new WalletOperationLifecycle();operations.setAccount(b.account);
  let authCount=0;
  const controller=new PendingRemovalRetryController(operations.scope(),repository,async()=>{authCount++});
  events.length=0;
  return{a,b,current,journal,bValues,values,events,repository,operations,controller,authCount:()=>authCount,dropClear:()=>{dropClear=true},afterDelete:(fn:(key:string)=>void)=>{afterDelete=fn}};
}
test("explicit cold retry composes original journal readback without losing retained account or UNKNOWN bytes",async()=>{
  const f=await fixture(),review=f.controller.prepare();assert.deepEqual(f.events,[]);assert.equal(f.authCount(),0);
  const next=await f.controller.confirm(review);assert.equal(f.authCount(),1);assert.equal(next.selectedAccountId,f.b.account);assert.deepEqual(next.accounts.map(a=>a.account),[f.b.account]);
  assert.equal(f.values.get(MANIFEST_KEY),f.current);assert.equal(f.values.has(DELETION_JOURNAL_KEY),false);
  assert.equal([...f.values.keys()].some(key=>key.includes(f.a.account)),false);for(const [key,value] of f.bValues)assert.equal(f.values.get(key),value);
  assert.equal(f.values.get("unrelated.original.transaction.history"),"controlled retained UNKNOWN bytes");await assert.rejects(f.controller.confirm(review));f.controller.finish(review);
});
test("a dropped original journal clear refuses successful completion and keeps retry evidence",async()=>{
  const f=await fixture();f.dropClear();const review=f.controller.prepare();await assert.rejects(f.controller.confirm(review),/readback|verif|saved|journal/i);
  assert.equal(f.authCount(),1);assert.equal(f.values.get(DELETION_JOURNAL_KEY),f.journal);assert.equal(f.values.get(MANIFEST_KEY),f.current);for(const [key,value] of f.bValues)assert.equal(f.values.get(key),value);
  const count=f.events.length;await assert.rejects(f.controller.confirm(review));assert.equal(f.events.length,count);f.controller.finish(review);
});
test("background during original protected deletion stops remaining cleanup and retains journal",async()=>{
  const f=await fixture();f.afterDelete(key=>{if(key.startsWith("ynx.wallet.account.auth.v3."))f.operations.setAppState("background")});
  const review=f.controller.prepare();await assert.rejects(f.controller.confirm(review),/cancelled|expired/);
  assert.equal(f.authCount(),1);assert.equal(f.events.filter(e=>e.method==="delete").length,1);assert.equal(f.values.get(DELETION_JOURNAL_KEY),f.journal);assert.equal(f.values.get(MANIFEST_KEY),f.current);for(const [key,value] of f.bValues)assert.equal(f.values.get(key),value);f.controller.finish(review);
});
test("an empty original deletion journal returns existing manifest without inventing any deletion",async()=>{
  const f=await fixture();f.values.delete(DELETION_JOURNAL_KEY);const review=f.controller.prepare(),before=new Map(f.values);await f.controller.confirm(review);
  assert.equal(f.authCount(),1);assert.equal(f.events.some(e=>e.method==="delete"||e.method==="set"),false);assert.deepEqual(f.values,before);f.controller.finish(review);
});
