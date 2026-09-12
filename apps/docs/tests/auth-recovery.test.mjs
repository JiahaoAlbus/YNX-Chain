import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../web/app-secure.js', import.meta.url), 'utf8');
function harness(bridge, reply = {token: 'docs-session'}) {
  const nodes = new Map();
  const storage = new Map();
  let calls = 0;
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {value: '', style: {}, addEventListener() {}});
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: {ynxWallet: bridge, sessionStorage: {
      getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    }, addEventListener() {}},
    document: {querySelector: node}, clearTimeout, clearInterval,
    fetch: async () => { calls++; return {status: 200, ok: true, headers: {get: () => 'application/json'}, json: async () => reply}; },
  });
  vm.runInContext(source.replace(/^import .*;\n/, ''), context);
  vm.runInContext('loadObjects = async () => {};', context);
  return {node, storage, calls: () => calls, run: (code) => vm.runInContext(code, context)};
}

test('missing bridge remains retryable without a session request', async () => {
  const h = harness();
  await h.run('connectWallet()');
  assert.match(h.node('#auth-state').textContent, /bridge is unavailable/);
  assert.equal(h.node('#auth-start').disabled, false);
  assert.equal(h.calls(), 0);
  assert.equal(h.storage.size, 0);
});

test('decline can be retried; product authorization does not claim provider connection', async () => {
  let attempts = 0;
  const h = harness({requestSession: async () => {
    if (++attempts === 1) throw {code: 4001};
    return {approval: 'fixture'};
  }});
  await h.run('connectWallet()');
  assert.match(h.node('#auth-state').textContent, /declined/);
  await h.run('connectWallet()');
  assert.equal(h.node('#wallet').textContent, 'Docs session authorized');
  assert.equal(h.node('#provider-state').textContent, 'Wallet connection: not verified');
  assert.equal(h.calls(), 1);
});

test('invalid session response cannot create false success', async () => {
  const h = harness({requestSession: async () => ({approval: 'fixture'})}, {});
  await h.run('connectWallet()');
  assert.equal(h.storage.size, 0);
  assert.equal(h.node('#wallet').textContent, 'Docs authorization required');
  assert.match(h.node('#auth-state').textContent, /no valid session/);
});

test('closing pending authorization ignores late approval and duplicate clicks', async () => {
  let resolve;
  let prompts = 0;
  const h = harness({requestSession: () => { prompts++; return new Promise((done) => { resolve = done; }); }});
  const pending = h.run('connectWallet()');
  await h.run('connectWallet()');
  h.run('cancelAuthorization()');
  resolve({approval: 'fixture'});
  await pending;
  assert.equal(prompts, 1);
  assert.equal(h.calls(), 0);
  assert.equal(h.storage.size, 0);
  assert.equal(h.node('#auth-start').disabled, false);
});
