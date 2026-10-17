import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { BiometricProtectionRequired, checkBiometricProtection, prepareProtectedWallet } from "./biometricProtection";
import { setupCopy } from "../i18n/setupCopy";

function capabilities(hardware=true,enrolled=true,level=3) { return {hasHardwareAsync:async()=>hardware,isEnrolledAsync:async()=>enrolled,getEnrolledLevelAsync:async()=>level,SecurityLevel:{BIOMETRIC_STRONG:3}}; }
for (const [reason,api] of [["hardware-unavailable",capabilities(false)], ["enrollment-required",capabilities(true,false)], ["strong-enrollment-required",capabilities(true,true,2)]] as const) {
  test(`protection ${reason} fails before recovery material generation`,async()=>{
    let generated=0;
    await assert.rejects(prepareProtectedWallet(()=>checkBiometricProtection(api),async()=>++generated,()=>{}),(error:unknown)=>error instanceof BiometricProtectionRequired&&error.reason===reason);
    assert.equal(generated,0);
  });
}
test("canceled capability checks cannot generate a key",async()=>{
  let current=true,generated=0;const api=capabilities();api.isEnrolledAsync=async()=>{current=false;return true};
  const guard=()=>{if(!current)throw new Error("canceled")};
  await assert.rejects(prepareProtectedWallet(()=>checkBiometricProtection(api,guard),async()=>++generated,guard),/canceled/);
  assert.equal(generated,0);
});
test("late entropy generation is erased when its creation intent was canceled",async()=>{
  let current=true;const bytes=new Uint8Array(32).fill(7);
  await assert.rejects(prepareProtectedWallet(async()=>{},async()=>{current=false;return bytes},()=>{if(!current)throw Error("canceled")},value=>value.fill(0)),/canceled/);
  assert.equal(bytes.some(value=>value!==0),false);
});
test("actual App creation handler keeps only intent through Settings and requires explicit retry",async()=>{
  const source=await readFile(new URL("../../App.tsx",import.meta.url),"utf8");
  const start=source.indexOf("  const beginSetup=async"),end=source.indexOf("  const create=",start);
  assert.ok(start>0&&end>start);
  let enrolled=false,generation=0,materialCalls=0,pending:any=null,mode="closed",intent:any=null,busy=false;
  const context={busy:false,AppState:{currentState:"active"},manifest:{accounts:[]},BiometricProtectionRequired,prepareProtectedWallet,
    assertStrongBiometrics:async()=>checkBiometricProtection(capabilities(true,enrolled)),
    getRandomBytesAsync:async()=>{materialCalls++;return new Uint8Array(32).fill(1)},bytesToHex:()=>"fixture-non-secret",
    setBusy:(value:boolean)=>{busy=value},setError:()=>{},setPendingRecovery:(value:any)=>{pending=value},setSetup:(value:string)=>{mode=value},setProtectionIntent:(value:any)=>{intent=value},localizeError:(_l:any,e:Error)=>e.message,locale:"en",
    rootScope:{begin:()=>{const owned=++generation;const assert=()=>{if(owned!==generation)throw Error("canceled")};return {assert,ownsScope:()=>owned===generation,step:async(fn:any)=>{assert();const value=await fn();assert();return value},finish:()=>{}}}}};
  const script=ts.transpile(`${source.slice(start,end)}\nglobalThis.beginSetup=beginSetup;`,{target:ts.ScriptTarget.ES2022});
  runInNewContext(script,context);
  const begin=(context as any).beginSetup;
  await begin("create");assert.equal(materialCalls,0);assert.equal(pending,null);assert.equal(mode,"closed");assert.equal((intent as any).mode,"create");assert.equal(busy,false);
  // System settings/enrollment changes do not execute the handler automatically.
  enrolled=true;assert.equal(materialCalls,0);assert.equal(mode,"closed");
  await begin((intent as any).mode);assert.equal(materialCalls,1);assert.equal(mode,"create");assert.ok(pending);assert.equal(intent,null);
  pending=null;mode="closed";enrolled=false;
  await begin("import");assert.equal((intent as any).mode,"import");assert.equal(materialCalls,1);assert.equal(mode,"closed");
  enrolled=true;await begin((intent as any).mode);assert.equal(mode,"import");assert.equal(materialCalls,1);
});
test("backup and protection actions are localized without translating confirmation token",()=>{
  assert.match(setupCopy("zh-Hans","backupConfirm"),/BACKED UP/);
  assert.match(setupCopy("zh-Hans","save"),/保存/);
  assert.match(setupCopy("en","preserved"),/never creates an account automatically/);
});
