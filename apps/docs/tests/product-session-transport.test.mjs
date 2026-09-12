import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocsSessionTransport} from '../web/product-session-transport.js';

function harness(fetchImpl) {
  let proofs = 0;
  const calls = [];
  const scopes = [];
  const request = createDocsSessionTransport({
    origin: 'https://docs.example.test',
    adapter: {createIntrospectionProof: async (required) => { scopes.push(required); return {proofHeader: `fixture-${++proofs}`}; }},
    fetchImpl: async (...args) => { calls.push(args); return fetchImpl ? fetchImpl(...args) : new Response('{}'); },
  });
  return {request, calls, scopes, proofs: () => proofs};
}

test('each product request uses a fresh proof without ambient credentials or redirects', async () => {
  const h = harness();
  const scopes = ['docs.read', 'files.read'];
  await h.request('/api/v1/objects', {scopes});
  await h.request('/api/v1/objects', {scopes});
  assert.equal(h.calls[0][1].headers.get('X-YNX-Product-Session-Proof-V2'), 'fixture-1');
  assert.equal(h.calls[1][1].headers.get('X-YNX-Product-Session-Proof-V2'), 'fixture-2');
  assert.equal(h.calls[0][1].credentials, 'omit');
  assert.equal(h.calls[0][1].redirect, 'error');
  assert.equal(h.calls[0][1].cache, 'no-store');
  assert.notEqual(h.scopes[0], scopes);
});

test('a network failure is not retried; explicit retry keeps action key but gets a new proof', async () => {
  const h = harness(() => { throw new TypeError('offline'); });
  const options = {method: 'PUT', scopes: ['docs.edit'], idempotencyKey: 'document-save-0001', body: '{}'};
  await assert.rejects(h.request('/api/v1/objects/a/document', options), /offline/);
  assert.equal(h.calls.length, 1);
  await assert.rejects(h.request('/api/v1/objects/a/document', options), /offline/);
  assert.equal(h.calls.length, 2);
  assert.equal(h.proofs(), 2);
  assert.equal(h.calls[0][1].headers.get('Idempotency-Key'), h.calls[1][1].headers.get('Idempotency-Key'));
});

test('paths, legacy credentials, and writes without an action key fail before proof generation', async () => {
  const h = harness();
  for (const path of ['https://elsewhere.test/api/v1/objects', '//elsewhere.test/api/v1/objects', '/api/v1/../../outside']) {
    await assert.rejects(h.request(path, {scopes: ['docs.read']}));
  }
  await assert.rejects(h.request('/api/v1/objects', {scopes: ['docs.read'], headers: {Authorization: 'Bearer fixture'}}));
  await assert.rejects(h.request('/api/v1/objects', {scopes: ['docs.edit'], method: 'POST'}));
  assert.equal(h.proofs(), 0);
  assert.equal(h.calls.length, 0);
});

test('cancellation while signing prevents submission of the generated proof', async () => {
  let resolve;
  let calls = 0;
  const request = createDocsSessionTransport({origin: 'https://docs.example.test',
    adapter: {createIntrospectionProof: () => new Promise((done) => { resolve = done; })},
    fetchImpl: async () => { calls++; },
  });
  const controller = new AbortController();
  const result = request('/api/v1/objects', {scopes: ['docs.read'], signal: controller.signal});
  controller.abort();
  resolve({proofHeader: 'unused-fixture'});
  await assert.rejects(result, {name: 'AbortError'});
  assert.equal(calls, 0);
});

test('a private-service unavailable response is returned unchanged without retries or disconnects', async () => {
  const h = harness(() => new Response('{}', {status: 503}));
  const response = await h.request('/api/v1/objects', {scopes: ['docs.read']});
  assert.equal(response.status, 503);
  assert.equal(h.calls.length, 1);
});
