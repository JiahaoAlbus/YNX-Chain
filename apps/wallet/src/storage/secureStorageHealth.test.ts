import assert from "node:assert/strict";
import { test } from "node:test";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { SecureStorageHealth, SecureStorageRestartRequired, STORAGE_WRITE_UNCERTAIN } from "./secureStorageHealth";
import { createPlatformSecureStorage, type NativeSecureStore } from "./secureStoragePolicy";

const key=`ynx.wallet.account.auth.v3.${walletIdentity("01".repeat(32)).account}`;
const uncertain=()=>Object.assign(new Error("native text may be localized"),{code:STORAGE_WRITE_UNCERTAIN});
const writeFailure=Object.assign(new Error("disk confirmation failed"),{code:"ERR_WRITE"});
const callsFor=(storage:ReturnType<typeof createPlatformSecureStorage>)=>[
  ()=>storage.getItem("metadata"),()=>storage.setItem("metadata","value"),()=>storage.deleteItem("metadata"),
  ()=>storage.authenticatedSecrets!.getItem(key),()=>storage.authenticatedSecrets!.setItem(key,"fixture"),()=>storage.authenticatedSecrets!.deleteItem(key),
];

function fixture(){
  const calls:Array<{method:string;key:string;options?:unknown}>=[];
  const native:NativeSecureStore={WHEN_UNLOCKED_THIS_DEVICE_ONLY:99,
    async getItemAsync(key,options){calls.push({method:"get",key,options});return null},
    async setItemAsync(key,_value,options){calls.push({method:"set",key,options})},
    async deleteItemAsync(key,options){calls.push({method:"delete",key,options})},
  };
  const health=new SecureStorageHealth();
  return {native,health,calls,storage:createPlatformSecureStorage(native,health)};
}

test("first failed commit is classified by one unauthenticated native probe and all six paths stop",async()=>{
  const f=fixture();let poisoned=false,notifications=0;
  f.health.subscribe(()=>{assert.equal(f.health.requiresRestart,true);notifications++});
  f.native.setItemAsync=async(k,_v,options)=>{f.calls.push({method:"set",key:k,options});poisoned=true;throw writeFailure};
  f.native.getItemAsync=async(k,options)=>{f.calls.push({method:"get",key:k,options});if(poisoned)throw uncertain();return null};
  await assert.rejects(f.storage.authenticatedSecrets!.setItem(key,"private-fixture"),SecureStorageRestartRequired);
  assert.equal(notifications,1);assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[1],{method:"get",key:"ynx.wallet.storage-health.probe.v1",options:undefined});
  for(const call of callsFor(f.storage))await assert.rejects(call(),SecureStorageRestartRequired);
  assert.equal(f.calls.length,2,"blocked operations never reach native storage");
});

test("failed deletion also probes without retrying or deleting other records",async()=>{
  const f=fixture();let deletes=0,probes=0;
  f.native.deleteItemAsync=async()=>{deletes++;throw Object.assign(new Error("delete failed"),{code:"ERR_DELETE"})};
  f.native.getItemAsync=async()=>{probes++;throw uncertain()};
  await assert.rejects(f.storage.deleteItem("metadata"),SecureStorageRestartRequired);
  assert.equal(deletes,1);assert.equal(probes,1);
});

test("a fresh JS adapter detects the retained native barrier on startup read without a mutation",async()=>{
  const f=fixture();f.native.getItemAsync=async()=>{throw uncertain()};
  await assert.rejects(f.storage.getItem("ynx.wallet.manifest.v2"),SecureStorageRestartRequired);
  assert.equal(f.health.requiresRestart,true);
  const afterReload=new SecureStorageHealth(),fresh=createPlatformSecureStorage(f.native,afterReload);
  await assert.rejects(fresh.getItem("ynx.wallet.manifest.v2"),SecureStorageRestartRequired);
  assert.equal(afterReload.requiresRestart,true);
});

for(const probeFails of [false,true])test(`biometric cancellation stays retryable when metadata probe ${probeFails?"also fails transiently":"is healthy"}`,async()=>{
  const f=fixture(),cancel=Object.assign(new Error("cancelled"),{code:"ERR_AUTHENTICATION_CANCELED"});
  let attempts=0;
  f.native.setItemAsync=async()=>{if(++attempts===1)throw cancel};
  f.native.getItemAsync=async()=>{if(probeFails)throw new Error("temporary read failure");return null};
  await assert.rejects(f.storage.authenticatedSecrets!.setItem(key,"fixture"),error=>error===cancel);
  assert.equal(f.health.requiresRestart,false);
  await f.storage.authenticatedSecrets!.setItem(key,"fixture");
  assert.equal(attempts,2);
});

test("ordinary read failures do not add probes or invent an unreadable wallet",async()=>{
  const f=fixture(),failure=new Error("temporarily unavailable");let reads=0;
  f.native.getItemAsync=async()=>{reads++;throw failure};
  await assert.rejects(f.storage.getItem("metadata"),error=>error===failure);
  assert.equal(reads,1);assert.equal(f.health.requiresRestart,false);
});

test("a successful native read arriving after quarantine never releases its captured secret",async()=>{
  const f=fixture();let resolve!:(value:string)=>void;
  f.native.getItemAsync=()=>new Promise(r=>{resolve=r});
  const pending=f.storage.authenticatedSecrets!.getItem(key);
  f.health.observe(uncertain());resolve("unverified-cached-secret");
  await assert.rejects(pending,SecureStorageRestartRequired);
});

test("a successful native write arriving after quarantine cannot show saved",async()=>{
  const f=fixture();let resolve!:()=>void;
  f.native.setItemAsync=()=>new Promise(r=>{resolve=r});
  const pending=f.storage.setItem("metadata","value");
  f.health.observe(uncertain());resolve();
  await assert.rejects(pending,SecureStorageRestartRequired);
  assert.equal(f.calls.length,0,"no extra probe after quarantine");
});

test("only exact native code latches; subscribers cannot hide failure or prevent other locks",()=>{
  const health=new SecureStorageHealth();let locks=0;
  health.subscribe(()=>{throw new Error("broken listener")});health.subscribe(()=>locks++);
  for(const value of ["ERR_STORAGE_WRITE_UNCERTAIN",new Error(new SecureStorageRestartRequired().message),{code:"ERR_WRITE"},{code:"err_storage_write_uncertain"}])health.observe(value);
  assert.equal(health.requiresRestart,false);assert.equal(locks,0);
  health.observe(uncertain());health.observe(uncertain());
  assert.equal(health.requiresRestart,true);assert.equal(locks,1);
  let late=0;const unsubscribe=health.subscribe(()=>late++);unsubscribe();
  assert.equal(late,1);assert.throws(()=>health.assertHealthy(),SecureStorageRestartRequired);
});
