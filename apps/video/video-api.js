import {serializeMediaBody} from './business-wire.js';
import {VIDEO_ORIGIN} from './product-session.js';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export function createVideoAPI({baseURL, fetch: request = globalThis.fetch.bind(globalThis),
  authorize, onUnauthorized = () => {}, requestId = () => crypto.randomUUID(), getAccount = () => null, environment = globalThis}) {
  const base = new URL(baseURL);
  // This is a caller fence, not an operation-result or authorization contract.
  // Normal app supplies its existing verified session account; no proof is inferred.
  const unresolved = new Map();
  const storageKey='ynx.video.pending-mutations.v1',maxRecords=64,maxStoredBytes=65536;
  const identity=record=>JSON.stringify([record.account,record.method,record.path]);
  const storageError=cause=>Object.assign(new Error('Video cannot safely retain this write. No new write was sent. Restore browser storage; reading and playback remain available.'),{code:'VIDEO_MUTATION_STORAGE_UNAVAILABLE',cause});
  const lockError=cause=>Object.assign(new Error('Video needs secure cross-tab coordination before this write. No new write was sent; reading and playback remain available.'),{code:'VIDEO_MUTATION_LOCK_UNAVAILABLE',cause});
  const validRecord=row=>!(!row||Object.keys(row).sort().join(',')!=='account,bodyBytes,bodyDigest,contentType,firstCause,key,method,path,state'||typeof row.account!=='string'||!row.account||row.account.length>256||typeof row.path!=='string'||!row.path.startsWith('/v1/')||row.path.length>2048||!['POST','PUT','PATCH','DELETE'].includes(row.method)||typeof row.key!=='string'||!/^[-A-Za-z0-9._:]{16,128}$/.test(row.key)||typeof row.bodyDigest!=='string'||!/^[a-f0-9]{64}$/.test(row.bodyDigest)||!Number.isSafeInteger(row.bodyBytes)||row.bodyBytes<0||row.bodyBytes>512*1024*1024||typeof row.contentType!=='string'||row.contentType.length>256||!['DISPATCHED','UNKNOWN'].includes(row.state)||row.firstCause!==null&&(!row.firstCause||Object.keys(row.firstCause).sort().join(',')!=='name,stage'||!['Error','TypeError','SyntaxError','AbortError','TimeoutError'].includes(row.firstCause.name)||!['result-unconfirmed','reinitialization-unconfirmed'].includes(row.firstCause.stage)));
  function readSaved(){
    try{
      const raw=environment.localStorage.getItem(storageKey);if(raw===null)return [];
      if(typeof raw!=='string'||raw.length>maxStoredBytes||new TextEncoder().encode(raw).length>maxStoredBytes)throw Error('Invalid Video fence size');
      const saved=JSON.parse(raw);if(saved.version!==1||!Array.isArray(saved.records)||saved.records.length>maxRecords)throw Error('Invalid Video fences');
      const seen=new Set();
      for(const row of saved.records){
        if(!validRecord(row))throw Error('Invalid Video original operation');
        const id=identity(row);if(seen.has(id))throw Error('Duplicate Video original operation');seen.add(id);
      }
      return saved.records;
    }catch(cause){throw storageError(cause)}
  }
  function hydrate(rows=readSaved()){
    for(const row of rows){const id=identity(row),local=unresolved.get(id);if(local){if(local.key!==row.key||local.bodyDigest!==row.bodyDigest)throw storageError();}else unresolved.set(id,{...row,state:'UNKNOWN',firstCause:row.firstCause||{name:'Error',stage:'reinitialization-unconfirmed'},restored:true});}
    return rows;
  }
  function save(rows){
    try{
      if(rows.length>maxRecords)throw Error('Video fence capacity reached');
      const records=rows.map(row=>({account:row.account,path:row.path,method:row.method,key:row.key,bodyDigest:row.bodyDigest,bodyBytes:row.bodyBytes,contentType:row.contentType,state:row.state,firstCause:row.firstCause?{name:['Error','TypeError','SyntaxError','AbortError','TimeoutError'].includes(row.firstCause.name)?row.firstCause.name:'Error',stage:row.firstCause.stage==='reinitialization-unconfirmed'?'reinitialization-unconfirmed':'result-unconfirmed'}:null}));
      // Validate our record shape before persisting; a missing account is not
      // a principal and cannot become a durable operation identity.
      if(records.some(row=>!validRecord(row)))throw Error('Original Video identity unavailable');
      const raw=JSON.stringify({version:1,records});if(new TextEncoder().encode(raw).length>maxStoredBytes)throw Error('Video fence size reached');
      environment.localStorage.setItem(storageKey,raw);if(environment.localStorage.getItem(storageKey)!==raw)throw Error('Video fence write unconfirmed');
    }catch(cause){throw storageError(cause)}
  }
  async function exclusive(signal,work){
    signal.throwIfAborted();let entered=false;
    try{
      if(environment.isSecureContext!==true||typeof environment.navigator?.locks?.request!=='function')throw lockError();
      const result=await environment.navigator.locks.request(storageKey,{mode:'exclusive',signal},async lock=>{entered=true;if(!lock||lock.name!==storageKey||lock.mode!=='exclusive')throw lockError();signal.throwIfAborted();return work();});
      if(!entered)throw lockError();return result;
    }catch(error){if(signal.aborted)throw signal.reason;if(entered||error.code==='VIDEO_MUTATION_LOCK_UNAVAILABLE')throw error;throw lockError(error)}
  }
  try{hydrate()}catch{} // Storage problems must not prevent safe read initialization.
  const unknownError = pending => Object.assign(new Error('Video result unconfirmed. The original action will not be repeated. Check your saved library state; this action remains blocked until its original result is confirmed.'), {code:'VIDEO_MUTATION_UNKNOWN',cause:pending.firstCause,pending});
  return async function api(path, options = {}) {
    const {private: needsAccount = false, assertCurrent = () => {}, ...init} = options;
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('//') || /[\\#\r\n]/.test(path) || /%(2e|2f|5c)/i.test(path.split('?')[0])) throw new Error('Invalid Video API route.');
    const method = (init.method || 'GET').toUpperCase();
    const mutation = !['GET', 'HEAD'].includes(method);
    const account = mutation ? getAccount() : null, index = JSON.stringify([account,method,path]);
    if (mutation && !needsAccount) throw new Error('Sign in to use this Video action.');
    if (needsAccount && (base.origin !== VIDEO_ORIGIN || base.pathname !== '/video/api' || base.search || base.hash)) {
      throw new Error('Private Video actions require video.ynxweb4.com.');
    }
    if(mutation&&unresolved.has(index))throw unknownError(unresolved.get(index));
    if(mutation){hydrate();if(unresolved.has(index))throw unknownError(unresolved.get(index));}
    const headers = Object.fromEntries(new Headers(init.headers));
    for (const key of Object.keys(headers)) if (/^(authorization|x-ynx-.*session.*)$/i.test(key)) delete headers[key];
    const controller = new AbortController(), signal = controller.signal;
    const cancel = () => controller.abort(init.signal.reason || new DOMException('Video request cancelled.', 'AbortError'));
    if (init.signal?.aborted) cancel(); else init.signal?.addEventListener('abort', cancel, {once: true});
    // One deadline covers authority, network retry and complete response body.
    const timer = setTimeout(() => controller.abort(new DOMException('Video service timed out. Retry the saved action.', 'TimeoutError')), 15000);
    const check = () => {assertCurrent(); signal.throwIfAborted();if(mutation&&account!==getAccount())throw new DOMException('Video account changed.','AbortError');};
    const wait = operation => new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) {signal.removeEventListener('abort', abort);reject(signal.reason);}
      Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    let reader, responseBody, pending, dispatched=false, resultKnown=false;
    try {
      check();const wire=await wait(serializeMediaBody(path.split('?')[0],method,init.body,headers,signal));check();let response;
      let commitment;
      if(mutation){const bytes=typeof wire.body==='string'?new TextEncoder().encode(wire.body):wire.body??new Uint8Array();const hash=await wait(environment.crypto.subtle.digest('SHA-256',bytes));commitment={bodyDigest:[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join(''),bodyBytes:bytes.length,contentType:wire.headers['content-type']||''};check();}
      for (let attempt = 0; attempt < (mutation?1:2); attempt++) {
        if(mutation){
          const flight=await wait(exclusive(signal,async()=>{
            check();const rows=hydrate();if(unresolved.has(index))throw unknownError(unresolved.get(index));
            wire.headers['Idempotency-Key'] ||= requestId();let proof;
            try{proof=await wait(authorize(path.split('?')[0],method,wire.body));}catch(error){check();onUnauthorized(error);throw error;}
            check();pending={account,path,method,key:wire.headers['Idempotency-Key'],body:wire.body,headers:{...wire.headers},...commitment,state:'DISPATCHED',firstCause:null};
            save([...rows,pending]);unresolved.set(index,pending);dispatched=true;
            const promise=Promise.resolve(request(base.href+path,{...init,method,body:wire.body,headers:{...wire.headers,...proof},credentials:'same-origin',redirect:'error',signal}));promise.catch(()=>{});return {promise};
          }));
          response=await wait(flight.promise);break;
        }else{
          let proof={};try{if(needsAccount)proof=await wait(authorize(path.split('?')[0],method,wire.body));}catch(error){check();onUnauthorized(error);throw error;}check();
          try{response=await wait(request(base.href+path,{...init,method,body:wire.body,headers:{...wire.headers,...proof},credentials:needsAccount?'same-origin':'omit',redirect:'error',signal}));break;}catch(error){check();if(attempt===1)throw error;}
        }
      }
      check();responseBody = response.body;
      if (response.redirected || response.url && response.url !== base.href + path) throw new Error('Unexpected Video service location.');
      let data;
      if (response.body?.getReader) {
        const length = response.headers.get('Content-Length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw new Error('Video response exceeds the supported limit.');
        reader = response.body.getReader();const chunks=[];let bytes=0;
        while (true) {const chunk=await wait(reader.read());check();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw new Error('Video response exceeds the supported limit.');chunks.push(chunk.value);}
        const raw=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}
        try {data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));} catch(error) {if(mutation)throw error;throw new Error('Invalid Video service response.');}
      } else {
        // HEAD has no JSON representation. Injected transport fixtures may expose
        // only json(); both still share the cancellation/deadline above.
        try {data=await wait(response.json());} catch(error) {if(mutation)throw error;check();throw new Error('Invalid Video service response.');}
      }
      check();
      resultKnown=true;if(pending&&unresolved.get(index)===pending){
        try{await exclusive(signal,()=>{check();const rows=readSaved(),original=rows.find(row=>identity(row)===index);if(!original||original.key!==pending.key||original.bodyDigest!==pending.bodyDigest)throw storageError();save(rows.filter(row=>row!==original));unresolved.delete(index);});}catch(error){pending.storageError=error;}
      }
      // Cleanup can queue behind another tab. A complete original result is
      // known, but its private body/401 must never cross a retired context.
      check();
      if (!response.ok) {
        const error = Object.assign(new Error(data.error || `Video service returned HTTP ${response.status}.`), {status: response.status});
        if (needsAccount && response.status === 401) onUnauthorized(error);
        throw error;
      }
      return data;
    } catch(error) {
      if(mutation&&dispatched&&!resultKnown){
        pending.state='UNKNOWN';pending.firstCause??=error;
        try{await exclusive(signal,()=>{const rows=readSaved(),original=rows.find(row=>identity(row)===index);if(!original||original.key!==pending.key||original.bodyDigest!==pending.bodyDigest)throw storageError();save(rows.map(row=>row===original?pending:row));});}catch(failure){pending.storageError=failure;}
        const unknown=unknownError(pending);
        try{check()}catch{unknown.name='AbortError';}
        throw unknown;
      }
      throw error;
    } finally {
      clearTimeout(timer);init.signal?.removeEventListener('abort', cancel);
      if (reader) {reader.cancel().catch(() => {});try {reader.releaseLock();} catch {}}
      else responseBody?.cancel().catch(() => {});
      controller.abort();
    }
  };
}
