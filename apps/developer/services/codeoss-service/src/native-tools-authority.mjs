const fail = (code = 'AI_NOT_SUPPLIED') => Object.assign(new Error('Current admitted project authority is unavailable.'), { code });
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const locatorKeys = ['projectId', 'workspace', 'launch'];
const identityKeys = ['owner', 'workspaceOwner', 'account', 'generation', 'identityReference'];
const snapshotKeys = [...identityKeys, 'localProjectId', 'workspace', 'launch', 'sessionId', 'expiresAt'];
// Construct only in the protected backend operator with the original SSO and
// admitted CodeOSS journal owner. Desktop input is a locator, never authority.
export function createNativeToolsAuthority({ retainedSSO, admittedProjects, now = Date.now } = {}) {
  if (typeof retainedSSO?.acquireReference !== 'function' || typeof admittedProjects?.acquireProject !== 'function') throw fail();
  return Object.freeze({
    async openProject(locator, { signal } = {}) {
      if (!exact(locator, locatorKeys) || typeof locator.projectId !== 'string' || !locator.projectId ||
          typeof locator.workspace !== 'string' || !locator.workspace || !/^[a-f0-9-]{36}$/.test(locator.launch || '')) throw fail('AI_RETIRED');
      signal?.throwIfAborted();
      const selected = Object.freeze({ ...locator });
      let project, identity, captured, closed = false, unknown = false, busy = false;
      let cleanupStarted = false;
      let cleanupActive = false;
      const cleanupErrors = [];
      const releases = { identity: { state: 'unentered' }, project: { state: 'unentered' } };
      const cleanupStatus = () => Object.freeze({ complete: !identity && !project,
        outstanding: Object.freeze(['identity', 'project'].filter(name => name === 'identity' ? identity : project)),
        owners: Object.freeze(Object.fromEntries(Object.entries(releases).map(([name, record]) => [name, Object.freeze({ state: record.state, settlement: record.settlement })]))),
        errors: Object.freeze([...cleanupErrors]) });
      const finishCleanup = () => {
        closed = true; cleanupStarted = true;
        if (cleanupActive) return cleanupStatus();
        cleanupActive = true;
        try {
        for (const name of ['identity', 'project']) {
          const owner = name === 'identity' ? identity : project;
          const record = releases[name];
          if (!owner || !['unentered', 'retryable'].includes(record.state)) continue;
          record.state = 'entered'; // before supplier entry: reentry cannot dispatch again
          let result;
          try {
            result = owner.close();
          } catch (error) {
            record.state = 'retryable'; cleanupErrors.push(Object.freeze({ owner: name, error })); continue;
          }
          let then;
          try { then = result?.then; }
          catch (error) { record.state = 'uncertain'; cleanupErrors.push(Object.freeze({ owner: name, error })); continue; }
          if (typeof then === 'function') {
            record.state = 'pending';
            cleanupErrors.push(Object.freeze({ owner: name, error: fail('AI_CLEANUP_ASYNC_UNSUPPORTED') }));
            // Observe the entered result; neither fulfillment nor rejection is
            // a synchronous release acknowledgement or permission to reenter.
            record.observation = new Promise((resolve, reject) => { then.call(result, resolve, reject); }).then(
              () => { record.state = 'uncertain'; record.settlement = 'fulfilled'; },
              error => { record.state = 'uncertain'; record.settlement = 'rejected'; cleanupErrors.push(Object.freeze({ owner: name, error })); }
            );
            continue;
          }
          record.state = 'released';
          if (name === 'identity') identity = undefined; else project = undefined;
        }
        return cleanupStatus();
        } finally { cleanupActive = false; }
      };
      const close = () => { closed = true; return cleanupStarted ? cleanupStatus() : finishCleanup(); };
      const fence = () => { signal?.throwIfAborted(); if (closed || unknown || captured && now() >= captured.expiresAt) throw fail(unknown ? 'AI_UNKNOWN' : 'AI_RETIRED'); };
      const localFence = requestSignal => {
        requestSignal?.throwIfAborted(); fence(); identity.assertLocalCurrent();
        if (project.assertLocalCurrent) project.assertLocalCurrent();
        requestSignal?.throwIfAborted(); fence();
      };
      function validate(s) {
        if (!exact(s, snapshotKeys) || s.localProjectId !== selected.projectId || s.workspace !== selected.workspace || s.launch !== selected.launch ||
            !/^[a-f0-9-]{36}$/.test(s.sessionId || '') || !/^[a-f0-9]{64}$/.test(s.owner || '') || !/^[a-f0-9]{64}$/.test(s.workspaceOwner || '') ||
            !Number.isSafeInteger(s.generation) || s.generation < 0 || typeof s.account !== 'string' || !s.account ||
            !/^[A-Za-z0-9_-]{43}$/.test(s.identityReference || '') || !Number.isFinite(s.expiresAt) || s.expiresAt <= now()) throw fail('AI_RETIRED');
      }
      async function current(requestSignal) {
        requestSignal?.throwIfAborted(); fence();
        const p = await project.assertCurrent(); fence(); validate(p);
        const id = await identity.assertCurrent(); fence();
        if (!Number.isFinite(id?.expiresAt) || id.expiresAt <= now() || identityKeys.some(k => p[k] !== id[k])) throw fail('AI_RETIRED');
        const after = await project.assertCurrent(); fence(); validate(after);
        if (snapshotKeys.some(k => p[k] !== after[k])) throw fail('AI_RETIRED');
        if (captured && (snapshotKeys.filter(k => k !== 'expiresAt').some(k => p[k] !== captured[k]) || p.expiresAt < captured.expiresAt || id.expiresAt < captured.expiresAt)) throw fail('AI_RETIRED');
        if (!captured) captured = Object.freeze({ ...p, expiresAt: Math.min(p.expiresAt, id.expiresAt) });
        localFence(requestSignal);
        return Object.freeze({ localProjectId: captured.localProjectId, workspace: captured.workspace, launch: captured.launch,
          sessionId: captured.sessionId, generation: String(captured.generation), expiresAt: captured.expiresAt });
      }
      try {
        project = await admittedProjects.acquireProject(selected, { signal }); fence();
        if (typeof project?.assertCurrent !== 'function' || typeof project.request !== 'function' || typeof project.close !== 'function') throw fail();
        const p = await project.assertCurrent(); fence(); validate(p);
        identity = await retainedSSO.acquireReference(p.identityReference); fence();
        if (typeof identity?.assertLocalCurrent !== 'function' || typeof identity.assertCurrent !== 'function' || typeof identity.close !== 'function') throw fail();
        await current(signal);
        localFence(signal);
      } catch (error) {
        const cleanup = close();
        if (!cleanup.complete) {
          // Never mutate an arbitrary supplier/AbortSignal reason. The carrier
          // is independently owned even for frozen objects, collisions or null.
          const carrier = Object.assign(fail('AI_ACQUISITION_CLEANUP_REQUIRED'), {
            cause: error, primary: error, cleanupErrors: cleanup.errors, finishCleanup, cleanupStatus,
          });
          throw Object.freeze(carrier);
        }
        throw error;
      }
      return Object.freeze({
        async assertCurrent(value, { signal: requestSignal } = {}) {
          if (!exact(value, locatorKeys) || locatorKeys.some(k => value[k] !== selected[k])) throw fail('AI_RETIRED');
          const result = await current(requestSignal); localFence(requestSignal); return result;
        },
        async request(value, { signal: requestSignal } = {}) {
          if (busy) throw fail('AI_BUSY');
          const actions = ['context', 'proposals', 'approve'];
          const action = actions.find(a => value?.path === `/runtime/native-tools/${a}?sessionId=${encodeURIComponent(captured.sessionId)}`);
          if (!action || !exact(value, action === 'context' ? ['method', 'path'] : ['method', 'path', 'body']) || value.method !== (action === 'context' ? 'GET' : 'POST')) throw fail();
          const request = structuredClone(value); let dispatched = false;
          if (action !== 'context' && Buffer.byteLength(JSON.stringify(request.body) ?? '') > 1048576) throw fail();
          busy = true;
          try {
            await current(requestSignal); localFence(requestSignal);
            dispatched = true;
            const result = await project.request(request, { signal: requestSignal });
            await current(requestSignal); localFence(requestSignal); return result;
          } catch (error) {
            if (dispatched && action !== 'context') { unknown = true; throw Object.assign(fail('AI_UNKNOWN'), { cause: error }); }
            throw error;
          } finally { busy = false; }
        },
        close,
        finishCleanup,
        cleanupStatus,
      });
    },
  });
}
