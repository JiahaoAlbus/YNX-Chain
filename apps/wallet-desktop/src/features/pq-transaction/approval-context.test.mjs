import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {DesktopKeyLifecycle} from '../../key-lifecycle.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {readPQTransferOriginal, exactData} from './transfer-binding.mjs';
import {createPQTransactionSubmission, pqBroadcastPermissionRequest} from './submission.mjs';

const vector = JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz', import.meta.url)), {maxOutputLength: 8 * 1024 * 1024}));
const fixtureOriginal = vector.originals.find(row => row.name === 'transfer-lost-response');
const account = vector.owner, networkId = vector.networkId;
const original = createPQOriginalRecord({account, kind: 'pq-transfer', operationId: 'QA-approval-context-original',
  request: preparePQTransferTransport(Buffer.from(fixtureOriginal.wire, 'base64'))});
const unknownPacket = vector.http.find(row => row.name === 'transfer-outcome-unknown');
const unknown = Object.freeze({status: unknownPacket.statusCode, text: Buffer.from(unknownPacket.bodyWire, 'base64').toString('utf8')});
const tick = () => new Promise(resolve => setImmediate(resolve));
const requestFields = ['action', 'networkId', 'nativeChainId', 'account', 'operationId', 'origin', 'transfer', 'requestDigest', 'transportHash'];
const transferFields = ['chainId', 'nativeChainId', 'from', 'to', 'amount', 'fee', 'nonce'];
const fail = code => { throw Object.assign(Error(code), {code}); };

// Test-local MODEL of the proposed original Main wiring. AsyncLocalStorage,
// FileTransactionIntentStore, controller and DesktopKeyLifecycle are real.
// Capsules, borrows, permission and transport below are CONTROLLED counters;
// no Electron sender, production Auth factory or real approval is established.
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'ynx-pq-approval-context-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filePath = path.join(directory, 'journal.json'), store = new FileTransactionIntentStore({filePath});
  await store.reserveOriginal(account, 'pq-transfer');
  store.captureOriginal(account, original, 'pq-transfer');
  await store.saveOriginal(account, original.hash, () => {});
  const lifecycle = new DesktopKeyLifecycle({authorizer: {available: () => true, authenticate: async () => {}, inProcess: true},
    focused: () => true, schedule: () => null, unschedule: () => {}});
  lifecycle.setAccount(account); await lifecycle.unlock();
  const approvalContext = new AsyncLocalStorage(), recognized = new WeakSet();
  const counts = {factoryCalls: 0, authCalls: 0, selectedBeforeAwait: 0, sameContextAfterAwait: 0, posts: 0,
    completed: 0, resourceRetired: 0, resourceJoined: 0, resourceClosed: 0,
    unusedCapsuleRetired: 0, unusedBorrowRetired: 0, unusedBorrowJoined: 0, unusedBorrowClosed: 0, outsideFinally: 0};

  const assertExpected = (request, expected) => {
    exactData(request, requestFields, 'QA_APPROVAL_CONTEXT_MISMATCH');
    exactData(expected, requestFields, 'QA_APPROVAL_CONTEXT_MISMATCH');
    exactData(request.transfer, transferFields, 'QA_APPROVAL_CONTEXT_MISMATCH');
    exactData(expected.transfer, transferFields, 'QA_APPROVAL_CONTEXT_MISMATCH');
    for (const key of requestFields) {
      if (key === 'transfer') {
        if (transferFields.some(field => request.transfer[field] !== expected.transfer[field])) fail('QA_APPROVAL_CONTEXT_MISMATCH');
      } else if (request[key] !== expected[key]) fail('QA_APPROVAL_CONTEXT_MISMATCH');
    }
  };
  const controlledAuthFactory = async (request, capsule, borrow) => {
    counts.authCalls++;
    const context = approvalContext.getStore();
    assert.ok(context); assert.equal(context.capsule, capsule); assert.equal(context.borrow, borrow);
    assert.equal(context.selected, true); counts.selectedBeforeAwait++;
    await tick();
    assert.equal(approvalContext.getStore(), context); counts.sameContextAfterAwait++;
    context.guard.assert(); assertExpected(request, context.expectedRequest);
    const now = Date.now(), binding = Object.freeze({...request, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString()});
    const permission = {
      readOriginal: () => binding, assertCurrent() {}, async recheck() { await tick(); }, enterBroadcast() {},
      complete() { counts.completed++; }, retire() { counts.resourceRetired++; },
      async join() { counts.resourceJoined++; }, async close() { counts.resourceClosed++; },
    };
    recognized.add(permission); return permission;
  };
  const acquireFromContext = async request => {
    counts.factoryCalls++;
    const context = approvalContext.getStore();
    if (!context || context.selected) fail('QA_APPROVAL_CONTEXT_REQUIRED');
    context.guard.assert();
    assertExpected(request, context.expectedRequest);
    // Consume the original context before crossing any await or Auth callback.
    context.selected = true;
    return controlledAuthFactory(request, context.capsule, context.borrow);
  };
  // Exactly one controller per fixture, shared across every approval attempt.
  const singleton = createPQTransactionSubmission({intentStore: store, networkId,
    acquireOriginalWalletTransactionPermission: acquireFromContext,
    isOriginalWalletTransactionPermission: value => recognized.has(value),
    transport: {async submitTransfer(request, assertCurrent) {
      assertCurrent(); counts.posts++;
      assert.equal(request.transportHash, original.hash);
      assert.equal((await new FileTransactionIntentStore({filePath}).readPQProgress(account, original.hash, () => {})).status, 'submission-unknown');
      return unknown;
    }}});

  const approveModel = (patch = null) => lifecycle.run(async guard => {
    // Independent journal read constructs the expected request before the
    // controller reconstructs its own request; renderer input supplies none.
    const plan = await readPQTransferOriginal(store, original.hash, {account, networkId, guard});
    const expected = pqBroadcastPermissionRequest(plan.binding);
    const context = {capsule: Object.freeze({modelOnly: 'capsule'}), borrow: Object.freeze({modelOnly: 'borrow'}),
      expectedRequest: patch ? Object.freeze({...expected, ...patch}) : expected, guard, selected: false};
    try { return await approvalContext.run(context, () => singleton.broadcast(original.hash, guard)); }
    finally {
      assert.equal(approvalContext.getStore(), undefined); counts.outsideFinally++;
      if (!context.selected) {
        counts.unusedCapsuleRetired++; counts.unusedBorrowRetired++;
        await tick(); counts.unusedBorrowJoined++; counts.unusedBorrowClosed++;
      }
    }
  });
  return {store, filePath, lifecycle, singleton, approvalContext, counts, approveModel};
}

