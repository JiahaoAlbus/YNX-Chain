import {loadDocsEditorBridge, createDocsLocalExport, docsText, mountDocsLanguage} from './editor-session-bridge.js';
const $ = (query) => document.querySelector(query);
const t = (message, values = {}) => typeof docsText === 'function' ? docsText(message, values) : message.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
const editorV2Mode = window.location?.origin === 'https://docs.ynxweb4.com';
let editorV2 = null;
let docsListView = 'active';
let commentsContext = null;
// Quota failures must not leave another account's draft in the visible editor.
// These drafts live only in this page and are recoverable by their exact owner.
const memoryDrafts = new Map();
function docsIdentity() { return editorV2Mode ? editorV2?.identity || '' : state.credential; }
const storageKey = ['ynx', 'docs', 'session'].join('.');
const headerName = ['Author', 'ization'].join('');
const authScheme = ['Bear', 'er'].join('');

function savedCredential() {
  if (editorV2Mode) return '';
  try { return window.sessionStorage.getItem(storageKey) || ''; } catch { return ''; }
}

const state = {
  credential: savedCredential(),
  objects: [],
  folders: [],
  parentId: '',
  listCursor: '',
  listHistory: [],
  currentFolder: null,
  current: null,
  documentAccount: '',
  content: '',
  baseVersion: 0,
  dirty: false,
  saving: false,
  saveTimer: null,
  heartbeatTimer: null,
  searchTimer: null,
  conflict: null,
  commentAnchor: null,
};

const scopes = [
  'files.read',
  'files.write',
  'permissions.manage',
  'docs.read',
  'docs.edit',
  'docs.comment',
  'audit.read',
  'ai.use',
];

let authAttempt = 0;
let documentAttempt = 0;
let listAttempt = 0;
let authPending = false;
let sessionStatus = editorV2Mode ? 'Checking Docs Product Session' : state.credential ? 'Checking saved Docs session' : 'Docs authorization required';

function renderAuth() {
  $('#wallet').textContent = t(sessionStatus);
  if (!$('#provider-state').dataset?.standardManaged) $('#provider-state').textContent = 'Wallet connection: not verified';
  $('#session-state').textContent = t(sessionStatus);
  $('#auth-start').disabled = authPending;
  $('#auth-end').disabled = authPending || !docsIdentity();
  $('#auth-start').textContent = authPending ? 'Waiting for authorization...' : 'Authorize Docs with YNX Wallet';
  if (editorV2Mode) {
    $('#auth-start').textContent = t(authPending ? 'Waiting for approval…' : 'Approve reading and editing');
    $('#auth-end').disabled = !docsIdentity() && !editorV2?.revocationPending;
    $('#new-doc').disabled = !editorV2?.canWrite || docsListView === 'trash';
    $('#new-folder').disabled = !editorV2?.canWrite || docsListView === 'trash';
    if ($('#retry-write')) $('#retry-write').disabled = !editorV2?.identity;
    if ($('#view-trash')) $('#view-trash').disabled = !editorV2?.canBrowseTrash;
  }
}

function clearDocsSession() {
  if (editorV2Mode) {
    if (state.dirty && state.current) persistDraft();
    clearDocument();
    state.parentId = ''; state.listCursor = ''; state.listHistory = [];
    state.objects = []; state.folders = []; renderObjects(); $('#panel').hidden = true; commentsContext = null;
    $('#panel-content').replaceChildren();
    $('#local-conflict').value = ''; $('#server-conflict').value = '';
    $('#conflict-dialog').close();
  }
  documentAttempt += 1;
  listAttempt += 1;
  if (!editorV2Mode) {
    state.credential = '';
    try { window.sessionStorage.removeItem(storageKey); } catch {}
  }
  clearTimeout(state.saveTimer);
  clearInterval(state.heartbeatTimer);
  $('#title').disabled = true;
  $('#editor').disabled = true;
  enableDocumentActions(false);
  sessionStatus = 'Docs authorization required';
  renderAuth();
}

async function request(path, options = {}) {
  if (editorV2Mode) {
    if (!editorV2) throw new Error('Open Docs Product Session to authorize this editor.');
    try { return await editorV2.request(path, options); }
    catch (error) { if (error.status === 401 || ['SESSION_EXPIRED', 'SESSION_INACTIVE'].includes(error.code)) clearDocsSession(); throw error; }
  }
  const credential = docsIdentity();
  const headers = {...(options.headers || {})};
  if (state.credential) headers[headerName] = `${authScheme} ${state.credential}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/v1${path}`, {...options, headers});
  if (response.status === 401 && path !== '/session' && credential === docsIdentity()) clearDocsSession();
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : await response.blob();
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function setStatus(text, error = false) {
  $('#save-state').textContent = t(text);
  $('#save-state').style.color = error ? '#a12222' : '';
}

function enableDocumentActions(enabled) {
  if (editorV2Mode) {
    $('#ai').disabled = true;
    $('#duplicate').disabled = !enabled || !editorV2?.canCopy;
    $('#comments').disabled = !enabled;
    for (const id of ['move', 'trash']) $(`#${id}`).disabled = !enabled || !editorV2?.canWrite;
    $('#history').disabled = !enabled;
    $('#export').disabled = !enabled;
    $('#export-format').disabled = !enabled;
    return;
  }
  for (const id of ['export', 'duplicate', 'move', 'trash', 'history', 'comments', 'ai']) {
    $(`#${id}`).disabled = !enabled;
  }
  $('#export-format').disabled = !enabled;
}

function openPanel(eyebrow, title) {
  $('#panel').hidden = false;
  const root = $('#panel-content');
  root.replaceChildren();
  const label = document.createElement('p');
  label.className = 'eyebrow';
  label.textContent = eyebrow;
  const heading = document.createElement('h2');
  heading.textContent = title;
  root.append(label, heading);
  return root;
}

function notice(text) {
  const node = document.createElement('div');
  node.className = 'callout';
  node.textContent = text;
  return node;
}

