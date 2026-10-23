import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { YNXCloudClient } from '../sdk/index.js';
import { observeIDEDeployment, YNXCloudObservationError } from '../sdk/observe-ide-deployment.mjs';

// Real loopback HTTP + original SDK transport. PUBLIC HTTP/proof/resource
// responses below are NOT real authority, signatures, containers or deployment.
const requestId = 'PUBLIC_request_original_123456';
const binding = { projectId: 'PUBLIC_PROJECT', version: '1', contentDigest: 'a'.repeat(64), publishPurpose: 'deploy', targetEnvironment: 'PUBLIC_ENV', byteSize: 19 };
const expected = { binding, manifestSHA256: 'b'.repeat(64), approvalSHA256: 'c'.repeat(64), publisherId: 'PUBLIC_PUBLISHER', resourceId: 'PUBLIC_RESOURCE' };
const operation = state => ({ ...expected, requestId, state, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), logs: [], ...(state === 'unknown' ? {} : { deploymentId: 'PUBLIC_CONTAINER', runtimeUrl: 'https://public.invalid/runtime', runtimeKind: 'node-http-project' }), ...(state === 'completed' ? { exitCode: 0 } : {}) });

async function fixture(t, serve) {
  const requests = [], proofs = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader('Content-Type', 'application/json');
    const value = serve(req, requests.length);
    res.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const client = new YNXCloudClient({ endpoint: `http://127.0.0.1:${server.address().port}`, product: 'cloud', getDeploymentRequestHeaders: descriptor => { proofs.push(descriptor); return { 'X-PUBLIC-TEST-PROOF': String(proofs.length) }; } });
  return { client, requests, proofs };
}
const logs = { requestId, operationLogs: [], runtimeLogs: 'PUBLIC_NOT_REAL_RUNTIME', runtimeLogSource: 'original-resource' };
const options = { requestId, expected, intervalMs: 100, timeoutMs: 2000, maxObservations: 3 };

test('observer polls original UNKNOWN then running and reads resource logs, never POST', async t => {
  let statuses = 0;
  const f = await fixture(t, req => req.url.endsWith('/logs') ? logs : operation(++statuses === 1 ? 'unknown' : 'running'));
  const result = await observeIDEDeployment(f.client, options);
  assert.equal(result.operation.state, 'running'); assert.equal(result.observationCount, 2); assert.equal(result.logs.runtimeLogs, logs.runtimeLogs);
  assert.equal(f.requests.length, 3); assert.ok(f.requests.every(req => req.method === 'GET'));
  assert.equal(f.proofs.length, 3); assert.ok(f.proofs.every(p => p.operationRequestId === requestId));
});
test('observer preserves UNKNOWN after bounded reads without inventing failure', async t => {
  const f = await fixture(t, () => operation('unknown'));
  const result = await observeIDEDeployment(f.client, { ...options, maxObservations: 2 });
  assert.equal(result.operation.state, 'unknown'); assert.equal(result.logs, null); assert.equal(f.requests.length, 2);
});
test('observer rejects a different approval before reading its logs', async t => {
  const f = await fixture(t, () => ({ ...operation('running'), approvalSHA256: 'd'.repeat(64) }));
  await assert.rejects(observeIDEDeployment(f.client, options), err => err instanceof YNXCloudObservationError && err.operationRequestId === requestId && err.lastObservation === null);
  assert.equal(f.requests.length, 1);
});
test('cancelled observation retains running original and never cancels or redeploys', async t => {
  const controller = new AbortController();
  const f = await fixture(t, req => { if (req.url.endsWith('/logs')) { setImmediate(() => controller.abort(new Error('PUBLIC project closed'))); return logs; } return operation('running'); });
  await assert.rejects(observeIDEDeployment(f.client, { ...options, until: 'terminal', signal: controller.signal }), err => err instanceof YNXCloudObservationError && err.lastObservation?.operation.state === 'running' && err.state === 'running');
  assert.ok(f.requests.every(req => req.method === 'GET')); assert.equal(f.requests.length, 2);
});
test('observation source errors retain original HTTP cause without retry writes', async t => {
  const f = await fixture(t, req => req.url.endsWith('/logs') ? { ...logs, runtimeLogSource: 'cloud-operation' } : operation('running'));
  await assert.rejects(observeIDEDeployment(f.client, options), err => err instanceof YNXCloudObservationError && err.lastObservation?.operation.state === 'running' && Boolean(err.cause));
  assert.ok(f.requests.every(req => req.method === 'GET'));
});
