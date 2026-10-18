import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {DesktopKeyLifecycle} from '../../key-lifecycle.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQTransactionSubmission} from './submission.mjs';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';
import {NORMAL_OPERATOR, CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';

const vector = JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz', import.meta.url)), {maxOutputLength: 8 * 1024 * 1024}));
const fixtureOriginal = vector.originals.find(row => row.name === 'transfer-lost-response');
const account = vector.owner, networkId = vector.networkId;
const original = createPQOriginalRecord({account, kind: 'pq-transfer', operationId: 'QA-adversarial-original',
  request: preparePQTransferTransport(Buffer.from(fixtureOriginal.wire, 'base64'))});
const packet = name => {
  const row = vector.http.find(value => value.name === name);
  return Object.freeze({status: row.statusCode, text: Buffer.from(row.bodyWire, 'base64').toString('utf8')});
};
const unknown = packet('transfer-outcome-unknown'), inclusion = packet('transfer-original-reconciled');

// Actual journal and key lifecycle, public producer fixtures, CONTROLLED Auth
// peer and transport. These tests confer no real permission or network result.
async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'ynx-pq-adversarial-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filePath = path.join(directory, 'journal.json'), store = new FileTransactionIntentStore({filePath});
  await store.reserveOriginal(account, 'pq-transfer');
  store.captureOriginal(account, original, 'pq-transfer');
  await store.saveOriginal(account, original.hash, () => {});
  const lifecycle = new DesktopKeyLifecycle({authorizer: {available: () => true, authenticate: async () => {}, inProcess: true},
    focused: () => true, schedule: () => null, unschedule: () => {}});
  lifecycle.setAccount(account); await lifecycle.unlock();
  const counts = {posts: 0, gets: 0, acquired: 0, retired: 0, joined: 0, closed: 0, completed: 0};
  const recognized = new WeakSet();
  const acquire = async request => {
    counts.acquired++;
    const index = counts.acquired;
    const now = Date.now(), binding = Object.freeze({...request, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString(), policyRevision: '1'});
    const resource = {
      readOriginal: () => binding, assertCurrent() {},
      async recheck() { if (options.cleanupDebt && index === 1) throw Object.assign(Error('Controlled revoked peer'), {code: 'QA_REVOKED'}); },
      enterBroadcast() {}, complete() { counts.completed++; },
      retire() { counts.retired++; },
      async join() { counts.joined++; if (options.cleanupDebt && index === 1) throw Object.assign(Error('Controlled join failure'), {code: 'QA_JOIN_FAILED'}); },
      async close() { counts.closed++; },
    };
    recognized.add(resource); return resource;
  };
  const transport = options.transportFactory ? options.transportFactory({lifecycle, counts}) : {
    async submitTransfer(request) {
      counts.posts++;
      const cold = new FileTransactionIntentStore({filePath});
      assert.equal((await cold.readPQProgress(account, original.hash, () => {})).status, 'submission-unknown');
      assert.deepEqual(request.body, Buffer.from(original.wire, 'base64url'));
      if (options.throwFalse) throw false;
      if (options.lateLock) lifecycle.lock('focus-lost');
      return options.lateLock ? inclusion : unknown;
    },
    async readOriginal(hash) { counts.gets++; assert.equal(hash, original.hash); return inclusion; },
  };
  const create = (intentStore = store, supplied = true) => createPQTransactionSubmission({intentStore, networkId, transport,
    ...(supplied ? {acquireOriginalWalletTransactionPermission: acquire, isOriginalWalletTransactionPermission: resource => recognized.has(resource)} : {})});
  return {filePath, store, lifecycle, counts, create, cold: () => new FileTransactionIntentStore({filePath})};
}

test('real lifecycle wrapping preserves the original falsy transport cause and UNKNOWN after cold restart', async t => {
  const f = await setup(t, {throwFalse: true}), controller = f.create();
  await assert.rejects(f.lifecycle.run(guard => controller.broadcast(original.hash, guard)), {code: 'PQ_TRANSACTION_OUTCOME_UNKNOWN'});
  const state = await f.cold().readPQProgress(account, original.hash, () => {});
  assert.equal(state.status, 'submission-unknown');
  assert.deepEqual(state.firstCause, {kind: 'boolean', value: false, code: null}, 'guard.submit must not replace the root transport failure');
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.completed, 1); assert.equal(f.counts.closed, 1);
  assert.equal((await f.cold().readPQOriginals(account, () => {}))[0].wire, original.wire);
});

