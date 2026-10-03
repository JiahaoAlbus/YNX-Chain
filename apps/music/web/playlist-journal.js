// Recovery metadata is separate from Wallet keys and credentials. Each slot is
// derived only after the original /api/me readback supplies the current account.
export function createPlaylistJournal({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}) {
  let database;
  const valid=record=>record?.version===1&&typeof record.key==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.key)&&typeof record.body?.name==='string'&&[...record.body.name].length<=120&&typeof record.body.description==='string'&&new TextEncoder().encode(record.body.description).byteLength<=500&&Array.isArray(record.body.trackIDs)&&record.body.trackIDs.length<=1000&&record.body.trackIDs.every(id=>/^trk_[0-9a-f]{24}$/.test(id));
  async function owner(account,current){
    current();if(typeof account!=='string'||!account.trim()||account.length>256)throw new Error('Verified Music recovery account missing');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ynx.music.playlist-intent.v1:'+account.trim().toLowerCase()));current();return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function open(){
    if(!indexedDB)throw new Error('Music recovery storage is unavailable');
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open('ynx.music.playlist-intents.v1',1);let expired=false;
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
      const get=store.get(key);get.onsuccess=()=>{try{current();const saved=get.result;if(saved&&(saved.owner!==key||!valid(saved)))throw new Error('Saved playlist recovery is invalid; the original metadata was retained');result=operation(store,key,saved)}catch(e){error=e;tx.abort()}};
      tx.oncomplete=()=>{clearTimeout(timer);try{current();resolve(result)}catch(e){reject(e)}};
      tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(error||new Error('Music recovery write was not confirmed'))};
    });
  }
  return {
    read:(account,current)=>transaction(account,current,(_store,_key,saved)=>saved||null),
    begin:(account,body,current)=>transaction(account,current,(store,owner,saved)=>{
      if(saved)return saved;
      const record={version:1,owner,key:'music-playlist-'+crypto.randomUUID(),body:{name:body.name,description:body.description,trackIDs:[...body.trackIDs]}};
      if(!valid(record))throw new Error('Playlist recovery input is invalid');store.put(record,owner);return record;
    }),
    finish:(account,intentKey,current)=>transaction(account,current,(store,owner,saved)=>{if(saved?.key===intentKey)store.delete(owner)}),
  };
}
