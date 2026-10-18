import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicMultiFile, multiError, validateNetwork } from '../../multichain-config.mjs';
import { CctpFlow, CctpStore } from './cctp-flow.mjs';
import { ROUTE } from './cctp-wire.mjs';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TX = { approve: `0x${'aa'.repeat(32)}`, burn: `0x${'bb'.repeat(32)}`, mint: `0x${'cc'.repeat(32)}` };
const NONCE = `0x${'dd'.repeat(32)}`;
const INPUT = { routeId: ROUTE.id, asset: 'USDC', amount: '1', recipient: RECIPIENT, maxProtocolFee: '0.0001', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000' };
const copy = value => structuredClone(value);
const code = expected => error => error?.code === expected;

// Protocol bytes are structurally valid fixture data, not a Circle signature.
function proof() {
  const bytes = Buffer.alloc(376);
  const word = (offset, value, size = 32) => Buffer.from(BigInt(value).toString(16).padStart(size * 2, '0'), 'hex').copy(bytes, offset);
  word(0, 1, 4); word(4, 0, 4); word(8, 6, 4); word(12, NONCE);
  word(44, ROUTE.source.tokenMessenger); word(76, ROUTE.destination.tokenMessenger); word(108, ACCOUNT);
  word(140, 2000, 4); word(144, 2000, 4); word(148, 1, 4); word(152, ROUTE.source.usdc);
  word(184, RECIPIENT); word(216, 1000000); word(248, ACCOUNT); word(280, 100); word(312, 75);
  return { message: `0x${bytes.toString('hex')}`, attestation: `0x${'12'.repeat(65)}`, nonce: NONCE, sourceTxHash: TX.burn, feeExecuted: '75', amountReceived: '999925' };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-cctp-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'cross-chain.json');
  const context = { account: ACCOUNT, revision: 1, epoch: 0, locked: false };
  const networks = [ROUTE.source, ROUTE.destination].map((value, i) => validateNetwork({ name: value.name, chainId: String(value.chainId), rpcUrl: `https://recovery-${i}.example.org/`, genesis: `0x${String(i + 1).repeat(64)}`, symbol: 'ETH', decimals: 18 }));
  const current = { allowanceUnits: '0', quoteError: null, cancelResult: null, cancelError: null };
  const calls = { prepare: [], send: [], check: [], cancel: [], quote: [], attestation: [], destination: [] };
  // Emulates the original owner contract: reviews are volatile, while a send
  // reserves an opaque original operation in the owner's persistent journal.
  let reviews = new Map();
  const journal = new Map();
  const wallet = {
    async context() { return copy(context); },
    async snapshot() { return { account: ACCOUNT, revision: 7, networks: copy(networks) }; },
    async assert(value, revision) { assert.deepEqual(value, context); if (revision !== undefined) assert.equal(revision, 7); },
    async prepareCctpStep(input) {
      calls.prepare.push(copy(input));
      const review = { id: randomUUID(), intentId: input.intentId, step: input.step, expiresAt: 1800000120000 };
      reviews.set(review.id, copy(review)); return review;
    },
    async send(id, guard) {
      guard.assert(); const review = reviews.get(id);
      assert.ok(review, 'cold or cancelled review must never reach owner custody');
      reviews.delete(id); calls.send.push(id);
      const operation = { id, state: 'submitted', hash: TX[review.step] };
      journal.set(id, operation); return copy(operation);
    },
    async checkCctpStep({ id }) {
      calls.check.push(id); const operation = journal.get(id);
      if (!operation) throw multiError('MULTICHAIN_UNKNOWN_INTENT', 'No original dispatch exists for this volatile review.');
      return copy(operation);
    },
    async cancel(id) {
      calls.cancel.push(id);
      if (current.cancelError) throw current.cancelError;
      if (current.cancelResult) return copy(current.cancelResult);
      // This is the actual original MultichainService.cancel review-only result,
      // including false after restart when the in-memory review no longer exists.
      return { cancelled: reviews.delete(id), reason: 'review-only' };
    },
  };
  const reader = {
    async quote(binding) { calls.quote.push(copy(binding)); if (current.quoteError) throw current.quoteError; return { allowanceUnits: current.allowanceUnits, requiredFeeUnits: '75' }; },
    async attestation(binding) { calls.attestation.push(copy(binding)); return proof(); },
    async destination(binding) {
      calls.destination.push(copy(binding));
      return { state: 'finalized', receipt: { hash: binding.transactionHash, status: 1, confirmationScope: 'rpc-finalized-block', blockHash: `0x${'ef'.repeat(32)}`, finalizedBlockHash: `0x${'fe'.repeat(32)}`, blockNumber: '100', finalizedBlockNumber: '101' } };
    },
  };
  const guard = { account: ACCOUNT, assert() {} };
  const store = new CctpStore({ filePath });
  assert.ok(store.file instanceof AtomicMultiFile);
  const createFlow = nextStore => new CctpFlow({ wallet, reader, store: nextStore, now: () => 1800000000000 });
  const flow = createFlow(store);
  const cold = () => { reviews = new Map(); return createFlow(new CctpStore({ filePath })); };
  const sendAndInclude = async (record, review, active = flow) => {
    await active.confirmStep({ id: record.id, reviewId: review.id }, guard);
    journal.get(review.id).state = 'included';
    return active.check(record.id);
  };
  const readyReview = async step => {
    const record = await flow.start((await flow.quote(copy(INPUT))).quoteId);
    const approve = await flow.prepareStep(record.id);
    assert.equal(approve.step, 'approve');
    await sendAndInclude(record, approve); current.allowanceUnits = '1000000';
    const burn = await flow.prepareStep(record.id);
    assert.equal(burn.step, 'burn');
    if (step === 'burn') return { record: await store.get(record.id), review: burn, prior: [approve] };
    await sendAndInclude(record, burn);
    const mint = await flow.prepareStep(record.id);
    assert.equal(mint.step, 'mint');
    return { record: await store.get(record.id), review: mint, prior: [approve, burn] };
  };
  return { filePath, context, current, calls, journal, store, flow, cold, guard, readyReview };
}

