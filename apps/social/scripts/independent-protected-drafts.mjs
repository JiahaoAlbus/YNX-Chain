import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const kind of ['unknown-status-save','ciphertext-save','revision-load','wrongkey-save','wrong-origin','wrong-account']) {
 const context=await browser.newContext();const page=await context.newPage();
 await page.route('**/*',r=>{const p=new URL(r.request().url()).pathname;if(p==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html>'});if(['/crypto-store.mjs','/protected-drafts.mjs'].includes(p))return r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../web/matrix'+p,import.meta.url),'utf8')});return r.abort()});
 await page.goto('https://protected-fixture.invalid/');
 const observed=await page.evaluate(async kind=>{
 const {matrixCryptoStore}=await import('/crypto-store.mjs'),{openProtectedMomentDrafts}=await import('/protected-drafts.mjs');
 const account='ynx1'+'a'.repeat(38),wrapped=await matrixCryptoStore(account);wrapped.storageKey.fill(0);
 const args={account,deviceId:wrapped.deviceId};const payload={transactionId:'original_protected_draft_001',text:'Original protected text',selection:{kind:'private'},file:null,status:kind==='unknown-status-save'?'delivery-unknown':'draft'};
 let vault=await openProtectedMomentDrafts(args);await vault.save(payload);vault.close();
 const db=await new Promise((resolve,reject)=>{let r=indexedDB.open('ynx-social-matrix-wrap-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject});
 const slot=['ynx-social-protected-moment/v1',account,wrapped.deviceId];
 const get=key=>new Promise((resolve,reject)=>{const t=db.transaction('accounts'),r=t.objectStore('accounts').get(key);r.onsuccess=()=>resolve(r.result);t.onerror=reject});
 const put=(key,value)=>new Promise((resolve,reject)=>{const t=db.transaction('accounts','readwrite');t.objectStore('accounts').put(value,key);t.oncomplete=resolve;t.onerror=reject});
 let before=await get(slot);
 if(kind==='unknown-status-save')await put(slot,{...before,status:'draft'});
 if(kind==='ciphertext-save'){const corrupted=new Uint8Array(before.encrypted).slice();corrupted[0]^=1;await put(slot,{...before,encrypted:corrupted.buffer});before=await get(slot)}
 if(kind==='revision-load')await put(slot,{...before,revision:'corrupt-revision'});
 if(kind==='wrongkey-save'){const wrapping=await get(account);const replacement=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await put(account,{...wrapping,key:replacement})}
 let rejected=false,error='';
 try{
 const altered=kind==='wrong-origin'?{...args,environment:{isSecureContext:true,crypto,indexedDB,location:{origin:'https://wrong.invalid'}}}:kind==='wrong-account'?{...args,account:'ynx1'+'b'.repeat(38)}:args;
 vault=await openProtectedMomentDrafts(altered);
 if(kind.endsWith('-save'))await vault.save({...payload,text:'Replacement text',status:'draft',transactionId:kind==='unknown-status-save'?'replacement_transaction_001':payload.transactionId});else await vault.load();
 }catch(e){rejected=true;error=e.message}finally{vault?.close()}
 const after=await get(slot);db.close();
 return {rejected,ciphertextRetained:JSON.stringify([...new Uint8Array(before.encrypted)])===JSON.stringify([...new Uint8Array(after.encrypted)]),error};
 },kind);
 results.push({case:kind,expectedRejected:true,...observed,status:observed.rejected&&observed.ciphertextRetained?'PASS':'FAIL'});await context.close();
 }
 console.log(JSON.stringify({results,pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,skip:0},null,2));
}finally{await browser.close()}
if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
