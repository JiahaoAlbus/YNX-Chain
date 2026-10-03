// Product requests may finish after sign-out, an account change, or a new store
// selection. Such responses must never enter the current workspace.
export class ContextChangedError extends Error {
  constructor() { super('The account or workspace changed.'); this.code = 'COMMERCE_CONTEXT_CHANGED'; }
}
export const contextChanged = error => error?.code === 'COMMERCE_CONTEXT_CHANGED';
export function createRequestContext(identity, { timeoutMs = 15000 } = {}) {
  let revision = 0;
  const active = new Set();
  function capture() {
    const at = revision, subject = identity();
    return () => { if (at !== revision || subject !== identity()) throw new ContextChangedError(); };
  }
  function invalidate() { revision++; for (const controller of active) controller.abort(); active.clear(); }
  async function fetchJSON(url, options = {}, fetcher = globalThis.fetch, decode = response => response.json()) {
    const assertCurrent = capture(), controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      assertCurrent();
      if (options.signal?.aborted) controller.abort();
      const response = await fetcher(url, { ...options, signal: controller.signal });
      const data = await decode(response);
      assertCurrent();
      if (!response.ok) throw Object.assign(new Error(data.error || `Request failed ${response.status}`), { status: response.status, code: data.code });
      return data;
    } catch (error) { assertCurrent(); throw error; }
    finally { clearTimeout(timer); active.delete(controller); options.signal?.removeEventListener('abort', abort); }
  }
  return Object.freeze({ capture, invalidate, fetchJSON });
}
