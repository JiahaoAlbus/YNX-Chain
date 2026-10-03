import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const qa=process.env.COMMERCE_CANONICAL_QA;
if(!qa)throw Error('COMMERCE_CANONICAL_QA is required');
const require=createRequire(qa+'/apps/merchant-console/package.json');
const {build}=require('esbuild'),{chromium}=require('playwright');
const sdk=await import(qa+'/packages/wallet-auth/src/index.js');
const source=`import {createPrivateSessionController} from '${qa}/apps/seller-console/product-session.js';
window.prepare=(productId,scopes)=>window.controller=createPrivateSessionController({productId,scopes,purpose:'Controlled canonical browser preparation',endpoint:()=> 'https://auth.ynxweb4.com'});`;
const bundle=await build({stdin:{contents:source,resolveDir:qa,sourcefile:'canonical-browser-entry.js'},bundle:true,platform:'browser',format:'iife',write:false});
const browser=await chromium.launch({headless:true});
const records=[];
try{for(const row of [{productId:'shop',origin:'https://shop.ynxweb4.com',scopes:['account:read','shop:seller:operate']},{productId:'pay-merchant',origin:'https://pay.ynxweb4.com',scopes:['account:read','merchant:session:create']}]){
 const context=await browser.newContext();let timeCalls=0,otherRequests=0;
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.origin===row.origin){await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Controlled SDK QA</title>'});return}
  if(url.origin==='https://auth.ynxweb4.com'&&url.pathname==='/v2/product-sessions/time'){
   timeCalls++;const requestId=request.headers()['x-request-id'];
   const body=sdk.canonicalJSON({ok:true,requestId,result:{serverTime:new Date().toISOString()},schemaVersion:sdk.PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION});
   await route.fulfill({status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':requestId,'access-control-allow-origin':row.origin,'access-control-expose-headers':'x-request-id,cache-control'},body});return
  }
  otherRequests++;await route.abort();
 });
 const page=await context.newPage();await page.goto(row.origin+'/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(row=>{sessionStorage.setItem('ynx_wallet_pending','original-v1-data');window.prepare(row.productId,row.scopes)},row);
 const first=await page.evaluate(()=>controller.begin());assert.equal(first.status,'connecting');assert.equal(first.route.status,'ready');assert.equal(first.automatic,false);assert.equal(first.installation,'unverified');assert.deepEqual(first.request.scopes,row.scopes);assert.equal(first.request.origin,row.origin);assert.equal(await page.evaluate(()=>controller.current()),null);
 assert.equal(first.request.applicationId,row.productId==='shop'?'com.ynxweb4.shop.web':'com.ynxweb4.merchant-console.web');
 const key=first.request.deviceKey,nonce=first.request.nonce;
 await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(row=>window.prepare(row.productId,row.scopes),row);
 const restored=await page.evaluate(()=>controller.recover(location.href));assert.equal(restored,null);
 const storage=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('ynx-product-session-web-v2',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,t=db.transaction(['devices','state'],'readonly'),dr=t.objectStore('devices').getAll(),sr=t.objectStore('state').getAll();t.oncomplete=()=>{resolve({devices:dr.result.map(x=>({deviceKey:x.deviceKey,extractable:x.privateKey.extractable})),pending:sr.result.flatMap(x=>Object.entries(x.values).filter(([k])=>k.endsWith(':pending')).map(([,v])=>JSON.parse(v))),legacy:sessionStorage.getItem('ynx_wallet_pending')});db.close()};t.onerror=()=>reject(t.error)}}));
 assert.equal(storage.devices.length,1);assert.equal(storage.devices[0].extractable,false);assert.equal(storage.devices[0].deviceKey,key);assert.equal(storage.pending[0].nonce,nonce);assert.equal(storage.legacy,'original-v1-data');
 const cleared=await page.evaluate(()=>controller.clear());assert.equal(cleared.status,'disconnected');assert.equal(await page.evaluate(()=>controller.current()),null);assert.equal(otherRequests,0);assert.ok(timeCalls>=2);
 records.push({productId:row.productId,origin:row.origin,scopes:row.scopes,preparedOnly:true,automatic:false,installation:'unverified',nonextractableKeyPersisted:true,pendingNonceSurvivedReload:true,legacyRecordUntouched:true,noPrivateSession:true,localPendingRequestCleared:true,timeCalls,unapprovedNetworkRequests:otherRequests});
 await context.close();
}
 const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html>'}));const page=await context.newPage();await page.goto('https://pay.ynxweb4.com/');await page.addScriptTag({content:bundle.outputFiles[0].text});const wrong=await page.evaluate(async()=>{window.prepare('shop',['account:read','shop:seller:operate']);try{await controller.begin();return null}catch(e){return e.code}});assert.equal(wrong,'ORIGIN_NOT_ALLOWED');await context.close();
 console.log(JSON.stringify({classification:'CONTROLLED_REAL_SDK_BROWSER_PREPARATION_ONLY',sdkSource:'9555b01e47519a5df882bb0092d2d20e1d7ce6e2',bundleSHA256:crypto.createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'),records,wrongRegisteredOriginRejected:true,realWalletApproved:false,liveBusinessReadback:false},null,2));
}finally{await browser.close()}
