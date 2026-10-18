import test from 'node:test';
import assert from 'node:assert/strict';
import { OriginalIDEIdentityCall } from './wallet-identity-v2-caller.mjs';

// Caller lifecycle models only. These doubles are NOT Native authority,
// signatures, public receipts, real key custody or product acceptance.
const entry = 'file:///Applications/YNX%20Developer.app/Contents/Resources/server.mjs';
function fixture({ kind = 'receive', overrides = {}, constructFailure, onConstruct } = {}) {
  const calls = [], raw = '{"native-held-public-request":true}';
  const causes = Object.freeze({ receive: 'AUTH-IDENTITY-RECEIVE', recover: 'AUTH-IDENTITY-RECOVER', keyCall: 'AUTH-PROTECTED-KEY-CALL' });
  const status = Object.freeze({ phase: 'unknown', ready: false, unknown: true,
    retired: false, cleanupComplete: false, disposed: false, firstCauseCode: 'MODEL_UNKNOWN' });
  const owner = {
    assertReady() { calls.push(['ready']); }, current() { calls.push(['current']); },
    copyRequestOriginal() { calls.push(['request']); return raw; },
    completeProof(...args) { calls.push(['proof', ...args]); },
    result() { calls.push(['result']); return undefined; },
    invoke(...args) { calls.push(['invoke', ...args]); return undefined; },
    retire() { calls.push(['retire']); }, join() { calls.push(['join']); },
    close() { calls.push(['close']); },
    status() { assert.equal(this, owner); return status; },
    ...overrides,
  };
  const construct = (...args) => { calls.push(['construct', ...args]); onConstruct?.(); if (constructFailure) throw constructFailure; return owner; };
  const contract = {
    AUTH_IDENTITY_PURPOSES: causes,
    parseOriginalAuthIdentityRequest(value) { assert.equal(value, raw); calls.push(['parse', value]); return { purpose: causes[kind] }; },
    encodeOriginalAuthIdentityRequest(value) { calls.push(['encode', value]); return new Uint8Array([69, 1, 2]); },
  };
  const binding = { receiveOriginalIDEIdentity: construct, recoverOriginalIDEIdentity: construct, acquireOriginalIDEProtectedKeyCall: construct };
  return { caller: new OriginalIDEIdentityCall({ binding, actualEntryURL: entry, contract }), calls, owner, binding, contract, raw };
}
test('absent actual Native export refuses availability; never manufactures a successful owner', () => {
  const caller = new OriginalIDEIdentityCall({ binding: {}, actualEntryURL: entry, contract: {} });
  assert.throws(() => caller.begin('receive'), { code: 'IDE_IDENTITY_NATIVE_UNAVAILABLE' });
  assert.equal(caller.status().ready, false);
  assert.throws(() => caller.begin('receive'), { code: 'IDE_IDENTITY_CALL_ALREADY_SELECTED' });
});
test('retains SAME returned partial before assertReady failure and joins before its only close', () => {
  const original = new Error('original backend-only first cause');
  const f = fixture({ overrides: { assertReady() { throw original; } } });
  assert.throws(() => f.caller.begin('receive'), e => e === original);
  assert.equal(f.caller.status(), f.owner.status()); // Native owns status, not local success inference
  assert.throws(() => f.caller.close(), { code: 'IDE_IDENTITY_JOIN_REQUIRED' });
  f.caller.retire(); f.caller.join(); f.caller.close(); f.caller.close();
  assert.deepEqual(f.calls.filter(c => ['retire', 'join', 'close'].includes(c[0])).map(c => c[0]), ['retire', 'join', 'close']);
});
test('uses only Native original and sole SDK E encoder; proof selection and UNKNOWN cannot replay', () => {
  let wire, entered = 0;
  const f = fixture({ overrides: { completeProof(value) { entered++; wire = value; throw undefined; } } });
  f.caller.begin('receive'); const request = f.caller.request();
  assert.equal(request.original, f.raw); assert.deepEqual([...request.message], [69, 1, 2]);
  assert.equal(request.authorized, false); assert.equal(request.dataOnly, true);
  assert.deepEqual(f.calls[0], ['construct', entry]);
  const input = new Uint8Array([3, 4]);
  let caught = false; try { f.caller.completeProof(input); } catch (e) { caught = true; assert.equal(e, undefined); }
  assert.equal(caught, true); input[0] = 99; assert.deepEqual([...wire], [3, 4]);
  try { f.caller.completeProof(input); } catch (e) { assert.equal(e, undefined); }
  assert.equal(entered, 1); assert.equal(f.caller.status().unknown, true);
  f.caller.retire(); f.caller.join(); f.caller.close();
  assert.equal(f.caller.status().unknown, true);
});
test('fixed purpose mismatch refuses before proof; retired request cannot be reused', () => {
  const f = fixture(); f.contract.parseOriginalAuthIdentityRequest = () => ({ purpose: 'AUTH-LOGIN' });
  f.caller.begin('recover'); assert.throws(() => f.caller.request(), { code: 'IDE_IDENTITY_PURPOSE_MISMATCH' });
  assert.equal(f.calls.filter(c => c[0] === 'proof').length, 0);
  const other = fixture(); other.caller.begin('receive'); other.caller.retire();
  assert.throws(() => other.caller.request(), { code: 'IDE_IDENTITY_CALL_RETIRED' });
});
test('key call captures invocation once; invokes same owner with zero selectors and unknown result', () => {
  const f = fixture({ kind: 'keyCall' });
  f.caller.begin('keyCall', '{"original-public-call":true}');
  assert.deepEqual(f.calls[0], ['construct', entry, '{"original-public-call":true}']);
  f.caller.request(); f.caller.completeProof(new Uint8Array([1]));
  assert.equal(f.caller.invoke(), undefined); assert.equal(f.caller.result(), undefined);
  assert.deepEqual(f.calls.find(c => c[0] === 'invoke'), ['invoke']);
  assert.throws(() => f.caller.invoke(), { code: 'IDE_IDENTITY_INVOCATION_UNAVAILABLE' });
  assert.equal(f.calls.filter(c => c[0] === 'invoke').length, 1);
});
test('preserves first close failure consistently even after an independent business failure', () => {
  const business = Error('business'), closing = Error('cleanup'); let closeCount = 0;
  const f = fixture({ overrides: { completeProof() { throw business; }, close() { closeCount++; throw closing; } } });
  f.caller.begin('receive'); f.caller.request(); assert.throws(() => f.caller.completeProof(new Uint8Array([1])), e => e === business);
  f.caller.retire(); f.caller.join();
  assert.throws(() => f.caller.close(), e => e === closing);
  assert.throws(() => f.caller.close(), e => e === closing);
  assert.equal(closeCount, 1);
});
test('pending join retains original owner without closing or replaying any operation', () => {
  let joined = false, count = 0; const pending = Error('pending');
  const f = fixture({ overrides: { join() { count++; if (!joined) throw pending; } } });
  f.caller.begin('receive'); f.caller.retire();
  assert.throws(() => f.caller.join(), e => e === pending);
  assert.throws(() => f.caller.close(), { code: 'IDE_IDENTITY_JOIN_REQUIRED' });
  joined = true; f.caller.join(); f.caller.close();
  assert.equal(count, 2); assert.equal(f.calls.filter(c => c[0] === 'construct').length, 1);
});
test('shared proof memory is refused and callers cannot rewrite private lifecycle to replay', () => {
  const f = fixture(); f.caller.begin('receive'); f.caller.request();
  assert.throws(() => f.caller.completeProof(new Uint8Array(new SharedArrayBuffer(16))), { code: 'IDE_IDENTITY_PROOF_BYTES_REQUIRED' });
  assert.equal(f.calls.filter(c => c[0] === 'proof').length, 0);
  assert.deepEqual(Object.keys(f.caller), []);
  f.caller.proofSelected = false; f.caller.failed = false; // unrelated public names cannot reset private state
  assert.throws(() => f.caller.completeProof(new Uint8Array([1])), { code: 'IDE_IDENTITY_PROOF_BYTES_REQUIRED' });
  assert.equal(f.calls.filter(c => c[0] === 'proof').length, 0);
});
test('an undefined close failure stays a failure on every later observation without double-close', () => {
  let calls = 0; const f = fixture({ overrides: { close() { calls++; throw undefined; } } });
  f.caller.begin('receive'); f.caller.retire(); f.caller.join();
  for (let i = 0; i < 2; i++) {
    let rejected = false;
    try { f.caller.close(); } catch (error) { rejected = true; assert.equal(error, undefined); }
    assert.equal(rejected, true);
  }
  assert.equal(calls, 1);
});
test('unrecognized and prototype action names cannot select the receive operation', () => {
  for (const action of ['toString', 'constructor', '__proto__', 'login', 'export']) {
    const f = fixture();
    assert.throws(() => f.caller.begin(action), { code: 'IDE_IDENTITY_CALL_INVALID' });
    assert.equal(f.calls.length, 0);
  }
});
test('proof cannot enter Native before the original request has been prepared for review', () => {
  const f = fixture(); f.caller.begin('receive');
  assert.throws(() => f.caller.completeProof(new Uint8Array([1])), { code: 'IDE_IDENTITY_REQUEST_UNAVAILABLE' });
  assert.equal(f.calls.filter(c => c[0] === 'proof').length, 0);
});
test('repeated UI reads keep the same original challenge and isolate mutable message bytes', () => {
  const f = fixture(); f.caller.begin('receive'); const one = f.caller.request();
  one.message[0] = 99; const two = f.caller.request();
  assert.equal(two.original, one.original); assert.deepEqual([...two.message], [69, 1, 2]);
  // Native holds the challenge. Reading it may copy again but must neither
  // reacquire an owner nor submit a proof or manufacture a current window.
  assert.equal(f.calls.filter(c => c[0] === 'construct').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'proof').length, 0);
});
test('reentrant retirement during acquisition cannot join or close before the returned partial is retained', () => {
  let joinError, closeError;
  const f = fixture({ onConstruct() {
    f.caller.retire();
    try { f.caller.join(); } catch (error) { joinError = error; }
    try { f.caller.close(); } catch (error) { closeError = error; }
  } });
  assert.throws(() => f.caller.begin('receive'), { code: 'IDE_IDENTITY_CALL_RETIRED' });
  assert.equal(joinError?.code, 'IDE_IDENTITY_JOIN_PENDING');
  assert.equal(closeError?.code, 'IDE_IDENTITY_JOIN_REQUIRED');
  assert.equal(f.calls.filter(c => c[0] === 'ready').length, 0);
  assert.equal(f.calls.filter(c => c[0] === 'retire').length, 1);
  f.caller.join(); f.caller.close();
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 1);
});
test('retirement reentered from Native current blocks request copying and publication', () => {
  const f = fixture({ overrides: { current() { f.caller.retire(); } } });
  f.caller.begin('receive');
  assert.throws(() => f.caller.request(), { code: 'IDE_IDENTITY_CALL_RETIRED' });
  assert.equal(f.calls.filter(c => c[0] === 'request').length, 0);
  assert.equal(f.calls.filter(c => c[0] === 'encode').length, 0);
});
test('retirement reentered at proof or invocation preflight cannot enter a new Native effect', () => {
  for (const stage of ['proof', 'invoke']) {
    let cancel = false;
    const f = fixture({ kind: 'keyCall', overrides: { current() { if (cancel) f.caller.retire(); } } });
    f.caller.begin('keyCall', 'PUBLIC_CAPTURED_INVOCATION'); f.caller.request();
    if (stage === 'invoke') f.caller.completeProof(new Uint8Array([1]));
    cancel = true;
    assert.throws(() => stage === 'proof' ? f.caller.completeProof(new Uint8Array([1])) : f.caller.invoke(), { code: 'IDE_IDENTITY_CALL_RETIRED' });
    assert.equal(f.calls.filter(c => c[0] === stage).length, 0);
  }
});
test('an entered Native effect must unwind before reentrant join or close can dispose its owner', () => {
  let joinError, closeError;
  const f = fixture({ overrides: { completeProof() {
    f.caller.retire();
    try { f.caller.join(); } catch (error) { joinError = error; }
    try { f.caller.close(); } catch (error) { closeError = error; }
  } } });
  f.caller.begin('receive'); f.caller.request();
  assert.throws(() => f.caller.completeProof(new Uint8Array([1])), { code: 'IDE_IDENTITY_CALL_RETIRED' });
  assert.equal(joinError?.code, 'IDE_IDENTITY_JOIN_PENDING');
  assert.equal(closeError?.code, 'IDE_IDENTITY_JOIN_REQUIRED');
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 0);
  f.caller.join(); f.caller.close();
  assert.equal(f.calls.filter(c => c[0] === 'close').length, 1);
});
test('first retire failure remains independent of a prior business failure and never reenters retirement', () => {
  const business = Error('business'), cleanup = Error('retire'); let retired = 0;
  const f = fixture({ overrides: { completeProof() { throw business; }, retire() { retired++; throw cleanup; } } });
  f.caller.begin('receive'); f.caller.request();
  assert.throws(() => f.caller.completeProof(new Uint8Array([1])), e => e === business);
  assert.throws(() => f.caller.retire(), e => e === cleanup);
  assert.throws(() => f.caller.retire(), e => e === cleanup);
  assert.equal(retired, 1);
});
test('reentrant close cannot report success before the entered original close finishes', () => {
  let nestedError, closed = 0;
  const f = fixture({ overrides: { close() {
    closed++;
    try { f.caller.close(); } catch (error) { nestedError = error; }
  } } });
  f.caller.begin('receive'); f.caller.retire(); f.caller.join(); f.caller.close();
  assert.equal(nestedError?.code, 'IDE_IDENTITY_CLOSE_PENDING');
  assert.equal(closed, 1);
});