test('unresolved permission cleanup before the marker fences a second acquisition and POST for that original', async t => {
  const f = await setup(t, {cleanupDebt: true}), controller = f.create();
  await assert.rejects(f.lifecycle.run(guard => controller.broadcast(original.hash, guard)), {code: 'QA_REVOKED'});
  assert.equal((await f.cold().readPQProgress(account, original.hash, () => {})).status, 'signed-unsubmitted');
  assert.equal(f.counts.joined, 1); assert.equal(f.counts.closed, 0); assert.equal(f.counts.posts, 0);
  await assert.rejects(f.lifecycle.run(guard => controller.broadcast(original.hash, guard)), {code: 'PQ_TRANSACTION_CLEANUP_PENDING'});
  assert.equal(f.counts.acquired, 1, 'unresolved foreign resource must not be replaced by a fresh grant');
  assert.equal(f.counts.posts, 0);
});

test('real focus-loss lock preserves the complete returned response before lifecycle refusal and cleanup', async t => {
  const f = await setup(t, {lateLock: true}), controller = f.create();
  await assert.rejects(f.lifecycle.run(guard => controller.broadcast(original.hash, guard)), error => error.data?.code === 'WALLET_OPERATION_CANCELLED');
  const state = await f.cold().readPQProgress(account, original.hash, () => {});
  assert.equal(state.status, 'inclusion-observed'); assert.equal(state.storageConfirmed, true); assert.equal(state.consensusFinality, false);
  const journal = JSON.parse(await fs.readFile(f.filePath, 'utf8'));
  assert.equal(journal.pqProgress[0].result.text, inclusion.text);
  assert.equal(journal.pqOriginals[0].wire, original.wire);
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.completed, 1); assert.equal(f.counts.closed, 1);
});

test('missing Auth hooks fail before mutation while cold UNKNOWN recovery requires only the original GET', async t => {
  const f = await setup(t), before = await fs.readFile(f.filePath, 'utf8');
  await assert.rejects(f.lifecycle.run(guard => f.create(f.store, false).broadcast(original.hash, guard)), {code: 'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED'});
  assert.equal(await fs.readFile(f.filePath, 'utf8'), before); assert.equal(f.counts.acquired, 0); assert.equal(f.counts.posts, 0);
  const sent = await f.lifecycle.run(guard => f.create().broadcast(original.hash, guard));
  assert.equal(sent.status, 'submission-unknown');
  const cold = f.create(f.cold(), false);
  const recovered = await f.lifecycle.run(guard => cold.reconcile(original.hash, guard));
  assert.equal(recovered.status, 'inclusion-observed'); assert.equal(recovered.consensusFinality, false);
  assert.equal(f.counts.acquired, 1); assert.equal(f.counts.posts, 1); assert.equal(f.counts.gets, 1);
  await assert.rejects(f.lifecycle.run(guard => cold.broadcast(original.hash, guard)), {code: 'PQ_TRANSACTION_PERMISSION_NOT_SUPPLIED'});
  assert.equal(f.counts.posts, 1); assert.equal((await f.cold().readPQOriginals(account, () => {}))[0].hash, original.hash);
});

test('real lifecycle lock during node preflight prevents the later POST while retaining the original marker', async t => {
  const methods = [];
  const f = await setup(t, {transportFactory: ({lifecycle, counts}) => {
    const requestImpl = (url, options, receive) => {
      const request = new EventEmitter(); request.destroy = () => {};
      request.end = () => {
        methods.push([options.method, url.pathname]);
        if (options.method === 'POST') counts.posts++;
        queueMicrotask(() => {
          const response = new EventEmitter(); response.statusCode = 200;
          response.headers = {'content-type': 'application/json', 'cache-control': 'no-store'};
          response.destroy = () => { response.emit('error', Error('CONTROLLED_DESTROY')); };
          let text = inclusion.text;
          if (url.pathname === '/status') text = JSON.stringify({chainId: 6423, catchingUp: false, persistence: true, persistenceError: '', build: {commit: NORMAL_OPERATOR.reportedCommit, release: NORMAL_OPERATOR.reportedRelease}});
          if (url.pathname === '/blocks/0') {
            text = JSON.stringify({height: 0, hash: CANONICAL_NETWORK_ID});
            lifecycle.lock('focus-lost');
          }
          receive(response);
          if (response.listenerCount('data')) { response.emit('data', Buffer.from(text)); response.emit('end'); }
        });
      };
      return request;
    };
    return new PQTransactionNodeTransportKernel(requestImpl);
  }});
  await assert.rejects(f.lifecycle.run(guard => f.create().broadcast(original.hash, guard)));
  assert.deepEqual(methods, [['GET', '/status'], ['GET', '/blocks/0']], 'a lock during awaited preflight must fence the later outward effect');
  assert.equal(f.counts.posts, 0);
  assert.equal((await f.cold().readPQProgress(account, original.hash, () => {})).status, 'submission-unknown');
  assert.equal((await f.cold().readPQOriginals(account, () => {}))[0].wire, original.wire);
});
