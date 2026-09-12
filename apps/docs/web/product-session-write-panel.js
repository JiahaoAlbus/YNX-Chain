import {createDocsWriteClient} from './product-session-write-client.js';
import {createDocsReadClient} from './product-session-read-client.js';

export function mountDocsWritePanel({root, getAdapter, origin}) {
  const panel = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = 'Create and save documents';
  const title = document.createElement('input');
  title.placeholder = 'Document title'; title.setAttribute('aria-label', 'Document title');
  const text = document.createElement('textarea');
  text.rows = 12; text.style.width = '100%'; text.setAttribute('aria-label', 'Document draft');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = 'Editing requires separate approved write scopes and an enabled backend. Draft text alone is not a saved document.';
  const create = document.createElement('button'); create.textContent = 'Create as new document';
  const save = document.createElement('button'); save.textContent = 'Save / retry original write';
  const reconcile = document.createElement('button'); reconcile.textContent = 'Read server version for reconciliation';
  const recover = document.createElement('button'); recover.textContent = 'Recover local draft';
  const server = document.createElement('pre'); server.style.whiteSpace = 'pre-wrap';
  const adopt = document.createElement('button'); adopt.textContent = 'Use reviewed server version as save base'; adopt.disabled = true;
  panel.append(heading, title, text, create, save, reconcile, recover, status, server, adopt); root.append(panel);
  let selected, reviewed, busy = false, selection = 0;
  const storageKey = (session) => `ynx.docs.v2.pending.${session.account}`;
  function active() {
    const adapter = getAdapter();
    if (adapter?.client.current?.status !== 'connected') throw Error('Authorize a Docs session first.');
    return {adapter, state: adapter.client.current};
  }
  function persistDraft() {
    if (!text.value && !title.value) return;
    try { localStorage.setItem(`ynx.docs.v2.draft.${selected?.id || 'new'}`, JSON.stringify({name: title.value, content: text.value})); }
    catch { status.textContent = 'Draft storage unavailable. Keep this page open and copy your text before leaving.'; }
  }
  text.addEventListener('input', persistDraft); title.addEventListener('input', persistDraft);
  recover.onclick = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(`ynx.docs.v2.draft.${selected?.id || 'new'}`) || 'null');
      if (!draft || typeof draft.content !== 'string' || typeof draft.name !== 'string') throw Error('No valid local draft is available for this document.');
      if (!confirm('Restore this local draft into the editor? It will not be submitted to the server.')) return;
      title.value = draft.name; text.value = draft.content;
      status.textContent = 'Local draft restored. Review and explicitly save when ready.';
    } catch (error) { status.textContent = error.message; }
  };
  async function write(mode) {
    if (busy) return;
    busy = true; create.disabled = save.disabled = true;
    try {
      const {adapter, state} = active();
      const epoch = selection;
      if (!['docs.write', 'files.write'].every((scope) => state.session.scopes.includes(scope))) throw Error('Choose editing access and explicitly authorize the write scopes first.');
      const response = await fetch('/wallet-session-config.json', {cache: 'no-store', credentials: 'omit', redirect: 'error'});
      if (!response.ok || (await response.json()).apiWriteEnabled !== true) throw Error('Docs write API is not enabled on this deployment. Your draft is unchanged.');
      if (getAdapter() !== adapter || adapter.client.current !== state || selection !== epoch) return;
      const writer = createDocsWriteClient({adapter, origin});
      const key = storageKey(state.session);
      const stored = localStorage.getItem(key);
      let record = stored ? JSON.parse(stored) : null;
      if (record?.blocked) throw Error('Previous write outcome requires server readback and explicit reconciliation before another write.');
      if (record && !confirm('Retry the exact original write? Current draft edits will not replace its submitted body.')) return;
      if (!record) {
        if (mode === 'save' && !selected) throw Error('Open a document or create one first.');
        const operation = mode === 'create' ? writer.prepareCreate({name: title.value, content: text.value})
          : writer.prepareSave({id: selected.id, baseVersion: selected.version, content: text.value});
        record = {operation, content: text.value, blocked: false};
        // Persist before sending so reload retains the exact body and key.
        localStorage.setItem(key, JSON.stringify(record));
      }
      try {
        const result = await writer.send(writer.resumePrepared(record.operation));
        localStorage.removeItem(key);
        if (getAdapter() !== adapter || adapter.client.current !== state || selection !== epoch) return;
        selected = result.object;
        status.textContent = text.value === record.content ? `Saved version ${selected.version}${result.replayed ? ' (confirmed receipt replay)' : ''}.`
          : 'Original write confirmed. Newer text in your draft is still unsaved.';
      } catch (error) {
        if (error.reconciliationRequired || error.current) {
          record.blocked = true;
          if (error.current) record.current = error.current;
          localStorage.setItem(key, JSON.stringify(record));
        }
        throw error;
      }
    } catch (error) { status.textContent = error.message || 'Write unconfirmed. Your draft and request are retained.'; }
    finally { busy = false; create.disabled = save.disabled = false; }
  }
  create.onclick = () => write('create'); save.onclick = () => write('save');
  reconcile.onclick = async () => {
    if (busy) return;
    try {
      const {adapter, state} = active();
      const pending = JSON.parse(localStorage.getItem(storageKey(state.session)) || 'null');
      const id = pending?.current?.id || selected?.id;
      if (!id) throw Error('Creation outcome is unknown. Use the authorized document list to locate and read the actual document; do not create again blindly.');
      const epoch = selection;
      const result = await createDocsReadClient({adapter, origin}).open(id);
      if (getAdapter() !== adapter || adapter.client.current !== state || epoch !== selection) return;
      reviewed = {result, state, adapter}; server.textContent = result.content; adopt.disabled = false;
      status.textContent = `Server version ${result.metadata.version} read. Compare it with your draft before choosing a new save base.`;
    } catch (error) { status.textContent = error.message || 'Server readback failed.'; }
  };
  adopt.onclick = () => {
    try {
      const {adapter, state} = active();
      if (!reviewed || reviewed.adapter !== adapter || reviewed.state !== state) throw Error('Read the current server version again.');
      if (!confirm('Use this reviewed server version as the base of your next explicit save? Your local text is kept.')) return;
      selected = reviewed.result.metadata;
      localStorage.removeItem(storageKey(state.session));
      reviewed = null; adopt.disabled = true;
      status.textContent = 'Base version updated after review. Your draft is not saved until you explicitly save again.';
    } catch (error) { status.textContent = error.message; }
  };
  return {
    selectDocument(result) {
      if (busy || (text.value && !confirm('Open this document in the draft editor? Existing draft text remains in local device storage.'))) return;
      persistDraft(); selection++;
      selected = result.metadata; title.value = selected.name; text.value = result.content;
      try {
        const {adapter, state} = active();
        reviewed = {result, adapter, state}; server.textContent = result.content; adopt.disabled = false;
      } catch { reviewed = null; adopt.disabled = true; }
      status.textContent = `Opened version ${selected.version}. Saving requires editing authorization.`;
    },
  };
}
