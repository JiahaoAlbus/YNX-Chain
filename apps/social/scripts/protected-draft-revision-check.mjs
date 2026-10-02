import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html>'});
    if(['/crypto-store.mjs','/protected-drafts.mjs'].includes(path))return route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../web/matrix'+path,import.meta.url),'utf8')});
    return route.abort();
  });
  await page.goto('https://protected-fixture.invalid/');
  const result=await page.evaluate(async()=>{
    const {matrixCryptoStore}=await import('/crypto-store.mjs');
    const {openProtectedMomentDrafts}=await import('/protected-drafts.mjs');
    const account='ynx1'+'a'.repeat(38),wrapped=await matrixCryptoStore(account);wrapped.storageKey.fill(0);
    const args={account,deviceId:wrapped.deviceId},legacy='ynx-social-protected-moment/v1';
    const slot=[legacy,account,wrapped.deviceId];
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ynx-social-matrix-wrap-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject});
    const get=key=>new Promise((resolve,reject)=>{const t=db.transaction('accounts'),r=t.objectStore('accounts').get(key);r.onsuccess=()=>resolve(r.result);t.onerror=reject});
    const put=value=>new Promise((resolve,reject)=>{const t=db.transaction('accounts','readwrite');t.objectStore('accounts').put(value,slot);t.oncomplete=resolve;t.onerror=reject});
    const payload={transactionId:'original_revision_draft_001',text:'Original protected draft',selection:{kind:'private'},file:null,status:'draft'};
    const wrapping=await get(account),iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify([legacy,location.origin,account,wrapped.deviceId,payload.transactionId,payload.status]))},wrapping.key,new TextEncoder().encode(JSON.stringify(payload)));
    const original={protocol:legacy,revision:1,transactionId:payload.transactionId,status:payload.status,iv,encrypted};
    await put(original);
    const vault=await openProtectedMomentDrafts(args);
    const legacyRead=JSON.stringify(await vault.load())===JSON.stringify(payload);
    const unchanged=await get(slot);
    const legacyPreserved=unchanged.protocol===legacy&&unchanged.revision===1&&JSON.stringify([...new Uint8Array(unchanged.encrypted)])===JSON.stringify([...new Uint8Array(encrypted)]);
    await vault.save(payload);
    const v2=await get(slot),migrated=v2.protocol==='ynx-social-protected-moment/v2'&&v2.revision===2&&JSON.stringify(await vault.load())===JSON.stringify(payload);
    const checks=[];
    for(const [name,altered] of [['numeric-revision',{...v2,revision:18}],['protocol-downgrade',{...v2,protocol:legacy}]]){
      await put(altered);let loadRejected=false,saveRejected=false;
      try{await vault.load()}catch{loadRejected=true}
      try{await vault.save(payload)}catch{saveRejected=true}
      const retained=await get(slot);
      checks.push({name,loadRejected,saveRejected,cipherRetained:JSON.stringify([...new Uint8Array(retained.encrypted)])===JSON.stringify([...new Uint8Array(v2.encrypted)])});
    }
    await put(v2);const restored=JSON.stringify(await vault.load())===JSON.stringify(payload);
    vault.close();db.close();
    return {legacyRead,legacyPreserved,migrated,restored,checks};
  });
  console.log(JSON.stringify(result,null,2));
  if(!result.legacyRead||!result.legacyPreserved||!result.migrated||!result.restored||result.checks.some(x=>!x.loadRejected||!x.saveRejected||!x.cipherRetained))process.exitCode=1;
}finally{await browser.close()}
