import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createNativeParentControl, createNativeRequestCustody, attachUnavailableOriginalServiceChannel } from './native-parent-control.mjs';
import { attachNativeGoSelectionChannel } from './local-go-selection.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const frame = body => Buffer.from(JSON.stringify(body) + '\n');
const context = () => ({ id: randomUUID(), workspace: '/source-owned-control-only' });

test('actual Go subscription cancels and joins its own job without pausing Wallet input', async () => {
  const input = new PassThrough(), control = createNativeParentControl({ input }), ctx = context();
  let started, ended, cancelCount = 0; const startedPromise = new Promise(resolve => started = resolve), endedPromise = new Promise(resolve => ended = resolve);
  const results = [], wallet = [];
  // Transport-only consumer; no real toolchain supplier or Native grant.
  const store = { async prepare(root, { signal }) { started(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelCount++; reject(Error('cancelled')); }, { once: true })); }, async writeResult(directory, id, result) { results.push(result); ended(); } };
  const go = attachNativeGoSelectionChannel({ control, store, context: ctx, directory: '/unused' });
  const other = control.subscribe({ actions: ['original-service-dispatch'], receive: body => wallet.push(body.canonicalInput) });
  const id = randomUUID(); input.write(frame({ action: 'prepare-go', id, projectId: ctx.id, workspace: ctx.workspace, selectedRoot: '/no-supplier-in-this-control' }));
  await startedPromise;
  input.write(frame({ action: 'cancel-go', id, projectId: ctx.id, workspace: ctx.workspace }));
  await endedPromise; await go.finishCleanup();
  assert.equal(cancelCount, 1); assert.equal(results[0].status, 'cancelled');
  go.close(); go.close();
  input.write(frame({ action: 'original-service-dispatch', canonicalInput: 'unchanged bytes' })); await tick();
  assert.equal(input.readableFlowing, true); assert.deepEqual(wallet, ['unchanged bytes']);
  assert.equal(input.listenerCount('data'), 1);
  other.close(); await control.finishCleanup(); input.destroy();
});

test('single reader preserves UTF8 chunks and raw canonical strings without cross-routing', async () => {
  const input = new PassThrough(), control = createNativeParentControl({ input }), go = [], wallet = [];
  assert.equal(createNativeParentControl({ input }), control);
  input.write(frame({ action: 'prepare-go', id: 'queued-before-setup' })); await tick();
  assert.equal(input.listenerCount('data'), 0);
  control.subscribe({ actions: ['prepare-go'], receive: body => go.push(body) });
  control.subscribe({ actions: ['original-service-dispatch'], receive: body => wallet.push(body.canonicalInput) });
  assert.throws(() => control.subscribe({ actions: ['prepare-go'], receive() {} }), /unavailable/);
  const raw = '{"body":"中文\\nbody","operation":"restore","phase":"effect","proofHeader":"proof","requestId":"req_exact123456789"}';
  const bytes = Buffer.concat([frame({ action: 'original-service-dispatch', canonicalInput: raw }), frame({ action: 'prepare-go', id: 'go-only' })]);
  for (const byte of bytes) input.write(Buffer.from([byte])); await tick();
  assert.deepEqual(wallet, [raw]); assert.equal(go.length, 2); assert.equal(go[0].id, 'queued-before-setup'); assert.equal(go[1].id, 'go-only');
  await control.finishCleanup(); input.destroy();
});

test('oversize, invalid UTF8 and partial EOF retire all consumers once', async () => {
  for (const kind of ['oversize', 'utf8', 'partial']) {
    const input = new PassThrough(), errors = []; let closed = 0;
    const control = createNativeParentControl({ input, onError: error => errors.push(error) });
    control.subscribe({ actions: ['prepare-go'], receive() { assert.fail('invalid frame entered'); }, onClose() { closed++; } });
    if (kind === 'oversize') input.write(Buffer.alloc(262145, 65));
    if (kind === 'utf8') input.write(Buffer.from([123, 34, 0xc3, 0x28, 34, 125, 10]));
    if (kind === 'partial') { input.write('{"action":'); input.end(); }
    await tick(); await control.finishCleanup(); await control.finishCleanup();
    assert.equal(closed, 1); assert.equal(errors.length, 1); assert.equal(control.status().closed, true);
    assert.equal(input.listenerCount('data'), 0); input.destroy();
  }
});

test('EOF aborts owned Go work and waits for cleanup without duplicate retirement', async () => {
  const input = new PassThrough(), control = createNativeParentControl({ input }), ctx = context();
  let started, finish, aborted = 0; const ready = new Promise(resolve => started = resolve);
  const store = { async prepare(root, { signal }) { started(); await new Promise(resolve => { finish = resolve; signal.addEventListener('abort', () => { aborted++; }); }); }, async writeResult() { assert.fail('closed consumer published a result'); } };
  const go = attachNativeGoSelectionChannel({ control, store, context: ctx, directory: '/unused' });
  input.write(frame({ action: 'prepare-go', id: randomUUID(), projectId: ctx.id, workspace: ctx.workspace, selectedRoot: '/transport-only' }));
  await ready; input.end(); await tick(); assert.equal(aborted, 1);
  let drained = false; const cleanup = control.finishCleanup().then(() => { drained = true; });
  await tick(); assert.equal(drained, false); finish(); await cleanup; await go.finishCleanup();
  assert.equal(aborted, 1); assert.equal(control.status().pending, 0); input.destroy();
});

