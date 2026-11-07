// Controlled Main/Native/resource fixtures; never genuine Root admission,
// actual registered private transport, keys, signatures or application GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalWalletProductContextBridge} from '../src/original-policy-supplier/product-native-context.mjs';
const account='0x'+'12'.repeat(20),networkId='34'.repeat(32),merchant='0x'+'56'.repeat(20);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
function fixture(options={}){
 const events=[],requests=[],nativeOwners=new WeakSet();let guardCausePresent=false,guardCause,clock=new Date(),live={account,networkId,revision:1,locked:false,changing:false,focused:true};
 const ctx={captureOpen:true,captureSelected:false,account,networkId,revision:1,expiresAtMs:clock.getTime()+60000,
  assertCurrent(){events.push('ctx.current');if(guardCausePresent)throw guardCause;},async recheck(){events.push('ctx.recheck');},readCurrentState:()=>({...live}),onCaptured(peer){events.push('captured');options.onCaptured?.(peer);}};
 let selectedContext=ctx;const bridge=createOriginalWalletProductContextBridge(()=>selectedContext,{isOriginalNativeOwner:owner=>nativeOwners.has(owner)});
 const scopeDATA={version:1,account,networkId,protectedResourceRef:'PUBLIC.pay.resource',operations:['readInvoice','readInvoiceEvents','readOriginalArchiveReceipt','readOriginalArchiveReconciliation'],products:[{productId:'shop.order',sourceOrder:'order.one'}]};
 const resource={networkId,protectedResourceRef:'PUBLIC.pay.resource',origin:'https://pay.example.invalid',
  async requestPrivate(input){requests.push(input);input.assertCurrent();if(options.request)return options.request(input);return{method:input.method,requestPath:input.path,status:200,contentType:'application/json',body:Buffer.from(JSON.stringify({merchant,invoiceId:'invoice.one',events:[]}))};},
  current(){events.push('resource.current');if(options.resourceCurrent)return options.resourceCurrent();},
  retire(){events.push('resource.retire');return options.resourceRetire?.();},async join(){events.push('resource.join');return options.resourceJoin?.();},async close(){events.push('resource.close');return options.resourceClose?.();}};
 let peer;
 const owner=Object.freeze({
  current(){events.push('FORBIDDEN native.current');throw Error('Main current must never cycle through Native');},
  retire(){events.push('native.retire');peer?.retire();return options.nativeRetire?.();},
  readOriginalProductScopeDATAForMain(){events.push('native.scope');return options.rawScope?options.rawScope(scopeDATA):freeze(options.scope??scopeDATA);},
  captureOriginalProductPayResourceForMain(){events.push('native.resource');return options.captureResource?options.captureResource(Object.freeze(resource)):Object.freeze(resource);}});nativeOwners.add(owner);
 return {ctx,bridge,owner,scopeDATA,resource,events,requests,nativeOwners,get peer(){return peer;},get live(){return live;},set live(value){live=value;},setContext:value=>{selectedContext=value;},revoke(cause){guardCausePresent=true;guardCause=cause;},capture(){peer=bridge.capture();return peer;},associate(){bridge.associate(peer,owner);}};
}
async function drain(peer){peer.retire();await peer.join();await peer.close();}

