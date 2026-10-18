import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicMultiFile, multiError, validateNetwork } from '../../multichain-config.mjs';
import { CctpFlow, CctpStore, validateCctpStore } from './cctp-flow.mjs';
import { ROUTE } from './cctp-wire.mjs';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const OTHER_ACCOUNT = '0x3333333333333333333333333333333333333333';
const TX = Object.freeze({ approve: `0x${'aa'.repeat(32)}`, burn: `0x${'bb'.repeat(32)}`, mint: `0x${'cc'.repeat(32)}` });
const NONCE = `0x${'dd'.repeat(32)}`;
const INPUT = Object.freeze({ routeId: ROUTE.id, asset: 'USDC', amount: '1', recipient: RECIPIENT, maxProtocolFee: '0.0001', maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '2000000000000000' });
const copy = value => structuredClone(value);
const code = expected => error => error?.code === expected;
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Controlled protocol observations only. These fixtures do not represent signed
// Circle attestations, real Wallet approvals, RPC receipts or asset movement.
async function harness(t, { allowanceUnits = '0' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-cctp-flow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'cross-chain.json');
  const calls = { prepare: [], send: [], check: [], cancel: [], quote: [], attestation: [], destination: [] };
  const current = { context: { account: ACCOUNT, revision: 1, epoch: 0, locked: false }, revision: 5, time: 1800000000000, allowanceUnits, requiredFeeUnits: '75', quoteError: null, sendError: null, sendGate: null, sendEntered: null, proof: null, destination: { state: 'pending', balanceUnits: '1000000', httpStatus: 200 }, hooks: {} };
  const networks = [ROUTE.source, ROUTE.destination].map((chain, index) => validateNetwork({ name: chain.name, chainId: String(chain.chainId), rpcUrl: `https://rpc-${index}.example.org/`, symbol: 'ETH', decimals: 18, genesis: `0x${String(index + 1).repeat(64)}` }));
  current.networks = networks;
  const original = new Map();
  const wallet = {
    async context({ unlocked = false } = {}) {
      await current.hooks.context?.({ unlocked });
      if (unlocked && current.context.locked) throw multiError('MULTICHAIN_LOCKED', 'Locked fixture.');
      return copy(current.context);
    },
    async snapshot() { return { revision: current.revision, networks: copy(current.networks), account: current.context.account }; },
    async assert(context, revision) {
      await current.hooks.assert?.(context, revision);
      if (JSON.stringify(context) !== JSON.stringify(current.context) || revision !== current.revision) throw multiError('MULTICHAIN_CONTEXT_CHANGED', 'Fixture context changed.');
    },
    async prepareCctpStep(input) {
      calls.prepare.push(copy(input));
      const review = { id: randomUUID(), intentId: input.intentId, step: input.step, expiresAt: current.time + 120000 };
      original.set(review.id, { ...review, hash: null, state: 'prepared' });
      await current.hooks.prepare?.(input, review);
      return copy(review);
    },
    async send(id, guard) {
      guard.assert();
      calls.send.push(id);
      const operation = original.get(id);
      assert.ok(operation, 'send must use an original review ID');
      Object.assign(operation, { hash: TX[operation.step], state: current.sendError ? 'unknown' : 'submitted' });
      current.sendEntered?.resolve();
      if (current.sendGate) await current.sendGate.promise;
      if (current.sendError) throw current.sendError;
      return { id, state: operation.state, hash: operation.hash };
    },
    async checkCctpStep(input) {
      calls.check.push(copy(input));
      const operation = original.get(input.id);
      assert.ok(operation, 'check must retain the original operation ID');
      return { id: input.id, hash: operation.hash, state: operation.state };
    },
    async cancel(id) { calls.cancel.push(id); return { cancelled: original.delete(id),reason:'review-only' }; },
  };
  const reader = {
    async quote(binding) { calls.quote.push(copy(binding)); await current.hooks.quote?.(binding); if (current.quoteError) throw current.quoteError; return { requiredFeeUnits: current.requiredFeeUnits, allowanceUnits: current.allowanceUnits, sourceBalanceUnits: '1000000', destinationBalanceUnits: '1000000', httpStatus: 200 }; },
    async attestation(binding) { calls.attestation.push(copy(binding)); return copy(current.proof); },
    async destination(binding) { calls.destination.push(copy(binding)); return copy(current.destination); },
  };
  const guard = { account: ACCOUNT, assert() { if (current.context.locked) throw multiError('MULTICHAIN_LOCKED', 'Fixture locked.'); } };
  const store = new CctpStore({ filePath });
  assert.ok(store.file instanceof AtomicMultiFile);
  const createFlow = (nextStore = store) => new CctpFlow({ wallet, reader, store: nextStore, now: () => current.time });
  const flow = createFlow();
  const start = async () => flow.start((await flow.quote(copy(INPUT))).quoteId);
  const confirm = (record, review, activeFlow = flow) => activeFlow.confirmStep({ id: record.id, reviewId: review.id }, guard);
  const included = review => { Object.assign(original.get(review.id), { state: 'included', hash: TX[review.step] }); };
  const proof = () => {
    const bytes=Buffer.alloc(376),word=(offset,value,size=32)=>Buffer.from(BigInt(value).toString(16).padStart(size*2,'0'),'hex').copy(bytes,offset);
    word(0,1,4);word(4,0,4);word(8,6,4);word(12,NONCE);word(44,ROUTE.source.tokenMessenger);word(76,ROUTE.destination.tokenMessenger);word(108,ACCOUNT);word(140,2000,4);word(144,2000,4);word(148,1,4);word(152,ROUTE.source.usdc);word(184,RECIPIENT);word(216,1000000);word(248,ACCOUNT);word(280,100);word(312,75);
    return {sourceTxHash:TX.burn,nonce:NONCE,message:'0x'+bytes.toString('hex'),attestation:`0x${'12'.repeat(65)}`,amountReceived:'999925',feeExecuted:'75'};
  };
  const mintReady = async () => {
    current.allowanceUnits = '1000000';
    const record = await start();
    const burn = await flow.prepareStep(record.id);
    assert.equal(burn.step, 'burn');
    await confirm(record, burn); included(burn); current.proof = proof();
    const ready = await flow.check(record.id);
    assert.equal(ready.state, 'mint-ready');
    return { record: ready, burn };
  };
  return { filePath, calls, current, original, wallet, reader, guard, store, flow, createFlow, start, confirm, included, proof, mintReady };
}

