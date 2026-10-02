type Action = 'edit' | 'save' | 'open-project' | 'review-tool';
export function createIdentityActivity(fetcher: typeof fetch, clock = Date.now, token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}) {
  let epoch = 0, lastSent = -Infinity, editAt = -Infinity, pending: Promise<boolean> | null = null;
  function reset() { epoch++; lastSent = -Infinity; editAt = -Infinity; pending = null; }
  function attest(event: Pick<Event, 'isTrusted'>, action: Action): Promise<boolean> {
    if (!event.isTrusted) return Promise.resolve(false);
    if (clock() - lastSent < 60000) return Promise.resolve(true);
    if (pending) return pending;
    const captured = epoch;
    const work = (async () => {
      const response = await fetcher('/runtime/identity', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const identity = await response.json();
      if (captured !== epoch || !response.ok || !identity.connected || typeof identity.csrf !== 'string') return false;
      const acknowledged = await fetcher('/runtime/identity/activity', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csrf: identity.csrf, action, eventId: token() }), signal: AbortSignal.timeout(5000) });
      if (captured !== epoch || !acknowledged.ok) return false;
      lastSent = clock(); return true;
    })().finally(() => { if (pending === work) pending = null; });
    pending = work; return work;
  }
  function noteEditorInput(event: Event) {
    // Untrusted cross-site runtime input does not bubble into this host document.
    // Messages, focus, polling, timers and synthetic events never attest usage.
    if (event.isTrusted && event.target instanceof Element && event.target.closest('.monaco-editor,.cm-editor')) editAt = clock();
  }
  async function savedTrustedEdit() {
    if (clock() - editAt > 30000) return false;
    editAt = -Infinity; return attest({ isTrusted: true }, 'save');
  }
  return { attest, noteEditorInput, savedTrustedEdit, reset };
}
export const identityActivity = createIdentityActivity((...args) => fetch(...args));
