import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {YNXCloudClient} from '../sdk/index.js';
import {CloudDeploymentClient} from '../client/deployment-client.mjs';

// PUBLIC data and a local transport fixture only: no signer, Source or service.
function fixture({billMode = 'stop'} = {}) {
  const controller = new AbortController();
  const context = Object.freeze({signal: controller.signal});
  const paths = [], methods = [];
  const stopBilling = Error('PUBLIC reached billing proof');
  let selection, operation;
  const sdk = new YNXCloudClient({
    endpoint: 'https://public.invalid/api/v1', product: 'cloud',
    getDeploymentRequestHeaders: async (request, actual) => {
      assert.equal(actual, context, `original context lost at ${request.path}`);
      assert.equal(actual.signal, controller.signal);
      paths.push(request.path);
      if (request.path.includes('/billing/') && billMode === 'stop') throw stopBilling;
      return {'X-Public-Fixture': 'NOT_A_SIGNATURE'};
    },
    fetch: async (url, options) => {
      assert.equal(options.signal, controller.signal);
      methods.push(options.method || 'GET');
      const path = new URL(url).pathname;
      if (path.includes('/billing/')) {
        const sampleBinding = {bytes: '12', sha3_512: 'a'.repeat(128), sha512: 'b'.repeat(128)};
        const asset = {genesis: 'd'.repeat(64), nativeChainId: '71', assetId: 'PUBLIC_ASSET', unitVersion: '7'};
        const schedule = {id: 'PUBLIC_TARIFF', revision: '1', resourceId: operation.resourceId,
          projectId: 'PUBLIC_PROJECT', merchant: 'PUBLIC_MERCHANT', recipient: 'PUBLIC_RECIPIENT',
          registrationRef: 'PUBLIC_REGISTRATION', approvalRef: 'PUBLIC_APPROVAL_REF', asset,
          cpuNanos: {units: '1000000', atoms: '2'}, egressBytes: {units: '10', atoms: '3'},
          peakStoredBytes: {units: '64', atoms: '1'}};
        return Response.json({request: {requestId: selection.requestId, instanceId: operation.deploymentId,
          period: '2026-11-07', scheduleId: schedule.id, scheduleRevision: schedule.revision,
          merchant: schedule.merchant, recipient: schedule.recipient, registrationRef: schedule.registrationRef,
          approvalRef: schedule.approvalRef, asset, atoms: '6', sampleBinding},
          aggregate: {period: '2026-11-07', cpuNanos: '1000000', egressBytes: '10',
            peakStoredBytes: selection.contentBinding.bytes, sampleBinding},
          schedule, state: 'PREPARED', settlement: 'NOT_VERIFIED', invoiceId: 'PUBLIC_INVOICE',
          originalOperation: 'PUBLIC_ORIGINAL'});
      }
      if (path.endsWith('/logs')) return Response.json({requestId: selection.requestId,
        deploymentId: operation.deploymentId, resourceId: operation.resourceId,
        slotRevision: operation.slotRevision, contentBinding: selection.contentBinding,
        operationLogs: [], runtimeLogs: 'PUBLIC', runtimeLogSource: 'original-resource'});
      if (path.endsWith('/usage') || path.endsWith('/usage/records')) {
        const sample = {instanceId: operation.deploymentId, period: '2026-11-07',
          sampleSeq: '1794009600000000000', cpuNanos: '1000000', cpuMs: '1',
          memoryBytes: '4096', storedBytes: selection.contentBinding.bytes,
          egressBytes: '0', observedAt: '2026-11-07T00:00:00Z'};
        return Response.json({requestId: selection.requestId, instanceId: operation.deploymentId,
          billingState: 'UNPRICED', samples: {[`${sample.period}/${sample.sampleSeq}`]: sample}, latest: sample});
      }
      return Response.json(operation);
    }
  });
  const client = new CloudDeploymentClient(sdk);
  const prepared = client.prepare({requestId: 'req_PUBLIC_LEGACY_CONTEXT_0001',
    manifest: Buffer.from('PUBLIC manifest'), artifact: Buffer.from('PUBLIC artifact'),
    approval: Buffer.from('PUBLIC NOT_A_SIGNATURE'), expectedSlotRevision: '0'});
  selection = prepared.selection;
  operation = {requestId: selection.requestId, manifestSHA256: selection.manifestSHA256,
    approvalSHA256: selection.approvalSHA256, contentBinding: selection.contentBinding,
    expectedSlotRevision: '0', slotRevision: '1', state: 'running',
    runtimeKind: 'node-http-project', runtimeUrl: 'https://public.invalid/app',
    deploymentId: 'PUBLIC_INSTANCE', resourceId: 'PUBLIC_RESOURCE', binding: {projectId: 'PUBLIC_PROJECT'}};
  return {sdk, client, prepared, selection, operation, context, controller, paths, methods, stopBilling};
}

