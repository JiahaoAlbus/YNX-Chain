import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../web/app-secure.js', import.meta.url), 'utf8');
function harness() {
  const nodes = new Map();
  const drafts = new Map();
  const timers = new Map();
  let timer = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {value: '', style: {}, addEventListener() {}});
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: {sessionStorage: {getItem: () => '', removeItem() {}}, localStorage: {
      getItem: (key) => drafts.get(key), setItem: (key, value) => drafts.set(key, value), removeItem: (key) => drafts.delete(key),
    }, addEventListener() {}},
    document: {querySelector: node}, navigator: {onLine: true}, TextEncoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'), confirm: () => true,
    setTimeout: (fn) => { timers.set(++timer, fn); return timer; },
    clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
    fetch: async () => ({status: 401, ok: false, headers: {get: () => 'application/json'}, json: async () => ({error: 'expired'})}),
  });
  vm.runInContext(source.replace(/^import .*;\n/, ''), context);
  vm.runInContext("state.credential = 'fixture'; state.current = {id: 'a', version: 1}; state.baseVersion = 1; state.dirty = true; loadObjects = async () => {};", context);
  return {node, drafts, timers, context, run: (code) => vm.runInContext(code, context)};
}

test('edits typed during save remain dirty and are queued using the returned version', async () => {
  const h = harness();
  let resolve;
  h.context.reply = new Promise((done) => { resolve = done; });
  h.run('request = async (path, options) => { globalThis.sent = JSON.parse(options.body); return reply; };');
  h.node('#editor').value = 'submitted';
  const saving = h.run('saveDocument()');
  h.node('#editor').value = 'submitted plus newer text';
  resolve({id: 'a', version: 2});
  await saving;
  assert.equal(h.run('state.content'), 'submitted');
  assert.equal(h.run('state.dirty'), true);
  assert.equal(h.run('state.baseVersion'), 2);
  assert.equal(h.run('sent.baseVersion'), 1);
  const draft = JSON.parse(h.drafts.get('ynx.docs.draft.a'));
  assert.equal(draft.content, 'submitted plus newer text');
  assert.equal(draft.baseVersion, 2);
  assert.equal(h.timers.size, 1);
});

test('late save response cannot replace a different open document', async () => {
  const h = harness();
  let resolve;
  h.context.reply = new Promise((done) => { resolve = done; });
  h.run('request = async () => reply;');
  h.node('#editor').value = 'first';
  const saving = h.run('saveDocument()');
  h.run("state.current = {id: 'b', version: 9}; state.baseVersion = 9; state.dirty = false;");
  h.node('#editor').value = 'second';
  resolve({id: 'a', version: 2});
  await saving;
  assert.equal(h.run('state.current.id'), 'b');
  assert.equal(h.run('state.baseVersion'), 9);
  assert.equal(h.node('#editor').value, 'second');
});

test('draft storage failure reports loss of persistence without discarding text', () => {
  const h = harness();
  h.node('#editor').value = 'keep this text';
  h.run("window.localStorage.setItem = () => { throw Error('quota'); }; editDocument();");
  assert.equal(h.node('#editor').value, 'keep this text');
  assert.equal(h.run('state.dirty'), true);
  assert.match(h.node('#save-state').textContent, /storage is unavailable/);
});

test('expired session stops presence heartbeat and disables editing', async () => {
  const h = harness();
  await h.run('sendPresence()');
  assert.equal(h.run('state.credential'), '');
  assert.equal(h.timers.size, 0);
  assert.equal(h.node('#editor').disabled, true);
});

test('Docs logout confirms server deletion and preserves unsaved text', async () => {
  const h = harness();
  h.node('#editor').value = 'unsaved';
  h.run('request = async (path, options) => { globalThis.deletion = {path, method: options.method}; };');
  await h.run('endDocsSession()');
  assert.equal(h.run('deletion.path'), '/session');
  assert.equal(h.run('deletion.method'), 'DELETE');
  assert.equal(h.run('state.credential'), '');
  assert.equal(h.node('#editor').value, 'unsaved');
  assert.match(h.node('#auth-state').textContent, /session revoked/);
});

test('logout network failure never claims a revoked session', async () => {
  const h = harness();
  h.run("request = async () => { throw Error('offline'); };");
  await h.run('endDocsSession()');
  assert.equal(h.run('state.credential'), 'fixture');
  assert.match(h.node('#auth-state').textContent, /Could not confirm/);
  assert.equal(h.node('#auth-end').disabled, false);
});
