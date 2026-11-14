import test from 'node:test';
import assert from 'node:assert/strict';
import {YNXCloudClient} from '../sdk/index.js';

const requestId = 'req_PUBLIC_CONTEXT_SDK_000001';
const endpoint = 'https://public.invalid/api/v1';
const path = `/ide/deployments/${requestId}`;
const headers = {'X-Public-Fixture': 'NOT_A_SIGNATURE'};
const response = () => Response.json({requestId, state: 'unknown'});

test('original Cloud read passes the exact caller context and signal to proof and transport', async () => {
  const controller = new AbortController(), context = Object.freeze({signal: controller.signal});
  let proofs = 0, sends = 0;
  const client = new YNXCloudClient({endpoint, product: 'cloud',
    getDeploymentRequestHeaders: async (request, actual) => {
      proofs++; assert.equal(actual, context); assert.equal(actual.signal, controller.signal);
      assert.equal(request.method, 'GET'); assert.equal(request.operationRequestId, requestId);
      assert.equal(request.path, `/api/v1${path}`); assert.ok(Object.isFrozen(request));
      return headers;
    }, fetch: async (url, options) => {
      sends++; assert.equal(url, endpoint + path); assert.equal(options.signal, controller.signal);
      assert.equal(options.method, 'GET'); return response();
    }});
  assert.equal((await client.getIDEDeploymentStatus(requestId, {originalRequestContext: context})).state, 'unknown');
  assert.equal(proofs, 1); assert.equal(sends, 1);
});

test('changed, mutable or accessor context is rejected before proof', async () => {
  const first = new AbortController(), second = new AbortController();
  let proofs = 0, getters = 0;
  const client = new YNXCloudClient({endpoint, product: 'cloud',
    getDeploymentRequestHeaders: async () => {proofs++; return headers;}});
  const accessor = Object.freeze(Object.defineProperty({}, 'signal', {enumerable: true, get() {getters++; return first.signal;}}));
  for (const context of [{signal: first.signal}, Object.freeze({signal: second.signal}), accessor,
    Object.freeze({signal: first.signal, authority: true})]) {
    await assert.rejects(client.getIDEDeploymentStatus(requestId, {signal: first.signal, originalRequestContext: context}), /context changed/);
  }
  assert.equal(proofs, 0); assert.equal(getters, 0);
});

test('changed endpoint during the original proof cannot enter transport', async () => {
  const controller = new AbortController(), context = Object.freeze({signal: controller.signal});
  let entered, release, sends = 0;
  const started = new Promise(resolve => {entered = resolve;});
  const waiting = new Promise(resolve => {release = resolve;});
  const client = new YNXCloudClient({endpoint, product: 'cloud',
    getDeploymentRequestHeaders: async () => {entered(); await waiting; return headers;},
    fetch: async () => {sends++; return response();}});
  const pending = client.getIDEDeploymentStatus(requestId, {originalRequestContext: context});
  const rejected = assert.rejects(pending, /selection changed/);
  await started; client.endpoint = 'https://changed.invalid/api/v1'; release();
  await rejected; assert.equal(sends, 0);
});

test('changed proof headers are refused before the original read transport', async () => {
  const controller = new AbortController(), context = Object.freeze({signal: controller.signal});
  let sends = 0;
  const client = new YNXCloudClient({endpoint, product: 'cloud',
    getDeploymentRequestHeaders: async () => headers,
    fetch: async () => {sends++; return response();}});
  const selected = await client.deploymentHeaders('GET', path, requestId, {}, controller.signal, undefined, context);
  selected.set('X-Public-Changed', 'PUBLIC');
  await assert.rejects(client.request(path, {headers: selected, originalAuthorizationHeaders: selected, signal: controller.signal}), /selection changed/);
  assert.equal(sends, 0);
});