test('legacy original reads carry the same caller context into every proof and transport', async t => {
  for (const [name, read] of [
    ['status', (f, o) => f.client.lookupOriginal(f.selection, o)],
    ['logs', (f, o) => f.client.logs(f.selection, o)],
    ['runtime', (f, o) => f.client.runtime(f.selection, o)],
    ['usage', (f, o) => f.client.usage(f.selection, o)],
    ['usage-records', (f, o) => f.client.usage(f.selection, {...o, observe: false})],
    ['inspect', (f, o) => f.client.inspect(f.selection, o)],
    ['bill-original', (f, o) => assert.rejects(f.client.bill(f.selection, '2026-11-07', o), e => e === f.stopBilling)]
  ]) await t.test(name, async () => {
    const f = fixture();
    await read(f, {originalRequestContext: f.context});
    assert.ok(f.paths.length > 0);
    assert.ok(f.methods.every(method => method === 'GET'));
  });
});



test('borrowed read context cannot authorize legacy bill preparation', async () => {
  const f = fixture();
  await assert.rejects(f.client.bill(f.selection, '2026-11-07', {prepare: true, originalRequestContext: f.context}), /read context/i);
  assert.equal(f.paths.length, 0);
  assert.equal(f.methods.length, 0);
});

test('legacy bill observation reaches the original GET transport with the same context', async () => {
  const f = fixture({billMode: 'return'});
  const result = await f.client.bill(f.selection, '2026-11-07', {originalRequestContext: f.context});
  assert.equal(result.settlement, 'NOT_VERIFIED');
  assert.ok(f.paths.some(path => path.endsWith('/billing/2026-11-07')));
  assert.deepEqual(f.methods, ['GET', 'GET']);
});

test('legacy reads retain their original selection and context across a pending status', async t => {
  for (const [name, read] of [
    ['status', (f, selection, options) => f.client.lookupOriginal(selection, options)],
    ['logs', (f, selection, options) => f.client.logs(selection, options)],
    ['usage-records', (f, selection, options) => f.client.usage(selection, {...options, observe: false})],
    ['bill-original', (f, selection, options) => assert.rejects(f.client.bill(selection, '2026-11-07', options), e => e === f.stopBilling)]
  ]) await t.test(name, async () => {
    const f = fixture(), selection = structuredClone(f.selection), other = new AbortController();
    const options = {signal: f.controller.signal, originalRequestContext: f.context};
    const originalFetch = f.sdk.fetch;
    let changed = false;
    f.sdk.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (!changed) {
        changed = true;
        selection.requestId = 'req_PUBLIC_DIFFERENT_00000001';
        selection.contentBinding.bytes = '999';
        options.signal = other.signal;
        options.originalRequestContext = Object.freeze({signal: other.signal});
      }
      return response;
    };
    await read(f, selection, options);
    assert.equal(changed, true);
    assert.ok(f.paths.every(path => path.includes(f.selection.requestId)));
    assert.ok(f.methods.every(method => method === 'GET'));
  });
});

test('rollback preparation retains its original input while the selected operation is checked', async () => {
  const f = fixture(), target = structuredClone(f.selection);
  f.operation.state = 'completed'; f.operation.exitCode = 0;
  const input = {requestId: 'req_PUBLIC_ROLLBACK_CONTEXT_01', manifest: Buffer.from('PUBLIC manifest'),
    artifact: Buffer.from('PUBLIC artifact'), approval: Buffer.from('PUBLIC NEW_APPROVAL_NOT_SIGNATURE'),
    expectedSlotRevision: '1'};
  const expectedApproval = createHash('sha256').update(input.approval).digest('hex');
  const originalFetch = f.sdk.fetch;
  f.sdk.fetch = async (...args) => {
    const response = await originalFetch(...args);
    target.requestId = 'req_PUBLIC_DIFFERENT_00000001';
    input.expectedSlotRevision = '2';
    input.approval.fill(0);
    return response;
  };
  const prepared = await f.client.prepareRollback(target, input, {originalRequestContext: f.context});
  assert.equal(prepared.selection.rollbackTo, f.selection.requestId);
  assert.equal(prepared.selection.expectedSlotRevision, '1');
  assert.equal(prepared.selection.approvalSHA256, expectedApproval);
  assert.ok(f.methods.every(method => method === 'GET'));
});





