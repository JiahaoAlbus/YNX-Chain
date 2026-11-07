// Actual preload, Main IPC bodies, lifecycle and P06 whole9 controllers.
// Only the Electron transport/Native loan/authorizer are PUBLIC controlled
// fixtures. This is not installed GUI, Root/Source or financial acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {assertWalletIPC} from '../src/wallet-ipc-policy.mjs';
import {createWalletNativePayProductStartup} from '../src/wallet-native-pay-product-startup.mjs';
import {createWalletNativePayProduct,installWalletNativePayProductIPC} from '../src/wallet-native-pay-product.mjs';

const source=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
const preload=fs.readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8');
const ipcBody=source.slice(source.indexOf('function handleWalletIPC('),source.indexOf('const isolatedProfile ='));
const safeBody=source.slice(source.indexOf('async function safeIPC('),source.indexOf('function safeErrorClass('));
const directory=fileURLToPath(new URL('../src/',import.meta.url));
const account='0x'+'11'.repeat(20),invoiceId='PUBLIC-invoice-original';
const request={action:'invoice',merchant:account,invoiceId};
const gate=()=>{let release;const promise=new Promise(yes=>release=yes);return{promise,release};};

async function fixture(t,{read,close,payMissing=false}={}){
 let startup,focused=true,api,currentEvent,reads=0,acquisitions=0,closes=0;
 const calls=[],wire=[],recognized=new WeakSet(),handlers=new Map();
 const keyAccess=new DesktopKeyLifecycle({focused:()=>focused,
  authorizer:{available:()=>true,method:'PUBLIC-no-credentials',authenticate:async()=>({account})},
  beforeInvalidate:()=>startup?.cancel()});
 keyAccess.setAccount(account);keyAccess.setFocused(true);await keyAccess.unlock();
 const forbidden=()=>{throw Error('PUBLIC_READ_MUST_NOT_SIGN_OR_SEND');};
 const main={pendingRequests:()=>[],expire:forbidden,requestPQTypedAction:forbidden,reject:forbidden,
  transactionSender:{submissions:{intentStore:{readPQOriginals:forbidden,unresolvedPreparation:forbidden}}}};
 startup=createWalletNativePayProductStartup({
  captureFactories:()=>({
   acquireOriginalProductSource(){
    acquisitions++;let retired=false;
    const loan={current(){if(retired)throw Error('PUBLIC_RETIRED');calls.push('current');},
     retire(){retired=true;calls.push('retire');},async join(){calls.push('join');},
     async close(){closes++;calls.push('close');return close?.();},
     pay:payMissing?{}:{async readInvoice(merchant,id){reads++;calls.push('read');
      assert.equal(merchant,account);assert.equal(id,invoiceId);
      return read?read():{merchant,invoiceId:id,status:'unpaid',paidAtoms:'9007199254740993',member:'PUBLIC_PRIVATE_MEMBER'};
     }}};
    recognized.add(loan);return loan;
   },isOriginalProductSource:value=>recognized.has(value)
  }),getMain:()=>main,getGuard:()=>keyAccess.current(),
  getContext:()=>({...keyAccess.status(),focused,changing:false})});
 startup.configure();
 const service=createWalletNativePayProduct({entry:startup,getMain:()=>main,getGuard:()=>keyAccess.current(),publishReview:forbidden});
 // These two bodies come from the normal Main source, including its original
 // sender gate and safe result envelope. The metadata sink never touches disk.
 const safeIPC=Function('recordRPCMetadataFailure','path','app',safeBody+'\nreturn safeIPC;')(
  ()=>{},path,{getPath:()=>'/PUBLIC-no-wallet-data'});
 const contents={isDestroyed:()=>false,mainFrame:{url:pathToFileURL(path.join(directory,'index.html')).href}};
 currentEvent={sender:contents,senderFrame:contents.mainFrame};
 const handleWalletIPC=Function('ipcMain','assertWalletIPC','mainWindow','pathToFileURL','path','directory','safeIPC',ipcBody+'\nreturn handleWalletIPC;')(
  {handle:(name,handler)=>handlers.set(name,handler)},assertWalletIPC,{webContents:contents},pathToFileURL,path,directory,safeIPC);
 installWalletNativePayProductIPC({handleWalletIPC,safeIPC,sensitiveIPC:action=>safeIPC(()=>keyAccess.run(action)),service});
 runInNewContext(preload,{require:name=>{
  assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'ynxWallet');api=value;}},
   ipcRenderer:{async invoke(channel,...args){
    const handler=handlers.get(channel);assert.ok(handler,'normal registered Pay handler');
    const result=await handler(currentEvent,...structuredClone(args));wire.push(result);return structuredClone(result);
   },on:forbidden}};
 }});
 t.after(async()=>{try{await startup.shutdown();}catch{}try{keyAccess.lock('closed');}catch{}});
 return {api,startup,wire,calls,counts:()=>({reads,acquisitions,closes}),
  blur(){focused=false;keyAccess.setFocused(false);},
  foreignFrame(){currentEvent={sender:contents,senderFrame:{url:'https://PUBLIC.invalid/foreign'}};}};
}

