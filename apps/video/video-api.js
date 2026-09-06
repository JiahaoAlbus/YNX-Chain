import {VIDEO_ORIGIN} from './product-session.js';

export function createVideoAPI({baseURL, fetch: request = globalThis.fetch.bind(globalThis),
  authorize, onUnauthorized = () => {}, requestId = () => crypto.randomUUID()}) {
  const base = new URL(baseURL);
  return async function api(path, options = {}) {
    const {private: needsAccount = false, ...init} = options;
    if (!path.startsWith('/v1/') || path.includes('..')) throw new Error('Invalid Video API route.');
    const method = (init.method || 'GET').toUpperCase();
    const mutation = !['GET', 'HEAD'].includes(method);
    if (mutation && !needsAccount) throw new Error('Sign in to use this Video action.');
    if (needsAccount && (base.origin !== VIDEO_ORIGIN || base.pathname !== '/video/api' || base.search || base.hash)) {
      throw new Error('Private Video actions require video.ynxweb4.com.');
    }
    const headers = {...(init.headers || {})};
    // Callers cannot accidentally attach old sessions to public requests.
    for (const key of Object.keys(headers)) if (/^(authorization|x-ynx-.*session.*)$/i.test(key)) delete headers[key];
    if (mutation) headers['Idempotency-Key'] ||= requestId();
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      let proof = {};
      try {if (needsAccount) proof = await authorize(path.split('?')[0], method);}
      catch (error) {onUnauthorized(error); throw error;}
      try {
        response = await request(base.href + path, {...init, method, headers: {...headers, ...proof},
          credentials: 'omit', redirect: 'error', signal: init.signal || AbortSignal.timeout(15000)});
        break;
      } catch (error) {if (attempt === 1 || init.signal?.aborted) throw error;}
    }
    const data = await response.json().catch(() => ({error: 'Invalid Video service response.'}));
    if (!response.ok) {
      const error = Object.assign(new Error(data.error || `Video service returned HTTP ${response.status}.`), {status: response.status});
      if (needsAccount && response.status === 401) onUnauthorized(error);
      throw error;
    }
    return data;
  };
}
