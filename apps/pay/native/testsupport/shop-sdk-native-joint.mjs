// PUBLIC mechanism composition only. The actual SDK wrapper and Native TUs
// are pinned, but their Root/session/proof ports below are PUBLIC fixtures.
// This cannot qualify a production Source, signed proof, image or installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';

const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sdkFile=process.env.PUBLIC_SHOP_SDK_MODULE;
const mainFile=process.env.PAY_MAIN_PRODUCT_MODULE;
assert.equal(hash(sdkFile),'46bac4ea711d4a5bd0a2816e38770da371d14443398459f19aa47e6ec56ce822');
assert.equal(hash(mainFile),'3e44cc3e96092616ebaa0752ae6bdcf62f4cb808ac2f6d4e72cc97b15ad2731a');
const {acquireOriginalShopPrivateClient,isOriginalShopPrivateClient}=await import(pathToFileURL(sdkFile).href);
const {createWalletNativePayProduct}=await import(pathToFileURL(mainFile).href);
const image=createRequire(import.meta.url)(process.env.PUBLIC_SHOP_NATIVE_IMAGE);
const expected=JSON.parse(fs.readFileSync(process.env.PUBLIC_SHOP_EXPECTED_DATA,'utf8'));
const captured=acquireOriginalShopPrivateClient();
assert.equal(captured.errorPresent,false);
const child=captured.owner;
assert.equal(isOriginalShopPrivateClient(child),true);
assert.equal(child.isClosed(),false);
assert.equal(Object.hasOwn(child,'pay'),false);

let validated=0,reads=0,cachedPromise,retired=0,joined=0,parentClosed=false;
let cancelOnCachedRead=false;
const forbidden=()=>{throw Error('PUBLIC query entered review/signing/dispatch');};
const account=expected.merchant;
const main={pendingRequests:()=>[],requestPQTypedAction:forbidden,requestPQPayBroadcast:forbidden,reject:forbidden};
// This query-only fixture supplies no Main journal or signing capability.
const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account,revision:1,focused:true})});
// PUBLIC parent fixture: the genuine Native child brand is deliberately NOT
// passed to P06 as a whole ProductSource recognizer or a Pay capability.
const loan={
 current:()=>child.current(),
 readOriginalShopNativeInvoiceRequestDATA(order,current){
  reads++;
  const promise=child.readOriginalShopNativeInvoiceRequestDATA(order,current);
  if(cachedPromise)assert.equal(promise,cachedPromise);
  else cachedPromise=promise;
  if(cancelOnCachedRead)entry.cancel();
  return promise;
 },
 pay:{lookupInvoiceIntent(original,current){
  current();validated++;
  assert.deepEqual(JSON.parse(JSON.stringify(original)),expected);
  throw Object.assign(Error('PUBLIC Pay capability absent'),{code:'PUBLIC_PAY_SOURCE_NOT_SUPPLIED'});
 }},
 retire(){retired++;child.retire();},
 async join(){joined++;await child.join();},
 async close(){
  await child.close();
  assert.equal(child.isClosed(),true);
  // Native physical closure is insufficient for this separate parent.
  assert.equal(parentClosed,false);
  parentClosed=true;
 }
};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:()=>loan,isOriginalProductSource:v=>v===loan});
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account,assert(){}}),publishReview:forbidden});
try{
 const request={action:'lookup-intent',productId:'shop.order',sourceOrder:expected.sourceOrder};
 const first=await service.invoke(request);
 assert.equal(first.ok,false);assert.equal(first.code,'PUBLIC_PAY_SOURCE_NOT_SUPPLIED');
 assert.equal(first.outcome,'UNKNOWN');assert.equal(first.canRetry,false);
 assert.equal(first.bill,undefined);assert.equal(first.walletRequest,undefined);
 assert.equal(validated,1);
 const before=image.PUBLICcounts();
 assert.deepEqual(before,{reads:1,releases:1,proofs:1,proofCloses:1,proofDrops:1,sessionCloses:0,sourceCloses:0});
 cancelOnCachedRead=true;
 const cancelled=await service.invoke(request);
 assert.equal(cancelled.ok,false);
 assert.equal(cancelled.code,'NATIVE_PAY_PRODUCT_REQUEST_CANCELLED');
 assert.equal(cancelled.bill,undefined);assert.equal(cancelled.walletRequest,undefined);
 assert.equal(validated,1);assert.equal(reads,2);
 assert.deepEqual(image.PUBLICcounts(),before);
 assert.equal(parentClosed,false);assert.equal(child.isClosed(),false);
 service.assertSafeToClose();
}finally{
 source.retire();await source.join();await source.close();source.assertSafeToClose();
}
assert.deepEqual([retired,joined,parentClosed],[1,1,true]);
assert.equal(child.isClosed(),true);
assert.deepEqual(image.PUBLICcounts(),{reads:1,releases:1,proofs:1,proofCloses:1,proofDrops:1,sessionCloses:1,sourceCloses:1});
console.log(JSON.stringify({version:'pay-shop-sdk-native-public-joint/v1',runtime:process.versions,actualSDKWrapper:true,actualNativeOwnerProofNapi:true,pinnedOriginalMainWrapper:true,normalMainSourceRead:true,soleBusinessValidator:true,sameOrderPromiseRetained:true,cachedReadCancellationRefused:true,nativeCounts:image.PUBLICcounts(),wholePUBLICParentClosed:parentClosed,RootAdmission:false,SourceAdmission:false,actualV4Proof:false,actualShopGET:false,normalCombinedImage:false,AppModified:false,installed:false,payDispatched:0,signing:0,funds:0}));