test('one singleton factory retains the selected approval context and independently bound expected request across await', async t => {
  const f = await setup(t), singleton = f.singleton;
  const result = await f.approveModel();
  assert.equal(f.singleton, singleton); assert.equal(result.status, 'submission-unknown'); assert.equal(result.consensusFinality, false);
  assert.equal(f.counts.factoryCalls, 1); assert.equal(f.counts.authCalls, 1);
  assert.equal(f.counts.selectedBeforeAwait, 1); assert.equal(f.counts.sameContextAfterAwait, 1);
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.completed, 1);
  assert.equal(f.counts.resourceRetired, 1); assert.equal(f.counts.resourceJoined, 1); assert.equal(f.counts.resourceClosed, 1);
  assert.equal(f.counts.unusedCapsuleRetired, 0); assert.equal(f.counts.unusedBorrowClosed, 0);
  assert.equal(f.counts.outsideFinally, 1); assert.equal(f.approvalContext.getStore(), undefined);
  await tick(); assert.equal(f.approvalContext.getStore(), undefined);
});

test('wrong context hash or operation ID cannot enter the Auth model, mutate the journal or POST', async t => {
  for (const patch of [{transportHash: '0x' + '0'.repeat(64)}, {operationId: 'QA-other-operation'}]) {
    const f = await setup(t), before = await fs.readFile(f.filePath, 'utf8');
    await assert.rejects(f.approveModel(patch), {code: 'QA_APPROVAL_CONTEXT_MISMATCH'});
    assert.equal(f.counts.factoryCalls, 1); assert.equal(f.counts.authCalls, 0); assert.equal(f.counts.posts, 0);
    assert.equal(f.counts.selectedBeforeAwait, 0); assert.equal(f.counts.resourceRetired, 0);
    assert.equal(f.counts.unusedCapsuleRetired, 1); assert.equal(f.counts.unusedBorrowRetired, 1);
    assert.equal(f.counts.unusedBorrowJoined, 1); assert.equal(f.counts.unusedBorrowClosed, 1);
    assert.equal(await fs.readFile(f.filePath, 'utf8'), before); assert.equal(f.approvalContext.getStore(), undefined);
  }
});

test('existing UNKNOWN bypasses the factory and Main-model finally releases only the unconsumed capsule and borrow', async t => {
  const f = await setup(t), singleton = f.singleton;
  await f.store.beginPQSubmission(account, original.hash, () => {});
  const before = await fs.readFile(f.filePath, 'utf8');
  await assert.rejects(f.approveModel(), {code: 'PQ_TRANSACTION_ALREADY_ENTERED'});
  assert.equal(f.singleton, singleton); assert.equal(f.counts.factoryCalls, 0); assert.equal(f.counts.authCalls, 0); assert.equal(f.counts.posts, 0);
  assert.equal(f.counts.resourceRetired, 0); assert.equal(f.counts.resourceJoined, 0); assert.equal(f.counts.resourceClosed, 0);
  assert.equal(f.counts.unusedCapsuleRetired, 1); assert.equal(f.counts.unusedBorrowRetired, 1);
  assert.equal(f.counts.unusedBorrowJoined, 1); assert.equal(f.counts.unusedBorrowClosed, 1);
  assert.equal(await fs.readFile(f.filePath, 'utf8'), before); assert.equal(f.approvalContext.getStore(), undefined);
  assert.equal((await new FileTransactionIntentStore({filePath: f.filePath}).readPQOriginals(account, () => {}))[0].wire, original.wire);
});
