import {VIDEO_ORIGIN} from './product-session.js';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export function createVideoAPI({baseURL, fetch: request = globalThis.fetch.bind(globalThis),
  authorize, onUnauthorized = () => {}, requestId = () => crypto.randomUUID()}) {
  const base = new URL(baseURL);
  return async function api(path, options = {}) {
    const {private: needsAccount = false, assertCurrent = () => {}, ...init} = options;
    if (!path.startsWith('/v1/') || path.includes('..') || path.includes('//') || /[\\#\r\n]/.test(path) || /%(2e|2f|5c)/i.test(path.split('?')[0])) throw new Error('Invalid Video API route.');
    const method = (init.method || 'GET').toUpperCase();
    const mutation = !['GET', 'HEAD'].includes(method);
    if (mutation && !needsAccount) throw new Error('Sign in to use this Video action.');
    if (needsAccount && (base.origin !== VIDEO_ORIGIN || base.pathname !== '/video/api' || base.search || base.hash)) {
      throw new Error('Private Video actions require video.ynxweb4.com.');
    }
    const headers = {...(init.headers || {})};
    for (const key of Object.keys(headers)) if (/^(authorization|x-ynx-.*session.*)$/i.test(key)) delete headers[key];
    if (mutation) headers['Idempotency-Key'] ||= requestId();
    const controller = new AbortController(), signal = controller.signal;
    const cancel = () => controller.abort(init.signal.reason || new DOMException('Video request cancelled.', 'AbortError'));
    if (init.signal?.aborted) cancel(); else init.signal?.addEventListener('abort', cancel, {once: true});
    // One deadline covers authority, network retry and complete response body.
    const timer = setTimeout(() => controller.abort(new DOMException('Video service timed out. Retry the saved action.', 'TimeoutError')), 15000);
    const check = () => {assertCurrent(); signal.throwIfAborted();};
    const wait = operation => new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) {signal.removeEventListener('abort', abort);reject(signal.reason);}
      Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    let reader, responseBody;
    try {
      check();let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        let proof = {};
        try {if (needsAccount) proof = await wait(authorize(path.split('?')[0], method));}
        catch (error) {check(); onUnauthorized(error); throw error;}
        check();
        try {
          response = await wait(request(base.href + path, {...init, method, headers: {...headers, ...proof}, credentials: 'omit', redirect: 'error', signal}));
          break;
        } catch (error) {check(); if (attempt === 1) throw error;}
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
        try {data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));} catch {throw new Error('Invalid Video service response.');}
      } else {
        // HEAD has no JSON representation. Injected transport fixtures may expose
        // only json(); both still share the cancellation/deadline above.
        try {data=await wait(response.json());} catch(error) {check();throw new Error('Invalid Video service response.');}
      }
      check();
      if (!response.ok) {
        const error = Object.assign(new Error(data.error || `Video service returned HTTP ${response.status}.`), {status: response.status});
        if (needsAccount && response.status === 401) onUnauthorized(error);
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);init.signal?.removeEventListener('abort', cancel);
      if (reader) {reader.cancel().catch(() => {});try {reader.releaseLock();} catch {}}
      else responseBody?.cancel().catch(() => {});
      controller.abort();
    }
  };
}