test('caller abort(null) preserves the original reason and suppresses late HTTP', async () => {
  const controller = new AbortController(), context = Object.freeze({signal: controller.signal});
  let entered, release, fetches = 0;
  const started = new Promise(resolve => {entered = resolve;});
  const waiting = new Promise(resolve => {release = resolve;});
  const sdk = new YNXCloudClient({endpoint: 'https://public.invalid/api/v1', product: 'cloud',
    getDeploymentRequestHeaders: async (_request, actual) => {
      assert.equal(actual, context); entered(); await waiting; return {'X-Public-Fixture': 'NOT_AUTHORITY'};
    }, fetch: async () => {fetches++; throw Error('must not dispatch');}});
  const pending = sdk.getIDEDeploymentStatus('req_PUBLIC_NULL_CANCEL_000001', {originalRequestContext: context});
  const rejected = assert.rejects(pending, error => error === null);
  await started; controller.abort(null); await rejected; release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0);
});

test('legacy reads reject a mismatched or cancelled caller context before proof', async () => {
  const f = fixture(), other = new AbortController();
  await assert.rejects(f.client.lookupOriginal(f.selection, {signal: other.signal, originalRequestContext: f.context}), /context changed/);
  const reason = Error('PUBLIC cancelled');
  f.controller.abort(reason);
  await assert.rejects(f.client.inspect(f.selection, {originalRequestContext: f.context}), e => e === reason);
  assert.equal(f.paths.length, 0);
  assert.equal(f.methods.length, 0);
});

test('pre-cancelled legacy reads and rollback do not capture caller DATA', async () => {
  const f = fixture(), reason = Error('PUBLIC already cancelled');
  f.controller.abort(reason);
  let reads = 0;
  const poisoned = Object.defineProperty({}, 'requestId', {enumerable: true, get() {reads++; throw Error('must not read');}});
  const options = {originalRequestContext: f.context};
  for (const call of [
    () => f.client.lookupOriginal(poisoned, options),
    () => f.client.logs(poisoned, options),
    () => f.client.runtime(poisoned, options),
    () => f.client.inspect(poisoned, options),
    () => f.client.usage(poisoned, options),
    () => f.client.bill(poisoned, '2026-11-07', options),
    () => f.client.prepareRollback(poisoned, poisoned, options)
  ]) await assert.rejects(call(), error => error === reason);
  assert.equal(reads, 0);
  assert.equal(f.paths.length, 0);
  assert.equal(f.methods.length, 0);
});

test('pre-cancelled original signal cannot bypass its native abort check', async () => {
  const f = fixture(), reason = Error('PUBLIC native cancellation');
  f.controller.abort(reason);
  Object.defineProperty(f.controller.signal, 'throwIfAborted', {value() {}});
  let reads = 0;
  const selection = Object.defineProperty({}, 'requestId', {enumerable: true, get() {reads++; throw Error('must not read');}});
  await assert.rejects(f.client.lookupOriginal(selection, {originalRequestContext: f.context}), error => error === reason);
  assert.equal(reads, 0);
  assert.equal(f.paths.length, 0);
});

test('rollback returns no prepared DATA when the original read is cancelled before continuation', async () => {
  const f = fixture(), reason = Error('PUBLIC rollback cancellation');
  f.operation.state = 'completed'; f.operation.exitCode = 0;
  f.client.lookupOriginal = async () => {
    queueMicrotask(() => f.controller.abort(reason));
    return f.operation;
  };
  const input = {requestId: 'req_PUBLIC_ROLLBACK_CONTEXT_02', manifest: Buffer.from('PUBLIC manifest'),
    artifact: Buffer.from('PUBLIC artifact'), approval: Buffer.from('PUBLIC NEW_APPROVAL_NOT_SIGNATURE'),
    expectedSlotRevision: '1'};
  await assert.rejects(f.client.prepareRollback(f.selection, input, {originalRequestContext: f.context}), error => error === reason);
  assert.equal(f.paths.length, 0);
  assert.equal(f.methods.length, 0);
});