test('normal preload reaches per-request original Source and returns nested exact Pay DATA without effects',async t=>{
 const f=await fixture(t),status=await f.api.nativePayStatus();
 assert.equal(status.ok,true);assert.equal(status.value.canRequest,true);
 assert.equal(status.value.available,false);assert.equal(status.value.sourceSupplied,false);
 assert.equal(f.counts().acquisitions,0);
 const outer=await f.api.nativePayInvoke(request);
 assert.equal(outer.ok,true);assert.equal(outer.value.version,'ynx.pay.main-result/v1');assert.equal(outer.value.ok,true);
 assert.equal(outer.value.bill.paidAtoms,'9007199254740993');assert.equal(outer.value.clientIndependentFinality,false);
 assert.doesNotMatch(JSON.stringify(outer),/PUBLIC_PRIVATE_MEMBER/);
 assert.deepEqual(f.counts(),{reads:1,acquisitions:1,closes:1});
 assert.deepEqual(f.calls.filter(x=>['retire','join','close'].includes(x)),['retire','join','close']);
});

test('all three normal Pay IPC entry points reject a foreign frame before acquisition',async t=>{
 const f=await fixture(t);f.foreignFrame();
 for(const invoke of [()=>f.api.nativePayStatus(),()=>f.api.nativePayInvoke(request),()=>f.api.nativePayCancel()]){
  const result=await invoke();assert.equal(result.ok,false);assert.equal(result.error.code,'UNTRUSTED_WALLET_FRAME');
 }
 assert.deepEqual(f.counts(),{reads:0,acquisitions:0,closes:0});
});

test('outer IPC success keeps inner UNKNOWN failure distinct and loses private diagnostic authority over the wire',async t=>{
 const f=await fixture(t,{read(){throw false;}}),outer=await f.api.nativePayInvoke(request);
 assert.equal(outer.ok,true);assert.equal(outer.value.ok,false);assert.equal(outer.value.outcome,'UNKNOWN');
 assert.equal(outer.value.canRetry,false);assert.equal(outer.value.paymentAuthorized,false);
 assert.deepEqual(outer.value.recoveryActions,[request]);
 assert.deepEqual(f.startup.readOriginalFailureCause(outer.value),{present:false});
 assert.deepEqual(f.startup.readOriginalFailureCause(f.wire.at(-1).value),{present:true,cause:false});
 assert.equal(f.counts().reads,1);
 await Promise.resolve();assert.equal(f.counts().reads,1);
 await f.api.nativePayInvoke(outer.value.recoveryActions[0]);assert.equal(f.counts().reads,2);
});

test('actual focus-loss lifecycle fences a late read and drains its same original loan once',async t=>{
 const entered=gate(),finish=gate(),f=await fixture(t,{async read(){entered.release();await finish.promise;return {merchant:account,invoiceId,status:'paid'};}});
 const pending=f.api.nativePayInvoke(request);await entered.promise;f.blur();
 assert.equal(f.calls.includes('retire'),true);assert.equal(f.calls.includes('close'),false);
 finish.release();const result=await pending;assert.equal(result.ok,false);assert.equal(Object.hasOwn(result,'value'),false);
 await f.startup.shutdown();assert.deepEqual(f.counts(),{reads:1,acquisitions:1,closes:1});
});

test('missing original qualified method is precise UNKNOWN DATA and never a fallback lookup',async t=>{
 const f=await fixture(t,{payMissing:true}),outer=await f.api.nativePayInvoke(request);
 assert.equal(outer.ok,true);assert.equal(outer.value.ok,false);
 assert.equal(outer.value.code,'NATIVE_PAY_PRODUCT_PAY_METHOD_UNAVAILABLE');
 assert.equal(outer.value.canRetry,false);assert.equal(f.counts().reads,0);
 assert.deepEqual(outer.value.recoveryActions,[request]);
});

test('unconfirmed original close cannot become successful IPC or restart cleanup on repeated shutdown',async t=>{
 const f=await fixture(t,{close(){throw false;}}),outer=await f.api.nativePayInvoke(request);
 assert.equal(outer.ok,false);assert.equal(Object.hasOwn(outer,'value'),false);
 assert.equal(f.counts().closes,1);assert.throws(()=>f.startup.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLEANUP_PENDING'});
 const first=f.startup.shutdown();assert.equal(f.startup.shutdown(),first);await assert.rejects(first,e=>e===false);
 assert.equal(f.counts().closes,1);
});
