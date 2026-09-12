import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsReadClient} from '../web/product-session-read-client.js';

function harness(responses) {
  const calls = [];
  const scopes = [];
  const client = createDocsReadClient({origin: 'https://docs.ynxweb4.com',
    adapter: {createIntrospectionProof: async (value) => { scopes.push(value); return {proofHeader: `proof-${scopes.length}`}; }},
    fetchImpl: async (url, options) => { calls.push({url, options}); return responses.shift(); },
  });
  return {client, calls, scopes};
}

test('list uses exact candidate read scopes and URL-encoded query fields', async () => {
  const h = harness([Response.json([{id: 'doc-1', name: 'One', kind: 'doc'}])]);
  const result = await h.client.list({parentId: 'folder-1', query: 'a&b'});
  assert.equal(result.length, 1);
  const url = new URL(h.calls[0].url);
  assert.equal(url.searchParams.get('q'), 'a&b');
  assert.deepEqual(h.scopes, [['docs.read', 'files.read']]);
  assert.equal(h.calls[0].options.headers.has('Authorization'), false);
});

test('metadata and content use separate fresh proofs', async () => {
  const h = harness([Response.json({id: 'doc-1', name: 'One', kind: 'doc', version: 3}), new Response('Document text')]);
  const result = await h.client.open('doc-1');
  assert.equal(result.content, 'Document text');
  assert.equal(h.calls.length, 2);
  assert.notEqual(h.calls[0].options.headers.get('X-YNX-Product-Session-Proof-V2'), h.calls[1].options.headers.get('X-YNX-Product-Session-Proof-V2'));
});

test('denied metadata never fetches content or falls back to legacy authorization', async () => {
  const h = harness([new Response('{}', {status: 403})]);
  await assert.rejects(h.client.open('doc-1'), {status: 403});
  assert.equal(h.calls.length, 1);
});

test('mismatched metadata cannot be displayed as the requested document', async () => {
  const h = harness([Response.json({id: 'other', name: 'Other', kind: 'doc'})]);
  await assert.rejects(h.client.open('doc-1'), /invalid document metadata/);
  assert.equal(h.calls.length, 1);
});
