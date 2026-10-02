const protocol='ynx-social-protected-moment/v1';
const fail=()=>{throw new Error('MATRIX_DRAFT_RECOVERY_REQUIRED: original protected records were retained')};
const transaction=/^[A-Za-z0-9_-]{16,128}$/;

// Reuse the original Matrix wrapping key. Never create/reset a device or key.
// Protection is at rest, not against hostile same-origin code or OS compromise.
export async function openProtectedMomentDrafts({account,deviceId,environment=globalThis}) {
  if(!/^ynx1[0-9a-z]{38}$/.test(account)||!deviceId||!environment.isSecureContext||!environment.crypto?.subtle||!environment.indexedDB)fail();
  const db=await new Promise((resolve,reject)=>{
    const request=environment.indexedDB.open('ynx-social-matrix-wrap-v1',1);
    request.onupgradeneeded=()=>request.transaction.abort();
    request.onsuccess=()=>resolve(request.result);request.onerror=request.onblocked=()=>reject(new Error('MATRIX_DRAFT_STORAGE_UNAVAILABLE'));
  });
  const io=(mode,action,guard=()=>{})=>new Promise((resolve,reject)=>{
    const tx=db.transaction('accounts',mode),store=tx.objectStore('accounts');let value;
    tx.oncomplete=()=>{try{guard();resolve(value)}catch(error){reject(error)}};
    tx.onerror=tx.onabort=()=>reject(new Error('MATRIX_DRAFT_STORAGE_FAILED'));
    try{guard();action(store,tx,result=>{value=result})}catch(error){tx.abort();reject(error)}
  });
  try{
    const wrapping=await io('readonly',(store,_tx,result)=>{const request=store.get(account);request.onsuccess=()=>result(request.result)});
    if(wrapping?.version!==1||wrapping.deviceId!==deviceId||wrapping.origin!==environment.location.origin||wrapping.key?.extractable!==false||wrapping.key.algorithm?.name!=='AES-GCM')fail();
    const slot=[protocol,account,deviceId],subtle=environment.crypto.subtle;
    // Authenticate the original wrapping record too. A replacement key must
    // never let this helper overwrite recoverable drafts under a new key.
    try{
      const secret=new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:wrapping.iv,additionalData:new TextEncoder().encode(JSON.stringify([wrapping.origin,account,deviceId]))},wrapping.key,wrapping.encrypted));
      const valid=secret.length===32;secret.fill(0);if(!valid)fail();
    }catch{fail()}
    const aad=(id,status)=>new TextEncoder().encode(JSON.stringify([protocol,wrapping.origin,account,deviceId,id,status]));
    const validate=payload=>{
      if(!payload||!transaction.test(payload.transactionId)||typeof payload.text!=='string'||payload.text.length>16000||!payload.selection||!['contacts','private','group','selected'].includes(payload.selection.kind)||!['draft','delivery-unknown'].includes(payload.status))fail();
    };
    const envelope=record=>{
      if(!record||JSON.stringify(Object.keys(record).sort())!==JSON.stringify(['encrypted','iv','protocol','revision','status','transactionId'])||record.protocol!==protocol||!Number.isSafeInteger(record.revision)||record.revision<1||!transaction.test(record.transactionId)||!['draft','delivery-unknown'].includes(record.status)||!(record.iv instanceof Uint8Array)||record.iv.byteLength!==12||!(record.encrypted instanceof ArrayBuffer)||record.encrypted.byteLength<16||record.encrypted.byteLength>36*1024*1024+16)fail();
    };
    const decode=async(record,guard)=>{
      envelope(record);
      try{
        const plain=await subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad(record.transactionId,record.status)},wrapping.key,record.encrypted);guard();
        const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));validate(payload);
        if(payload.transactionId!==record.transactionId||payload.status!==record.status)fail();
        return payload;
      }catch{fail()}
    };
    const sameBytes=(left,right)=>{const a=new Uint8Array(left.buffer??left,left.byteOffset??0,left.byteLength),b=new Uint8Array(right.buffer??right,right.byteOffset??0,right.byteLength);return a.length===b.length&&a.every((value,index)=>value===b[index])};
    const unchangedRecord=(current,previous)=>{
      if(previous===undefined)return current===undefined;
      envelope(current);
      return current.revision===previous.revision&&current.transactionId===previous.transactionId&&current.status===previous.status&&sameBytes(current.iv,previous.iv)&&sameBytes(current.encrypted,previous.encrypted);
    };
    return Object.freeze({
      async save(payload,guard=()=>{},{prepared=false}={}){
        guard();validate(payload);
        const snapshot=structuredClone(payload),plain=new TextEncoder().encode(JSON.stringify(snapshot));
        if(plain.byteLength>36*1024*1024)fail();
        const previous=await io('readonly',(store,_tx,result)=>{const read=store.get(slot);read.onsuccess=()=>result(read.result)},guard);
        const priorPayload=previous===undefined?null:await decode(previous,guard);
        if(previous?.revision===Number.MAX_SAFE_INTEGER)fail();
        if(prepared&&previous?.status!=='delivery-unknown')fail();
        if(previous?.status==='delivery-unknown'){
          if(prepared){
            const old=structuredClone(priorPayload),next=structuredClone(snapshot);
            const originalAttachment=old.preparedAttachment,attachment=next.preparedAttachment;
            if(snapshot.status!=='delivery-unknown'||attachment?.msgtype!=='m.file'||attachment.file?.v!=='v2'||typeof attachment.file.url!=='string'||!attachment.file.url.startsWith('mxc://'))fail();
            delete old.preparedAttachment;delete next.preparedAttachment;
            if(JSON.stringify(old)!==JSON.stringify(next)||originalAttachment&&JSON.stringify(originalAttachment)!==JSON.stringify(attachment))fail();
          }else if(JSON.stringify(priorPayload)!==JSON.stringify(snapshot))fail();
        }
        const iv=environment.crypto.getRandomValues(new Uint8Array(12));
        const encrypted=await subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(snapshot.transactionId,snapshot.status)},wrapping.key,plain);guard();
        await io('readwrite',(store,tx)=>{
          const read=store.get(slot);read.onsuccess=()=>{try{
            guard();const old=read.result;
            if(!unchangedRecord(old,previous)){tx.abort();return}
            if(old?.status==='delivery-unknown'&&(old.transactionId!==snapshot.transactionId||snapshot.status!=='delivery-unknown')){tx.abort();return}
            store.put({protocol,revision:(previous?.revision??0)+1,transactionId:snapshot.transactionId,status:snapshot.status,iv,encrypted},slot);
          }catch{tx.abort()}};
        },guard);
      },
      savePrepared(payload,guard=()=>{}){return this.save(payload,guard,{prepared:true})},
      async load(guard=()=>{}){
        const record=await io('readonly',(store,_tx,result)=>{const read=store.get(slot);read.onsuccess=()=>result(read.result)},guard);
        if(record===undefined)return null;
        return decode(record,guard);
      },
      async clearConfirmed(transactionId,guard=()=>{}){
        if(!transaction.test(transactionId))fail();
        const previous=await io('readonly',(store,_tx,result)=>{const read=store.get(slot);read.onsuccess=()=>result(read.result)},guard);
        await decode(previous,guard);if(previous.transactionId!==transactionId)fail();
        await io('readwrite',(store,tx)=>{const read=store.get(slot);read.onsuccess=()=>{try{guard();if(!unchangedRecord(read.result,previous)){tx.abort();return}store.delete(slot)}catch{tx.abort()}}},guard);
      },
      close:()=>db.close(),
    });
  }catch(error){db.close();throw error}
}

export async function encodeDraftFile(file){
  if(!file)return null;
  if(!file.size||file.size>25*1024*1024)fail();
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return {name:file.name,type:file.type||'application/octet-stream',base64:btoa(binary)};
}
export function decodeDraftFile(record){
  if(record===null||record===undefined)return null;
  if(typeof record.name!=='string'||!record.name||record.name.length>255||typeof record.type!=='string'||typeof record.base64!=='string'||record.base64.length>35*1024*1024)fail();
  const binary=atob(record.base64);if(!binary.length||binary.length>25*1024*1024)fail();
  return new File([Uint8Array.from(binary,char=>char.charCodeAt(0))],record.name,{type:record.type});
}
