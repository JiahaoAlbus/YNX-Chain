import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {encryptAttachment} from 'matrix-encrypt-attachment';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Isolated protected draft check</body>'});
    if(['/crypto-store.mjs','/protected-drafts.mjs'].includes(path))return route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../web/matrix'+path,import.meta.url),'utf8')});
    return route.abort();
  });
  await page.goto('https://protected-fixture.invalid/');
  const initial=await page.evaluate(async()=>{
    const {matrixCryptoStore}=await import('/crypto-store.mjs'),{openProtectedMomentDrafts}=await import('/protected-drafts.mjs');
    const account='ynx1'+'a'.repeat(38),wrapped=await matrixCryptoStore(account);wrapped.storageKey.fill(0);
    const vault=await openProtectedMomentDrafts({account,deviceId:wrapped.deviceId});
    const payload={transactionId:'original_protected_draft_001',text:'Private cold-recoverable caption',selection:{kind:'private'},file:{name:'original.txt',type:'text/plain',base64:btoa('original private file')},status:'draft'};
    await vault.save(payload);vault.close();
    return {account,deviceId:wrapped.deviceId,payload};
  });
  await page.reload();
  const encrypted=await encryptAttachment(new TextEncoder().encode('original private file').buffer);
  const preparedAttachment={msgtype:'m.file',body:'original.txt',file:{...encrypted.info,url:'mxc://fixture.invalid/original-upload'},info:{size:21,mimetype:'text/plain'}};
  const actual=await page.evaluate(async ({initial,preparedAttachment})=>{
    const {matrixCryptoStore}=await import('/crypto-store.mjs'),{openProtectedMomentDrafts,decodeDraftFile}=await import('/protected-drafts.mjs');
    const wrapped=await matrixCryptoStore(initial.account);wrapped.storageKey.fill(0);
    const vault=await openProtectedMomentDrafts({account:initial.account,deviceId:initial.deviceId});
    const recovered=await vault.load(),file=decodeDraftFile(recovered.file);
    let wrongDeviceRejected=false;try{await openProtectedMomentDrafts({account:initial.account,deviceId:'different-device'})}catch{wrongDeviceRejected=true}
    const unknown={...recovered,status:'delivery-unknown'};await vault.save(unknown);
    await vault.savePrepared({...unknown,preparedAttachment});
    const preparedRecovery=await vault.load();let receiptReplacementDenied=false;
    try{await vault.savePrepared({...unknown,preparedAttachment:{...preparedAttachment,file:{...preparedAttachment.file,url:'mxc://fixture.invalid/replacement'}}})}catch{receiptReplacementDenied=true}
    let replacementRejected=false,changedBodyRejected=false,staleRejected=false;
    try{await vault.save({...unknown,transactionId:'replacement_transaction_001',status:'draft'})}catch{replacementRejected=true}
    try{await vault.save({...unknown,text:'replacement private text'})}catch{changedBodyRejected=true}
    try{await vault.save(unknown,()=>{throw Error('stale actor')})}catch{staleRejected=true}
    const retained=await vault.load();vault.close();
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('ynx-social-matrix-wrap-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=reject});
    const slot=['ynx-social-protected-moment/v1',initial.account,initial.deviceId];
    const read=()=>new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readonly'),request=tx.objectStore('accounts').get(slot);request.onsuccess=()=>resolve(request.result);tx.onerror=reject});
    const envelope=await read(),ciphertext=new Uint8Array(envelope.encrypted).slice();
    const cleartextVisible=new TextDecoder().decode(ciphertext).includes(initial.payload.text);
    await new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put({...envelope,transactionId:'tampered_transaction_001'},slot);tx.oncomplete=resolve;tx.onerror=reject});
    const bad=await openProtectedMomentDrafts({account:initial.account,deviceId:initial.deviceId});let tamperRejected=false;
    try{await bad.load()}catch{tamperRejected=true}bad.close();
    const after=await read();db.close();
    return {sameDevice:wrapped.deviceId===initial.deviceId,recovered,fileText:await file.text(),preparedRecovery,receiptReplacementDenied,wrongDeviceRejected,replacementRejected,changedBodyRejected,staleRejected,retained,cleartextVisible,tamperRejected,ciphertextRetained:JSON.stringify([...new Uint8Array(after.encrypted)])===JSON.stringify([...ciphertext])};
  },{initial,preparedAttachment});
  assert.equal(actual.sameDevice,true);assert.deepEqual(actual.recovered,initial.payload);assert.equal(actual.fileText,'original private file');
  for(const key of ['wrongDeviceRejected','replacementRejected','changedBodyRejected','staleRejected','tamperRejected','ciphertextRetained'])assert.equal(actual[key],true,key);
  assert.equal(actual.cleartextVisible,false);assert.equal(actual.retained.status,'delivery-unknown');assert.equal(actual.retained.text,initial.payload.text);
  assert.deepEqual(actual.preparedRecovery.preparedAttachment,preparedAttachment);assert.equal(actual.receiptReplacementDenied,true);
  // A separate context and a second page reload discard the preparer's memory.
  const coldPage=await browser.newPage();
  await coldPage.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Cold prepared receipt</body>'});
    if(['/crypto-store.mjs','/protected-drafts.mjs'].includes(path))return route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('../web/matrix'+path,import.meta.url),'utf8')});
    return route.abort();
  });
  await coldPage.goto('https://protected-fixture.invalid/');
  const coldIdentity=await coldPage.evaluate(async ({payload,preparedAttachment})=>{
    const {matrixCryptoStore}=await import('/crypto-store.mjs'),{openProtectedMomentDrafts}=await import('/protected-drafts.mjs');
    const account='ynx1'+'b'.repeat(38),stored=await matrixCryptoStore(account);stored.storageKey.fill(0);
    const vault=await openProtectedMomentDrafts({account,deviceId:stored.deviceId});
    const original={...payload,status:'delivery-unknown'};await vault.save(original);await vault.savePrepared({...original,preparedAttachment});vault.close();
    return {account,deviceId:stored.deviceId};
  },{payload:initial.payload,preparedAttachment});
  await coldPage.reload();
  const coldRecovered=await coldPage.evaluate(async identity=>{const {openProtectedMomentDrafts}=await import('/protected-drafts.mjs');const vault=await openProtectedMomentDrafts(identity);try{return await vault.load()}finally{vault.close()}},coldIdentity);
  assert.deepEqual(coldRecovered.preparedAttachment,preparedAttachment);assert.equal(coldRecovered.transactionId,initial.payload.transactionId);assert.equal(coldRecovered.text,initial.payload.text);await coldPage.close();
  console.log(JSON.stringify({status:'PASS',browser:'headless Chromium',coldReload:true,realWebCrypto:true,realIndexedDB:true,originalDeviceReused:true,unknownReplacementDenied:true,knownPreparedReceiptRestored:true,receiptReplacementDenied:true,tamperPreserved:true,syntheticOrigin:true,productionStateTouched:false},null,2));
}finally{await browser.close()}
