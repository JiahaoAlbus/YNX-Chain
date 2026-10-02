import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../web/app-secure.js', import.meta.url), 'utf8');
function harness(v2 = false) {
  const nodes = new Map();
  const drafts = new Map();
  const timers = new Map();
  let timer = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {value: '', style: {}, addEventListener() {}, replaceChildren(){}, append(){}});
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: {location:{origin:v2?'https://docs.ynxweb4.com':'https://legacy.invalid'},sessionStorage: {getItem: () => '', removeItem() {}}, localStorage: {
      getItem: (key) => drafts.get(key), setItem: (key, value) => drafts.set(key, value), removeItem: (key) => drafts.delete(key),
    }, addEventListener() {}},
    document: {querySelector: node,createElement:()=>({})}, navigator: {onLine: true}, TextEncoder,
    mountDocsLanguage(){},loadDocsEditorBridge:()=>new Promise(()=>{}),
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

test('v2 drafts stay with original account and legacy drafts are neither read nor migrated', () => {
  const h=harness(true);
  h.run("editorV2={identity:'session-A',account:'account-A',canWrite:true};state.documentAccount='account-A';");
  h.node('#editor').value='account A draft';h.run('persistDraft()');
  assert.equal(JSON.parse(h.drafts.get('ynx.docs.v2.draft.account-A.a')).content,'account A draft');
  h.drafts.set('ynx.docs.draft.a',JSON.stringify({content:'legacy private text',baseVersion:1,at:new Date().toISOString()}));
  h.run("editorV2={identity:'session-B',account:'account-B',canWrite:true};state.documentAccount='account-B';");
  h.node('#editor').value='server B';h.run('recoverOfflineDraft()');
  assert.equal(h.node('#editor').value,'server B');
  assert.equal(h.drafts.has('ynx.docs.draft.a'),true);
  assert.equal(h.drafts.has('ynx.docs.v2.draft.account-A.a'),true);
});

test('old-account draft cannot auto-save under a later connected account', async () => {
  const h=harness(true);
  h.run("editorV2={identity:'session-B',account:'account-B',canWrite:true};state.documentAccount='account-A';request=async()=>{throw Error('must not write');};");
  await h.run('saveDocument()');assert.equal(h.run('state.saving'),false);
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

test('confirmed quota-draft save clears only its original submitted owner snapshot', async () => {
  const h=harness(true);
  h.run("window.localStorage.setItem=()=>{throw Error('quota');};editorV2={identity:'session-B',account:'account-B',canWrite:true};state.current={id:'b',version:1};state.documentAccount='account-B';");
  h.node('#editor').value='B private draft';h.run('persistDraft()');
  h.run("editorV2={identity:'session-A',account:'account-A',canWrite:true};state.current={id:'a',version:1};state.documentAccount='account-A';request=async()=>({id:'a',version:2});");
  h.node('#editor').value='A submitted';h.run('persistDraft()');await h.run('saveDocument()');
  assert.equal(h.run("memoryDrafts.has('ynx.docs.v2.draft.account-A.a')"),false);
  assert.equal(h.run("memoryDrafts.get('ynx.docs.v2.draft.account-B.b').content"),'B private draft');
  assert.equal(h.run('state.dirty'),false);
});

test('late confirmation never clears newer quota-retained edits of the same owner', async () => {
  const h=harness(true);let resolve;h.context.reply=new Promise(done=>{resolve=done});
  h.run("window.localStorage.setItem=()=>{throw Error('quota');};editorV2={identity:'session-A',account:'account-A',canWrite:true};state.documentAccount='account-A';request=async()=>reply;");
  h.node('#editor').value='A submitted';h.run('persistDraft()');const saving=h.run('saveDocument()');
  h.node('#editor').value='A newer unsaved';h.run('persistDraft()');resolve({id:'a',version:2});await saving;
  assert.equal(h.run("memoryDrafts.get('ynx.docs.v2.draft.account-A.a').content"),'A newer unsaved');
  assert.equal(h.run('state.dirty'),true);
});

test('explicit server-version choice clears only its reviewed owner draft', async () => {
  const h=harness(true);
  h.run("window.localStorage.setItem=()=>{throw Error('quota');};editorV2={identity:'session-B',account:'account-B',canWrite:true};state.documentAccount='account-B';");
  h.node('#editor').value='B retained';h.run('persistDraft()');
  h.run("editorV2={identity:'session-A',account:'account-A',canWrite:true,resolveReviewedConflict:async()=>{}};state.documentAccount='account-A';state.conflict={id:'a',version:2};request=async()=>({text:async()=> 'server version'});");
  h.node('#editor').value='A discarded';h.run('persistDraft()');h.node('#conflict-dialog').close=()=>{};
  await h.run('useServerVersion()');
  assert.equal(h.run("memoryDrafts.has('ynx.docs.v2.draft.account-A.a')"),false);
  assert.equal(h.run("memoryDrafts.get('ynx.docs.v2.draft.account-B.a').content"),'B retained');
  assert.equal(h.node('#editor').value,'server version');
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
