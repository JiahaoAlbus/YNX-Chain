import { createNativeToolsAuthority } from './native-tools-authority.mjs';
import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
const unavailable = () => Object.assign(new Error('Original conversation authority is not supplied.'), { code: 'AI_NOT_SUPPLIED' });
const retired = (code = 'AI_RETIRED') => Object.assign(new Error('Original completed project is unavailable.'), { code });
const snapshotKeys = ['owner', 'workspaceOwner', 'account', 'generation', 'identityReference', 'localProjectId', 'workspace', 'launch', 'sessionId'];
const methods = owner => owner && ['assertCurrent', 'request', 'close'].every(k => typeof owner[k] === 'function');
// Release-owned constructor inputs only. The protected configuration loader
// selects this module; no public route registers a factory or credentials.
export function createDeveloperCoreAdmission({ coreAdmission, retainedSSO, admittedProjects, conversationAuthority = null, now = Date.now } = {}) {
  if (!coreAdmission || ['launchURL', 'sessionForHost', 'originForSession'].some(k => typeof coreAdmission[k] !== 'function') ||
      ['start', 'stop', 'connect'].some(k => typeof coreAdmission.driver?.[k] !== 'function')) throw unavailable();
  const nativeTools = createNativeToolsAuthority({ retainedSSO, admittedProjects, now });
  // These registries are held by this release-owned constructor only. A locator
  // never indexes the acquisition API: it requires the exact retained object.
  const completed = new WeakMap(), sessions = new Set(), retainedRecords = new Set();
  const workContext = new AsyncLocalStorage();
  let lifecyclePass;
  let draining = false;
  async function retainCompletedProject({ admittedProject, session, nativeTools: suppliedTools } = {}) {
    if (draining || !methods(admittedProject) || suppliedTools !== nativeTools || !session || session.status !== 'running' ||
        typeof session.sessionId !== 'string' || typeof session.projectId !== 'string' ||
        !Number.isFinite(session.expiresAt) || session.expiresAt <= now()) throw retired();
    if (completed.has(admittedProject) || sessions.has(session.sessionId)) throw retired('AI_DUPLICATE');
    // Reserve before the first foreign call/await; callback reentry cannot admit
    // a second operation, even when the first acquisition later fails.
    sessions.add(session.sessionId);
    const fixedSession = Object.freeze({ sessionId: session.sessionId, projectId: session.projectId, expiresAt: session.expiresAt });
    let closed = false, lifecycleRetired = false, unknown = false, borrowed = false, captured, primary, hasPrimary = false, outcomeCause, hasOutcomeCause = false;
    let deadline = fixedSession.expiresAt, cleanupActive = false, cleanupPass, cleanupSelection;
    const enteredWork = new Set();
    const startedAt = now(), monotonicStart = performance.now();
    let wallFloor = startedAt;
    const records = [{ owner: admittedProject, state: 'unentered', errors: [] }];
    const status = () => Object.freeze({ complete: closed && enteredWork.size === 0 && records.every(r => r.state === 'released'),
      pending: enteredWork.size, retained: records.filter(r => r.state !== 'released').length,
      unknown, ...(hasOutcomeCause ? { outcomeCause } : {}),
      outstanding: enteredWork.size + records.filter(r => r.state !== 'released').length,
      owners: Object.freeze(records.map(r => Object.freeze({ state: r.state, settlement: r.settlement }))),
      errors: Object.freeze(records.flatMap(r => r.errors)), ...(hasPrimary ? { primary } : {}) });
    function cleanup(explicit = false, selection = lifecyclePass || { owners: new Set() }) {
      closed = true;
      if (cleanupActive || enteredWork.size) return status();
      cleanupActive = true;
      try {
        for (const record of [...records].reverse()) {
          let method;
          if (record.state === 'unentered' || explicit && record.state === 'retryable') method = 'close';
          else if (explicit && record.state === 'incomplete' && typeof record.owner.finishCleanup === 'function') method = 'finishCleanup';
          else continue;
          // Reserve before any foreign disposal. Internal seams, reentry and
          // concurrent row/global joins never select this owner twice in a pass.
          if (selection.owners.has(record)) continue;
          selection.owners.add(record);
          record.state = 'entered';
          let result;
          try { result = record.owner[method](); }
          catch (error) { record.state = 'retryable'; record.errors.push(error); continue; }
          try {
            const then = result?.then;
            if (typeof then === 'function') {
              record.state = 'pending';
              record.errors.push(retired('AI_CLEANUP_ASYNC_UNSUPPORTED'));
              record.observation = new Promise((resolve, reject) => then.call(result, resolve, reject)).then(
                () => { record.state = 'uncertain'; record.settlement = 'fulfilled'; },
                error => { record.state = 'uncertain'; record.settlement = 'rejected'; record.errors.push(error); });
            } else if (result === undefined || result?.complete === true) record.state = 'released';
            else { record.state = 'incomplete'; record.errors.push(retired('AI_CLEANUP_REQUIRED')); }
          } catch (error) {
            // A throwing then getter is not evidence that close was unentered.
            record.state = 'uncertain'; record.errors.push(error);
          }
        }
        return status();
      } finally { cleanupActive = false; }
    }
    const close = () => cleanup(false);
    function finishInPass(selection) {
      closed = true;
      // Foreign callbacks under an entered original operation cannot await the
      // very operation whose completion they are responsible for. Observe only.
      if (cleanupActive || workContext.getStore()) return status();
      if (cleanupPass) {
        // A direct explicit pass may already be pending when normal global
        // shutdown joins it. Unify reservations, not merely the wait promise.
        if (cleanupSelection !== selection) {
          for (const owner of cleanupSelection.owners) selection.owners.add(owner);
          cleanupSelection.owners = selection.owners;
        }
        return cleanupPass;
      }
      cleanupSelection = selection;
      cleanupPass = Promise.resolve().then(async () => {
        await Promise.all([...enteredWork].map(ticket => ticket.done));
        return cleanup(true, selection);
      }).finally(() => { cleanupPass = undefined; cleanupSelection = undefined; });
      return cleanupPass;
    }
    const finishCleanup = () => finishInPass(lifecyclePass || { owners: new Set() });
    async function tracked(work) {
      try { fence(); } catch (error) { throw preserve(error); }
      let resolve;
      const ticket = { done: new Promise(done => { resolve = done; }) };
      enteredWork.add(ticket); // before invoking original current/request/acquire
      try { return await workContext.run(ticket, work); }
      finally {
        enteredWork.delete(ticket); resolve();
        // Outer tickets keep post-fence/late outcome capture owned until done.
        // Business-only lifecycle retirement is not a disposal selection. Its
        // pending original captures stay owned through the normal driver join.
        // Explicit close and unretired acquisition failures retain auto cleanup.
        if (closed && !lifecycleRetired && enteredWork.size === 0 && !cleanupPass) cleanup(false);
      }
    }
    const cleanupOwner = Object.freeze({ close, finishCleanup, cleanupStatus: status });
    const preserve = error => {
      if (!hasPrimary) { primary = error; hasPrimary = true; }
      if (lifecycleRetired) closed = true;
      else close();
      return Object.freeze(Object.defineProperties(Object.assign(retired('AI_ACQUISITION_CLEANUP_REQUIRED'), {
        cause: primary, primary, cleanupOwner, finishCleanup, cleanupStatus: status,
      }), {
        unknown: { enumerable: true, get: () => unknown },
        outcomeCause: { enumerable: true, get: () => outcomeCause },
      }));
    };
    const markUnknown = cause => { unknown = true; if (!hasOutcomeCause) { outcomeCause = cause; hasOutcomeCause = true; } };
    function fence(signal) {
      signal?.throwIfAborted();
      const at = now();
      if (closed || unknown || !Number.isFinite(at) || at < wallFloor || at >= deadline ||
          performance.now() - monotonicStart >= deadline - startedAt) throw retired(unknown ? 'AI_UNKNOWN' : 'AI_RETIRED');
      wallFloor = at;
    }
    function validate(value) {
      if (!value || snapshotKeys.some(k => value[k] === undefined) || value.sessionId !== fixedSession.sessionId ||
          value.launch !== fixedSession.sessionId || value.localProjectId !== fixedSession.projectId ||
          !/^[a-f0-9]{64}$/.test(value.owner || '') || !/^[a-f0-9]{64}$/.test(value.workspaceOwner || '') ||
          typeof value.account !== 'string' || !value.account || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.identityReference || '') || typeof value.workspace !== 'string' || !value.workspace ||
          !Number.isFinite(value.expiresAt) || value.expiresAt <= now() ||
          captured && snapshotKeys.some(k => captured[k] !== value[k])) throw retired();
      if (captured && value.expiresAt < deadline) throw retired();
    }
    let witness;
    async function current(signal) {
      return tracked(async () => {
      fence(signal);
      const first = await admittedProject.assertCurrent(); fence(signal); validate(first);
      const checked = await witness.assertCurrent(); fence(signal); validate(checked);
      if (snapshotKeys.some(k => first[k] !== checked[k])) throw retired();
      const after = await admittedProject.assertCurrent(); fence(signal); validate(after);
      if (snapshotKeys.some(k => first[k] !== after[k])) throw retired();
      if (!captured) captured = Object.freeze(Object.fromEntries(snapshotKeys.map(k => [k, first[k]])));
      // Shrinking never renews this receiver's initial completed-session budget.
      deadline = Math.min(deadline, first.expiresAt, checked.expiresAt, after.expiresAt);
      fence(signal); return Object.freeze({ ...captured, expiresAt: deadline });
      });
    }
    async function own(acquire) {
      return tracked(async () => {
      try {
        const owner = await acquire();
        // Publish before post-await fences: late success remains cleanup-owned.
        if (owner && typeof owner.close === 'function' && !records.some(r => r.owner === owner)) records.push({ owner, state: 'unentered', errors: [] });
        return owner;
      } catch (error) {
        if (error?.code === 'AI_ACQUISITION_CLEANUP_REQUIRED' && typeof error.finishCleanup === 'function' && typeof error.cleanupStatus === 'function') {
          records.push({ owner: { close: () => error.cleanupStatus(), finishCleanup: () => error.finishCleanup() }, state: 'unentered', errors: [] });
        }
        throw error;
      }
      });
    }
    let requestBusy = false;
    const canonicalProject = Object.freeze({
      async assertCurrent() { return tracked(async () => { try { return await current(); } catch (error) { throw preserve(error); } }); },
      async request(value, { signal } = {}) {
        return tracked(async () => {
        if (requestBusy) throw retired('AI_BUSY');
        let entered = false; requestBusy = true;
        try {
          await current(signal); fence(signal); entered = true;
          // Only the independently acquired original broker executes a request;
          // callback-provided methods or snapshots cannot mint an effect.
          const result = await witness.request(value, { signal });
          await current(signal); fence(signal); return result;
        } catch (error) {
          if (entered && value?.method !== 'GET') { markUnknown(error); throw preserve(error); }
          throw preserve(error);
        } finally { requestBusy = false; }
        });
      }, close, finishCleanup, cleanupStatus: status,
    });
    const pairedTools = Object.freeze({ async openProject(locator, { signal } = {}) {
      return tracked(async () => {
      let tools;
      try {
        await current(signal);
        if (!locator || Object.keys(locator).sort().join('|') !== 'launch|projectId|workspace' ||
            locator.projectId !== captured.localProjectId || locator.workspace !== captured.workspace || locator.launch !== captured.launch || borrowed) throw retired();
        borrowed = true; // one private acquisition, including failed/partial entry
        tools = await own(() => nativeTools.openProject(Object.freeze({ ...locator }), { signal }));
        fence(signal);
        if (!methods(tools)) throw retired();
        await current(signal); fence(signal);
        let busy = false;
        return Object.freeze({
          async assertCurrent(value, { signal: operationSignal } = {}) {
            return tracked(async () => {
            try { await current(operationSignal); const result = await tools.assertCurrent(value, { signal: operationSignal }); await current(operationSignal); return result; }
            catch (error) { throw preserve(error); }
            });
          },
          async request(value, { signal: operationSignal } = {}) {
            return tracked(async () => {
            if (busy) throw retired('AI_BUSY');
            let entered = false; busy = true;
            try { await current(operationSignal); fence(operationSignal); entered = true;
              const result = await tools.request(value, { signal: operationSignal }); await current(operationSignal); return result; }
            catch (error) { if (entered && value?.method !== 'GET') { markUnknown(error); throw preserve(error); } throw preserve(error); }
            finally { busy = false; }
            });
          }, close, finishCleanup, cleanupStatus: status,
        });
      } catch (error) { throw preserve(error); }
      });
    } });
    const pair = Object.freeze({ admittedProject: canonicalProject, nativeTools: pairedTools, close, finishCleanup, cleanupStatus: status });
    const record = { pair, ready: false, claimed: false, current, tracked, preserve, status, close, finishInPass,
      sessionId: fixedSession.sessionId,
      retire(primaryInput, supplied) { if (supplied && !hasPrimary) { primary = primaryInput; hasPrimary = true; } lifecycleRetired = true; closed = true; return status(); } };
    completed.set(admittedProject, record);
    retainedRecords.add(record); // strong owner before first foreign entry
    return tracked(async () => { try {
      const first = await admittedProject.assertCurrent(); fence(); validate(first);
      captured = Object.freeze(Object.fromEntries(snapshotKeys.map(k => [k, first[k]])));
      deadline = Math.min(deadline, first.expiresAt);
      witness = await own(() => admittedProjects.acquireProject(Object.freeze({ projectId: captured.localProjectId, workspace: captured.workspace, launch: captured.launch })));
      fence(); if (!methods(witness) || witness === admittedProject) throw retired();
      await current(); fence(); record.ready = true;
      return pair;
    } catch (error) { throw preserve(error); } });
  }
  async function acquireCompletedProject(original, { signal } = {}) {
    const record = original && completed.get(original);
    if (!record?.ready || record.claimed) throw retired();
    record.claimed = true;
    return record.tracked(async () => {
      try { await record.current(signal); return record.pair; }
      catch (error) { throw record.preserve(error); }
    });
  }
  function aggregate(selected = [...retainedRecords]) {
    const observations = selected.map(record => record.status());
    return Object.freeze({ complete: observations.every(value => value.complete),
      pending: observations.reduce((n, value) => n + value.pending, 0),
      retained: observations.reduce((n, value) => n + value.retained, 0),
      unknown: observations.some(value => value.unknown),
      records: Object.freeze(observations), errors: Object.freeze(observations.flatMap(value => value.errors)) });
  }
  const forSession = id => [...retainedRecords].filter(record => record.sessionId === id);
  async function finishSelected(selected, join) {
    // Reserve synchronously before retiring or invoking normal row callbacks.
    // Concurrent top-level callers share this selection until all joins settle.
    const pass = lifecyclePass || (lifecyclePass = { owners: new Set(), joins: 0 });
    pass.joins++;
    try {
      for (const record of selected) record.retire();
      const cleanup = selected.map(record => record.finishInPass(pass));
      // A row failure cannot release the pass while entered cleanup is pending.
      const results = await Promise.allSettled([...cleanup, typeof join === 'function' ? Promise.resolve().then(join) : undefined]);
      const failed = results.find(value => value.status === 'rejected');
      if (failed) throw failed.reason;
      return aggregate(selected);
    } finally {
      if (--pass.joins === 0 && lifecyclePass === pass) lifecyclePass = undefined;
    }
  }
  const completedProjectLifecycle = Object.freeze({
    retireOriginal(original, options = {}) {
      const record = original && completed.get(original);
      if (!record) return Object.freeze({ recognized: false, status: aggregate([]) });
      const value = record.retire(options.primary, Object.hasOwn(options, 'primary'));
      return Object.freeze({ recognized: true, status: value });
    },
    retireSession(sessionId) { const selected = forSession(sessionId); for (const record of selected) record.retire(); return aggregate(selected); },
    finishSessionCleanup(sessionId) { return finishSelected(forSession(sessionId)); },
    async drain(join) {
      draining = true;
      const selected = [...retainedRecords];
      return finishSelected(selected, join);
    },
    cleanupStatus: () => aggregate(),
  });
  const hostedGeneration = conversationAuthority && typeof conversationAuthority.openGeneration === 'function'
    ? Object.freeze({ openGeneration: (...args) => conversationAuthority.openGeneration(...args) })
    : Object.freeze({ async openGeneration() { throw unavailable(); } });
  // Never derive ai:generate from SSO, nativeTools, or four-op admission.
  return Object.freeze({ ...coreAdmission, nativeTools, hostedGeneration, retainCompletedProject, acquireCompletedProject, completedProjectLifecycle });
}
