const failure = (code = 'AI_NOT_SUPPLIED') => Object.assign(new Error('The admitted native project service is unavailable.'), { code });
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
// Supply is a separate original owner capability, never a four-op Wallet check.
export function createNativeToolsClient({ supply = null } = {}) {
  if (!supply) return null;
  if (typeof supply.openProject !== 'function') throw failure();
  let opening, session, captured, binding, retired = false;
  async function current(value, signal) {
    signal?.throwIfAborted();
    if (retired) throw failure('AI_RETIRED');
    const exact = JSON.stringify([value.projectId, value.workspace, value.launch]);
    if (captured && captured !== exact) throw failure('AI_RETIRED');
    captured = exact;
    if (!session) {
      opening ||= Promise.resolve().then(() => supply.openProject(Object.freeze({ ...value }), { signal }));
      try { session = await opening; } catch (error) { retired = true; throw error; }
      if (retired) { try { session?.close?.(); } catch {} throw failure('AI_RETIRED'); }
    }
    if (typeof session?.assertCurrent !== 'function' || typeof session.request !== 'function') { retired = true; try { session?.close?.(); } catch {} throw failure(); }
    const state = await session.assertCurrent(Object.freeze({ ...value }), { signal });
    signal?.throwIfAborted();
    if (retired || state?.localProjectId !== value.projectId || state.workspace !== value.workspace || state.launch !== value.launch ||
      !uuid(state.sessionId) || typeof state.generation !== 'string' || !state.generation || !Number.isFinite(state.expiresAt) || state.expiresAt <= Date.now()) throw failure('AI_RETIRED');
    return Object.freeze({ localProjectId: state.localProjectId, workspace: state.workspace, launch: state.launch, sessionId: state.sessionId, generation: state.generation, expiresAt: state.expiresAt });
  }
  return Object.freeze({
    async assertCurrent(value, signal) {
      if (!value || Object.keys(value).sort().join('|') !== 'launch|projectId|workspace' || typeof value.projectId !== 'string' || typeof value.workspace !== 'string' || !uuid(value.launch)) throw failure('AI_RETIRED');
      const state = await current(value, signal);
      binding ||= Object.freeze({ ...value });
      return state;
    },
    async request(action, body, { signal } = {}) {
      if (!binding || !['context', 'proposals', 'approve'].includes(action)) throw failure();
      const before = await current(binding, signal);
      // Authenticated transport owns origin/credentials; no caller headers or URL.
      const request = Object.freeze({ method: action === 'context' ? 'GET' : 'POST',
        path: `/runtime/native-tools/${action}?sessionId=${encodeURIComponent(before.sessionId)}`,
        ...(action === 'context' ? {} : { body: structuredClone(body) }) });
      const result = await session.request(request, { signal });
      const after = await current(binding, signal);
      if (before.sessionId !== after.sessionId || before.generation !== after.generation || before.expiresAt !== after.expiresAt) throw failure(action === 'approve' ? 'AI_UNKNOWN' : 'AI_RETIRED');
      return result;
    },
    close() { if (retired) return; retired = true; try { session?.close?.(); } catch {} },
  });
}
