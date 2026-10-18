import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createNativeParentControl } from './native-parent-control.mjs';
import { attachOriginalServicePipe } from './original-service-pipe.mjs';
const { __PUBLIC_TEST_ONLY_attachAcquired: attachAcquired } = await import('./original-service-pipe.mjs');
assert.equal(typeof attachAcquired, 'function', 'external PUBLIC test exposure required; never a production export');

// PUBLIC transport controls. The snapshot contains the unchanged sole-SDK pure
// decoder, extracted without loading its Native/Host acquisition graph. The
// fake original below is never installed by normal startup or made a grant.
assert.ok(process.env.YNX_IDE_PIPE_CODEC_SNAPSHOT, 'explicit read-only SDK CODE snapshot required');
const codec = await import(pathToFileURL(process.env.YNX_IDE_PIPE_CODEC_SNAPSHOT));
mock.module(new URL('../../../packages/wallet-auth/src/original-wallet-service-private-dispatch.js', import.meta.url).href,
  { namedExports: { decodeOriginalWalletServicePrivateRequest: codec.decodeOriginalWalletServicePrivateRequest } });
mock.module(new URL('../../../packages/wallet-auth/src/canonical.js', import.meta.url).href,
  { namedExports: { canonicalJSON: codec.canonicalJSON } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function waitFor(read) {
  // Observe a real file/condition until a bounded deadline. A fixed count of
  // immediate callbacks can expire before the required actual fsync returns.
  const deadline = Date.now() + 2000; let last;
  while (Date.now() < deadline) { try { return await read(); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'NOT_YET') throw e; last = e; } await new Promise(resolve => setTimeout(resolve, 2)); }
  throw last;
}
const request = serial => codec.canonicalJSON({ requestId: 'req_PUBLIC_PIPE_' + String(serial).padStart(6, '0'), operation: 'restore', phase: 'time', body: null, proofHeader: null });
async function fixture({ earlyDispatch = false, heldOriginal = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ynx-ide-pipe-public-')); await fs.chmod(directory, 0o700);
  const input = new PassThrough(), control = createNativeParentControl({ input }), instance = randomUUID(), context = { id: randomUUID(), workspace: '/public/transport-only' };
  const state = { dispatches: [], acks: [], currentReads: 0, terminal: false, response: { status: 200, headers: { 'x-request-id': 'req_PUBLIC_PIPE_000001' }, body: '{ "exact": "PUBLIC" }' } };
  const original = {
    async dispatch(raw) { state.dispatches.push(raw); if (state.dispatchGate) await state.dispatchGate; return state.response; },
    async acknowledge(...args) { state.acks.push(args); if (state.forbidAck) throw Error('PUBLIC_DUPLICATE_BUSINESS_ACK'); if (state.ackGate) await state.ackGate; if (state.ackFailurePresent) throw state.ackFailure; state.terminal = true; },
    selectCurrentOutcome() { state.currentReads++; if (state.currentFailureAt === state.currentReads) throw state.currentFailure;
      return { result: state.response, terminal: state.terminal, unknown: !state.terminal }; },
  };
  const body = { action: 'original-service-dispatch', id: randomUUID(), document: randomUUID(), instance, projectId: context.id, workspace: context.workspace, canonicalInput: request(1) };
  const send = value => input.write(Buffer.from(JSON.stringify(value) + '\n'));
  if (earlyDispatch) { control.subscribe({ actions: ['prepare-go'], receive() {} }); await tick(); }
  const ownerGate = heldOriginal ? deferred() : undefined;
  const errors = [], attaching = attachAcquired({ control, instance, context, directory, onError: e => errors.push(e) }, ownerGate?.promise || original);
  if (earlyDispatch) send(body);
  const channel = await attaching;
  const read = suffix => fs.readFile(path.join(directory, 'wallet-' + body.id + suffix + '.json'), 'utf8').then(JSON.parse);
  const received = digest => ({ action: 'original-service-received', id: body.id, document: body.document, instance, projectId: context.id, workspace: context.workspace, resultDigest: digest });
  const cancel = () => { const { canonicalInput, ...value } = body; send({ ...value, action: 'original-service-cancel' }); };
  return { directory, input, control, context, instance, body, state, errors, channel, send, read, received, cancel,
    originalReady() { ownerGate?.resolve(original); },
    async dispose() { channel.close(); await channel.finishCleanup(); await control.finishCleanup(); input.destroy(); await fs.rm(directory, { recursive: true, force: true }); } };
}
test('R91 first renderer request waits for the same selected SDK original before entering',async()=>{
  const f=await fixture({heldOriginal:true});try{
    f.send(f.body);await tick();assert.equal(f.state.dispatches.length,0);
    f.originalReady();const provisional=await waitFor(()=>f.read(''));
    assert.equal(f.state.dispatches.length,1);f.send(f.received(provisional.resultDigest));await waitFor(()=>f.read('-terminal'));
  }finally{await f.dispose();}
});
test('R91 cancelled renderer request cannot enter when selected original becomes ready late',async()=>{
  const f=await fixture({heldOriginal:true});try{
    f.send(f.body);await tick();f.cancel();f.originalReady();await tick();await f.channel.finishCleanup();
    assert.equal(f.state.dispatches.length,0);await assert.rejects(f.read(''),{code:'ENOENT'});
  }finally{await f.dispose();}
});
test('normal entry refuses caller-supplied providers and preserves the original unavailable response', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ynx-ide-pipe-null-')); await fs.chmod(directory, 0o700);
  const input = new PassThrough(), control = createNativeParentControl({ input }), instance = randomUUID(), context = { id: randomUUID(), workspace: '/public/no-supplier' };
  let accesses = 0; const options = { control, instance, context, directory };
  const injected = { ...options, get original() { accesses++; return {}; } };
  await assert.rejects(attachOriginalServicePipe(injected)); assert.equal(accesses, 0);
  const channel = await attachOriginalServicePipe(options), id = randomUUID();
  try {
    input.write(Buffer.from(JSON.stringify({ action: 'original-service-dispatch', id, document: randomUUID(), instance, projectId: context.id, workspace: context.workspace, canonicalInput: request(1) }) + '\n'));
    const result = await waitFor(() => fs.readFile(path.join(directory, 'wallet-' + id + '.json'), 'utf8').then(JSON.parse));
    assert.equal(Object.keys(result).length, 8); assert.equal(result.error, 'ORIGINAL_PRIVATE_SERVICE_NOT_SUPPLIED'); assert.equal(result.entered, false); assert.equal(result.unknown, false);
  } finally { channel.close(); await channel.finishCleanup(); await control.finishCleanup(); input.destroy(); await fs.rm(directory, { recursive: true, force: true }); }
});
test('PUBLIC first-use service frame during SDK CODE loading is retained after Go began reading', async () => {
  const f = await fixture({ earlyDispatch: true }); try {
    const p = await waitFor(() => f.read('')); assert.equal(f.state.dispatches.length, 1);
    f.send(f.received(p.resultDigest)); await waitFor(() => f.read('-terminal'));
  } finally { await f.dispose(); }
});
test('PUBLIC actual stdin and files: response is provisional until one original SDK ACK/current completion', async () => {
  const f = await fixture(); try {
    f.send(f.body); const provisional = await waitFor(() => f.read(''));
    assert.equal(provisional.status, 'response-pending-terminal'); assert.equal(provisional.unknown, true);
    assert.equal(provisional.resultRaw, codec.canonicalJSON(f.state.response)); assert.equal(f.state.acks.length, 0);
    await assert.rejects(f.read('-terminal'), { code: 'ENOENT' });
    f.send(f.received(provisional.resultDigest)); const terminal = await waitFor(() => f.read('-terminal'));
    assert.equal(terminal.status, 'terminal'); assert.equal(terminal.unknown, false);
    assert.deepEqual(f.state.dispatches, [f.body.canonicalInput]);
    assert.deepEqual(f.state.acks, [['restore', 'time', 'req_PUBLIC_PIPE_000001', provisional.resultDigest]]);
    assert.equal(f.channel.status().unknown, false); assert.equal((await f.channel.finishCleanup()).complete, true);
  } finally { await f.dispose(); }
});
test('PUBLIC already-terminal current original is delivered without a second business ACK', async () => {
  const f = await fixture(); try {
    f.state.terminal = true; f.state.forbidAck = true; f.send(f.body); const p = await waitFor(() => f.read(''));
    f.send(f.received(p.resultDigest)); const terminal = await waitFor(() => f.read('-terminal'));
    assert.equal(terminal.unknown, false); assert.equal(f.state.acks.length, 0); assert.equal(f.state.dispatches.length, 1);
  } finally { await f.dispose(); }
});
test('PUBLIC server terminal DTO flags cannot replace this acquired client own terminal ACK', async () => {
  const f = await fixture(); try {
    f.state.response.body = codec.canonicalJSON({ terminal: true, unknown: false, owner: 'PUBLIC_OTHER_DAEMON' });
    f.send(f.body); const p = await waitFor(() => f.read('')); f.send(f.received(p.resultDigest)); await waitFor(() => f.read('-terminal'));
    assert.equal(f.state.acks.length, 1); assert.equal(f.state.terminal, true);
  } finally { await f.dispose(); }
});
test('PUBLIC v4 uses the sole SDK decoder and retains exact reference request/inner response strings', async () => {
  const f = await fixture(); try {
    f.body.canonicalInput = codec.canonicalJSON({ requestId: 'req_PUBLIC_REFERENCE_001', operation: 'beginYNX', phase: 'effect', proofHeader: null,
      carrierVersion: 'YNX-PRODUCT-SESSION-PRIVATE/v4', referenceAction: 'challenge', body: codec.canonicalJSON({ reference: 'ynxpsr1_' + 'A'.repeat(43), request: { version: '2' } }) });
    f.send(f.body); const p = await waitFor(() => f.read('')); assert.equal(f.state.dispatches[0], f.body.canonicalInput);
    f.send(f.received(p.resultDigest)); await waitFor(() => f.read('-terminal'));
    assert.equal(JSON.parse(p.resultRaw).body, '{ "exact": "PUBLIC" }'); assert.equal(f.state.acks[0][0], 'beginYNX');
  } finally { await f.dispose(); }
});
test('PUBLIC receipt duplicates join without a second SDK ACK; forged binding cannot acknowledge', async () => {
  const f = await fixture(), gate = deferred(); try {
    f.state.ackGate = gate.promise; f.send(f.body); const p = await waitFor(() => f.read(''));
    for (const key of ['document','instance','projectId','workspace']) f.send({ ...f.received(p.resultDigest), [key]: key === 'workspace' ? '/foreign' : randomUUID() });
    await tick(); assert.equal(f.state.acks.length, 0);
    f.send(f.received(p.resultDigest)); f.send(f.received(p.resultDigest));
    await waitFor(async () => { if (f.state.acks.length !== 1) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    gate.resolve(); await waitFor(() => f.read('-terminal')); assert.equal(f.state.acks.length, 1);
  } finally { gate.resolve(); await f.dispose(); }
});
test('PUBLIC dispatch then cancellation in the same input chunk never enters SDK', async () => {
  const f = await fixture(); try { f.send(f.body); f.cancel(); await tick(); await f.channel.finishCleanup();
    assert.equal(f.state.dispatches.length, 0); assert.equal(f.state.acks.length, 0); assert.equal(f.channel.status().unknown, false);
  } finally { await f.dispose(); }
});
test('PUBLIC late dispatch after cancellation retains UNKNOWN and cannot publish or retry', async () => {
  const f = await fixture(), gate = deferred(); try {
    f.state.dispatchGate = gate.promise; f.send(f.body);
    await waitFor(async () => { if (!f.state.dispatches.length) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    f.cancel(); gate.resolve(); await f.channel.finishCleanup();
    assert.equal(f.channel.status().unknown, true); assert.equal(f.channel.status().poisoned, true);
    await assert.rejects(f.read(''), { code: 'ENOENT' }); assert.equal(f.state.acks.length, 0);
    f.send({ ...f.body, id: randomUUID(), canonicalInput: request(2) }); await tick(); await f.channel.finishCleanup();
    assert.equal(f.state.dispatches.length, 1); assert.equal(f.state.dispatches[0], f.body.canonicalInput);
  } finally { gate.resolve(); await f.dispose(); }
});
test('PUBLIC receipt before a provisional response cannot preselect terminal ACK', async () => {
  const f = await fixture(), gate = deferred(); try {
    f.state.dispatchGate = gate.promise; f.send(f.body); f.send(f.received('a'.repeat(64))); await tick();
    assert.equal(f.state.acks.length, 0); gate.resolve(); const p = await waitFor(() => f.read(''));
    f.send(f.received(p.resultDigest)); await waitFor(() => f.read('-terminal')); assert.equal(f.state.acks.length, 1);
  } finally { gate.resolve(); await f.dispose(); }
});
test('PUBLIC wrong digest cannot select an operation or produce terminal success', async () => {
  const f = await fixture(); try {
    f.send(f.body); await waitFor(() => f.read('')); f.send(f.received('a'.repeat(64)));
    await waitFor(async () => { if (!f.channel.status().firstFailurePresent) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    assert.equal(f.state.acks.length, 0); assert.equal(f.channel.status().unknown, true); await assert.rejects(f.read('-terminal'), { code: 'ENOENT' });
  } finally { await f.dispose(); }
});
test('PUBLIC pipe retirement waits for late original call and reports incomplete cleanup', async () => {
  const f = await fixture(), gate = deferred(); try {
    f.state.dispatchGate = gate.promise; f.send(f.body);
    await waitFor(async () => { if (!f.state.dispatches.length) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    const cleanup = f.control.finishCleanup(); let settled = false; void cleanup.then(() => { settled = true; });
    await tick(); assert.equal(settled, false); gate.resolve();
    assert.equal((await cleanup).complete, false); assert.equal(f.channel.status().unknown, true); assert.equal(f.state.acks.length, 0);
    await assert.rejects(f.read(''), { code: 'ENOENT' });
  } finally { gate.resolve(); await f.dispose(); }
});
for (const cause of [false, undefined]) test(`PUBLIC ACK rejection ${String(cause)} retains first cause and no terminal file`, async () => {
  const f = await fixture(); try {
    f.state.ackFailurePresent = true; f.state.ackFailure = cause; f.send(f.body); const p = await waitFor(() => f.read(''));
    f.send(f.received(p.resultDigest));
    await waitFor(async () => { if (!f.channel.status().firstFailurePresent) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    assert.equal(f.channel.status().firstFailure, cause); assert.equal(f.channel.status().unknown, true);
    await assert.rejects(f.read('-terminal'), { code: 'ENOENT' }); assert.equal((await f.channel.finishCleanup()).complete, false);
  } finally { await f.dispose(); }
});
test('PUBLIC Source refusal after ACK cannot release terminal success', async () => {
  const f = await fixture(); try {
    f.send(f.body); const p = await waitFor(() => f.read('')); f.state.currentFailureAt = f.state.currentReads + 2; f.state.currentFailure = false;
    f.send(f.received(p.resultDigest)); await waitFor(async () => { if (!f.channel.status().firstFailurePresent) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    assert.equal(f.state.acks.length, 1); assert.equal(f.channel.status().firstFailure, false);
    await assert.rejects(f.read('-terminal'), { code: 'ENOENT' });
  } finally { await f.dispose(); }
});
test('PUBLIC post-link current refusal leaves nlink2 evidence that Native cannot consume', async () => {
  const f = await fixture(); try {
    f.send(f.body); const p = await waitFor(() => f.read('')); f.state.currentFailureAt = f.state.currentReads + 4; f.state.currentFailure = undefined;
    f.send(f.received(p.resultDigest)); await waitFor(async () => { if (!f.channel.status().firstFailurePresent) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    const st = await fs.stat(path.join(f.directory, 'wallet-' + f.body.id + '-terminal.json'));
    assert.equal(st.nlink, 2); assert.equal(f.channel.status().unknown, true);
  } finally { await f.dispose(); }
});
test('PUBLIC existing result is never overwritten and sibling Go routing remains alive', async () => {
  const f = await fixture(); try {
    const target = path.join(f.directory, 'wallet-' + f.body.id + '.json'); await fs.writeFile(target, 'PUBLIC_ORIGINAL', { mode: 0o600 });
    let go = 0; const sibling = f.control.subscribe({ actions: ['prepare-go'], receive: () => go++ });
    f.send(f.body); await waitFor(async () => { if (!f.channel.status().firstFailurePresent) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; });
    assert.equal(await fs.readFile(target, 'utf8'), 'PUBLIC_ORIGINAL'); assert.equal(f.state.acks.length, 0);
    f.send({ action: 'prepare-go' }); await tick(); assert.equal(go, 1); sibling.close();
  } finally { await f.dispose(); }
});
test('PUBLIC malformed >64KiB service raw is refused by SDK, without expanding Go framing or entering service', async () => {
  const f = await fixture(); try {
    f.body.canonicalInput = '"'.repeat(150000); f.send(f.body); const rejected = await waitFor(() => f.read(''));
    assert.equal(rejected.status, 'failed'); assert.equal(rejected.entered, false); assert.equal(f.state.dispatches.length, 0);
    assert.equal(f.control.status().closed, false); assert.equal(f.channel.status().poisoned, false);
    f.body.id = randomUUID(); f.body.canonicalInput = request(2); f.send(f.body);
    const p = await waitFor(() => f.read('')); f.send(f.received(p.resultDigest)); await waitFor(() => f.read('-terminal'));
    assert.equal(f.state.dispatches.length, 1);
  } finally { await f.dispose(); }
});
test('PUBLIC exact 64KiB response uses only the private service wrapper; 64KiB+1 is not accepted', async () => {
  for (const extra of [0, 1]) {
    const f = await fixture(); try {
      const overhead = Buffer.byteLength(codec.canonicalJSON({ ...f.state.response, body: '' }));
      f.state.response.body = 'x'.repeat(65536 - overhead + extra); f.send(f.body);
      if (!extra) { const p = await waitFor(() => f.read('')); assert.equal(Buffer.byteLength(p.resultRaw), 65536); }
      else { await waitFor(async () => { if (!f.channel.status().firstFailurePresent) throw Object.assign(Error(), { code: 'NOT_YET' }); return true; }); await assert.rejects(f.read(''), { code: 'ENOENT' }); }
      assert.equal(f.state.acks.length, 0);
    } finally { await f.dispose(); }
  }
});