for (const step of ['burn', 'mint']) test(`cold ${step} review can be discarded without losing confirmed history, then explicitly reviewed under a fresh opaque ID`, async t => {
  const h = await fixture(t);
  const { record, review, prior } = await h.readyReview(step);
  const originalBinding = copy(record.binding), originalProof = copy(record.proof);
  const cold = h.cold();
  await assert.rejects(cold.confirmStep({ id: record.id, reviewId: review.id }, h.guard), code('CCTP_CHECK_ORIGINAL'));
  await assert.rejects(cold.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  const checked = await cold.check(record.id);
  assert.equal(checked.state, `${step}-ready`);
  assert.equal(checked.operations.at(-1).id, review.id);
  assert.equal(checked.operations.at(-1).state, 'review');
  const sendsBefore = h.calls.send.length;
  const recovered = await cold.cancel(record.id);
  assert.equal(recovered.cancelled, true, 'an included prior step must not make an unsigned cold review impossible to discard');
  assert.equal(recovered.reason, 'review-only');
  assert.equal(recovered.record.state, `${step}-ready`, 'discarding a review cannot cancel a confirmed burn or the cross-chain intent');
  assert.deepEqual(h.calls.cancel, [review.id], 'owner cancellation is only for the current unsigned opaque review');
  assert.deepEqual(recovered.record.binding, originalBinding);
  assert.deepEqual(recovered.record.proof, originalProof);
  assert.equal(recovered.record.operations.find(op => op.id === review.id).state, 'cancelled');
  for (const previous of prior) assert.deepEqual(recovered.record.operations.find(op => op.id === previous.id), { step: previous.step, id: previous.id, state: 'included', hash: TX[previous.step] });
  assert.equal(h.calls.send.length, sendsBefore);
  // Re-read on a second fresh flow so cancelled review history survives a second
  // restart and does not consume the only allowed operation slot for its step.
  const restarted = h.cold();
  const attestationCount = h.calls.attestation.length;
  const stable = await restarted.check(record.id);
  assert.equal(stable.state, `${step}-ready`, 'checking after cancellation must not regress an already confirmed prior step');
  assert.deepEqual(stable.proof, originalProof);
  assert.equal(h.calls.attestation.length, attestationCount, 'an existing proof does not need a new attestation after unsigned review cancellation');
  assert.ok(!h.calls.check.includes(review.id), 'discarded volatile review is not an owner dispatch to reconcile');
  if (step === 'mint') h.current.quoteError = multiError('SOURCE_ALREADY_BURNED', 'Mint must not demand the burned source balance.');
  const freshReview = await restarted.prepareStep(record.id);
  assert.equal(freshReview.step, step); assert.notEqual(freshReview.id, review.id);
  const durable = JSON.parse(await readFile(h.filePath, 'utf8')).records[0];
  assert.equal(durable.operations.find(op => op.id === review.id).state, 'cancelled');
  assert.equal(durable.operations.find(op => op.id === freshReview.id).state, 'review');
  assert.equal(h.calls.send.length, sendsBefore, 'fresh review requires a separate explicit confirm');
  await assert.rejects(restarted.confirmStep({ id: record.id, reviewId: review.id }, h.guard), code('CCTP_CHECK_ORIGINAL'));
  await restarted.confirmStep({ id: record.id, reviewId: freshReview.id }, h.guard);
  assert.equal(h.calls.send.length, sendsBefore + 1);
  assert.equal(h.calls.send.at(-1), freshReview.id);
  assert.ok(!h.calls.send.includes(review.id));
  h.journal.get(freshReview.id).state = 'included';
  const reconciled = await restarted.check(record.id);
  assert.equal(reconciled.state, step === 'burn' ? 'mint-ready' : 'completed');
  assert.equal(reconciled.operations.find(op => op.id === review.id).state, 'cancelled');
  assert.equal(reconciled.operations.find(op => op.id === freshReview.id).hash, TX[step]);
  assert.equal(reconciled.proof.sourceTxHash, TX.burn, 'attestation must bind the active burn, not a cancelled review with a null hash');
  assert.equal(reconciled.proof.nonce, NONCE);
  if (step === 'mint') assert.equal(h.calls.destination.at(-1).transactionHash, TX.mint, 'target receipt lookup must use the active mint, not the discarded review');
});

test('unknown original cancellation result cannot discard a cold review or permit a replacement', async t => {
  const h = await fixture(t), { record, review } = await h.readyReview('burn');
  const cold = h.cold(), before = await readFile(h.filePath, 'utf8');
  h.current.cancelResult = { cancelled: false, reason: 'record-needs-resolution' };
  await assert.rejects(cold.cancel(record.id), code('CCTP_CANCEL_UNKNOWN'));
  assert.deepEqual(h.calls.cancel, [review.id]);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
  await assert.rejects(cold.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.send.length, 1);
});

test('a cancelled signed owner result cannot be misclassified as an unsigned review-only cancellation', async t => {
  const h = await fixture(t), { record, review } = await h.readyReview('burn');
  const cold = h.cold(), before = await readFile(h.filePath, 'utf8');
  h.current.cancelResult = { cancelled: true, reason: 'local-cancelled-before-broadcast', hash: TX.burn };
  await assert.rejects(cold.cancel(record.id), code('CCTP_CANCEL_UNKNOWN'));
  assert.deepEqual(h.calls.cancel, [review.id]);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
  assert.equal((await h.store.get(record.id)).operations.at(-1).state, 'review');
  await assert.rejects(cold.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.send.length, 1);
});

test('a failed recovery disk commit preserves the original review and blocks replacement custody', async t => {
  const h = await fixture(t), { record, review } = await h.readyReview('burn');
  // Keep one process/AtomicMultiFile instance here so the injected write failure
  // exercises the real serialized mutation barrier, not a fake store result.
  const before = await readFile(h.filePath, 'utf8');
  h.store.file.write = async () => { throw multiError('ENOSPC', 'Controlled recovery commit failure.'); };
  await assert.rejects(h.flow.cancel(record.id), code('ENOSPC'));
  assert.deepEqual(h.calls.cancel, [review.id]);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
  await assert.rejects(h.flow.prepareStep(record.id), code('CCTP_PERSISTENCE_UNKNOWN'));
  assert.equal(h.calls.send.length, 1);
});

for (const state of ['dispatching', 'unknown', 'submitted', 'reverted']) test(`${state} source attempt cannot use unsigned-review recovery`, async t => {
  const h = await fixture(t), { record, review } = await h.readyReview('burn');
  await h.store.update(record.id, record.revision, value => { value.state = state === 'reverted' ? 'failed' : 'burn-pending'; Object.assign(value.operations.at(-1), { state, hash: state === 'dispatching' ? null : TX.burn }); });
  const cold = h.cold(), before = await readFile(h.filePath, 'utf8');
  const result = await cold.cancel(record.id);
  assert.equal(result.cancelled, false);
  assert.equal(result.reason, 'query-original');
  assert.equal(h.calls.cancel.length, 0);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
  await assert.rejects(cold.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  await assert.rejects(cold.confirmStep({ id: record.id, reviewId: review.id }, h.guard), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.send.length, 1);
});

test('a signed original Wallet journal stays query-only after coordinator dispatch uncertainty', async t => {
  const h = await fixture(t), { record, review } = await h.readyReview('burn');
  await h.store.update(record.id, record.revision, value => { value.state = 'burn-pending'; value.operations.at(-1).state = 'dispatching'; });
  h.journal.set(review.id, { id: review.id, state: 'signed', hash: TX.burn });
  const cold = h.cold();
  const checked = await cold.check(record.id);
  assert.equal(checked.operations.at(-1).state, 'unknown');
  assert.equal(checked.operations.at(-1).hash, TX.burn);
  assert.equal((await cold.cancel(record.id)).cancelled, false);
  await assert.rejects(cold.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.cancel.length, 0);
  assert.equal(h.calls.send.length, 1);
  assert.equal(h.calls.check.at(-1), review.id);
});

test('journal schema rejects duplicate active steps, duplicate opaque IDs and invalid state/hash pairs without altering original bytes', async t => {
  const h = await fixture(t), { record } = await h.readyReview('burn');
  const before = await readFile(h.filePath, 'utf8');
  const invalid = [
    ['duplicate active step', value => value.operations.push({ ...value.operations.at(-1), id: randomUUID() })],
    ['duplicate opaque ID', value => value.operations.push({ step: 'mint', id: value.operations.at(-1).id, state: 'cancelled', hash: null })],
    ['cancelled operation with hash', value => Object.assign(value.operations.at(-1), { state: 'cancelled', hash: TX.burn })],
    ['included operation without hash', value => { value.operations[0].hash = null; }],
    ['submitted operation without hash', value => Object.assign(value.operations.at(-1), { state: 'submitted', hash: null })],
    ['reverted operation without hash', value => Object.assign(value.operations.at(-1), { state: 'reverted', hash: null })],
  ];
  for (const [label, mutate] of invalid) {
    await assert.rejects(h.store.update(record.id, record.revision, mutate), code('CCTP_STORE_INVALID'), label);
    assert.equal(await readFile(h.filePath, 'utf8'), before, `${label} must retain original persisted bytes`);
  }
  assert.deepEqual((await h.store.get(record.id)).operations, record.operations);
  assert.equal(h.calls.send.length, 1);
});

test('32 retained operations stop before owner prepare and preserve every original cancelled review', async t => {
  const h = await fixture(t), { record, review } = await h.readyReview('burn');
  const cancelled = await h.flow.cancel(record.id);
  const full = await h.store.update(record.id, cancelled.record.revision, value => {
    while (value.operations.length < 32) value.operations.push({ step: 'burn', id: randomUUID(), state: 'cancelled', hash: null });
  });
  assert.equal(full.operations.length, 32);
  assert.equal(full.operations.find(op => op.id === review.id).state, 'cancelled');
  const before = await readFile(h.filePath, 'utf8'), prepares = h.calls.prepare.length, sends = h.calls.send.length;
  await assert.rejects(h.cold().prepareStep(record.id), code('CCTP_REVIEW_HISTORY_FULL'));
  assert.equal(h.calls.prepare.length, prepares, 'history capacity must be checked before creating any owner review');
  assert.equal(h.calls.send.length, sends);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
  await assert.rejects(h.store.update(record.id, full.revision, value => { value.operations.push({ step: 'burn', id: randomUUID(), state: 'cancelled', hash: null }); }), code('CCTP_STORE_INVALID'));
  assert.equal(await readFile(h.filePath, 'utf8'), before, 'a 33rd record cannot truncate or replace retained history');
});

for (const prerequisite of ['unknown-prior-step', 'missing-mint-proof']) test(`persisted readiness with ${prerequisite} cannot create a fresh owner review`, async t => {
  const h = await fixture(t), step = prerequisite === 'unknown-prior-step' ? 'burn' : 'mint';
  const { record } = await h.readyReview(step);
  const cancelled = await h.flow.cancel(record.id);
  await h.store.update(record.id, cancelled.record.revision, value => {
    if (prerequisite === 'unknown-prior-step') value.operations[0].state = 'unknown';
    else value.proof = null;
  });
  const before = await readFile(h.filePath, 'utf8'), prepares = h.calls.prepare.length, quotes = h.calls.quote.length, sends = h.calls.send.length;
  await assert.rejects(h.cold().prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.prepare.length, prepares);
  assert.equal(h.calls.quote.length, quotes, 'unresolved prerequisites must be checked before a new quote/review');
  assert.equal(h.calls.send.length, sends);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
});
