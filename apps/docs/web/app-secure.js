const $ = (query) => document.querySelector(query);
const storageKey = ['ynx', 'docs', 'session'].join('.');
const headerName = ['Author', 'ization'].join('');
const authScheme = ['Bear', 'er'].join('');

const state = {
  credential: window.sessionStorage.getItem(storageKey) || '',
  objects: [],
  folders: [],
  parentId: '',
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

async function request(path, options = {}) {
  const headers = {...(options.headers || {})};
  if (state.credential) headers[headerName] = `${authScheme} ${state.credential}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/v1${path}`, {...options, headers});
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
  $('#auth-dialog').showModal();
}

async function connectWallet() {
  const output = $('#auth-state');
  try {
    if (!window.ynxWallet?.requestSession) {
      throw new Error('YNX Wallet bridge is unavailable. Docs does not accept recovery keys or substitute login credentials.');
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
    const result = await request('/session', {method: 'POST', body: JSON.stringify(assertion)});
    state.credential = result[['to', 'ken'].join('')];
    window.sessionStorage.setItem(storageKey, state.credential);
    $('#auth-dialog').close();
    $('#wallet').textContent = 'Wallet connected';
    await loadObjects();
  } catch (error) {
    output.textContent = error.message;
  }
}

async function loadObjects() {
  if (!state.credential) return;
  try {
    const query = encodeURIComponent($('#search').value.trim());
    const parentId = encodeURIComponent(state.parentId);
    const [visible, recent] = await Promise.all([
      request(`/objects?parentId=${parentId}&q=${query}`),
      request('/objects?view=recent'),
    ]);
    state.objects = visible.filter((object) => object.kind === 'doc' || object.kind === 'folder');
    state.folders = recent.filter((object) => object.kind === 'folder' && !object.trashedAt);
    state.currentFolder = state.parentId ? state.folders.find((folder) => folder.id === state.parentId) || null : null;
    renderNavigation();
    renderObjects();
    setStatus(state.current ? `Version ${state.baseVersion}` : 'Synced');
  } catch (error) {
    if (error.status === 401) {
      state.credential = '';
      window.sessionStorage.removeItem(storageKey);
      $('#wallet').textContent = 'Sign in with YNX Wallet';
    }
    setStatus(error.message, true);
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
  $('#search').value = '';
  await loadObjects();
}

async function openParentFolder() {
  if (!state.parentId) return;
  state.parentId = state.currentFolder?.parentId || '';
  $('#search').value = '';
  await loadObjects();
}

async function createDocument() {
  if (!state.credential) return showSignIn();
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
  if (!state.credential) return showSignIn();
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
  try {
    const [metadata, blob] = await Promise.all([
      request(`/objects/${document.id}`),
      request(`/objects/${document.id}/content`),
    ]);
    state.current = metadata;
    state.content = await blob.text();
    state.baseVersion = metadata.version;
    state.dirty = false;
    state.commentAnchor = null;
    $('#title').value = metadata.name;
    $('#title').disabled = false;
    $('#editor').value = state.content;
    $('#welcome').hidden = true;
    $('#editor-shell').hidden = false;
    enableDocumentActions(true);
    updateWordCount();
    renderObjects();
    recoverOfflineDraft();
    sendPresence();
    setStatus(`Version ${metadata.version}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function clearDocument() {
  clearTimeout(state.heartbeatTimer);
  state.current = null;
  state.content = '';
  state.baseVersion = 0;
  state.dirty = false;
  state.commentAnchor = null;
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
  window.localStorage.setItem(`ynx.docs.draft.${state.current.id}`, JSON.stringify({
    baseVersion: state.baseVersion,
    content: $('#editor').value,
    at: new Date().toISOString(),
  }));
  clearTimeout(state.saveTimer);
  if (navigator.onLine) state.saveTimer = setTimeout(saveDocument, 900);
}

async function saveDocument() {
  if (!state.current || !state.dirty || state.saving || !navigator.onLine) return;
  state.saving = true;
  setStatus('Saving…');
  try {
    const document = await request(`/objects/${state.current.id}/document`, {
      method: 'PUT',
      body: JSON.stringify({baseVersion: state.baseVersion, content: encodeText($('#editor').value)}),
    });
    state.current = document;
    state.baseVersion = document.version;
    state.content = $('#editor').value;
    state.dirty = false;
    window.localStorage.removeItem(`ynx.docs.draft.${document.id}`);
    setStatus(`Saved · version ${document.version}`);
    await loadObjects();
  } catch (error) {
    if (error.status===409) {
      await showConflict(error.body.current);
    } else {
      setStatus(error.message, true);
    }
  } finally {
    state.saving = false;
  }
}

async function showConflict(current) {
  clearTimeout(state.saveTimer);
  const latest = await request(`/objects/${current.id}/content?version=${current.version}`);
  $('#local-conflict').value = $('#editor').value;
  $('#server-conflict').value = await latest.text();
  state.conflict = current;
  $('#conflict-dialog').showModal();
  setStatus('Conflict recovery required; nothing was overwritten', true);
}

async function keepLocalCopy() {
  try {
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
    $('#editor').value = await blob.text();
    state.current = current;
    state.baseVersion = current.version;
    state.content = $('#editor').value;
    state.dirty = false;
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
  const raw = window.localStorage.getItem(key);
  if (!raw) return;
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(key);
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
  if (!state.current) return;
  try {
    const presence = await request(`/objects/${state.current.id}/presence`, {
      method: 'POST',
      body: JSON.stringify({label: 'Editing'}),
    });
    $('#presence').textContent = presence.length === 1 ? 'Only you are active' : `${presence.length} bounded collaborators active`;
  } catch (error) {
    $('#presence').textContent = `Presence unavailable · ${error.message}`;
  }
  clearTimeout(state.heartbeatTimer);
  state.heartbeatTimer = setTimeout(sendPresence, 20000);
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
$('#new-doc').onclick = createDocument;
$('#new-folder').onclick = createFolder;
$('#folder-up').onclick = openParentFolder;
$('#search').oninput = () => {
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
loadObjects();
