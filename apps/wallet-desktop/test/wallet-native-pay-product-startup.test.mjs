import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletNativePayProductStartup} from '../src/wallet-native-pay-product-startup.mjs';
const account='0x'+'11'.repeat(20);
function fixture({acquire,close,read}={}){
 let live=true,captures=0,acquisitions=0;const calls=[];
 const loan={current(){calls.push('current');},retire(){calls.push('retire');},async join(){calls.push('join');},async close(){calls.push('close');return close?.();},pay:{async readInvoice(merchant,invoiceId){calls.push('read');if(read)return read();return {merchant,invoiceId,status:'unpaid'};}}};
 const main={requestPQTypedAction(){throw Error('NO_SIGNING');},reject(){throw Error('NO_APPROVAL');},transactionSender:{submissions:{intentStore:{readPQOriginals(){throw Error('NO_SIGNING');},unresolvedPreparation(){throw Error('NO_SIGNING');}}}}};
 const service=createWalletNativePayProductStartup({captureFactories(){captures++;return {acquireOriginalProductSource(){acquisitions++;return acquire?acquire(loan):loan;},isOriginalProductSource:value=>value===loan};},getMain:()=>main,getContext:()=>({account,locked:!live,focused:true,changing:false,revision:1}),getGuard:()=>({assert(){if(!live)throw Error('PUBLIC_LOCK');}})});
 return {service,calls,lock(){live=false;service.cancel();},counts:()=>({captures,acquisitions})};
}
const input={action:'invoice',merchant:account,invoiceId:'PUBLIC'};
test('boot captures factories without opening a Source; each explicit read drains its own original parent',async()=>{
 const f=fixture();f.service.configure();assert.deepEqual(f.counts(),{captures:1,acquisitions:0});
 for(let i=0;i<2;i++)assert.equal((await f.service.invoke(input)).bill.status,'unpaid');
 assert.deepEqual(f.counts(),{captures:1,acquisitions:2});assert.deepEqual(f.calls.filter(x=>['retire','join','close'].includes(x)),['retire','join','close','retire','join','close']);
 await f.service.shutdown();f.service.assertSafeToClose();
});
test('cancel during acquisition adopts and closes the late SAME parent without reading or publishing',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const f=fixture({async acquire(loan){entered();await gate;return loan;}});const pending=f.service.invoke(input);await ready;f.lock();release();await assert.rejects(pending,{code:'NATIVE_PAY_MAIN_CURRENT_UNAVAILABLE'});
 assert.equal(f.calls.includes('read'),false);assert.deepEqual(f.calls.slice(-3),['retire','join','close']);await f.service.shutdown();
});
test('factory failure retains and drains its recognized partial before returning original failure',async()=>{
 const cause=Object.assign(Error('PUBLIC_CAPTURE'),{});const f=fixture({acquire(loan){cause.partial=loan;throw cause;}});
 await assert.rejects(f.service.invoke(input),error=>error.cause===cause);assert.deepEqual(f.calls,['retire','join','close']);await f.service.shutdown();
});
test('UNKNOWN close is retained and never retried by repeated shutdown',async()=>{
 const cause=Error('PUBLIC_CLOSE_UNKNOWN'),f=fixture({close(){throw cause;}});
 await assert.rejects(f.service.invoke(input),error=>error===cause);assert.throws(()=>f.service.assertSafeToClose(),{code:'NATIVE_PAY_PRODUCT_CLEANUP_PENDING'});
 const shutdown=f.service.shutdown();assert.equal(f.service.shutdown(),shutdown);await assert.rejects(shutdown,error=>error===cause);assert.equal(f.calls.filter(x=>x==='close').length,1);
});
test('lock during actual read prevents late result while original read drains before parent close',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const f=fixture({async read(){entered();await gate;return {merchant:account,invoiceId:'PUBLIC',status:'unpaid'};}});
 const pending=f.service.invoke(input);await ready;f.lock();const shutdown=f.service.shutdown();assert.equal(f.calls.includes('close'),false);release();await assert.rejects(pending);await shutdown;assert.equal(f.calls.filter(x=>x==='close').length,1);
});