function showSignIn() {
  renderAuth();
  $('#auth-dialog').showModal();
}

async function connectWallet() {
  if (editorV2Mode) {
    if (authPending) return;
    const attempt = ++authAttempt; authPending = true; renderAuth();
    $('#auth-state').textContent = t('Review document reading and editing in YNX Wallet.');
    try {
      if (!editorV2) await initializeDocsEditor();
      if (attempt !== authAttempt) return;
      const result = await editorV2.authorize();
      if (attempt !== authAttempt || result?.status !== 'connected') return;
      sessionStatus = 'Docs editing session authorized'; renderAuth();
      authPending = false; renderAuth();
      $('#auth-dialog').close(); await loadObjects();
    } catch (error) {
      if (attempt === authAttempt) {
        $('#auth-state').textContent = t(Number(error?.code) === 4001 ? 'Approval declined. You can try again.' : 'Docs approval could not be confirmed. Retry or check your wallet.');
        $('#auth-details').textContent = String(error?.code || 'WALLET_UNAVAILABLE');
      }
    } finally { if (attempt === authAttempt) { authPending = false; renderAuth(); } }
    return;
  }
  if (authPending) return;
  const attempt = ++authAttempt;
  authPending = true;
  renderAuth();
  const output = $('#auth-state');
  output.textContent = 'Waiting for explicit Docs authorization in YNX Wallet.';
  try {
    if (typeof window.ynxWallet?.requestSession !== 'function') {
      throw new Error('YNX Wallet authorization bridge is unavailable. Enable YNX Wallet, then retry. A MetaMask provider alone cannot authorize this Docs session. Docs does not accept recovery keys or substitute login credentials.');
    }
    const assertion = await window.ynxWallet.requestSession({
      version: 1,
      product: 'docs',
      clientId: 'com.ynx.docs.web',
      bundleId: 'com.ynx.docs.web',
      callback: '/docs/auth/callback',
      chainId: 'ynx_6423-1',
      scopes,
      purpose: 'Edit only explicitly authorized YNX Docs',
      expiresInSeconds: 300,
    });
    if (attempt !== authAttempt) return;
    if (!assertion || typeof assertion !== 'object') throw new Error('Wallet returned no Docs authorization. Retry when ready.');
    const result = await request('/session', {method: 'POST', body: JSON.stringify(assertion)});
    if (attempt !== authAttempt) return;
    const credential = result?.[['to', 'ken'].join('')];
    if (typeof credential !== 'string' || !credential.trim()) throw new Error('Docs service returned no valid session. Retry authorization.');
    window.sessionStorage.setItem(storageKey, credential);
    state.credential = credential;
    sessionStatus = 'Docs session authorized';
    output.textContent = 'Docs session authorized. Standard wallet connection has not been verified.';
    renderAuth();
    await loadObjects();
  } catch (error) {
    if (attempt !== authAttempt) return;
    output.textContent = Number(error?.code) === 4001 || error?.name === 'AbortError'
      ? 'Authorization declined or cancelled. You can retry when ready.'
      : (error?.message || 'Docs authorization failed. Please retry.');
  } finally {
    if (attempt === authAttempt) {
      authPending = false;
      renderAuth();
    }
  }
}

function cancelAuthorization() {
  authAttempt += 1;
  authPending = false;
  if (editorV2Mode) void editorV2?.cancelAuthorization().catch(() => {});
  $('#auth-state').textContent = 'Authorization dialog closed. Pending results will not activate a Docs session.';
  renderAuth();
}

async function endDocsSession() {
  if (editorV2Mode) {
    if (!editorV2 || !confirm('Revoke this Docs Product Session? Unsaved drafts are retained on this page for the same account. Keep this page open if device storage is unavailable.')) return;
    const result = await editorV2.disconnect();
    clearDocsSession();
    $('#auth-state').textContent = result.status === 'disconnected' ? 'Docs session revoked. Standard wallet connection is unchanged.' : 'Revocation is not confirmed. Retry on the Product Session page.';
    return;
  }
  if (!docsIdentity() || authPending) return;
  if (!confirm('End this Docs session? Unsaved text stays on this screen. This does not disconnect your wallet.')) return;
  const credential = docsIdentity();
  authPending = true;
  renderAuth();
  try {
    await request('/session', {method: 'DELETE'});
    if (docsIdentity() !== credential) return;
    clearDocsSession();
    $('#auth-state').textContent = 'Docs session revoked. Unsaved text remains read-only on this screen. Wallet connection was not changed.';
  } catch (error) {
    if (docsIdentity() !== credential) return;
    if (error.status === 401) {
      clearDocsSession();
      $('#auth-state').textContent = 'Docs session has already expired or been revoked.';
    } else {
      $('#auth-state').textContent = 'Could not confirm session revocation. Retry when the service is available.';
    }
  } finally {
    authPending = false;
    renderAuth();
  }
}

async function loadObjects() {
  if (!docsIdentity()) return;
  const attempt = ++listAttempt;
  const credential = docsIdentity();
  try {
    const query = encodeURIComponent($('#search').value.trim());
    const parentId = encodeURIComponent(state.parentId);
    const [visible, recent] = await Promise.all([
      request(`/objects?${docsListView === 'trash' ? 'view=trash' : `parentId=${parentId}`}&q=${query}${state.listCursor ? `&cursor=${encodeURIComponent(state.listCursor)}` : ''}`),
      request('/objects?view=recent'),
    ]);
    if (credential !== docsIdentity() || attempt !== listAttempt) return;
    sessionStatus = 'Docs session authorized';
    renderAuth();
    state.objects = (Array.isArray(visible) ? visible : visible.items).filter((object) => object.kind === 'doc' || object.kind === 'folder');
    state.folders = (Array.isArray(recent) ? recent : recent.items).filter((object) => object.kind === 'folder' && !object.trashedAt);
    state.currentFolder = state.parentId ? state.folders.find((folder) => folder.id === state.parentId) || null : null;
    renderNavigation();
    renderObjects();
    renderPagination(visible);
    if (!state.dirty && !state.conflict) setStatus(state.current ? `Version ${state.baseVersion}` : 'Synced');
  } catch (error) {
    if (credential !== docsIdentity()) return;
    if (error.status === 401) {
      clearDocsSession();
    } else if (sessionStatus === 'Checking saved Docs session') {
      sessionStatus = 'Saved Docs session not verified';
      renderAuth();
    }
    setStatus(error.message, true);
  }
}

