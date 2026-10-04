// Ordinary account-owned recovery metadata only; never Wallet credentials.
// IndexedDB read/write transactions serialize both entry points and tabs.
export function createPlaylistJournal({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}) {
  let database;
  const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...expected].sort().join(',');
  const validIntent=row=>keys(row,['key','body'])&&/^video-playlist-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.key)&&keys(row.body,['Name'])&&typeof row.body.Name==='string'&&row.body.Name===row.body.Name.trim()&&row.body.Name.length>0&&new TextEncoder().encode(row.body.Name).length<=100;
  const same=(a,b)=>validIntent(a)&&validIntent(b)&&a.key===b.key&&a.body.Name===b.body.Name;
  function validate(saved,owner) {
    if(!keys(saved,['version','owner','pending','history'])||saved.version!==1||saved.owner!==owner||!Array.isArray(saved.history)||saved.history.length>64||saved.pending!==null&&!validIntent(saved.pending))throw Error('Saved playlist recovery is invalid; the original records were retained.');
    const ids=new Set();for(const row of [...saved.history,...(saved.pending?[saved.pending]:[])])if(!validIntent(row)||ids.has(row.key))throw Error('Saved playlist recovery is invalid; the original records were retained.');else ids.add(row.key);
  }
  async function owner(account,current) {
    current();if(typeof account!=='string'||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(account))throw Error('Verified Video recovery account missing.');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ynx.video.playlist-intent.v1:'+account));current();return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function open() {
    if(!indexedDB)throw Error('Video recovery storage is unavailable.');
    if(!database)database=new Promise((resolve,reject)=>{
      const request=indexedDB.open('ynx.video.playlist-intents.v1',1);let expired=false;
      const timer=setTimeout(()=>{expired=true;database=null;reject(Error('Video recovery storage timed out.'));},5000);
      const fail=()=>{expired=true;clearTimeout(timer);database=null;reject(Error('Video recovery storage is unavailable.'));};
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('intents'))request.result.createObjectStore('intents');};request.onerror=fail;request.onblocked=fail;
      request.onsuccess=()=>{clearTimeout(timer);if(expired){request.result.close();return;}const db=request.result;db.onversionchange=()=>{db.close();database=null;};resolve(db);};
    });return database;
  }
  async function transaction(account,current,operation) {
    const key=await owner(account,current),db=await open();current();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('intents','readwrite'),store=tx.objectStore('intents');let result,error;
      const timer=setTimeout(()=>{error=Error('Video recovery write timed out.');try{tx.abort();}catch{}},5000);
      const get=store.get(key);get.onsuccess=()=>{try{current();const saved=get.result??{version:1,owner:key,pending:null,history:[]};validate(saved,key);result=operation(saved);current();if(result.write){validate(saved,key);store.put(saved,key);}else if(result.clear)store.delete(key);}catch(e){error=e;tx.abort();}};
      tx.oncomplete=()=>{clearTimeout(timer);try{current();resolve(result.value);}catch(e){reject(e);}};
      tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(error||Error('Video recovery write was not confirmed.'));};
    });
  }
  return {
    read:(account,current)=>transaction(account,current,s=>({value:s})),
    begin:(account,name,current)=>transaction(account,current,s=>{
      const body={Name:typeof name==='string'?name.trim():''};
      if(s.pending){if(s.pending.body.Name!==body.Name)throw Error('Retry or pause the original playlist request first.');return {value:s.pending};}
      const retained=s.history.find(row=>row.body.Name===body.Name);
      const row=retained??{key:'video-playlist-'+crypto.randomUUID(),body};if(!validIntent(row))throw Error('Playlist name must contain 1–100 UTF-8 bytes.');
      if(retained)s.history=s.history.filter(item=>item.key!==retained.key);s.pending=row;return {value:row,write:true};
    }),
    pause:(account,original,current)=>transaction(account,current,s=>{
      if(!same(s.pending,original))throw Error('The original playlist request is no longer current.');if(s.history.length>=64)throw Error('Saved playlist request history is full; the current request was retained.');s.history.push(s.pending);s.pending=null;return {write:true};
    }),
    restore:(account,original,current)=>transaction(account,current,s=>{
      if(s.pending)throw Error('Retry or pause the current playlist request first.');const row=s.history.find(item=>item.key===original?.key);if(!same(row,original))throw Error('The original playlist request is unavailable.');s.pending=row;s.history=s.history.filter(item=>item.key!==row.key);return {value:row,write:true};
    }),
    finish:(account,original,current)=>transaction(account,current,s=>{if(!same(s.pending,original))throw Error('The original playlist result is no longer current.');s.pending=null;return {write:true};}),
    clear:(account,current)=>transaction(account,current,()=>({clear:true})),
  };
}
