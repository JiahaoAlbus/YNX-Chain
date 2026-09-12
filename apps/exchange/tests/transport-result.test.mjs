import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeOnce } from '../scripts/transport-result.mjs';

const options = () => ({ executable: '/usr/bin/ssh', argv: ['private-key-path-not-to-be-logged'],
  input: Buffer.from('frozen-payload'), timeoutMs: 120000,
  validateReceipt: raw => JSON.parse(raw).status === 'PLACED_EXACT' });

test('transport records exactly one invocation and accepts only expected nonempty receipt', () => {
  let calls = 0;
  const o = options();
  const r = invokeOnce(o, (exe, argv, passed) => {
    calls++; assert.equal(exe, o.executable); assert.deepEqual(argv, o.argv);
    assert.deepEqual(passed.input, o.input); assert.equal(passed.timeout, 120000);
    return { status: 0, signal: null, stdout: Buffer.from('{"status":"PLACED_EXACT"}'), stderr: Buffer.alloc(0) };
  });
  assert.equal(calls, 1); assert.equal(r.receipt.terminalReceiptValidated, true);
  assert.equal(r.receipt.retryAttempted, false);
  assert.doesNotMatch(JSON.stringify(r.receipt), /private-key|frozen-payload/);
});

for (const [name, result, expectedCode] of [
  ['silent zero', { status: 0 }, null],
  ['nonzero', { status: 255 }, null],
  ['timeout', { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'private-key-path-not-to-be-logged' } }, 'ETIMEDOUT'],
  ['spawn failure', { status: null, error: { code: 'ENOENT' } }, 'ENOENT'],
  ['wrong receipt', { status: 0, stdout: Buffer.from('{"status":"OTHER"}') }, null],
  ['invalid receipt', { status: 0, stdout: Buffer.from('not-json') }, null],
]) test(`transport ${name} is fail closed without retry or remote-state inference`, () => {
  let calls = 0;
  const r = invokeOnce(options(), () => { calls++; return result; });
  assert.equal(calls, 1); assert.equal(r.receipt.terminalReceiptValidated, false);
  assert.equal(r.receipt.outcome, 'FAILED_CLOSED_REMOTE_STATE_UNPROVEN');
  assert.equal(r.receipt.processExitStatus, result.status);
  assert.equal(r.receipt.processErrorCode, expectedCode);
  assert.doesNotMatch(JSON.stringify(r.receipt), /private-key/);
});

test('invalid local contract calls no process', () => {
  let calls = 0;
  for (const change of [{ executable: 'ssh' }, { timeoutMs: 300000 }, { input: 'text' }, { validateReceipt: null }]) {
    assert.throws(() => invokeOnce({ ...options(), ...change }, () => { calls++; }), /INVALID_FROZEN_TRANSPORT_INPUT/);
  }
  assert.equal(calls, 0);
});
