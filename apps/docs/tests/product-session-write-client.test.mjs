import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsWriteClient} from '../web/product-session-write-client.js';

function harness(responses) {
  const calls = [], scopes = [];
  let keys = 0;
  const client = createDocsWriteClient({origin: 'https://docs.ynxweb4.com', keyFactory: () => `docs_operation_${++keys}`,
    adapter: {createIntrospectionProof: async (value) => { scopes.push(value); return {proofHeader: `proof-${scopes.length}`}; }},
    fetchImpl: async (url, options) => { calls.push({url, options}); const result = responses.shift(); if (result instanceof Error) throw result; return result; },
  });
  return {client, calls, scopes, keys: () => keys};
}

test('save snapshots exact content and baseVersion with only write-route scopes', async () => {
  const h = harness([Response.json({id: 'one', version: 2})]);
  const draft = {id: 'one', baseVersion: 1, content: 'original'};
  const operation = h.client.prepareSave(draft);
  draft.content = 'new typing';
  await h.client.send(operation);
  assert.equal(JSON.parse(h.calls[0].options.body).content, btoa('original'));
  assert.equal(JSON.parse(h.calls[0].options.body).baseVersion, 1);
  assert.deepEqual(h.scopes[0], ['docs.write', 'files.write']);
  assert.equal(Object.isFrozen(operation), true);
});

test('explicit retry preserves key and exact body but uses a fresh proof', async () => {
  const h = harness([new TypeError('offline'), Response.json({id: 'one'}, {headers: {'Idempotency-Replayed': 'true'}})]);
  const operation = h.client.prepareCreate({name: 'One'});
  await assert.rejects(h.client.send(operation), /offline/);
  const result = await h.client.send(operation);
  assert.equal(result.replayed, true);
  assert.equal(h.keys(), 1);
  assert.equal(h.calls[0].options.body, h.calls[1].options.body);
  assert.equal(h.calls[0].options.headers.get('Idempotency-Key'), h.calls[1].options.headers.get('Idempotency-Key'));
  assert.notEqual(h.calls[0].options.headers.get('X-YNX-Product-Session-Proof-V2'), h.calls[1].options.headers.get('X-YNX-Product-Session-Proof-V2'));
});

test('uncertain outcome blocks resubmission and requires real readback', async () => {
  const h = harness([Response.json({code: 'WRITE_OUTCOME_UNCERTAIN'}, {status: 409})]);
  const operation = h.client.prepareSave({id: 'one', baseVersion: 1, content: 'draft'});
  await assert.rejects(h.client.send(operation), {code: 'WRITE_OUTCOME_UNCERTAIN', reconciliationRequired: true});
  await assert.rejects(h.client.send(operation), {code: 'WRITE_OUTCOME_UNCERTAIN', reconciliationRequired: true});
  assert.equal(h.calls.length, 1);
  assert.equal(h.keys(), 1);
});

test('version conflict preserves server current metadata for comparison', async () => {
  const current = {id: 'one', version: 3};
  const h = harness([Response.json({error: 'version conflict', current}, {status: 409})]);
  const operation = h.client.prepareSave({id: 'one', baseVersion: 1, content: 'draft'});
  await assert.rejects(h.client.send(operation), (error) => error.status === 409 && error.current.version === 3);
});

test('unsupported writes never fall back to legacy credentials', async () => {
  const h = harness([Response.json({code: 'V2_ROUTE_NOT_ENABLED'}, {status: 403})]);
  await assert.rejects(h.client.send(h.client.prepareCreate({name: 'Folder', kind: 'folder'})), {code: 'V2_ROUTE_NOT_ENABLED'});
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.headers.has('Authorization'), false);
});

test('restoring a persisted pending operation retains its original key without generating a replacement', async () => {
  const first = harness([]);
  const stored = JSON.parse(JSON.stringify(first.client.prepareCreate({name: 'One'})));
  const restarted = harness([Response.json({id: 'one'}, {headers: {'Idempotency-Replayed': 'true'}})]);
  await restarted.client.send(restarted.client.resumePrepared(stored));
  assert.equal(restarted.keys(), 0);
  assert.equal(restarted.calls[0].options.headers.get('Idempotency-Key'), stored.idempotencyKey);
  assert.equal(restarted.calls[0].options.body, stored.body);
});

for (const path of ['/api/v1/objects/one/trash', '/api/v1/objects/one/restore', '/api/v1/objects/one/versions/2/restore']) {
  for (const body of [undefined, '']) {
    test(`reload and explicit retry preserve empty body at ${path} (${String(body)})`, async () => {
      const h = harness([new TypeError('offline'), Response.json({id:'one'})]);
      const original = {method:'POST',path,body,idempotencyKey:'empty_operation_0001'};
      const op = h.client.resumePrepared(JSON.parse(JSON.stringify(original)));
      await assert.rejects(h.client.send(op), /offline/);
      await h.client.send(op);
      assert.equal(h.keys(), 0);
      assert.equal(h.calls[0].options.body, body);
      assert.equal(h.calls[1].options.body, body);
      assert.equal(h.calls[1].options.headers.has('Content-Type'), false);
      assert.equal(h.calls[1].options.headers.get('Idempotency-Key'), original.idempotencyKey);
      assert.notEqual(h.calls[0].options.headers.get('X-YNX-Product-Session-Proof-V2'), h.calls[1].options.headers.get('X-YNX-Product-Session-Proof-V2'));
      assert.throws(() => h.client.resumePrepared({...original,body:'{}'}), /invalid/);
    });
  }
}

for (const [method,path,scopes] of [
  ['PATCH','/api/v1/objects/one',['docs.write','files.write']],
  ['POST','/api/v1/objects/one/comments',['docs.write','files.write']],
  ['POST','/api/v1/objects/one/comments/root/resolve',['docs.write','files.write']],
  ['POST','/api/v1/objects/one/duplicate',['docs.read','docs.write','files.read','files.write']],
]) {
  test(`route-specific scope order: ${method} ${path}`, async () => {
    const h = harness([Response.json({id:'receipt'})]);
    await h.client.send(h.client.resumePrepared({method,path,body:'{}',idempotencyKey:'route_operation_001'}));
    assert.deepEqual(h.scopes[0],scopes);
  });
}
