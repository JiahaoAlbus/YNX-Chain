import {loadDocsBrowserSession, docsSessionBinding} from './product-session-client.js';
import {createDocsReadClient} from './product-session-read-client.js';

const status = document.querySelector('#session-status');
const begin = document.querySelector('#session-begin');
const end = document.querySelector('#session-end');
const retry = document.querySelector('#session-retry');
const launch = document.querySelector('#session-launch');
const callback = location.pathname === '/wallet-auth/callback';
let adapter;
let busy = false;
let completed = false;
let readGeneration = 0;
let readAbort;
const documents = document.createElement('section');
const listButton = document.createElement('button');
listButton.textContent = 'Load authorized documents (read only)';
listButton.disabled = true;
const readStatus = document.createElement('p');
readStatus.setAttribute('role', 'status');
const documentList = document.createElement('div');
const preview = document.createElement('pre');
preview.style.whiteSpace = 'pre-wrap';
preview.style.overflowWrap = 'anywhere';
documents.append(listButton, readStatus, documentList, preview);
document.querySelector('main').append(documents);

function clearReads() {
  readGeneration++;
  readAbort?.abort();
  documentList.replaceChildren();
  preview.textContent = '';
  listButton.disabled = true;
}

function render(state) {
  clearReads();
  listButton.disabled = state?.status !== 'connected';
  launch.hidden = true;
  launch.removeAttribute('href');
  status.textContent = state?.status === 'connected'
    ? 'Read-only Docs Product Session verified. Standard wallet connection and document API access are separate.'
    : 'Docs Product Session is not connected. You can explicitly start authorization or retry recovery.';
  end.disabled = state?.status !== 'connected';
  if (state?.status === 'connected') {
    completed = true;
    // SDK has persisted/verified the returned session before removing callback data.
    if (callback) history.replaceState(null, '', '/wallet-auth/callback');
  }
}

async function run(operation) {
  if (busy) return;
  busy = true;
  clearReads();
  begin.disabled = end.disabled = retry.disabled = true;
  launch.hidden = true;
  try { await operation(); }
  catch {
    status.textContent = 'Docs authorization could not be confirmed. Check deployment availability and retry. No legacy session was imported or substituted.';
  } finally {
    busy = false;
    begin.disabled = !adapter || callback;
    end.disabled = !adapter || adapter.client.current?.status !== 'connected';
    retry.disabled = false;
    listButton.disabled = adapter?.client.current?.status !== 'connected';
  }
}

async function readDocuments(parentId = '', cursor = '', previous = []) {
  if (busy || adapter?.client.current?.status !== 'connected') return;
  readAbort?.abort();
  readAbort = new AbortController();
  const signal = readAbort.signal;
  const generation = ++readGeneration;
  const session = adapter.client.current;
  let selectionAttempt = 0;
  const current = () => generation === readGeneration && adapter.client.current === session;
  listButton.disabled = true;
  documentList.replaceChildren();
  preview.textContent = '';
  try {
    const response = await fetch('/wallet-session-config.json', {cache: 'no-store', credentials: 'omit', redirect: 'error', signal});
    if (!response.ok) throw new Error('Docs API configuration is unavailable.');
    const config = await response.json();
    if (!current()) return;
    if (config.apiReadEnabled !== true) {
      readStatus.textContent = 'Docs v2 document API is not enabled on this deployment. No legacy API fallback was attempted.';
      return;
    }
    const reader = createDocsReadClient({adapter, origin: docsSessionBinding.origin});
    readStatus.textContent = 'Loading authorized documents...';
    const page = await reader.list({parentId, cursor, signal});
    const objects = page.items;
    if (!current()) return;
    if (parentId) {
      const root = document.createElement('button');
      root.textContent = 'All documents';
      root.onclick = () => readDocuments();
      documentList.append(root);
    }
    for (const object of objects) {
      const button = document.createElement('button');
      button.textContent = object.kind === 'folder' ? `Folder: ${object.name}` : object.name;
      button.onclick = async () => {
        if (!current()) return;
        if (object.kind === 'folder') return readDocuments(object.id);
        const selection = ++selectionAttempt;
        const selected = () => current() && selection === selectionAttempt;
        preview.textContent = '';
        try {
          const result = await reader.open(object.id, {signal});
          if (!selected()) return;
          preview.textContent = result.content;
          readStatus.textContent = `${result.metadata.name}: read-only content loaded.`;
        } catch (error) {
          if (selected()) readStatus.textContent = error.message || 'Document read failed.';
        }
      };
      documentList.append(button);
    }
    if (previous.length) {
      const back = document.createElement('button');
      back.textContent = 'Previous page';
      back.onclick = () => readDocuments(parentId, previous.at(-1), previous.slice(0, -1));
      documentList.append(back);
    }
    if (page.nextCursor) {
      const next = document.createElement('button');
      next.textContent = 'Next page';
      next.onclick = () => readDocuments(parentId, page.nextCursor, [...previous, cursor]);
      documentList.append(next);
    }
    readStatus.textContent = objects.length ? 'Choose a document or folder.' : page.nextCursor ? 'No documents on this page. More results may be available on the next page.' : 'No authorized documents on this page.';
  } catch (error) {
    if (current()) readStatus.textContent = error.message || 'Docs read failed. Retry when ready.';
  } finally {
    if (current()) listButton.disabled = false;
  }
}
listButton.addEventListener('click', () => readDocuments());

async function recover() {
  if (!adapter) adapter = await loadDocsBrowserSession();
  const state = callback && !completed
    ? await adapter.client.handleReturn(location.href)
    : await adapter.client.restore();
  render(state);
}

begin.addEventListener('click', () => run(async () => {
  const pending = await adapter.client.beginExplicit();
  render(pending);
  if (pending.route?.status === 'ready') {
    const url = new URL(pending.route.url);
    if (url.protocol !== 'ynxwallet:') throw new Error('Unsupported Wallet handoff');
    launch.href = url.href;
    launch.hidden = false;
    status.textContent = 'Request prepared; Wallet installation is unverified. Choose Open YNX Wallet to attempt opening it, then review and approve the read-only scopes only if you agree. Opening a link does not confirm authorization.';
  } else {
    status.textContent = 'A Wallet handoff could not be prepared. Retry when the authorization service is available. No installation or authorization was confirmed.';
  }
}));
end.addEventListener('click', () => run(async () => {
  const state = await adapter.client.disconnect();
  render(state);
  status.textContent = state?.status === 'disconnected'
    ? 'Docs Product Session disconnected. Standard wallet connection was not changed.'
    : 'Docs Product Session revocation is not confirmed. Retry recovery to reconcile the pending sign-out.';
}));
retry.addEventListener('click', () => run(recover));
window.addEventListener('pagehide', () => adapter?.close());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { adapter = undefined; run(recover); }
});
if (location.origin !== docsSessionBinding.origin) status.textContent = 'This page is outside the configured Docs application origin.';
else run(recover);