test('quote → exact approve → burn → attestation → mint requires a finalized target receipt and survives a new disk reader', async t => {
  const h = await harness(t);
  const quote = await h.flow.quote(copy(INPUT));
  assert.equal(quote.amountUnits, '1000000');
  assert.equal(quote.maxFeeUnits, '100');
  assert.equal(quote.minimumReceivedUnits, '999900');
  assert.equal(quote.slippageBps, 0);
  assert.equal(quote.sourceNetwork.chainId, '0xaa36a7');
  assert.equal(quote.destinationNetwork.chainId, '0x14a34');
  const record = await h.flow.start(quote.quoteId);
  assert.equal(record.state, 'ready');
  assert.equal(h.calls.send.length, 0);
  const approve = await h.flow.prepareStep(record.id);
  assert.equal(approve.step, 'approve');
  assert.equal(h.calls.prepare[0].binding.recipient, RECIPIENT);
  assert.equal(h.calls.prepare[0].binding.maxSourceGasFeeWei, INPUT.maxSourceGasFeeWei);
  const approval = await h.confirm(record, approve);
  assert.equal(approval.state, 'approval-pending');
  assert.equal(approval.operations[0].hash, TX.approve);
  assert.equal((await h.flow.check(record.id)).state, 'approval-pending');
  h.included(approve); h.current.allowanceUnits = '1000000';
  assert.equal((await h.flow.check(record.id)).state, 'burn-ready');
  const burn = await h.flow.prepareStep(record.id);
  assert.equal(burn.step, 'burn');
  await h.confirm(record, burn); h.included(burn);
  assert.equal((await h.flow.check(record.id)).state, 'attestation-pending');
  assert.equal(h.calls.attestation.at(-1).sourceTxHash, TX.burn);
  h.current.proof = h.proof();
  assert.equal((await h.flow.check(record.id)).state, 'mint-ready');
  const restartedStore = new CctpStore({ filePath: h.filePath });
  const restarted = h.createFlow(restartedStore);
  const restored = await restartedStore.get(record.id);
  assert.equal(restored.proof.nonce, NONCE);
  assert.equal(restored.proof.sourceTxHash, TX.burn);
  const mint = await restarted.prepareStep(record.id);
  assert.equal(mint.step, 'mint');
  assert.deepEqual(h.calls.prepare.at(-1).proof, restored.proof);
  await h.confirm(record, mint, restarted); h.included(mint);
  assert.equal((await restarted.check(record.id)).state, 'mint-pending', 'HTTP success plus a sufficient balance is not a destination receipt');
  h.current.destination = { state: 'finalized',receipt:{hash:TX.mint,blockHash:`0x${'ef'.repeat(32)}`,blockNumber:'20',status:1,confirmationScope:'rpc-finalized-block',finalizedBlockHash:`0x${'fe'.repeat(32)}`,finalizedBlockNumber:'25'},balanceUnits:'1000000' };
  const completed = await restarted.check(record.id);
  assert.equal(completed.state, 'completed');
  assert.deepEqual(completed.operations.map(({ step, hash }) => [step, hash]), [['approve', TX.approve], ['burn', TX.burn], ['mint', TX.mint]]);
  assert.equal(h.calls.destination.at(-1).transactionHash, TX.mint);
  assert.equal(h.calls.destination.at(-1).sourceTxHash, TX.burn);
  assert.equal(h.calls.check.at(-1).network.chainId, '0x14a34');
  assert.equal(h.calls.send.length, 3);
  assert.deepEqual((await new CctpStore({ filePath: h.filePath }).get(record.id)).destination, completed.destination);
  assert.equal(JSON.parse(await readFile(h.filePath, 'utf8')).records[0].state, 'completed');
});

