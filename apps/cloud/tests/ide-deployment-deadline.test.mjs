import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { YNXCloudClient, YNXCloudDeploymentUnknownError } from '../sdk/index.js';
import { observeIDEDeployment, YNXCloudObservationError } from '../sdk/observe-ide-deployment.mjs';

// PUBLIC non-cooperative provider/transport controls, not Source, approval,
// signatures or execution. A deadline ends observation, never the deployment.
const requestId = 'PUBLIC_deadline_request_123456';
const artifact = new Uint8Array(Buffer.from('PUBLIC artifact'));
const binding = { projectId: 'PUBLIC_PROJECT', version: '1', contentDigest: createHash('sha256').update(artifact).digest('hex'), publishPurpose: 'deploy', targetEnvironment: 'PUBLIC_ENV', byteSize: artifact.length };
const expected = { binding, manifestSHA256: 'b'.repeat(64), approvalSHA256: 'c'.repeat(64), publisherId: 'PUBLIC_PUBLISHER', resourceId: 'PUBLIC_RESOURCE' };
const running = { ...expected, requestId, state: 'running', deploymentId: 'PUBLIC_CONTAINER', runtimeUrl: 'https://public.invalid/runtime' };
const logs = { requestId, runtimeLogSource: 'original-resource', operationLogs: [], runtimeLogs: 'PUBLIC logs' };
const options = { requestId, expected, timeoutMs: 100, intervalMs: 100 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function client(fetch, getDeploymentRequestHeaders = () => ({ 'X-PUBLIC': 'NOT_AUTHORITY' })) {
  return new YNXCloudClient({ endpoint: 'https://public.invalid', product: 'cloud', fetch, getDeploymentRequestHeaders });
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PUBLIC test watchdog: cancellation did not settle')), 1500); })]); }
  finally { clearTimeout(timer); }
}
function timeoutError(error) {
  assert.ok(error instanceof YNXCloudObservationError);
  assert.equal(error.operationRequestId, requestId);
  assert.equal(error.cause?.name, 'TimeoutError');
  return true;
}

test('observer deadline bounds pending original headers and ignores their late result', async () => {
  let release, providers = 0, sends = 0;
  const c = client(() => { sends++; throw new Error('must not dispatch late headers'); }, () => { providers++; return new Promise(resolve => { release = resolve; }); });
  await assert.rejects(bounded(observeIDEDeployment(c, options)), error => {
    timeoutError(error); assert.equal(error.state, 'unknown'); assert.equal(error.lastObservation, null); return true;
  });
  release({ 'X-PUBLIC': 'LATE_NOT_AUTHORITY' });
  await tick();
  assert.equal(providers, 1); assert.equal(sends, 0);
});

test('a late provider rejection is consumed after cancellation without another call', async () => {
  let rejectLate, providers = 0, sends = 0;
  const c = client(() => { sends++; }, () => { providers++; return new Promise((_, reject) => { rejectLate = reject; }); });
  await assert.rejects(bounded(observeIDEDeployment(c, options)), timeoutError);
  rejectLate(new Error('PUBLIC late provider failure'));
  await tick();
  assert.equal(providers, 1); assert.equal(sends, 0);
});

test('non-cooperative status transport cannot outlive observation or start late log reads', async () => {
  let release;
  const requests = [];
  const c = client((url, init) => { requests.push({ url, method: init.method }); return new Promise(resolve => { release = resolve; }); });
  await assert.rejects(bounded(observeIDEDeployment(c, options)), timeoutError);
  release(Response.json(running));
  await tick();
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'GET');
  assert.ok(requests[0].url.endsWith('/' + requestId));
});

test('pending logs preserve the original running operation at deadline', async () => {
  let release;
  const requests = [];
  const c = client((url, init) => {
    requests.push({ url, method: init.method });
    return url.endsWith('/logs') ? new Promise(resolve => { release = resolve; }) : Promise.resolve(Response.json(running));
  });
  await assert.rejects(bounded(observeIDEDeployment(c, { ...options, until: 'terminal' })), error => {
    timeoutError(error); assert.equal(error.state, 'running'); assert.equal(error.lastObservation.operation.requestId, requestId); assert.equal(error.lastObservation.logs, null); return true;
  });
  release(Response.json(logs)); await tick();
  assert.equal(requests.length, 2); assert.ok(requests.every(request => request.method === 'GET'));
});

test('already aborted reads never acquire headers or dispatch', async () => {
  let providers = 0, sends = 0;
  const c = client(() => { sends++; }, () => { providers++; return {}; });
  const controller = new AbortController(), reason = new Error('PUBLIC closed project');
  controller.abort(reason);
  for (const method of ['getIDEDeploymentStatus', 'getIDEDeploymentLogs']) {
    await assert.rejects(c[method](requestId, { signal: controller.signal }), error => error === reason);
  }
  assert.equal(providers, 0); assert.equal(sends, 0);
});

test('post-dispatch cancellation retains UNKNOWN and only queries the same original request', async () => {
  const controller = new AbortController(), reason = new Error('PUBLIC observation closed');
  const requests = [];
  let release;
  const c = client((url, init) => {
    requests.push({ url, method: init.method });
    if (init.method === 'POST') {
      setImmediate(() => controller.abort(reason));
      return new Promise(resolve => { release = resolve; });
    }
    return Promise.resolve(Response.json({ requestId, state: 'unknown' }));
  });
  const input = { requestId, artifact, manifest: JSON.stringify(binding), approval: 'PUBLIC_NOT_APPROVAL' };
  await assert.rejects(bounded(c.submitIDEDeployment({ ...input, signal: controller.signal })), error => error instanceof YNXCloudDeploymentUnknownError && error.operationRequestId === requestId && error.cause === reason);
  release(Response.json(running)); await tick();
  await assert.rejects(c.submitIDEDeployment(input), YNXCloudDeploymentUnknownError);
  assert.equal((await c.getIDEDeploymentStatus(requestId)).state, 'unknown');
  assert.deepEqual(requests.map(request => request.method), ['POST', 'GET']);
  assert.ok(requests[1].url.endsWith('/' + requestId));
});