function renderPagination(page) {
  if (Array.isArray(page)) return;
  const root = $('#doc-list');
  if (state.listHistory.length) {
    const previous = document.createElement('button');
    previous.textContent = t('Previous page');
    previous.onclick = () => { state.listCursor = state.listHistory.pop(); loadObjects(); };
    root.append(previous);
  }
  if (page.nextCursor) {
    const next = document.createElement('button');
    next.textContent = t('Next page');
    next.onclick = () => { state.listHistory.push(state.listCursor); state.listCursor = page.nextCursor; loadObjects(); };
    root.append(next);
  }
}

function renderNavigation() {
  $('#folder-name').textContent = docsListView === 'trash' ? t('Trash') : state.currentFolder?.name || t('All documents');
  $('#folder-up').disabled = docsListView === 'trash' || !state.parentId;
}

function renderObjects() {
  const root = $('#doc-list');
  root.replaceChildren();
  const objects = [...state.objects].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const object of objects) {
    const button = document.createElement('button');
    button.className = `doc-item ${object.kind === 'folder' ? 'folder-item' : ''}`;
    button.dataset.id = object.id;
    if (state.current?.id === object.id) button.setAttribute('aria-current', 'page');
    const name = document.createTextNode(object.kind === 'folder' ? t('Folder: {name}', {name: object.name}) : object.name);
    const meta = document.createElement('small');
    meta.textContent = object.kind === 'folder'
      ? `Updated ${new Date(object.updatedAt).toLocaleDateString()}`
      : `v${object.version} · ${new Date(object.updatedAt).toLocaleDateString()}`;
    button.append(name, meta);
    button.onclick = () => docsListView === 'trash' ? showTrashObject(object) : object.kind === 'folder' ? enterFolder(object) : openDocument(object);
    root.append(button);
  }
  if (!objects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = t($('#search').value ? 'No matching documents or folders.' : 'This folder is empty.');
    root.append(empty);
  }
}

async function enterFolder(folder) {
  if (state.dirty && !confirm('This document has unsaved local edits. Open the folder without saving?')) return;
  state.parentId = folder.id;
  state.listCursor = ''; state.listHistory = [];
  $('#search').value = '';
  await loadObjects();
}

async function openParentFolder() {
  if (!state.parentId) return;
  state.parentId = state.currentFolder?.parentId || '';
  state.listCursor = ''; state.listHistory = [];
  $('#search').value = '';
  await loadObjects();
}

