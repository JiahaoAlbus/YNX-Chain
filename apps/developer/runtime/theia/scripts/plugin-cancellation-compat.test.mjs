import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CancellationTokenSource: NativeSource } = require('@theia/core/lib/common/cancellation');
const { adaptApi } = require('../../ynx-workbench/lib/plugin-vscode-init-adapter');
const CompatibleSource = adaptApi({ CancellationTokenSource: NativeSource }).CancellationTokenSource;

test('extension disposal keeps pending results live without changing native behavior', async () => {
  const source = new CompatibleSource(), token = source.token;
  let cancelled = 0;
  token.onCancellationRequested(() => cancelled++);
  source.dispose();
  // Discovery transport may deliver its last payload after process close.
  const result = await new Promise(resolve => setImmediate(() => resolve(!token.isCancellationRequested)));
  assert.equal(result, true);
  assert.equal(cancelled, 0);
  source.cancel();
  assert.equal(token.isCancellationRequested, true);
  assert.equal(cancelled, 0);
  const native = new NativeSource();
  native.dispose();
  assert.equal(native.token.isCancellationRequested, true);
});

test('explicit cancellation, including dispose(true), still fires once', () => {
  for (const action of ['cancel', 'dispose']) {
    const source = new CompatibleSource();
    let cancelled = 0;
    source.token.onCancellationRequested(() => cancelled++);
    source[action](true);
    source.dispose(true);
    assert.equal(source.token.isCancellationRequested, true);
    assert.equal(cancelled, 1);
  }
});

test('early disposal yields an inert token and releases parent subscriptions', () => {
  const parent = new CompatibleSource();
  const child = new CompatibleSource(parent.token);
  const live = new CompatibleSource(parent.token);
  child.dispose();
  parent.cancel();
  child.cancel();
  child.dispose(true);
  assert.equal(child.token.isCancellationRequested, false);
  assert.equal(live.token.isCancellationRequested, true);
});

test('separate plugin factories share the compatible constructor', () => {
  assert.equal(adaptApi({ CancellationTokenSource: NativeSource }).CancellationTokenSource, CompatibleSource);
  assert.notEqual(CompatibleSource, NativeSource);
});
