import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('export function composeProtectedDesktopPay('),end=source.indexOf('\nconst startupProtocolUrls',start);
assert.ok(start>0&&end>start);
// Execute the actual boot-composition function under PUBLIC Main globals.
// No Electron startup, Source constructor, native runtime or wallet is created.
function fixture(){
 let legacy=0;const sandbox={desktopPayService:{compose(){legacy++;}},walletAuthority:null,originalPQPaySupply:null,originalPQPayComposition:null,originalPQPayCompositionCause:undefined,originalPQPayBootEntered:false};
 const fn=vm.compileFunction(source.slice(start,end).replace('export function','function')+';composeProtectedDesktopPay.normal=composeNormalOriginalDesktopPay;return composeProtectedDesktopPay;',[],{filename:new URL('../src/main.mjs',import.meta.url).pathname,contextExtensions:[sandbox],importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER})();
 return {fn,sandbox,legacy:()=>legacy};
}
test('existing legacy boot composition retains its synchronous behavior and supplies no Pay authority',()=>{
 const f=fixture();assert.equal(f.fn({PUBLIC:true}),undefined);assert.equal(f.legacy(),1);assert.equal(f.sandbox.originalPQPaySupply,null);
});
test('new boot composition imports only fixed SDK parser and configures once without claiming Source admission',async()=>{
 const f=fixture(),acquire=()=>{throw Error('NO_NATIVE_SOURCE');},recognized=()=>false;
 const result=await f.fn(null,{acquireOriginalPaySource:acquire,isOriginalPaySource:recognized});
 assert.equal(result.configured,true);assert.equal(result.SourceAdmission,false);assert.equal(f.sandbox.originalPQPaySupply.acquireOriginalPaySource,acquire);assert.equal(f.legacy(),0);
 assert.throws(()=>f.fn(null,{acquireOriginalPaySource:acquire,isOriginalPaySource:recognized}),{code:'PQ_PAY_BOOT_COMPOSITION_REQUIRED'});
});
test('composition failure rejects actual caller, preserves first cause, and leaves only Pay unavailable',async()=>{
 const f=fixture();await assert.rejects(f.fn(null,{acquireOriginalPaySource:null,isOriginalPaySource:()=>false}),{code:'PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED'});
 assert.equal(f.sandbox.originalPQPaySupply,null);assert.equal(f.sandbox.originalPQPayCompositionCause.code,'PQ_PAY_DISPATCH_SOURCE_NOT_SUPPLIED');
 assert.throws(()=>f.fn(null,{}),{code:'PQ_PAY_BOOT_COMPOSITION_REQUIRED'});
 assert.match(source,/if\(originalPQPayComposition\)try\{await originalPQPayComposition;\}catch/);
});
test('normal Main routes the same pending capsule through one ALS controller with retained target',()=>{
 assert.match(source,/pqTransactionSubmission\.broadcast\(hash,guard,request,payTarget\)/);
 assert.match(source,/pqPayBroadcastSource:originalPQPaySupply\?executeOriginalPQBroadcast:null/);
 assert.equal(source.includes("handleWalletIPC('composeProtectedDesktopPay'"),false);
});
test('boot already entered refuses late composition even before the authority object exists',()=>{
 const f=fixture();f.sandbox.originalPQPayBootEntered=true;
 assert.throws(()=>f.fn(null,{acquireOriginalPaySource:()=>{},isOriginalPaySource:()=>false}),{code:'PQ_PAY_BOOT_COMPOSITION_REQUIRED'});
 assert.equal(f.sandbox.originalPQPaySupply,null);assert.equal(f.sandbox.originalPQPayComposition,null);
});

test('normal startup composes fixed SDK namespace once without loading or granting Native authority',async()=>{
 const f=fixture();const r=await f.fn.normal();assert.equal(r.configured,true);assert.equal(r.SourceAdmission,false);const original=f.sandbox.originalPQPaySupply;assert.equal(typeof original.acquireOriginalPaySource,'function');assert.equal(original.isOriginalPaySource({}),false);await f.fn.normal();assert.equal(f.sandbox.originalPQPaySupply,original);
 const boot=source.slice(source.indexOf('if (singleInstanceLock) app.whenReady().then(async () => {'));assert.ok(boot.indexOf('await composeNormalOriginalDesktopPay()')<boot.indexOf('originalPQPayBootEntered=true'));
});
test('normal startup preserves an existing composition failure rather than retrying the factory',async()=>{
 const f=fixture();await assert.rejects(f.fn(null,{}));const cause=f.sandbox.originalPQPayCompositionCause;await assert.rejects(f.fn.normal(),e=>e===cause);assert.equal(f.sandbox.originalPQPaySupply,null);
});
