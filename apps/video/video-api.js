import {serializeMediaBody} from './business-wire.js';
import {VIDEO_ORIGIN} from './product-session.js';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export function createVideoAPI({baseURL, fetch: request = globalThis.fetch.bind(globalThis),
  authorize, onUnauthorized = () => {}, requestId = () => crypto.randomUUID(), getAccount = () => null}) {
  const base = new URL(baseURL);
  // This is a caller fence, not an operation-result or authorization contract.
  // Normal app supplies its existing verified session account; no proof is inferred.
  const unresolved = new Map();
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
      for (let attempt = 0; attempt < (mutation?1:2); attempt++) {
        let proof = {};
        try {if (needsAccount) proof = await wait(authorize(path.split('?')[0], method, wire.body));}
        catch (error) {check(); onUnauthorized(error); throw error;}
        check();
        if(mutation){
          // Proof preparation may yield to another invocation of this API.
          if(unresolved.has(index))throw unknownError(unresolved.get(index));
          wire.headers['Idempotency-Key'] ||= requestId();
          pending={account,path,method,key:wire.headers['Idempotency-Key'],body:wire.body,headers:{...wire.headers},state:'DISPATCHED',firstCause:null};
          unresolved.set(index,pending);dispatched=true;
        }
        try {
          response = await wait(request(base.href + path, {...init, method, body:wire.body, headers: {...wire.headers, ...proof}, credentials: needsAccount ? 'same-origin' : 'omit', redirect: 'error', signal}));
          break;
        } catch (error) {if(mutation)throw error;check(); if (attempt === 1) throw error;}
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
      resultKnown=true;if(pending&&unresolved.get(index)===pending)unresolved.delete(index);
      if (!response.ok) {
        const error = Object.assign(new Error(data.error || `Video service returned HTTP ${response.status}.`), {status: response.status});
        if (needsAccount && response.status === 401) onUnauthorized(error);
        throw error;
      }
      return data;
    } catch(error) {
      if(mutation&&dispatched&&!resultKnown){
        pending.state='UNKNOWN';pending.firstCause??=error;
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