test('request custody fences duplicates/context and retains late UNKNOWN without replay', () => {
  const ctx = context(), instance = randomUUID(), custody = createNativeRequestCustody({ instance, context: ctx });
  const body = { id: randomUUID(), document: randomUUID(), instance, projectId: ctx.id, workspace: ctx.workspace, canonicalInput: 'opaque exact bytes' };
  assert.throws(() => custody.reserve({ ...body, instance: randomUUID() }), /invalid/);
  assert.throws(() => custody.reserve({ ...body, projectId: randomUUID() }), /invalid/);
  const row = custody.reserve(body); assert.throws(() => custody.reserve(body), /duplicate/);
  // This records a transport-owned entry observation; it grants no service.
  custody.observeEntry(row); custody.cancel(row.id, body.document); custody.retire();
  assert.equal(custody.retainCompletion(row, { retained: 'late' }), false);
  assert.equal(custody.status().unknown, true); assert.deepEqual(row.result, { retained: 'late' });
  assert.throws(() => custody.observeEntry(row), /cannot enter/);
  assert.throws(() => custody.retainCompletion(row, {}), /duplicate/);
  assert.throws(() => custody.reserve({ ...body, id: randomUUID() }), /stale/);
});

test('normal unavailable service result is pre-entry only; native script cancellation ignores late replies', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ynx-parent-control-')); await fs.chmod(directory, 0o700);
  const input = new PassThrough(), control = createNativeParentControl({ input }), ctx = context(), instance = randomUUID();
  const channel = attachUnavailableOriginalServiceChannel({ control, instance, context: ctx, directory });
  const body = { action: 'original-service-dispatch', id: randomUUID(), document: randomUUID(), instance, projectId: ctx.id, workspace: ctx.workspace, canonicalInput: '{"opaque":"unchanged"}' };
  input.write(frame(body)); await tick(); await control.finishCleanup();
  const result = JSON.parse(await fs.readFile(path.join(directory, 'wallet-' + body.id + '.json'), 'utf8'));
  assert.equal(result.status, 'unavailable'); assert.equal(result.entered, false); assert.equal(result.unknown, false); assert.equal(channel.status().unknown, false);
  input.destroy(); await fs.rm(directory, { recursive: true });

  const failedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ynx-parent-control-debt-')); await fs.chmod(failedDirectory, 0o700);
  const failedInput = new PassThrough(), errors = [], failedControl = createNativeParentControl({ input: failedInput, onError: error => errors.push(error) });
  const failedChannel = attachUnavailableOriginalServiceChannel({ control: failedControl, instance, context: ctx, directory: failedDirectory });
  const existing = path.join(failedDirectory, 'wallet-' + body.id + '.json'); await fs.writeFile(existing, 'preserved original', { mode: 0o600 });
  failedInput.write(frame(body)); await tick(); const failedCleanup = await failedControl.finishCleanup();
  assert.equal(failedCleanup.complete, false); assert.equal(errors.length, 1); assert.equal(failedChannel.status().cleanupFailure.code, 'EEXIST');
  assert.equal(await fs.readFile(existing, 'utf8'), 'preserved original');
  assert.equal(failedChannel.status().unknown, false); failedInput.destroy(); await fs.rm(failedDirectory, { recursive: true });

  const native = await fs.readFile(new URL('./macos/main.m', import.meta.url), 'utf8');
  const match = native.match(/NSString \*walletScript=@"([^\n]+)";/); assert.ok(match);
  const messages = [], events = {}, timers = new Map(); let timerId = 0;
  const sandbox = { location: { pathname: '/' }, crypto: { randomUUID }, TextEncoder, DOMException, AbortController,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id), addEventListener: (name, callback) => events[name] = callback,
    webkit: { messageHandlers: { ynxLocalWallet: { postMessage: body => messages.push(body) } } } };
  sandbox.window = sandbox; vm.runInNewContext(match[1], sandbox);
  const abort = new AbortController(); const pending = sandbox.ynxDesktopWallet.originalServiceDispatch('raw exact', { signal: abort.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  const request = messages.at(-1); abort.abort(); await rejected;
  assert.equal(messages.at(-1).action, 'original-service-cancel'); assert.equal(messages.at(-1).id, request.id);
  sandbox.__ynxOriginalServiceReply({ id: request.id, document: request.document, value: 'late' });
  assert.equal(timers.size, 0);
  const before = messages.length; await assert.rejects(sandbox.ynxDesktopWallet.originalServiceDispatch('raw', { signal: abort.signal })); assert.equal(messages.length, before);
  sandbox.webkit.messageHandlers.ynxLocalWallet.postMessage = () => { throw Error('native pipe gone'); };
  await assert.rejects(sandbox.ynxDesktopWallet.originalServiceDispatch('raw'), /native pipe gone/); assert.equal(timers.size, 0);
  assert.match(native, /self\.server!=server/); assert.match(native, /self\.localWalletGeneration!=generation/);
  assert.match(native, /window\.__ynxOriginalServiceDocument===%@/);
});