test('a source send timeout persists UNKNOWN; restart only checks its original ID and hash, never signs a replacement', async t => {
  const h = await harness(t, { allowanceUnits: '1000000' });
  const record = await h.start();
  const burn = await h.flow.prepareStep(record.id);
  h.current.sendError = multiError('RPC_TIMEOUT_AFTER_SEND', 'Controlled post-submit disconnect.');
  const uncertain = await h.confirm(record, burn);
  assert.equal(uncertain.state, 'burn-pending');
  assert.equal(uncertain.operations[0].state, 'unknown');
  assert.equal(uncertain.firstError, 'RPC_TIMEOUT_AFTER_SEND');
  const restarted = h.createFlow(new CctpStore({ filePath: h.filePath }));
  await assert.rejects(restarted.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  await assert.rejects(h.confirm(record, burn, restarted), code('CCTP_CHECK_ORIGINAL'));
  const checked = await restarted.check(record.id);
  assert.equal(checked.operations[0].id, burn.id);
  assert.equal(checked.operations[0].hash, TX.burn);
  assert.equal(checked.operations[0].state, 'unknown');
  h.included(burn);
  assert.equal((await restarted.check(record.id)).state, 'attestation-pending');
  assert.equal(h.calls.prepare.length, 1);
  assert.equal(h.calls.send.length, 1);
  assert.ok(h.calls.check.every(value => value.id === burn.id));
  assert.equal((await h.store.get(record.id)).firstError, 'RPC_TIMEOUT_AFTER_SEND');
});

test('overlapping confirm callbacks share one durable dispatch and one original send', async t => {
  const h = await harness(t);
  const record = await h.start();
  const review = await h.flow.prepareStep(record.id);
  h.current.sendEntered = gate(); h.current.sendGate = gate();
  const pending = h.confirm(record, review);
  try {
    await h.current.sendEntered.promise;
    const onDisk = await new CctpStore({ filePath: h.filePath }).get(record.id);
    assert.equal(onDisk.operations[0].state, 'dispatching');
    await assert.rejects(h.confirm(record, review), code('CCTP_BUSY'));
    assert.equal(h.calls.send.length, 1);
  } finally { h.current.sendGate.resolve(); }
  await pending;
  await assert.rejects(h.confirm(record, review), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.send.length, 1);
});

test('a failed persistence barrier does not enter send and preserves the original review on disk', async t => {
  const h = await harness(t);
  const record = await h.start();
  const review = await h.flow.prepareStep(record.id);
  const before = await readFile(h.filePath, 'utf8');
  const write = h.store.file.write.bind(h.store.file);
  h.store.file.write = async () => { throw multiError('ENOSPC', 'Controlled write failure.'); };
  await assert.rejects(h.confirm(record, review), code('ENOSPC'));
  assert.equal(h.calls.send.length, 0);
  assert.equal(await readFile(h.filePath, 'utf8'), before);
  await assert.rejects(h.flow.prepareStep(record.id), code('CCTP_PERSISTENCE_UNKNOWN'));
  h.store.file.write = write;
  const restarted = h.createFlow(new CctpStore({ filePath: h.filePath }));
  await assert.rejects(h.confirm(record, review, restarted), code('CCTP_CHECK_ORIGINAL'));
  assert.equal(h.calls.send.length, 0);
});

test('a result-persistence failure after send retains dispatching across restart and checks instead of resubmitting', async t => {
  const h = await harness(t, { allowanceUnits: '1000000' });
  const record = await h.start();
  const review = await h.flow.prepareStep(record.id);
  const write = h.store.file.write.bind(h.store.file);
  h.store.file.write = async value => {
    if (value.records[0].operations[0].state === 'submitted') throw multiError('ENOSPC', 'Controlled result commit failure.');
    return write(value);
  };
  const uncertain = await h.confirm(record, review);
  assert.equal(uncertain.operations[0].state, 'dispatching');
  assert.equal(h.calls.send.length, 1);
  const restarted = h.createFlow(new CctpStore({ filePath: h.filePath }));
  await assert.rejects(restarted.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  const checked = await restarted.check(record.id);
  assert.equal(checked.operations[0].id, review.id);
  assert.equal(checked.operations[0].hash, TX.burn);
  assert.equal(checked.operations[0].state, 'submitted');
  assert.equal(h.calls.send.length, 1);
});

test('unsupported YNX routes and assets remain unavailable before a quote or Wallet action', async t => {
  const h = await harness(t);
  assert.deepEqual(h.flow.routes().map(value => [value.id, value.testnet, value.refundSupported]), [[ROUTE.id, true, false]]);
  await assert.rejects(h.flow.quote({ ...INPUT, routeId: 'ynx-base-usdc' }), code('CCTP_UNSUPPORTED_ROUTE'));
  await assert.rejects(h.flow.quote({ ...INPUT, asset: 'YNX' }), code('CCTP_UNSUPPORTED_ROUTE'));
  assert.equal(h.calls.quote.length, 0);
  assert.equal(h.calls.prepare.length, 0);
  assert.equal(h.calls.send.length, 0);
});

test('fee caps are enforced at quote and again before preparing the original contract action', async t => {
  const h = await harness(t);
  h.current.requiredFeeUnits = '101';
  await assert.rejects(h.start(), code('CCTP_FEE_LIMIT'));
  assert.equal((await h.store.list(ACCOUNT)).length, 0);
  h.current.requiredFeeUnits = '75';
  const record = await h.start();
  h.current.requiredFeeUnits = '101';
  await assert.rejects(h.flow.prepareStep(record.id), code('CCTP_FEE_LIMIT'));
  assert.equal(h.calls.prepare.length, 0);
  assert.equal((await h.store.get(record.id)).operations.length, 0);
});

test('expired quote and current account/config/lock changes cannot consume an old signing review', async t => {
  const h = await harness(t);
  const quote = await h.flow.quote(copy(INPUT));
  h.current.time = quote.expiresAt;
  await assert.rejects(h.flow.start(quote.quoteId), code('CCTP_QUOTE_EXPIRED'));
  const record = await h.start();
  h.current.context.account = OTHER_ACCOUNT;
  await assert.rejects(h.flow.prepareStep(record.id), code('CCTP_ACCOUNT_CHANGED'));
  h.current.context.account = ACCOUNT;
  const review = await h.flow.prepareStep(record.id);
  for (const mutate of [() => { h.current.revision++; }, () => { h.current.context.epoch++; }, () => { h.current.context.locked = true; }]) {
    const context = copy(h.current.context), revision = h.current.revision;
    mutate();
    await assert.rejects(h.confirm(record, review), error => ['MULTICHAIN_CONTEXT_CHANGED', 'MULTICHAIN_LOCKED'].includes(error.code));
    h.current.context = context; h.current.revision = revision;
  }
  assert.equal(h.calls.send.length, 0);
  assert.equal((await h.store.get(record.id)).operations[0].state, 'review');
});

test('an account switch between ownership lookup and current-context capture is rejected before a new review', async t => {
  const h = await harness(t);
  const record = await h.start();
  h.current.hooks.context = ({ unlocked }) => { if (unlocked) h.current.context.account = OTHER_ACCOUNT; };
  await assert.rejects(h.flow.prepareStep(record.id), error => ['CCTP_ACCOUNT_CHANGED', 'MULTICHAIN_CONTEXT_CHANGED'].includes(error.code));
  assert.equal(h.calls.prepare.length, 0);
  assert.equal((await h.store.get(record.id)).operations.length, 0);
});

test('matching chain IDs cannot authorize a replaced saved network identity', async t => {
  const h = await harness(t);
  const record = await h.start();
  h.current.networks[1] = { ...h.current.networks[1], rpcUrl: 'https://replacement.example.org/' };
  h.current.revision++;
  await assert.rejects(h.flow.prepareStep(record.id), code('CCTP_NETWORK_CHANGED'));
  assert.equal(h.calls.prepare.length, 0);
  assert.equal(h.calls.send.length, 0);
  assert.equal((await h.store.get(record.id)).binding.destinationNetwork.rpcUrl, 'https://rpc-1.example.org/');
});

test('locking after the dispatch barrier but before custody never sends and preserves a query-only intent', async t => {
  const h = await harness(t);
  const record = await h.start();
  const review = await h.flow.prepareStep(record.id);
  const write = h.store.file.write.bind(h.store.file);
  h.store.file.write = async value => {
    await write(value);
    if (value.records[0].operations[0].state === 'dispatching') h.current.context.locked = true;
  };
  const result = await h.confirm(record, review);
  assert.equal(h.calls.send.length, 0);
  assert.equal(result.operations[0].state, 'unknown');
  assert.equal(result.firstError, 'MULTICHAIN_LOCKED');
  h.current.context.locked = false;
  const restarted = h.createFlow(new CctpStore({ filePath: h.filePath }));
  await assert.rejects(restarted.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  assert.equal((await restarted.check(record.id)).operations[0].state, 'unknown');
  assert.equal(h.calls.check[0].id, review.id);
  assert.equal(h.calls.send.length, 0);
});

test('mint recovery does not demand the already-burned source balance or replay an approve/burn', async t => {
  const h = await harness(t);
  const { record } = await h.mintReady();
  const quoteCount = h.calls.quote.length;
  h.current.quoteError = multiError('SOURCE_BALANCE_EMPTY', 'The confirmed burn consumed the source balance.');
  const restarted = h.createFlow(new CctpStore({ filePath: h.filePath }));
  const mint = await restarted.prepareStep(record.id);
  assert.equal(mint.step, 'mint');
  assert.equal(h.calls.quote.length, quoteCount);
  await h.confirm(record, mint, restarted);
  await assert.rejects(restarted.prepareStep(record.id), code('CCTP_CHECK_ORIGINAL'));
  await assert.rejects(h.confirm(record, mint, restarted), code('CCTP_CHECK_ORIGINAL'));
  assert.deepEqual(h.calls.prepare.map(value => value.step), ['burn', 'mint']);
  assert.equal(h.calls.send.length, 2);
});

test('a changing source transaction hash or an attestation for a different burn cannot advance the transfer', async t => {
  const h = await harness(t, { allowanceUnits: '1000000' });
  const record = await h.start();
  const burn = await h.flow.prepareStep(record.id);
  await h.confirm(record, burn); h.included(burn);
  h.original.get(burn.id).hash = TX.approve;
  await assert.rejects(h.flow.check(record.id), code('CCTP_RESULT_MISMATCH'));
  assert.equal((await h.store.get(record.id)).operations[0].hash, TX.burn);
  h.original.get(burn.id).hash = TX.burn;
  h.current.proof = { ...h.proof(), sourceTxHash: TX.approve };
  await assert.rejects(h.flow.check(record.id), code('CCTP_RESULT_MISMATCH'));
  const saved = await h.store.get(record.id);
  assert.equal(saved.state, 'attestation-pending');
  assert.equal(saved.proof, null);
  assert.equal(h.calls.send.length, 1);
});

test('cancel keeps a dispatched source operation query-only, while an unsigned review can be cancelled', async t => {
  const h = await harness(t);
  const record = await h.start();
  const review = await h.flow.prepareStep(record.id);
  const cancelled = await h.flow.cancel(record.id);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.record.state, 'cancelled');
  assert.equal(cancelled.record.operations[0].state, 'cancelled');
  assert.deepEqual(h.calls.cancel, [review.id]);
  const next = await h.start();
  const nextReview = await h.flow.prepareStep(next.id);
  await h.confirm(next, nextReview);
  const refused = await h.flow.cancel(next.id);
  assert.equal(refused.cancelled, false);
  assert.equal(refused.reason, 'query-original');
  assert.equal(h.calls.cancel.length, 1);
  assert.equal(refused.record.operations[0].hash, TX.approve);
});

test('durable history cannot silently change the immutable binding or claim completion with a balance alone', async t => {
  const h = await harness(t);
  const record = await h.start();
  await assert.rejects(h.store.update(record.id, record.revision, value => { value.binding.recipient = OTHER_ACCOUNT; }), code('CCTP_BINDING_CHANGED'));
  assert.equal((await h.store.get(record.id)).binding.recipient, RECIPIENT);
  await assert.rejects(h.store.update(record.id, record.revision, value => { value.state = 'completed'; value.destination = { balanceUnits: '1000000', httpStatus: 200 }; }), code('CCTP_STORE_INVALID'));
  assert.equal((await h.store.get(record.id)).state, 'ready');
  assert.throws(() => validateCctpStore({ version: 1, records: [record, copy(record)] }), code('CCTP_STORE_INVALID'));
});

test('cold unsigned review can be cancelled, but both networks stay reserved until cancellation is durable',async t=>{
  const h=await harness(t),record=await h.start();await h.flow.prepareStep(record.id);
  assert.equal(await h.store.pendingNetwork(record.binding.destinationNetwork.id),1);
  h.original.clear();
  const cold=h.createFlow(new CctpStore({filePath:h.filePath}));
  assert.equal((await cold.cancel(record.id)).cancelled,true);
  assert.equal(await h.store.pendingNetwork(record.binding.sourceNetwork.id),0);
  assert.equal(h.calls.send.length,0);
});

test('reverted mint preserves the burned transfer and network lock for original-claim reconciliation',async t=>{
  const h=await harness(t),{record}=await h.mintReady(),mint=await h.flow.prepareStep(record.id);
  await h.confirm(record,mint);Object.assign(h.original.get(mint.id),{state:'reverted'});
  assert.equal((await h.flow.check(record.id)).state,'failed');
  assert.equal(await h.store.pendingNetwork(record.binding.destinationNetwork.id),1);
  await assert.rejects(h.start(),code('CCTP_UNRESOLVED'));
  const count=h.calls.check.length;await h.flow.check(record.id);assert.equal(h.calls.check.length,count+1);
});
