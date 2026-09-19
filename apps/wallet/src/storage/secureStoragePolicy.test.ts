import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTHENTICATED_SECRET_SERVICE, createPlatformSecureStorage, SECRET_AUTHENTICATION_PROMPT, type NativeSecureStore } from "./secureStoragePolicy";
import { walletIdentity } from "@ynx-chain/wallet-auth";

function recordingNative() {
  const calls: Array<{method:string;key:string;value?:string;options?:Parameters<NativeSecureStore["getItemAsync"]>[1]}> = [];
  const native:NativeSecureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY:99,
    async getItemAsync(key,options){calls.push({method:"get",key,options});return null},
    async setItemAsync(key,value,options){calls.push({method:"set",key,value,options})},
    async deleteItemAsync(key,options){calls.push({method:"delete",key,options})},
  };
  return {storage:createPlatformSecureStorage(native),calls};
}

test("metadata, audit and replay storage never request native biometric authentication",async()=>{
  const {storage,calls}=recordingNative();
  for(const key of ["ynx.wallet.manifest.v2","ynx.wallet.authorization-audit.v1","ynx.wallet.product-session-replay.v2"]){
    await storage.getItem(key);await storage.setItem(key,"public");await storage.deleteItem(key);
  }
  assert.equal(calls.length,9);
  assert.ok(calls.every(call=>!call.options?.requireAuthentication&&!call.options?.keychainService));
});

test("secret reads and writes use a distinct service and cipher-bound biometric options",async()=>{
  const {storage,calls}=recordingNative();
  const key=`ynx.wallet.account.auth.v3.${walletIdentity("01".repeat(32)).account}`;
  await storage.authenticatedSecrets!.getItem(key);
  await storage.authenticatedSecrets!.setItem(key,"fixture-record");
  await storage.authenticatedSecrets!.deleteItem(key);
  assert.equal(calls.length,3);
  for(const call of calls) assert.deepEqual(call.options,{keychainService:AUTHENTICATED_SECRET_SERVICE,requireAuthentication:true,authenticationPrompt:SECRET_AUTHENTICATION_PROMPT,keychainAccessible:99});
});

test("new secret material cannot be written through the unauthenticated metadata adapter",async()=>{
  const {storage,calls}=recordingNative();
  for(const key of ["ynx.mobile.identity.v1","ynx.wallet.account.v2.test","ynx.wallet.account.auth.v3.test"]){
    await assert.rejects(storage.setItem(key,"fixture-secret"),/OS-authenticated/);
  }
  assert.equal(calls.length,0);
  assert.throws(()=>storage.authenticatedSecrets!.getItem("ynx.wallet.manifest.v2"),/Invalid authenticated/);
});
