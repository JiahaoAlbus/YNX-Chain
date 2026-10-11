const failure = (code = 'AI_RETIRED') => Object.assign(new Error('The retained project is not current.'), { code });
const keys = ['owner', 'workspaceOwner', 'account', 'generation', 'identityReference', 'localProjectId', 'workspace', 'launch', 'sessionId'];
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const locator = value => value && Object.keys(value).sort().join('|') === 'launch|projectId|workspace';
// Private desktop construction consumes an already retained original broker
// owner from the protected supplier. This never imports/adopts/launches a project
// or derives canonical authority from local directory names, cookies or UUIDs.
export function createAdmittedLocalProjectMapping({ context, canonicalProject, nativeTools, now = Date.now } = {}) {
  if (!canonicalProject) return null;
  let closed = false, opened = false, opening, session, selected, captured, canonical, deadline;
  let acquiring = false, acquisitionDone, acquisitionFinished, cleanupRun, cleanupActive = false, supplierDepth = 0, primary;
  const records = [{ owner: canonicalProject, entered: false, complete: false, pending: null, errors: [] }];
  function accept(record, value) {
    record.complete = value === undefined || value?.complete === true;
    if (Array.isArray(value?.errors)) for (const error of value.errors) if (!record.errors.includes(error)) record.errors.push(error);
  }
  function observe(record, value) {
    const then = value?.then;
    if (typeof then === 'function') {
      // Invoke the already entered thenable under the same supplier guard.
      // Synchronous reentry observes status rather than awaiting its own pass.
      record.pending = new Promise((resolve, reject) => { then.call(value, resolve, reject); }).then(result => accept(record, result), error => { record.errors.push(error); })
        .finally(() => { record.pending = null; });
    } else accept(record, value);
  }
  function enter(record, method) {
    if (method === 'close') { if (record.entered) return; record.entered = true; }
    supplierDepth++;
    try { observe(record, record.owner[method]()); }
    catch (error) { record.errors.push(error); }
    finally { supplierDepth--; }
  }
  function cleanupStatus() {
    return Object.freeze({ complete: closed && !acquiring && records.every(r => r.complete && !r.pending),
      outstanding: (acquiring ? 1 : 0) + records.filter(r => !r.complete || r.pending).length,
      errors: Object.freeze(records.flatMap(r => r.errors)), ...(primary !== undefined ? { primary } : {}) });
  }
  const close = () => {
    closed = true;
    if (cleanupActive) return cleanupStatus();
    cleanupActive = true;
    try { for (const record of records) enter(record, 'close'); return cleanupStatus(); }
    finally { cleanupActive = false; }
  };
  function finishCleanup() {
    closed = true;
    if (cleanupActive) return supplierDepth || !cleanupRun ? cleanupStatus() : cleanupRun;
    // Publish the whole pass before initial close or any other foreign entry.
    cleanupActive = true;
    let resolvePass, rejectPass;
    const pass = new Promise((resolve, reject) => { resolvePass = resolve; rejectPass = reject; });
    cleanupRun = pass;
    const settle = (forward, value) => {
      forward(value);
      if (cleanupRun === pass) { cleanupActive = false; cleanupRun = null; }
    };
    void (async () => {
      for (const record of records) enter(record, 'close');
      // Observe an acquisition or close already entered; never call it again.
      if (acquiring) await acquisitionDone;
      for (const record of records) {
        enter(record, 'close');
        if (record.pending) await record.pending;
        if (!record.complete && typeof record.owner.finishCleanup === 'function') {
          enter(record, 'finishCleanup');
          if (record.pending) await record.pending;
        }
      }
      return cleanupStatus();
    })().then(value => settle(resolvePass, value), error => settle(rejectPass, error));
    return pass;
  }
  const cleanupOwner = Object.freeze({ close, finishCleanup, cleanupStatus });
  function preserve(error) {
    primary = error; close();
    // Keep arbitrary/frozen primary values intact. The original mapping still
    // holds cleanup authority even if diagnostic properties cannot be attached.
    try { Object.defineProperties(error, { cleanupErrors: { configurable: true, get: () => cleanupStatus().errors }, cleanupOwner: { value: cleanupOwner, configurable: true } }); } catch {}
    return error;
  }
  if (!nativeTools) { const status = close(); if (status.complete) return null; throw preserve(failure('AI_NOT_SUPPLIED')); }
  if (!context || typeof context.id !== 'string' || typeof context.workspace !== 'string' ||
      ['assertCurrent', 'request', 'close'].some(k => typeof canonicalProject[k] !== 'function') || typeof nativeTools.openProject !== 'function') throw preserve(failure('AI_NOT_SUPPLIED'));
  const local = Object.freeze({ id: context.id, workspace: context.workspace });
  const fence = signal => { signal?.throwIfAborted(); if (closed || deadline !== undefined && now() >= deadline) throw failure(); };
  async function projectCurrent(signal) {
    fence(signal);
    const state = await canonicalProject.assertCurrent(); fence(signal);
    if (!state || keys.some(k => state[k] === undefined) || state.workspace !== local.workspace || !uuid(state.sessionId) || !uuid(state.launch) ||
        !Number.isSafeInteger(state.generation) || state.generation < 0 || !Number.isFinite(state.expiresAt) || state.expiresAt <= now()) throw failure();
    if (captured && keys.some(k => captured[k] !== state[k])) throw failure();
    if (!captured) {
      captured = Object.freeze({ ...state }); deadline = state.expiresAt;
      canonical = Object.freeze({ projectId: state.localProjectId, workspace: state.workspace, launch: state.launch });
    } else if (state.expiresAt < deadline) throw failure();
    fence(signal); return state;
  }
  async function current(signal) {
    await projectCurrent(signal);
    const state = await session.assertCurrent(canonical, { signal }); fence(signal);
    if (state?.localProjectId !== canonical.projectId || state.workspace !== canonical.workspace || state.launch !== canonical.launch ||
        state.sessionId !== captured.sessionId || state.generation !== String(captured.generation) || !Number.isFinite(state.expiresAt) || state.expiresAt < deadline) throw failure();
    await projectCurrent(signal); fence(signal);
    return Object.freeze({ localProjectId: local.id, workspace: local.workspace, launch: selected.launch,
      sessionId: captured.sessionId, generation: String(captured.generation), expiresAt: deadline });
  }
  return Object.freeze({
    async openProject(value, { signal } = {}) {
      if (!locator(value) || value.projectId !== local.id || value.workspace !== local.workspace || !uuid(value.launch) || opened) throw failure();
      opened = true; selected = Object.freeze({ ...value });
      acquiring = true; acquisitionDone = new Promise(resolve => { acquisitionFinished = resolve; });
      try {
        await projectCurrent(signal);
        // The separate Tools authority may have a shorter fixed identity lease.
        try {
          opening = Promise.resolve(nativeTools.openProject(canonical, { signal }));
          session = await opening;
        } catch (error) {
          // Only the private original acquisition boundary supplies this
          // cleanup-only carrier. It cannot become a returned business session.
          if (error?.code === 'AI_ACQUISITION_CLEANUP_REQUIRED' &&
              typeof error.cleanupStatus === 'function' && typeof error.finishCleanup === 'function') {
            records.unshift({ owner: { close: () => error.cleanupStatus(), finishCleanup: () => error.finishCleanup() },
              entered: false, complete: false, pending: null, errors: [] });
          }
          throw error;
        }
        records.unshift({ owner: session, entered: false, complete: false, pending: null, errors: [] });
        if (closed) throw failure();
        if (['assertCurrent', 'request', 'close'].some(k => typeof session?.[k] !== 'function')) throw failure('AI_NOT_SUPPLIED');
        const first = await session.assertCurrent(canonical, { signal }); fence(signal);
        if (!Number.isFinite(first?.expiresAt)) throw failure();
        deadline = Math.min(deadline, first.expiresAt);
        await current(signal);
      } catch (error) { throw preserve(error); }
      finally { acquiring = false; acquisitionFinished(); }
      let busy = false, unknown = false;
      return Object.freeze({
        async assertCurrent(input, { signal: requestSignal } = {}) {
          if (!locator(input) || ['projectId', 'workspace', 'launch'].some(k => input[k] !== selected[k]) || unknown) throw failure(unknown ? 'AI_UNKNOWN' : 'AI_RETIRED');
          return current(requestSignal);
        },
        async request(value, { signal: requestSignal } = {}) {
          if (busy || unknown) throw failure(unknown ? 'AI_UNKNOWN' : 'AI_BUSY');
          const action = ['context', 'proposals', 'approve'].find(k => value?.path === `/runtime/native-tools/${k}?sessionId=${encodeURIComponent(captured.sessionId)}`);
          if (!action || value.method !== (action === 'context' ? 'GET' : 'POST') || Object.keys(value).sort().join('|') !== (action === 'context' ? 'method|path' : 'body|method|path')) throw failure();
          const request = structuredClone(value); let entered = false; busy = true;
          try {
            await current(requestSignal); fence(requestSignal); entered = true;
            const result = await session.request(request, { signal: requestSignal });
            await current(requestSignal); return result;
          } catch (error) {
            if (entered && action !== 'context') { unknown = true; throw Object.assign(failure('AI_UNKNOWN'), { cause: error }); }
            throw error;
          } finally { busy = false; }
        }, close, finishCleanup, cleanupStatus,
      });
    }, close, finishCleanup, cleanupStatus,
  });
}