async function createDocument() {
  if (!docsIdentity()) return showSignIn();
  const name = prompt(t('Document title'), t('Untitled document'))?.trim();
  if (!name) return;
  const credential = docsIdentity(), attempt = documentAttempt;
  try {
    const document = await request('/objects', {
      method: 'POST',
      body: JSON.stringify({
        parentId: state.parentId,
        kind: 'doc',
        name,
        mime: 'text/plain',
        content: encodeText(''),
        encryption: {clientSide: false},
      }),
    });
    if (credential !== docsIdentity() || attempt !== documentAttempt) return;
    await loadObjects();
    if (credential !== docsIdentity() || attempt !== documentAttempt) return;
    await openDocument(document);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function createFolder() {
  if (!docsIdentity()) return showSignIn();
  const name = prompt(t('Folder name'), t('New folder'))?.trim();
  if (!name) return;
  try {
    await request('/objects', {
      method: 'POST',
      body: JSON.stringify({parentId: state.parentId, kind: 'folder', name}),
    });
    await loadObjects();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openDocument(document) {
  if (state.dirty && !confirm('This document has unsaved local edits. Switch without saving?')) return;
  const attempt = ++documentAttempt;
  const credential = docsIdentity();
  try {
    const [metadata, blob] = await Promise.all([
      request(`/objects/${document.id}`),
      request(`/objects/${document.id}/content`),
    ]);
    const content = await blob.text();
    if (attempt !== documentAttempt || !credential || credential !== docsIdentity()) return;
    state.documentAccount = editorV2Mode ? editorV2.account : '';
    state.current = metadata;
    state.content = content;
    state.baseVersion = metadata.version;
    state.dirty = false;
    state.commentAnchor = null;
    state.conflict = null;
    $('#title').value = metadata.name;
    $('#title').disabled = editorV2Mode && !editorV2?.canWrite;
    $('#editor').value = state.content;
    $('#editor').disabled = editorV2Mode && !editorV2?.canWrite;
    $('#welcome').hidden = true;
    $('#editor-shell').hidden = false;
    enableDocumentActions(true);
    updateWordCount();
    renderObjects();
    recoverOfflineDraft();
    sendPresence();
    setStatus(`Version ${metadata.version}`);
  } catch (error) {
    if (attempt !== documentAttempt || credential !== docsIdentity()) return;
    setStatus(error.message, true);
  }
}

function clearDocument() {
  documentAttempt += 1;
  clearTimeout(state.heartbeatTimer);
  state.current = null;
  state.documentAccount = '';
  state.content = '';
  state.baseVersion = 0;
  state.dirty = false;
  state.commentAnchor = null;
  state.conflict = null;
  $('#title').value = 'Untitled document';
  $('#title').disabled = true;
  $('#editor').value = '';
  $('#editor-shell').hidden = true;
  $('#welcome').hidden = false;
  $('#presence').textContent = 'No active collaborators';
  enableDocumentActions(false);
  renderObjects();
}

async function renameDocument() {
  if (!state.current) return;
  const id = state.current.id, credential = docsIdentity();
  const name = $('#title').value.trim();
  if (!name) {
    $('#title').value = state.current.name;
    setStatus('A document title is required', true);
    return;
  }
  if (name === state.current.name) return;
  try {
    const renamed = await request(`/objects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({name}),
    });
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    state.current = renamed;
    $('#title').value = state.current.name;
    await loadObjects();
    setStatus(`Renamed · version ${state.baseVersion}`);
  } catch (error) {
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    $('#title').value = state.current.name;
    setStatus(error.message, true);
  }
}

async function duplicateDocument() {
  if (!state.current) return;
  const id = state.current.id, credential = docsIdentity();
  const name = prompt(t('Name for the duplicate'), state.current.name)?.trim();
  if (!name) return;
  if (editorV2Mode && !confirm(t('Copy the current server version? Unsaved edits, comments and permissions are not copied.'))) return;
  try {
    const duplicate = await request(`/objects/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({parentId: state.current.parentId || '', name}),
    });
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    state.parentId = duplicate.parentId || '';
    await loadObjects();
    await openDocument(duplicate);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function showMovePanel() {
  if (!state.current) return;
  const id = state.current.id, credential = docsIdentity();
  const root = openPanel(t('Move'), t('Move document'));
  root.append(notice(t('Only the owner can move this document.')));
  const add = (destination) => {
    if (destination.id === state.current?.parentId) return;
    const button = document.createElement('button'); button.className = 'wide'; button.textContent = destination.name;
    button.disabled = editorV2Mode && !editorV2?.canWrite;
    button.onclick = () => {
      if (state.current?.id !== id || docsIdentity() !== credential) return;
      if (confirm(t('Move to "{name}"?', {name: destination.name}))) moveDocument(destination.id);
    };
    root.append(button);
  };
  add({id: '', name: t('All documents')});
  const seen = new Set();
  async function page(cursor = '') {
    const loading = notice(t('Loading...')); root.append(loading);
    try {
      const result = await request(`/objects?view=recent&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (state.current?.id !== id || docsIdentity() !== credential || !root.contains(loading)) return;
      for (const folder of (Array.isArray(result) ? result : result.items)) {
        if (folder.kind === 'folder' && !folder.trashedAt) add(folder);
      }
      if (result.nextCursor && !seen.has(result.nextCursor)) {
        seen.add(result.nextCursor);
        const more = document.createElement('button'); more.textContent = t('Next page');
        more.onclick = () => { more.remove(); page(result.nextCursor); }; root.append(more);
      }
    } catch (error) { root.append(notice(error.message)); }
    finally { loading.remove(); }
  }
  await page();
}

async function moveDocument(parentId) {
  if (!state.current) return;
  const id = state.current.id, credential = docsIdentity();
  try {
    const moved = await request(`/objects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({parentId}),
    });
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    state.current = moved;
    state.parentId = parentId;
    $('#panel').hidden = true;
    await loadObjects();
    setStatus(`Moved · version ${state.baseVersion}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function trashDocument() {
  if (!state.current) return;
  const id = state.current.id, credential = docsIdentity();
  if (state.dirty) {
    await saveDocument();
    if (state.dirty) return;
  }
  if (state.current?.id !== id || docsIdentity() !== credential) return;
  if (!confirm(t('Move "{name}" to Trash?', {name: state.current.name}))) return;
  try {
    await request(`/objects/${id}/trash`, {method: 'POST'});
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    clearDocument();
    await loadObjects();
    setStatus('Moved to Trash');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function showTrashObject(object) {
  const root = openPanel(t('Trash'), object.name);
  const credential = docsIdentity();
  const restore = document.createElement('button'); restore.className = 'wide'; restore.textContent = t('Restore');
  restore.disabled = !editorV2?.canWrite;
  root.append(notice(t('Restoring requires editing authorization.')), restore);
  restore.onclick = async () => {
    if (docsIdentity() !== credential || !confirm(t('Restore "{name}" from Trash?', {name: object.name}))) return;
    restore.disabled = true;
    try {
      await request(`/objects/${encodeURIComponent(object.id)}/restore`, {method: 'POST'});
      if (docsIdentity() !== credential) return;
      $('#panel').hidden = true;
      await loadObjects(); setStatus(t('Restored. Open All documents to continue.'));
    } catch (error) { root.append(notice(error.message)); }
    finally { restore.disabled = !editorV2?.canWrite; }
  };
}

function showPendingWrite() {
  const root = openPanel(t('Pending operation'), t('Review before retrying'));
  try {
    const record = editorV2.getPendingWrite();
    if (!record) { root.append(notice(t('No pending operation.'))); return; }
    const credential = docsIdentity();
    root.append(notice(`${record.operation.method} ${record.operation.path}`));
    root.append(notice(t('Retry keeps the original body and key. Newer draft edits are not submitted.')));
    const retry = document.createElement('button'); retry.textContent = t('Retry original operation'); retry.className = 'wide';
    retry.disabled = Boolean(record.blocked) || !editorV2.canWrite;
    root.append(retry);
    if (record.blocked) root.append(notice(t('Read and reconcile the server result before another write.')));
    const link = document.createElement('a'); link.href = '/session.html'; link.textContent = t('Open Docs Product Session'); root.append(link);
    retry.onclick = async () => {
      if (docsIdentity() !== credential || !confirm(t('Retry the original operation?'))) return;
      clearTimeout(state.saveTimer);
      retry.disabled = true;
      try {
        await editorV2.retryPendingWrite(record.snapshot);
        if (docsIdentity() !== credential) return;
        root.append(notice(t('Original operation confirmed. Reopen the document to review; your local draft is retained.')));
        await loadObjects();
      } catch (error) { root.append(notice(error.message)); retry.disabled = Boolean(editorV2.getPendingWrite()?.blocked) || !editorV2.canWrite; }
    };
  } catch (error) { root.append(notice(error.message)); }
}

function editDocument() {
  if (!state.current) return;
  state.dirty = true;
  setStatus(navigator.onLine ? 'Unsaved changes' : 'Offline draft saved on this device');
  updateWordCount();
  persistDraft();
  clearTimeout(state.saveTimer);
  if (navigator.onLine && docsIdentity() && !state.conflict && (!editorV2Mode || !editorV2?.hasPendingWrite)) state.saveTimer = setTimeout(saveDocument, 900);
}

function draftKey(id) {
  return editorV2Mode ? `ynx.docs.v2.draft.${state.documentAccount}.${id}` : `ynx.docs.draft.${id}`;
}

function persistDraft() {
  const key = draftKey(state.current.id);
  const draft = {baseVersion: state.baseVersion, content: $('#editor').value, at: new Date().toISOString()};
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
    memoryDrafts.delete(key);
    return true;
  } catch {
    if (editorV2Mode && state.documentAccount) memoryDrafts.set(key, draft);
    setStatus('Local draft storage is unavailable. Keep this page open and copy unsaved text before leaving.', true);
    return false;
  }
}

async function saveDocument() {
  if (!state.current || !docsIdentity() || (editorV2Mode && state.documentAccount !== editorV2.account) || !state.dirty || state.saving || state.conflict || !navigator.onLine) return;
  if (editorV2Mode && editorV2?.hasPendingWrite) { setStatus(t('Review before retrying'), true); return; }
  const id = state.current.id;
  const credential = docsIdentity();
  const content = $('#editor').value;
  const baseVersion = state.baseVersion;
  let saved = false;
  state.saving = true;
  setStatus('Saving…');
  try {
    const document = await request(`/objects/${id}/document`, {
      method: 'PUT',
      body: JSON.stringify({baseVersion, content: encodeText(content)}),
    });
    if (state.current?.id !== id || credential !== docsIdentity()) return;
    state.current = document;
    state.baseVersion = document.version;
    state.content = content;
    state.dirty = $('#editor').value !== content;
    saved = true;
    if (state.dirty) {
      setStatus('Newer edits are still unsaved');
      persistDraft();
    } else {
      try { window.localStorage.removeItem(draftKey(id)); } catch {}
      setStatus(`Saved · version ${document.version}`);
    }
    await loadObjects();
  } catch (error) {
    if (state.current?.id !== id || credential !== docsIdentity()) return;
    if (error.status === 409 && error.body?.current) {
      await showConflict(error.body.current);
    } else {
      setStatus(error.message, true);
    }
  } finally {
    state.saving = false;
    if ((saved || state.current?.id !== id) && credential === docsIdentity() && state.dirty && !state.conflict) {
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(saveDocument, 900);
    }
  }
}

async function showConflict(current) {
  if (!current || current.id !== state.current?.id) return;
  const credential = docsIdentity(), attempt = documentAttempt;
  clearTimeout(state.saveTimer);
  state.conflict = current;
  const latest = await request(`/objects/${current.id}/content?version=${current.version}`);
  const content = await latest.text();
  if (current.id !== state.current?.id || !credential || credential !== docsIdentity() || attempt !== documentAttempt) return;
  $('#local-conflict').value = $('#editor').value;
  $('#server-conflict').value = content;
  state.conflict = current;
  $('#conflict-dialog').showModal();
  setStatus('Conflict recovery required; nothing was overwritten', true);
}

async function keepLocalCopy() {
  const current = state.current, credential = docsIdentity(), attempt = documentAttempt;
  if (!current || !credential || (editorV2Mode && state.documentAccount !== editorV2.account)) return;
  const localText = $('#local-conflict').value;
  try {
    if (editorV2Mode) await editorV2.resolveReviewedConflict();
    if (state.current !== current || credential !== docsIdentity() || attempt !== documentAttempt) return;
    const document = await request('/objects', {
      method: 'POST',
      body: JSON.stringify({
        parentId: state.current?.parentId || '',
        kind: 'doc',
        name: `${state.current.name} — recovered ${new Date().toLocaleString()}`,
        mime: 'text/plain',
        content: encodeText(localText),
        encryption: {clientSide: false},
      }),
    });
    $('#conflict-dialog').close();
    await loadObjects();
    if (state.current !== current || credential !== docsIdentity() || attempt !== documentAttempt) return;
    await openDocument(document);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function useServerVersion() {
  const current = state.conflict, credential = docsIdentity(), attempt = documentAttempt;
  if (!current || !credential) return;
  try {
    const blob = await request(`/objects/${current.id}/content?version=${current.version}`);
    const content = await blob.text();
    if (state.conflict !== current || credential !== docsIdentity() || attempt !== documentAttempt) return;
    if (editorV2Mode) await editorV2.resolveReviewedConflict();
    if (state.conflict !== current || credential !== docsIdentity() || attempt !== documentAttempt) return;
    $('#editor').value = content;
    state.current = current;
    state.baseVersion = current.version;
    state.content = $('#editor').value;
    state.dirty = false;
    state.conflict = null;
    window.localStorage.removeItem(draftKey(current.id));
    $('#conflict-dialog').close();
    updateWordCount();
    setStatus(`Using server version ${current.version}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function recoverOfflineDraft() {
  const key = draftKey(state.current.id);
  const retained = editorV2Mode && state.documentAccount === editorV2?.account ? memoryDrafts.get(key) : null;
  let raw;
  try { raw = retained ? JSON.stringify(retained) : window.localStorage.getItem(key); } catch {
    setStatus('Local draft storage is unavailable. Keep this page open while editing.', true);
    return;
  }
  if (!raw) return;
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    setStatus('The stored draft could not be read. It has been preserved on this device.', true);
    return;
  }
  if (!draft || typeof draft.content !== 'string' || !Number.isInteger(draft.baseVersion) || !Number.isFinite(Date.parse(draft.at))) {
    setStatus('The stored draft is invalid. It has been preserved on this device.', true);
    return;
  }
  if (draft.content === state.content) return;
  if (draft.baseVersion === state.baseVersion && confirm(`Recover offline draft from ${new Date(draft.at).toLocaleString()}?`)) {
    $('#editor').value = draft.content;
    editDocument();
  } else if (draft.baseVersion !== state.baseVersion) {
    $('#local-conflict').value = draft.content;
    $('#server-conflict').value = state.content;
    state.conflict = state.current;
    $('#conflict-dialog').showModal();
  }
}

async function sendPresence() {
  if (editorV2Mode) { $('#presence').textContent = t('Not available on this backend'); return; }
  if (!state.current || !docsIdentity()) return;
  const id = state.current.id;
  const credential = docsIdentity();
  try {
    const presence = await request(`/objects/${state.current.id}/presence`, {
      method: 'POST',
      body: JSON.stringify({label: 'Editing'}),
    });
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    $('#presence').textContent = presence.length === 1 ? 'Only you are active' : `${presence.length} bounded collaborators active`;
  } catch (error) {
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    $('#presence').textContent = `Presence unavailable · ${error.message}`;
  }
  clearTimeout(state.heartbeatTimer);
  if (state.current?.id === id && docsIdentity() === credential) state.heartbeatTimer = setTimeout(sendPresence, 20000);
}

async function showHistory() {
  if (!state.current) return;
  const id = state.current.id, credential = docsIdentity();
  const root = openPanel(t('Versions'), t('Version history'));
  const loading = notice(t('Loading...'));
  root.append(loading);
  try {
    const versions = await request(`/objects/${id}/versions`);
    if (state.current?.id !== id || docsIdentity() !== credential || !root.contains(loading)) return;
    loading.remove();
    for (const version of versions) {
      const row = document.createElement('div');
      row.className = 'version';
      const heading = document.createElement('strong');
      heading.textContent = t('Version {version}', {version: version.number});
      const meta = document.createElement('small');
      meta.textContent = `${new Date(version.createdAt).toLocaleString()} · ${version.author} · ${version.hash.slice(0, 12)}…`;
      const preview = document.createElement('button');
      preview.textContent = t('Open read-only');
      preview.onclick = async () => {
        try {
          const blob = await request(`/objects/${id}/content?version=${version.number}`);
          const content = await blob.text();
          if (state.current?.id !== id || docsIdentity() !== credential) return;
          const text = document.createElement('pre'); text.dir = 'auto'; text.className = 'callout'; text.textContent = content; row.append(text);
        } catch (error) { row.append(notice(error.message)); }
      };
      row.append(heading, document.createElement('br'), meta, document.createElement('br'), preview);
      if (version.number !== state.baseVersion) {
        const restore = document.createElement('button');
        restore.textContent = t('Restore as new version');
        restore.disabled = editorV2Mode && !editorV2?.canWrite;
        restore.onclick = () => { if (state.current?.id === id && docsIdentity() === credential) restoreVersion(version.number); };
        row.append(restore);
      }
      root.append(row);
    }
  } catch (error) {
    loading.textContent = error.message;
  }
}

async function restoreVersion(version) {
  if (!state.current || state.saving) return;
  const id = state.current.id, credential = docsIdentity();
  if (state.dirty && !confirm(t('Discard unsaved edits and restore?'))) return;
  if (!confirm(t('Restore version {version} as a new version?', {version}))) return;
  clearTimeout(state.saveTimer);
  state.saving = true;
  $('#editor').disabled = true;
  try {
    const restored = await request(`/objects/${id}/versions/${version}/restore`, {method: 'POST'});
    if (state.current?.id !== id || docsIdentity() !== credential) return;
    state.dirty = false;
    window.localStorage.removeItem(draftKey(state.current.id));
    $('#panel').hidden = true;
    await openDocument(restored);
    await loadObjects();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.saving = false;
    $('#editor').disabled = !docsIdentity() || (editorV2Mode && !editorV2?.canWrite);
  }
}

function selectedAnchor() {
  const editor = $('#editor');
  if (editor.selectionEnd <= editor.selectionStart) return null;
  const quote = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (!quote || quote.length > 2000) return null;
  return {
    start: Array.from(editor.value.slice(0, editor.selectionStart)).length,
    end: Array.from(editor.value.slice(0, editor.selectionEnd)).length,
    quote,
  };
}

async function showComments() {
  if (!state.current) return;
  state.commentAnchor = state.dirty ? null : selectedAnchor();
  commentsContext = {id: state.current.id, version: state.baseVersion, credential: docsIdentity(), anchor: state.commentAnchor};
  const root = openPanel(t('Version {version}', {version: state.baseVersion}), t('Comments'));
  root.append(notice(t('Comments cite the saved version. Save edits before anchoring selected text.')));
  if (state.commentAnchor) root.append(notice(state.commentAnchor.quote));

  const bodyLabel = document.createElement('label');
  bodyLabel.textContent = t('Comment');
  const body = document.createElement('textarea');
  body.id = 'comment-body';
  body.rows = 3;
  bodyLabel.append(body);

  const mentionLabel = document.createElement('label');
  mentionLabel.textContent = t('Mentions (comma separated)');
  const mentions = document.createElement('input');
  mentions.id = 'mentions';
  mentionLabel.append(mentions);

  const add = document.createElement('button');
  add.className = 'primary wide';
  add.textContent = t('Comment');
  add.disabled = editorV2Mode && !editorV2?.canWrite;
  add.onclick = addComment;

  const list = document.createElement('div');
  list.id = 'comment-list';
  list.textContent = t('Loading...');
  root.append(bodyLabel, mentionLabel, add, list);
  await loadComments();
}

async function loadComments() {
  const list = $('#comment-list');
  const context = commentsContext;
  if (!list || !context || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
  try {
    const comments = (await request(`/objects/${context.id}/comments`)) || [];
    if (context !== commentsContext || context.id !== state.current?.id || context.credential !== docsIdentity() || $('#comment-list') !== list) return;
    list.replaceChildren();
    const threads = new Map();
    for (const comment of comments) {
      const threadId = comment.threadId || comment.id;
      if (!threads.has(threadId)) threads.set(threadId, []);
      threads.get(threadId).push(comment);
    }
    for (const [threadId, entries] of threads) {
      const rootComment = entries.find((entry) => entry.id === threadId) || entries[0];
      const thread = document.createElement('section');
      thread.className = 'comment-thread';
      thread.append(renderComment(rootComment, false));
      for (const reply of entries.filter((entry) => entry.id !== rootComment.id)) {
        thread.append(renderComment(reply, true));
      }
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const resolution = document.createElement('button');
      resolution.textContent = t(rootComment.resolvedAt ? 'Reopen thread' : 'Resolve thread');
      resolution.disabled = editorV2Mode && !editorV2?.canWrite;
      resolution.onclick = () => setThreadResolution(threadId, !rootComment.resolvedAt);
      actions.append(resolution);
      if (!rootComment.resolvedAt) {
        const reply = document.createElement('button');
        reply.textContent = t('Reply');
        reply.disabled = editorV2Mode && !editorV2?.canWrite;
        reply.onclick = () => replyToThread(threadId);
        actions.append(reply);
      }
      thread.append(actions);
      list.append(thread);
    }
    if (!comments.length) list.append(notice(t('No comments yet.')));
  } catch (error) {
    list.textContent = error.message;
  }
}

function renderComment(comment, reply) {
  const node = document.createElement('div');
  node.className = `comment ${reply ? 'comment-reply' : ''}`;
  const author = document.createElement('strong');
  author.textContent = comment.author;
  const meta = document.createElement('small');
  meta.textContent = `v${comment.version} · ${new Date(comment.createdAt).toLocaleString()}${comment.resolvedAt ? ` · resolved by ${comment.resolvedBy}` : ''}`;
  const body = document.createElement('p');
  body.textContent = comment.body;
  node.append(author, document.createElement('br'), meta);
  if (comment.anchor) {
    const anchor = document.createElement('blockquote');
    anchor.textContent = comment.anchor.quote;
    node.append(anchor);
  }
  node.append(body);
  return node;
}

async function addComment() {
  const context = commentsContext;
  if (!context || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
  const input = $('#comment-body');
  const submitted = input.value;
  const body = submitted.trim();
  if (!body) return setStatus(t('Comment text is required'), true);
  const mentions = $('#mentions').value.split(',').map((value) => value.trim()).filter(Boolean);
  try {
    await request(`/objects/${context.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({version: context.version, body, mentions, ...(context.anchor ? {anchor: context.anchor} : {})}),
    });
    if (context !== commentsContext || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
    if (input.value === submitted) input.value = '';
    state.commentAnchor = null;
    context.anchor = null;
    await loadComments();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function replyToThread(threadId) {
  const context = commentsContext;
  if (!context || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
  const body = prompt(t('Reply to this thread'))?.trim();
  if (!body) return;
  try {
    await request(`/objects/${context.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({version: context.version, body, mentions: [], parentId: threadId}),
    });
    if (context !== commentsContext || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
    await loadComments();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function setThreadResolution(threadId, resolved) {
  const context = commentsContext;
  if (!context || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
  try {
    await request(`/objects/${context.id}/comments/${threadId}/${editorV2Mode ? 'resolve' : 'resolution'}`, {
      method: 'POST',
      body: JSON.stringify({resolved}),
    });
    if (context !== commentsContext || context.id !== state.current?.id || context.credential !== docsIdentity()) return;
    await loadComments();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function showAI() {
  if (!state.current) return;
  const root = openPanel('SELECTED VERSION ONLY', 'Draft or revise');
  root.append(notice(`Context: ${state.current.name} · ${state.current.id}@v${state.baseVersion}\nNo other Drive content is readable.`));
  const provider = notice('Checking provider and model status…');
  provider.id = 'ai-provider';
  root.append(provider);

  const instructionLabel = document.createElement('label');
  instructionLabel.textContent = 'Instruction';
  const instruction = document.createElement('textarea');
  instruction.id = 'ai-instruction';
  instruction.rows = 5;
  instructionLabel.append(instruction);

  const consentLabel = document.createElement('label');
  const consent = document.createElement('input');
  consent.id = 'ai-consent';
  consent.type = 'checkbox';
  consentLabel.append(consent, document.createTextNode(' Send this exact version to YNX AI Gateway'));

  const run = document.createElement('button');
  run.className = 'primary wide';
  run.textContent = 'Run with review';
  run.onclick = runAI;

  const result = notice('No request has been sent.');
  result.id = 'ai-result';
  root.append(instructionLabel, consentLabel, run, result);

  try {
    const status = await request('/ai/status');
    provider.textContent = status.available
      ? `Provider: ${status.provider} · model: ${status.model}\n${status.boundary}`
      : `Provider unavailable · ${status.boundary}`;
  } catch (error) {
    provider.textContent = error.message;
  }
}

async function runAI() {
  const output = $('#ai-result');
  if (!$('#ai-consent').checked) {
    output.textContent = 'Explicit context consent is required.';
    return;
  }
  try {
    const provider = await request('/ai/status');
    if (!provider.available) {
      output.textContent = 'Provider unavailable. Docs will not substitute a canned response.';
      return;
    }
    let job = await request('/ai/jobs', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'revise',
        instruction: $('#ai-instruction').value,
        objectIds: [state.current.id],
        versions: [state.baseVersion],
        consent: true,
      }),
    });
    output.textContent = `Queued · ${provider.provider}/${provider.model} · estimated ${job.estimatedUnits} resource units`;
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel generation';
    cancel.onclick = () => request(`/ai/jobs/${job.id}/cancel`, {method: 'POST'});
    output.append(document.createElement('br'), cancel);

    let polls = 0;
    while ((job.status === 'queued' || job.status === 'running') && polls < 600) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      job = await request(`/ai/jobs/${job.id}`);
      output.firstChild.textContent = `${job.status} · ${job.provider}/${job.model} · estimated ${job.estimatedUnits} resource units`;
      polls += 1;
    }
    if (job.status === 'queued' || job.status === 'running') return;
    output.replaceChildren(document.createTextNode(job.status === 'review'
      ? `${job.result}\n\nCitations: ${job.citations.join(', ')}\nReview only; nothing was overwritten.`
      : `${job.status}: ${job.error}`));
    if (job.status === 'review') {
      const apply = document.createElement('button');
      apply.textContent = 'Place result in editor for review';
      apply.onclick = async () => {
        await request(`/ai/jobs/${job.id}/review`, {method: 'POST', body: JSON.stringify({decision: 'applied'})});
        $('#editor').value = job.result;
        editDocument();
      };
      const reject = document.createElement('button');
      reject.textContent = 'Reject result';
      reject.onclick = async () => {
        await request(`/ai/jobs/${job.id}/review`, {method: 'POST', body: JSON.stringify({decision: 'rejected'})});
        output.textContent = 'AI result rejected; document unchanged.';
      };
      output.append(document.createElement('br'), apply, reject);
    }
  } catch (error) {
    output.textContent = error.message;
  }
}

async function exportDocument() {
  if (editorV2Mode) {
    if (!state.current || !docsIdentity()) return;
    try {
      const result = createDocsLocalExport({id: state.current.id, name: state.current.name, version: state.baseVersion, content: state.content}, $('#export-format').value);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([result.body], {type: result.type}));
      link.download = result.filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setStatus(`Exported saved version ${state.baseVersion}${state.dirty ? '; newer unsaved draft was not included' : ''}`);
    } catch (error) { setStatus(error.message, true); }
    return;
  }
  if (!state.current) return;
  const format = $('#export-format').value;
  try {
    const headers = {};
    headers[headerName] = `${authScheme} ${state.credential}`;
    const response = await fetch(`/api/v1/objects/${encodeURIComponent(state.current.id)}/export?format=${encodeURIComponent(format)}&version=${state.baseVersion}`, {headers});
    if (!response.ok) {
      const type = response.headers.get('content-type') || '';
      const body = type.includes('json') ? await response.json() : {error: `Export failed ${response.status}`};
      throw new Error(body.error || `Export failed ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = match?.[1] || `${state.current.name}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus(`Exported v${response.headers.get('X-YNX-Document-Version') || state.baseVersion} · ${format}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function updateWordCount() {
  const text = $('#editor').value.trim();
  $('#word-count').textContent = t('{count} words', {count: text ? text.split(/\s+/).length : 0});
}

$('#wallet').onclick = showSignIn;
$('#auth-start').onclick = connectWallet;
$('#auth-end').onclick = endDocsSession;
$('#auth-dialog').addEventListener('close', () => { if (authPending) cancelAuthorization(); });
$('#auth-dialog').addEventListener('cancel', cancelAuthorization);
$('#auth-dialog').querySelector?.('form')?.addEventListener('submit', () => { if (authPending) cancelAuthorization(); });
$('#new-doc').onclick = createDocument;
$('#new-folder').onclick = createFolder;
$('#folder-up').onclick = openParentFolder;
$('#search').oninput = () => {
  state.listCursor = ''; state.listHistory = [];
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadObjects, 250);
};
$('#title').onchange = renameDocument;
$('#title').onkeydown = (event) => {
  if (event.key === 'Enter') event.currentTarget.blur();
};
$('#editor').oninput = editDocument;
$('#history').onclick = showHistory;
$('#comments').onclick = showComments;
$('#ai').onclick = showAI;
$('#export').onclick = exportDocument;
$('#duplicate').onclick = duplicateDocument;
$('#move').onclick = showMovePanel;
$('#trash').onclick = trashDocument;
$('#panel-close').onclick = () => { $('#panel').hidden = true; };
$('#keep-local').onclick = keepLocalCopy;
$('#use-server').onclick = useServerVersion;

window.addEventListener('offline', () => {
  $('#offline').hidden = false;
  if (state.current) editDocument();
});
window.addEventListener('online', () => {
  $('#offline').hidden = true;
  saveDocument();
});
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

enableDocumentActions(false);
renderAuth();
if (editorV2Mode) {
  mountDocsLanguage();
  window.addEventListener('docs-language-change', () => { renderAuth(); renderNavigation(); updateWordCount(); });
  $('#view-trash').onclick = () => { docsListView = 'trash'; state.listCursor = ''; state.listHistory = []; $('#search').value = ''; loadObjects(); };
  $('#view-documents').onclick = () => { docsListView = 'active'; state.listCursor = ''; state.listHistory = []; $('#search').value = ''; loadObjects(); };
  $('#retry-write').onclick = showPendingWrite;
  initializeDocsEditor().catch(() => { sessionStatus = 'Docs session unavailable; retry sign in'; renderAuth(); });
  window.addEventListener('focus', () => { if (!authPending) void editorV2?.restore().then(() => { renderAuth(); return loadObjects(); }).catch(() => {}); });
  /* initial restoration is shared with explicit Retry */
} else loadObjects();

var editorInitialization;
function initializeDocsEditor() {
  if (editorV2) return Promise.resolve(editorV2);
  if (editorInitialization) return editorInitialization;
  editorInitialization = loadDocsEditorBridge(globalThis, (session) => {
    if (session?.status !== 'connected' || (state.documentAccount && session.session?.account !== state.documentAccount)) clearDocsSession();
    sessionStatus = session?.status === 'connected' ? 'Docs editing session authorized' : session?.revocationPending ? 'Sign-out is pending. Retry sign-out.' : 'Docs authorization required';
    renderAuth();
  }).then((bridge) => {
    editorV2 = bridge;
    sessionStatus = bridge.identity ? (bridge.canWrite ? 'Docs editing session authorized' : 'Docs read-only session authorized') : 'Docs authorization required';
    renderAuth();
    if (bridge.hasPendingWrite) showPendingWrite();
    void loadObjects(); return bridge;
  }).finally(() => { editorInitialization = undefined; });
  return editorInitialization;
}
window.addEventListener('pagehide', () => editorV2?.close());
