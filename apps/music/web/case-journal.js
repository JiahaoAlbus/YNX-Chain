// Recovery metadata is separate from Wallet keys and credentials. Each slot is
// derived only after the original /api/me readback supplies the current account.
export function createCaseJournal({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}) {
  let database;
  const valid=record=>record?.version===1&&typeof record.key==='string'&&/^music-trust-[a-f0-9-]{36}$/i.test(record.key)&&record.body&&Object.keys(record.body).length===4&&['report','takedown','dispute','appeal'].includes(record.body.kind)&&/^trk_[0-9a-f]{24}$/.test(record.body.trackID)&&typeof record.body.reason==='string'&&[...record.body.reason].length>=5&&record.body.reason===record.body.reason.trim()&&typeof record.body.evidenceRef==='string'&&record.body.evidenceRef===record.body.evidenceRef.trim()&&new TextEncoder().encode(JSON.stringify(record.body)).byteLength<=16*1024;
  async function owner(account,current){
    current();if(typeof account!=='string'||!account.trim()||account.length>256)throw new Error('Verified Music recovery account missing');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ynx.music.case-intent.v1:'+account.trim().toLowerCase()));current();return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function open(){
    if(!indexedDB)throw new Error('Music recovery storage is unavailable');
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open('ynx.music.case-intents.v1',1);let expired=false;
      const timer=setTimeout(()=>{expired=true;database=null;reject(new Error('Music recovery storage timed out'))},5000);
      const fail=()=>{expired=true;clearTimeout(timer);database=null;reject(new Error('Music recovery storage is unavailable'))};
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('intents'))request.result.createObjectStore('intents')};request.onerror=fail;request.onblocked=fail;
      request.onsuccess=()=>{clearTimeout(timer);if(expired){request.result.close();return}const db=request.result;db.onversionchange=()=>{db.close();database=null};resolve(db)};
    });return database;
  }
  async function transaction(account,current,operation){
    const key=await owner(account,current),db=await open();current();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('intents','readwrite'),store=tx.objectStore('intents');let result,error;
      const timer=setTimeout(()=>{error=new Error('Music recovery write timed out');try{tx.abort()}catch{}},5000);
      const get=store.get(key);get.onsuccess=()=>{try{current();const saved=get.result;if(saved&&(saved.owner!==key||!valid(saved)))throw new Error('Saved Trust recovery is invalid; the original metadata was retained');result=operation(store,key,saved)}catch(e){error=e;tx.abort()}};
      tx.oncomplete=()=>{clearTimeout(timer);try{current();resolve(result)}catch(e){reject(e)}};
      tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(error||new Error('Music recovery write was not confirmed'))};
    });
  }
  return {
    read:(account,current)=>transaction(account,current,(_store,_key,saved)=>saved||null),
    begin:(account,body,current)=>transaction(account,current,(store,owner,saved)=>{
      if(saved)throw new Error('A saved Trust request is awaiting confirmation. Retry it from Library.');
      const record={version:1,owner,key:'music-trust-'+crypto.randomUUID(),body:{kind:body.kind,trackID:body.trackID,reason:body.reason,evidenceRef:body.evidenceRef}};
      if(!valid(record))throw new Error('Trust recovery input is invalid');store.put(record,owner);return record;
    }),
    finish:(account,intentKey,current)=>transaction(account,current,(store,owner,saved)=>{if(saved?.key===intentKey)store.delete(owner)}),
  };
}
