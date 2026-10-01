// Wrapping protects the standard SDK's encrypted IndexedDB store key at rest.
// This is not protection against same-origin malicious code or OS compromise.
export async function matrixCryptoStore(account,{environment=globalThis}={}){
  if(!/^ynx1[0-9a-z]{38}$/.test(account)||!environment.isSecureContext||!environment.indexedDB||!environment.crypto?.subtle)throw new Error('MATRIX_PROTECTED_STORAGE_UNAVAILABLE');
  const db=await new Promise((resolve,reject)=>{const request=environment.indexedDB.open('ynx-social-matrix-wrap-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('accounts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('MATRIX_STORAGE_OPEN_FAILED'));request.onblocked=()=>reject(new Error('MATRIX_STORAGE_BLOCKED'))});
  const transaction=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction('accounts',mode),store=tx.objectStore('accounts');let value;tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(new Error('MATRIX_STORAGE_TRANSACTION_FAILED'));try{action(store,tx,v=>{value=v})}catch{tx.abort()}});
  try{
    let record=await transaction('readonly',(store,tx,result)=>{const read=store.get(account);read.onsuccess=()=>result(read.result)});
    if(!record){const subtle=environment.crypto.subtle,key=await subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),secret=environment.crypto.getRandomValues(new Uint8Array(32)),iv=environment.crypto.getRandomValues(new Uint8Array(12)),deviceId=`YNX-${environment.crypto.randomUUID()}`,aad=new TextEncoder().encode(JSON.stringify([environment.location.origin,account,deviceId]));const encrypted=await subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,secret);secret.fill(0);
      const candidate={version:1,key,iv,encrypted,deviceId,origin:environment.location.origin};await transaction('readwrite',(store,tx,result)=>{const read=store.get(account);read.onsuccess=()=>{try{if(read.result===undefined)store.add(candidate,account)}catch{tx.abort()}}});
      record=await transaction('readonly',(store,tx,result)=>{const read=store.get(account);read.onsuccess=()=>result(read.result)});
    }
    if(record?.version!==1||record.origin!==environment.location.origin||record.key?.extractable!==false||record.key?.algorithm?.name!=='AES-GCM')throw new Error('MATRIX_STORAGE_RECOVERY_REQUIRED');
    const aad=new TextEncoder().encode(JSON.stringify([record.origin,account,record.deviceId]));const storageKey=new Uint8Array(await environment.crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad},record.key,record.encrypted));if(storageKey.length!==32)throw new Error('MATRIX_STORAGE_RECOVERY_REQUIRED');return {deviceId:record.deviceId,storageKey};
  }catch{throw new Error('MATRIX_STORAGE_RECOVERY_REQUIRED: original keys were retained')}finally{db.close()}
}