test('Main synchronous capture exposes exact2 DATA, same slot association and no Native-current recursion',async()=>{
 const f=fixture(),peer=f.capture();assert.equal(f.bridge.isPeer(peer),true);assert.deepEqual(peer.readOriginalContextDATA(),{networkId,account});assert.equal(Object.keys(peer.readOriginalContextDATA()).length,2);
 assert.throws(()=>f.bridge.capture(),/NOT_ACTIVE/);assert.throws(()=>peer.readOriginalContextDATA('caller'),/ZERO_INPUT/);assert.throws(()=>f.bridge.associate(peer,{}),/ASSOCIATION_OWNER/);
 f.associate();assert.equal(peer.current(),undefined);assert.equal(f.events.some(x=>x==='FORBIDDEN native.current'),false);await drain(peer);assert.equal(f.events.filter(x=>x==='native.retire').length,1);f.bridge.assertSafeToClose();
});
test('Main capture partial retains falsy current failure and can drain without closing any parent',async()=>{
 for(const cause of [false,null,undefined]){const f=fixture();f.revoke(cause);let partial;assert.throws(()=>f.capture(),error=>{partial=error.partial;return error.code==='PRODUCT_NATIVE_CONTEXT_CAPTURE_FAILED'&&error.cause===cause;});assert.equal(f.bridge.isPeer(partial),true);assert.equal(f.bridge.statusDATA().rows[0].firstCausePresent,true);await drain(partial);f.bridge.assertSafeToClose();assert.equal(f.events.includes('native.retire'),false);assert.equal(f.events.includes('resource.close'),false);}
});
test('unavailable original Shop and Cloud getters refuse rather than invent product data',async()=>{
 for(const name of ['readOriginalShopNativeInvoiceRequestDATA','readOriginalCloudBillLocator']){const f=fixture(),peer=f.capture();f.associate();await assert.rejects(peer[name](name.includes('Shop')?'order.one':{productId:'cloud.ide-usage',sourceOrder:'bill.one'},()=>{}),/PRODUCT_NATIVE_(?:SHOP_ORIGINAL|CLOUD_LOCATOR)_NOT_SUPPLIED/);assert.equal(f.requests.length,0);await drain(peer);f.bridge.assertSafeToClose();}
});
test('real Main-local getter receives combined current/signal and late lock never returns its value',async()=>{
 let release,started;const reached=new Promise(resolve=>{started=resolve;}),f=fixture();let sameSignal;
 f.ctx.readOriginalShopNativeInvoiceRequestDATA=(orderId,current)=>{assert.equal(orderId,'order.one');current();sameSignal=current.signal;started();return new Promise(resolve=>{release=()=>resolve({original:'PUBLIC original order'});});};
 const peer=f.capture();f.associate();const task=peer.readOriginalShopNativeInvoiceRequestDATA('order.one',()=>{});await reached;f.live={...f.live,locked:true};f.bridge.invalidateAll();assert.equal(sameSignal.aborted,true);const joined=peer.join();assert.throws(()=>peer.close(),/CHILDREN_RETAINED/);release();await assert.rejects(task,/RETIRED/);await joined;await peer.close();f.bridge.assertSafeToClose();assert.equal(f.events.filter(x=>x==='native.retire').length,1);
});
test('Native same owner fixed getters supply safe13 preparation client once and only child resources drain',async()=>{
 const f=fixture(),peer=f.capture();assert.throws(()=>peer.captureOriginalPayPreparationReaderForNative(),/ASSOCIATION_REQUIRED/);f.associate();const acquisition=peer.captureOriginalPayPreparationReaderForNative(),client=await acquisition;assert.equal(peer.captureOriginalPayPreparationReaderForNative(),acquisition);
 await client.pay.readInvoice(merchant,'invoice.one',()=>{});assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,`/v5/pay/invoices/${merchant}/invoice.one`);assert.equal(f.events.filter(x=>x==='native.resource').length,1);assert.equal(f.events.filter(x=>x==='native.scope').length,1);
 for(const forbidden of ['submitSettlement','submitRefund','submitMerchantMember','submitSettlementPacket','requestPrivate','approve','sign'])assert.equal(client.pay[forbidden],undefined);
 await drain(peer);f.bridge.assertSafeToClose();assert.equal(f.events.filter(x=>x==='resource.retire').length,1);assert.equal(f.events.filter(x=>x==='resource.join').length,1);assert.equal(f.events.filter(x=>x==='resource.close').length,1);assert.equal(f.events.includes('FORBIDDEN native.current'),false);
});
test('scope mismatch refuses before raw resource acquisition, constructor failure leaves cleanup with Native',async()=>{
 const mismatch=fixture(),a=mismatch.capture();mismatch.scopeDATA.networkId='ab'.repeat(32);mismatch.associate();await assert.rejects(a.captureOriginalPayPreparationReaderForNative(),/SCOPE_CHANGED/);assert.equal(mismatch.events.includes('native.resource'),false);await drain(a);
 const f=fixture();f.resource.protectedResourceRef='PUBLIC.other.resource';const peer=f.capture();f.associate();const attempt=peer.captureOriginalPayPreparationReaderForNative();await assert.rejects(attempt,/RESOURCE_NOT_SELECTED/);assert.equal(peer.captureOriginalPayPreparationReaderForNative(),attempt);await drain(peer);assert.equal(f.events.includes('resource.retire'),false);assert.equal(f.events.includes('resource.join'),false);assert.equal(f.events.includes('resource.close'),false);
});
test('cancellation adopts the same late raw resource but never transfers it to a new producer or retries',async()=>{
 let release,started;const reached=new Promise(resolve=>{started=resolve;}),f=fixture({captureResource:resource=>new Promise(resolve=>{release=()=>resolve(resource);started();})}),peer=f.capture();f.associate();const task=peer.captureOriginalPayPreparationReaderForNative();await reached;peer.retire();const joined=peer.join();let completed=false;void joined.then(()=>{completed=true;});await Promise.resolve();assert.equal(completed,false);release();await assert.rejects(task,/RETIRED/);await joined;await peer.close();f.bridge.assertSafeToClose();assert.equal(f.events.filter(x=>x==='native.resource').length,1);assert.equal(f.events.includes('resource.close'),false);assert.equal(f.bridge.statusDATA().held,0);
});
test('same associated owner is required, and association recognition never invokes owner.current',async()=>{
 const f=fixture(),peer=f.capture();const other=Object.freeze({retire(){},current(){throw Error('FORBIDDEN');}});f.nativeOwners.add(other);f.setContext({...f.ctx});assert.throws(()=>f.bridge.associate(peer,f.owner),/ASSOCIATION_SCOPE/);f.setContext(f.ctx);f.associate();assert.throws(()=>f.bridge.associate(peer,other),/ASSOCIATION_CONFLICT/);peer.current();await drain(peer);assert.equal(f.events.includes('FORBIDDEN native.current'),false);
});
test('failed child close retains same original UNKNOWN cleanup and never retries the resource',async()=>{
 const f=fixture({resourceClose:async()=>{throw false;}}),peer=f.capture();f.associate();await peer.captureOriginalPayPreparationReaderForNative();peer.retire();await peer.join();const closing=peer.close();await assert.rejects(closing,e=>e===false);assert.equal(peer.close(),closing);await assert.rejects(peer.close(),e=>e===false);assert.equal(f.events.filter(x=>x==='resource.close').length,1);assert.equal(f.bridge.statusDATA().rows[0].cleanupErrorPresent,true);assert.equal(f.bridge.statusDATA().rows[0].cleanupError,false);assert.throws(()=>f.bridge.assertSafeToClose(),/CLOSE_UNCONFIRMED/);
});
test('revision and deadline remain private current fences without expanding public context exact2',async()=>{
 const f=fixture(),peer=f.capture();f.associate();f.live={...f.live,revision:2};assert.throws(()=>peer.current(),/IDENTITY_CHANGED/);await drain(peer);const old=fixture();old.ctx.expiresAtMs=0;assert.throws(()=>old.capture(),e=>e.code==='PRODUCT_NATIVE_CONTEXT_CAPTURE_FAILED'&&e.cause.code==='PRODUCT_NATIVE_CONTEXT_BINDING_INVALID');await old.bridge.closeContext(old.ctx);old.bridge.assertSafeToClose();
});
test('formal getter results must be bare frozen exact8 resource and deep-frozen exact6 scope',async()=>{
 for(const change of [s=>s,s=>Object.freeze({...s}),s=>Object.freeze({owner:freeze(s),errorPresent:false})]){const f=fixture({rawScope:change}),peer=f.capture();f.associate();await assert.rejects(peer.captureOriginalPayPreparationReaderForNative(),/SCOPE_NOT_SUPPLIED/);assert.equal(f.events.includes('native.resource'),false);await drain(peer);}
 for(const change of [r=>({...r}),r=>Object.freeze({...r,extra:true}),r=>Object.freeze({owner:r,errorPresent:false})]){const f=fixture({captureResource:change}),peer=f.capture();f.associate();await assert.rejects(peer.captureOriginalPayPreparationReaderForNative(),/RESOURCE_NOT_SUPPLIED/);await drain(peer);assert.equal(f.events.includes('resource.close'),false);}
});
test('safe13 child still ANDs Main actual guard after the originating ALS capture call settles',async()=>{
 const f=fixture(),peer=f.capture();f.associate();const producer=await peer.captureOriginalPayPreparationReaderForNative();f.ctx.captureOpen=false;f.setContext(undefined);producer.current();f.revoke(false);await assert.rejects(producer.pay.readInvoice(merchant,'invoice.one',()=>{}),e=>e===false);assert.equal(f.requests.length,0);await drain(peer);f.bridge.assertSafeToClose();
});
test('parent context cleanup drains own children despite a sticky original retirement failure',async()=>{
 const f=fixture({nativeRetire:()=>{throw false;}}),peer=f.capture();f.associate();await peer.captureOriginalPayPreparationReaderForNative();
 await assert.rejects(f.bridge.closeContext(f.ctx),cause=>cause===false);
 assert.equal(f.events.filter(x=>x==='native.retire').length,1);assert.equal(f.events.filter(x=>x==='resource.retire').length,1);assert.equal(f.events.filter(x=>x==='resource.join').length,1);assert.equal(f.events.filter(x=>x==='resource.close').length,1);
 assert.equal(f.bridge.statusDATA().rows[0].cleanupErrorPresent,true);assert.equal(f.bridge.statusDATA().rows[0].cleanupError,false);assert.throws(()=>f.bridge.assertSafeToClose(),/CLOSE_UNCONFIRMED/);
});
