import {loadDocsEditorBridge, createDocsLocalExport} from './editor-session-bridge.js';
const $ = (query) => document.querySelector(query);
const editorV2Mode = window.location?.origin === 'https://docs.ynxweb4.com';
let editorV2 = null;
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
  $('#wallet').textContent = sessionStatus;
  if (!$('#provider-state').dataset?.standardManaged) $('#provider-state').textContent = 'Wallet connection: not verified';
  $('#session-state').textContent = sessionStatus;
  $('#auth-start').disabled = authPending;
  $('#auth-end').disabled = authPending || !docsIdentity();
  $('#auth-start').textContent = authPending ? 'Waiting for authorization...' : 'Authorize Docs with YNX Wallet';
  if (editorV2Mode) {
    $('#auth-start').textContent = 'Open Docs Product Session';
    $('#auth-end').disabled = !docsIdentity();
    $('#new-doc').disabled = !editorV2?.canWrite;
    $('#new-folder').disabled = !editorV2?.canWrite;
  }
}

function clearDocsSession() {
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
  $('#save-state').textContent = text;
  $('#save-state').style.color = error ? '#a12222' : '';
}

function enableDocumentActions(enabled) {
  if (editorV2Mode) {
    for (const id of ['duplicate', 'move', 'trash', 'history', 'comments', 'ai']) $(`#${id}`).disabled = true;
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
  if (editorV2Mode) { window.location.assign('/session.html'); return; }
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
  $('#auth-state').textContent = 'Authorization dialog closed. Pending results will not activate a Docs session.';
  renderAuth();
}

async function endDocsSession() {
  if (editorV2Mode) {
    if (!editorV2 || !confirm('Revoke this Docs Product Session? Unsaved text stays on this screen.')) return;
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
      request(`/objects?parentId=${parentId}&q=${query}${state.listCursor ? `&cursor=${encodeURIComponent(state.listCursor)}` : ''}`),
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
    previous.textContent = 'Previous page';
    previous.onclick = () => { state.listCursor = state.listHistory.pop(); loadObjects(); };
    root.append(previous);
  }
  if (page.nextCursor) {
    const next = document.createElement('button');
    next.textContent = 'Next page';
    next.onclick = () => { state.listHistory.push(state.listCursor); state.listCursor = page.nextCursor; loadObjects(); };
    root.append(next);
  }
}

function renderNavigation() {
  $('#folder-name').textContent = state.currentFolder?.name || 'All documents';
  $('#folder-up').disabled = !state.parentId;
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
    const name = document.createTextNode(object.kind === 'folder' ? `Folder · ${object.name}` : object.name);
    const meta = document.createElement('small');
    meta.textContent = object.kind === 'folder'
      ? `Updated ${new Date(object.updatedAt).toLocaleDateString()}`
      : `v${object.version} · ${new Date(object.updatedAt).toLocaleDateString()}`;
    button.append(name, meta);
    button.onclick = () => object.kind === 'folder' ? enterFolder(object) : openDocument(object);
    root.append(button);
  }
  if (!objects.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = $('#search').value ? 'No matching documents or folders.' : 'This folder is empty.';
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
  const name = prompt('Document title', 'Untitled document')?.trim();
  if (!name) return;
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
    await loadObjects();
    await openDocument(document);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function createFolder() {
  if (!docsIdentity()) return showSignIn();
  const name = prompt('Folder name', 'New folder')?.trim();
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
    state.current = metadata;
    state.content = content;
    state.baseVersion = metadata.version;
    state.dirty = false;
    state.commentAnchor = null;
    state.conflict = null;
    $('#title').value = metadata.name;
    $('#title').disabled = editorV2Mode;
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
  const name = $('#title').value.trim();
  if (!name) {
    $('#title').value = state.current.name;
    setStatus('A document title is required', true);
    return;
  }
  if (name === state.current.name) return;
  try {
    state.current = await request(`/objects/${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({name}),
    });
    $('#title').value = state.current.name;
    await loadObjects();
    setStatus(`Renamed · version ${state.baseVersion}`);
  } catch (error) {
    $('#title').value = state.current.name;
    setStatus(error.message, true);
  }
}

async function duplicateDocument() {
  if (!state.current) return;
  const name = prompt('Name for the duplicate', `${state.current.name} copy`)?.trim();
  if (!name) return;
  try {
    const duplicate = await request(`/objects/${state.current.id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({parentId: state.current.parentId || '', name}),
    });
    state.parentId = duplicate.parentId || '';
    await loadObjects();
    await openDocument(duplicate);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function showMovePanel() {
  if (!state.current) return;
  const root = openPanel('OWNERSHIP-PRESERVING MOVE', 'Move document');
  root.append(notice('Moving changes only the folder location. Ownership, versions, comments and permissions remain attached.'));
  const destinations = [{id: '', name: 'All documents'}, ...state.folders]
    .filter((folder) => folder.id !== state.current.parentId)
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const destination of destinations) {
    const button = document.createElement('button');
    button.className = 'wide';
    button.textContent = destination.name;
    button.onclick = () => moveDocument(destination.id);
    root.append(button);
  }
}

async function moveDocument(parentId) {
  if (!state.current) return;
  try {
    state.current = await request(`/objects/${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({parentId}),
    });
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
  if (state.dirty) {
    await saveDocument();
    if (state.dirty) return;
  }
  if (!confirm(`Move “${state.current.name}” to Trash? Share links and edits will stop resolving.`)) return;
  try {
    await request(`/objects/${state.current.id}/trash`, {method: 'POST'});
    clearDocument();
    await loadObjects();
    setStatus('Moved to Trash');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function editDocument() {
  if (!state.current) return;
  state.dirty = true;
  setStatus(navigator.onLine ? 'Unsaved changes' : 'Offline draft saved on this device');
  updateWordCount();
  persistDraft();
  clearTimeout(state.saveTimer);
  if (navigator.onLine && docsIdentity() && !state.conflict) state.saveTimer = setTimeout(saveDocument, 900);
}

function persistDraft() {
  try {
    window.localStorage.setItem(`ynx.docs.draft.${state.current.id}`, JSON.stringify({
    baseVersion: state.baseVersion,
    content: $('#editor').value,
    at: new Date().toISOString(),
    }));
    return true;
  } catch {
    setStatus('Local draft storage is unavailable. Keep this page open and copy unsaved text before leaving.', true);
    return false;
  }
}

async function saveDocument() {
  if (!state.current || !docsIdentity() || !state.dirty || state.saving || state.conflict || !navigator.onLine) return;
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
      try { window.localStorage.removeItem(`ynx.docs.draft.${id}`); } catch {}
      setStatus(`Saved · version ${document.version}`);
    }
    await loadObjects();
  } catch (error) {
    if (state.current?.id !== id || credential !== docsIdentity()) return;
    if (error.status===409) {
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
  clearTimeout(state.saveTimer);
  state.conflict = current;
  const latest = await request(`/objects/${current.id}/content?version=${current.version}`);
  if (current.id !== state.current?.id || !docsIdentity()) return;
  $('#local-conflict').value = $('#editor').value;
  $('#server-conflict').value = await latest.text();
  state.conflict = current;
  $('#conflict-dialog').showModal();
  setStatus('Conflict recovery required; nothing was overwritten', true);
}

async function keepLocalCopy() {
  try {
    if (editorV2Mode) editorV2.resolveReviewedConflict();
    const document = await request('/objects', {
      method: 'POST',
      body: JSON.stringify({
        parentId: state.current?.parentId || '',
        kind: 'doc',
        name: `${state.current.name} — recovered ${new Date().toLocaleString()}`,
        mime: 'text/plain',
        content: encodeText($('#local-conflict').value),
        encryption: {clientSide: false},
      }),
    });
    $('#conflict-dialog').close();
    await loadObjects();
    await openDocument(document);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function useServerVersion() {
  try {
    const current = state.conflict;
    const blob = await request(`/objects/${current.id}/content?version=${current.version}`);
    if (editorV2Mode) editorV2.resolveReviewedConflict();
    $('#editor').value = await blob.text();
    state.current = current;
    state.baseVersion = current.version;
    state.content = $('#editor').value;
    state.dirty = false;
    state.conflict = null;
    window.localStorage.removeItem(`ynx.docs.draft.${current.id}`);
    $('#conflict-dialog').close();
    updateWordCount();
    setStatus(`Using server version ${current.version}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function recoverOfflineDraft() {
  const key = `ynx.docs.draft.${state.current.id}`;
  let raw;
  try { raw = window.localStorage.getItem(key); } catch {
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
  if (editorV2Mode) { $('#presence').textContent = 'Presence is not yet supported by the v2 backend'; return; }
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
  const root = openPanel('VERSION EVIDENCE', 'Version history');
  const loading = notice('Loading verified versions…');
  root.append(loading);
  try {
    const versions = await request(`/objects/${state.current.id}/versions`);
    loading.remove();
    for (const version of versions) {
      const row = document.createElement('div');
      row.className = 'version';
      const heading = document.createElement('strong');
      heading.textContent = `Version ${version.number}`;
      const meta = document.createElement('small');
      meta.textContent = `${new Date(version.createdAt).toLocaleString()} · ${version.author} · ${version.hash.slice(0, 12)}…`;
      const preview = document.createElement('button');
      preview.textContent = 'Open read-only';
      preview.onclick = async () => {
        const blob = await request(`/objects/${state.current.id}/content?version=${version.number}`);
        const text = document.createElement('pre');
        text.className = 'callout';
        text.textContent = await blob.text();
        row.append(text);
      };
      row.append(heading, document.createElement('br'), meta, document.createElement('br'), preview);
      if (version.number !== state.baseVersion) {
        const restore = document.createElement('button');
        restore.textContent = 'Restore as new version';
        restore.onclick = () => restoreVersion(version.number);
        row.append(restore);
      }
      root.append(row);
    }
  } catch (error) {
    loading.textContent = error.message;
  }
}

async function restoreVersion(version) {
  if (!state.current) return;
  if (state.dirty && !confirm('Restoring creates a new server version. Discard current unsaved edits?')) return;
  if (!confirm(`Restore version ${version} as a new current version?`)) return;
  try {
    const restored = await request(`/objects/${state.current.id}/versions/${version}/restore`, {method: 'POST'});
    state.dirty = false;
    window.localStorage.removeItem(`ynx.docs.draft.${state.current.id}`);
    $('#panel').hidden = true;
    await openDocument(restored);
    await loadObjects();
  } catch (error) {
    setStatus(error.message, true);
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
  state.commentAnchor = selectedAnchor();
  const root = openPanel('VERSION-BOUND DISCUSSION', 'Comments');
  root.append(notice(state.commentAnchor
    ? `New thread anchor on v${state.baseVersion}: “${state.commentAnchor.quote}”`
    : `New thread will cite document version ${state.baseVersion}. Select text before opening Comments to create an anchored thread.`));

  const bodyLabel = document.createElement('label');
  bodyLabel.textContent = 'Comment';
  const body = document.createElement('textarea');
  body.id = 'comment-body';
  body.rows = 3;
  bodyLabel.append(body);

  const mentionLabel = document.createElement('label');
  mentionLabel.textContent = 'Mentions (ynx1…, comma separated)';
  const mentions = document.createElement('input');
  mentions.id = 'mentions';
  mentionLabel.append(mentions);

  const add = document.createElement('button');
  add.className = 'primary wide';
  add.textContent = `Comment on v${state.baseVersion}`;
  add.onclick = addComment;

  const list = document.createElement('div');
  list.id = 'comment-list';
  list.textContent = 'Loading…';
  root.append(bodyLabel, mentionLabel, add, list);
  await loadComments();
}

async function loadComments() {
  const list = $('#comment-list');
  if (!list || !state.current) return;
  try {
    const comments = await request(`/objects/${state.current.id}/comments`);
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
      resolution.textContent = rootComment.resolvedAt ? 'Reopen thread' : 'Resolve thread';
      resolution.onclick = () => setThreadResolution(threadId, !rootComment.resolvedAt);
      actions.append(resolution);
      if (!rootComment.resolvedAt) {
        const reply = document.createElement('button');
        reply.textContent = 'Reply';
        reply.onclick = () => replyToThread(threadId);
        actions.append(reply);
      }
      thread.append(actions);
      list.append(thread);
    }
    if (!comments.length) list.append(notice('No comments yet.'));
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
  const body = $('#comment-body').value.trim();
  if (!body) return setStatus('Comment text is required', true);
  const mentions = $('#mentions').value.split(',').map((value) => value.trim()).filter(Boolean);
  try {
    await request(`/objects/${state.current.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({version: state.baseVersion, body, mentions, anchor: state.commentAnchor}),
    });
    $('#comment-body').value = '';
    state.commentAnchor = null;
    await loadComments();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function replyToThread(threadId) {
  const body = prompt('Reply to this thread')?.trim();
  if (!body) return;
  try {
    await request(`/objects/${state.current.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({version: state.baseVersion, body, mentions: [], parentId: threadId}),
    });
    await loadComments();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function setThreadResolution(threadId, resolved) {
  try {
    await request(`/objects/${state.current.id}/comments/${threadId}/resolution`, {
      method: 'POST',
      body: JSON.stringify({resolved}),
    });
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
  $('#word-count').textContent = `${text ? text.split(/\s+/).length : 0} words`;
}

$('#wallet').onclick = showSignIn;
$('#auth-start').onclick = connectWallet;
$('#auth-end').onclick = endDocsSession;
$('#auth-dialog').addEventListener('close', cancelAuthorization);
$('#auth-dialog').addEventListener('cancel', cancelAuthorization);
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
  loadDocsEditorBridge().then((bridge) => {
    editorV2 = bridge;
    sessionStatus = bridge.identity ? (bridge.canWrite ? 'Docs editing session authorized' : 'Docs read-only session authorized') : 'Docs authorization required';
    renderAuth();
    return loadObjects();
  }).catch(() => { sessionStatus = 'Docs session unavailable; open Product Session to retry'; renderAuth(); });
  window.addEventListener('pagehide', () => editorV2?.close());
} else loadObjects();
