import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Interface, Wallet, zeroPadValue} from 'ethers';
import {AtomicMultiFile, validateNetwork, multiError} from '../../multichain-config.mjs';
import {MultiJournal} from '../../multichain-journal.mjs';
import {MultichainService} from '../../multichain-service.mjs';
import {CctpFlow, CctpStore} from './cctp-flow.mjs';
import {CctpEVMAdapter} from './cctp-action.mjs';
import {CctpReader} from './cctp-reader.mjs';
import {ROUTE} from './cctp-wire.mjs';

const ACCOUNT = '0x' + '11'.repeat(20), OTHER = '0x' + '33'.repeat(20), RECIPIENT = '0x' + '22'.repeat(20);
const BURN_HASH = '0x' + 'bb'.repeat(32), NONCE = '0x' + 'dd'.repeat(32);
const copy = value => structuredClone(value);
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done}); return {resolve, promise}};
const messenger = new Interface(['event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)']);
const transmitter = new Interface(['event MessageSent(bytes message)']);
const received = new Interface(['event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)']);
const token = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);

// Controlled public data only. No account generation, signatures, secrets or sends.
function message(binding, source = false) {
  const bytes = Buffer.alloc(376), word = (offset, value, size = 32) => Buffer.from(BigInt(value).toString(16).padStart(size * 2, '0'), 'hex').copy(bytes, offset);
  word(0, 1, 4); word(4, 0, 4); word(8, 6, 4); word(12, source ? 0 : NONCE);
  word(44, ROUTE.source.tokenMessenger); word(76, ROUTE.destination.tokenMessenger); word(108, binding.account);
  word(140, 2000, 4); word(144, source ? 0 : 2000, 4); word(148, 1, 4);
  word(152, ROUTE.source.usdc); word(184, binding.recipient); word(216, binding.amountUnits);
  word(248, binding.account); word(280, binding.maxFeeUnits); word(312, source ? 0 : 75);
  return '0x' + bytes.toString('hex');
}

async function harness(t, state = 'mint-ready') {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-cctp-reconcile-delta-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const filePath = join(directory, 'cctp.json'), time = 1800000000000;
  const networks = [ROUTE.source, ROUTE.destination].map((route, i) => validateNetwork({name: route.name, chainId: String(route.chainId), rpcUrl: `https://delta-${i}.example.org`, symbol: 'ETH', decimals: 18, genesis: '0x' + String(i + 1).repeat(64)}));
  const current = {context: {account: ACCOUNT, revision: 1, epoch: 0, locked: false}, revision: 5, networks};
  const binding = {routeId: ROUTE.id, account: ACCOUNT, recipient: RECIPIENT, amountUnits: '1000000', maxFeeUnits: '100',
    maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000', sourceNetwork: networks[0], destinationNetwork: networks[1],
    context: copy(current.context), configRevision: 5, expiresAt: time + 120000, quoteId: randomUUID()};
  const proof = {sourceTxHash: BURN_HASH, nonce: NONCE, message: message(binding), attestation: '0x' + '12'.repeat(65), amountReceived: '999925', feeExecuted: '75'};
  const record = {id: randomUUID(), revision: 0, binding, state, operations: [{step: 'burn', id: randomUUID(), state: 'included', hash: BURN_HASH}],
    proof: state === 'mint-ready' ? proof : null, destination: null, firstError: null, createdAt: time, updatedAt: time};
  const calls = {prepare: [], check: [], rpc: [], attestation: 0};
  const wallet = {
    context: async () => copy(current.context),
    snapshot: async () => ({account: current.context.account, revision: current.revision, networks: copy(current.networks)}),
    assert: async (context, revision) => {
      if (JSON.stringify(context) !== JSON.stringify(current.context) || revision !== undefined && revision !== current.revision)
        throw multiError('MULTICHAIN_CONTEXT_CHANGED', 'The actual wallet actor/configuration changed.');
    },
    checkCctpStep: async request => {calls.check.push(copy(request)); return {id: request.id, state: 'included', hash: BURN_HASH}},
    prepareCctpStep: async request => {calls.prepare.push(copy(request)); return {id: randomUUID(), intentId: request.intentId, step: request.step, expiresAt: time + 120000}},
    send: async () => assert.fail('Reconciliation must never send'),
  };
  const reader = new CctpReader({evm: {verify: async () => true, call: async (_network, method) => {assert.equal(method, 'eth_blockNumber'); return '0x64'}}});
  const receipt = {transactionHash: BURN_HASH, blockHash: '0x' + 'aa'.repeat(32), blockNumber: '0x63', transactionIndex: '0x0', status: '0x1', logs: []};
  const event = (address, abi, name, args) => ({address, ...abi.encodeEventLog(abi.getEvent(name), args), transactionHash: BURN_HASH,
    blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex, logIndex: '0x' + receipt.logs.length.toString(16), removed: false});
  receipt.logs.push(event(ROUTE.source.tokenMessenger, messenger, 'DepositForBurn', [ROUTE.source.usdc, binding.amountUnits, ACCOUNT, zeroPadValue(RECIPIENT, 32), 6, zeroPadValue(ROUTE.destination.tokenMessenger, 32), zeroPadValue(ACCOUNT, 32), binding.maxFeeUnits, 2000, '0x']));
  receipt.logs.push(event(ROUTE.source.messageTransmitter, transmitter, 'MessageSent', [message(binding, true)]));
  // Receipt acquisition is controlled; attestation/event/message validation is the production method.
  reader.receipt = async () => copy(receipt);
  reader.get = async () => ({sourceTxHash: BURN_HASH, messages: [{...proof, eventNonce: NONCE, status: 'complete', cctpVersion: 2}]});
  const store = new CctpStore({filePath}); await store.insert(record);
  // Reopen the actual durable store to exercise a cold flow, with no ephemeral review maps.
  const coldStore = new CctpStore({filePath}), flow = new CctpFlow({wallet, reader, store: coldStore, now: () => time});
  return {current, wallet, reader, store: coldStore, flow, record, proof, calls, filePath, time};
}

test('late source proof loss keeps cold history query-only and recovers only the same burn after canonical readback', async t => {
 for (const state of ['attestation-pending', 'mint-ready']) await t.test(state, async child => {
  const h = await harness(child, state), entered = deferred(), release = deferred();
  const priorProof = structuredClone(h.record.proof);
  const receipt = h.reader.receipt.bind(h.reader), get = h.reader.get.bind(h.reader);
  let missing = false;
  h.reader.receipt = (...args) => missing ? null : receipt(...args);
  h.reader.get = async (...args) => {h.calls.attestation++; entered.resolve(); await release.promise; return get(...args)};
  const checking = h.flow.check(h.record.id);
  await entered.promise;
  missing = true; release.resolve();
  await assert.rejects(checking, {code: 'CCTP_RECEIPT_MISMATCH'});
  const saved = await new CctpStore({filePath: h.filePath}).get(h.record.id);
  assert.equal(saved.state, 'attestation-pending'); assert.deepEqual(saved.proof, priorProof, 'retain any cached original proof as evidence without promoting it');
  assert.equal(saved.operations[0].id, h.record.operations[0].id);
  assert.equal(saved.operations[0].hash, BURN_HASH);
  assert.equal(h.calls.prepare.length, 0);
  await assert.rejects(h.flow.prepareStep(saved.id), {code: 'CCTP_CHECK_ORIGINAL'});
  // Another read of the SAME source operation can recover; no quote, review,
  // replacement source transaction or custody entry is used.
  missing = false;
  const cold = new CctpFlow({wallet: h.wallet, reader: h.reader, store: new CctpStore({filePath: h.filePath}), now: () => h.time});
  const recovered = await cold.check(saved.id);
  assert.equal(recovered.state, 'mint-ready'); assert.equal(recovered.proof.sourceTxHash, BURN_HASH);
  assert.equal(recovered.proof.nonce, NONCE); assert.equal(recovered.id, saved.id);
  assert.ok(h.calls.check.every(call => call.id === saved.operations[0].id));
  assert.equal(h.calls.prepare.length, 0);
  assert.equal(h.calls.attestation, 2);
 });
});

test('cold cached mint proof cannot retain mint readiness after the original adapter observes a missing burn receipt', async t => {
  const h = await harness(t);
  const adapter = new CctpEVMAdapter({rpc: async (_url, method) => {
    h.calls.rpc.push(method);
    if (method === 'eth_chainId') return h.record.binding.sourceNetwork.chainId;
    if (method === 'eth_getBlockByNumber') return {hash: h.record.binding.sourceNetwork.genesis};
    if (method === 'eth_getTransactionReceipt') return null;
    assert.fail('Read-only missing-receipt branch must not query or send another transaction: ' + method);
  }});
  // An already verified original signed-record boundary is a seam here; no private key is used.
  adapter.verifySigned = () => true;
  h.wallet.checkCctpStep = async request => {
    h.calls.check.push(copy(request));
    const next = await adapter.reconcile(request.network, {hash: BURN_HASH, raw: 'controlled-original-record', cctp: {step: 'burn'}});
    return {id: request.id, hash: BURN_HASH, ...next};
  };
  // If production rechecks source attestation on prepare, a missing receipt must not pass.
  h.reader.receipt = async () => null;
  const checked = await h.flow.check(h.record.id);
  assert.equal(checked.operations[0].state, 'unknown');
  assert.equal(checked.operations[0].hash, BURN_HASH);
  assert.ok(h.calls.rpc.includes('eth_getTransactionReceipt'));
  await assert.rejects(h.flow.prepareStep(h.record.id), error => /^CCTP_/.test(error.code ?? ''), 'missing original burn inclusion must prevent a new mint review');
  assert.equal(h.calls.prepare.length, 0, 'no mint review may escape to original custody');
  const saved = await h.store.get(h.record.id);
  assert.notEqual(saved.state, 'mint-ready');
  assert.equal(saved.proof.nonce, NONCE, 'retain the original proof as evidence without treating it as current readiness');
});

test('legacy persisted mint-ready with unknown burn must reject direct prepare without discarding its original history', async t => {
  const h = await harness(t);
  assert.ok(h.store.file instanceof AtomicMultiFile);
  // 9f90 could durably save this combination after an included burn became UNKNOWN.
  await h.store.file.mutate(value => {value.records[0].operations[0].state = 'unknown'; return value});
  const disk = JSON.parse(await readFile(h.filePath, 'utf8'));
  assert.equal(disk.records[0].state, 'mint-ready');
  assert.equal(disk.records[0].operations[0].state, 'unknown');
  assert.equal(disk.records[0].proof.nonce, NONCE);
  const restartedStore = new CctpStore({filePath: h.filePath});
  const restarted = new CctpFlow({wallet: h.wallet, reader: h.reader, store: restartedStore, now: () => h.time});
  const before = await restartedStore.get(h.record.id);
  await assert.rejects(restarted.prepareStep(h.record.id), {code: 'CCTP_CHECK_ORIGINAL'}, 'an old cached ready label cannot authorize mint while its original burn is UNKNOWN');
  assert.equal(h.calls.check.length, 0, 'this exercises direct prepare, with no preceding check to repair state');
  assert.equal(h.calls.prepare.length, 0, 'the original Wallet must not receive a mint preparation');
  assert.deepEqual(await restartedStore.get(h.record.id), before, 'keep the invalid readiness combination queryable without erasing hash, proof or history');
});

test('reader attestation completion cannot mutate a cold flow after actor or network configuration changes', async t => {
  for (const change of ['account', 'configuration']) await t.test(change, async child => {
    const h = await harness(child, 'attestation-pending'), entered = deferred(), release = deferred();
    const originalGet = h.reader.get.bind(h.reader);
    h.reader.get = async (...args) => {h.calls.attestation++; entered.resolve(); await release.promise; return originalGet(...args)};
    const checking = h.flow.check(h.record.id);
    await entered.promise;
    if (change === 'account') {h.current.context.account = OTHER; h.current.context.revision++}
    else {h.current.revision++; h.current.networks = h.current.networks.map(network => ({...network, rpcUrl: 'https://changed.example.org/'}))}
    release.resolve();
    await assert.rejects(checking, error => ['MULTICHAIN_CONTEXT_CHANGED', 'CCTP_ACCOUNT_CHANGED', 'CCTP_NETWORK_CHANGED'].includes(error.code));
    const saved = await h.store.get(h.record.id);
    assert.equal(h.calls.attestation, 1, 'the actual reader reached its awaited Iris response');
    assert.equal(saved.proof, null, 'do not publish proof accepted under the obsolete actor/configuration');
    assert.equal(saved.state, 'attestation-pending');
    assert.equal(h.calls.prepare.length, 0);
  });
});

test('actual destination finality read cannot publish completion after actor or configuration changes', async t => {
  for (const change of ['account', 'configuration']) await t.test(change, async child => {
    const h = await harness(child), entered = deferred(), release = deferred(), mintHash = '0x' + 'cc'.repeat(32);
    const mint = {step: 'mint', id: randomUUID(), state: 'submitted', hash: mintHash};
    await h.store.update(h.record.id, h.record.revision, value => {value.state = 'mint-pending'; value.operations.push(mint)});
    h.wallet.checkCctpStep = async request => ({id: request.id, state: 'included', hash: mintHash});
    const receipt = {transactionHash: mintHash, blockHash: '0x' + 'ab'.repeat(32), blockNumber: '0x63', transactionIndex: '0x0', status: '0x1', logs: []};
    const event = (address, abi, name, args) => ({address, ...abi.encodeEventLog(abi.getEvent(name), args), transactionHash: mintHash,
      blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, transactionIndex: receipt.transactionIndex, logIndex: '0x' + receipt.logs.length.toString(16), removed: false});
    receipt.logs.push(event(ROUTE.destination.messageTransmitter, received, 'MessageReceived', [ACCOUNT, 0, NONCE,
      zeroPadValue(ROUTE.source.tokenMessenger, 32), 2000, '0x' + h.proof.message.slice(2 + 148 * 2)]));
    receipt.logs.push(event(ROUTE.destination.usdc, token, 'Transfer', ['0x' + '00'.repeat(20), RECIPIENT, h.proof.amountReceived]));
    h.reader.receipt = async () => copy(receipt);
    // Keep destination() production validation, controlling only public contract/RPC reads.
    h.reader.read = async (_network, _contract, _abi, method) => {
      assert.ok(['usedNonces', 'balanceOf'].includes(method)); return method === 'usedNonces' ? '1' : '999925';
    };
    h.reader.evm.call = async (_network, method, params) => {
      assert.equal(method, 'eth_getBlockByNumber'); assert.deepEqual(params, ['finalized', false]);
      entered.resolve(); await release.promise; return {hash: '0x' + 'ac'.repeat(32), number: '0x64'};
    };
    const checking = h.flow.check(h.record.id);
    await entered.promise;
    if (change === 'account') {h.current.context.account = OTHER; h.current.context.revision++}
    else {h.current.revision++; h.current.networks = h.current.networks.map(network => ({...network, rpcUrl: 'https://changed.example.org/'}))}
    release.resolve();
    await assert.rejects(checking, error => ['MULTICHAIN_CONTEXT_CHANGED', 'CCTP_ACCOUNT_CHANGED', 'CCTP_NETWORK_CHANGED'].includes(error.code));
    const saved = await h.store.get(h.record.id);
    assert.equal(saved.state, 'mint-pending');
    assert.equal(saved.destination, null, 'a finality response under obsolete context must not be published');
    assert.equal(saved.operations.at(-1).hash, mintHash);
    assert.equal(saved.proof.nonce, NONCE);
    assert.equal(h.calls.prepare.length, 0);
  });
});

test('original transaction lookup cannot publish its receipt after an account switch during the await', async t => {
  const h = await harness(t, 'attestation-pending'), entered = deferred(), release = deferred();
  await h.store.update(h.record.id, h.record.revision, value => {value.state = 'burn-pending'; value.operations[0].state = 'submitted'});
  const before = await h.store.get(h.record.id);
  h.wallet.checkCctpStep = async request => {
    h.calls.check.push(copy(request)); entered.resolve(); await release.promise;
    return {id: request.id, state: 'included', hash: BURN_HASH};
  };
  const get = h.reader.get.bind(h.reader);
  h.reader.get = async (...args) => {h.calls.attestation++; return get(...args)};
  const checking = h.flow.check(h.record.id);
  await entered.promise;
  h.current.context.account = OTHER; h.current.context.revision++;
  release.resolve();
  await assert.rejects(checking, error => ['MULTICHAIN_CONTEXT_CHANGED', 'CCTP_ACCOUNT_CHANGED'].includes(error.code));
  assert.deepEqual(await h.store.get(h.record.id), before, 'obsolete original lookup must not publish an included state');
  assert.equal(h.calls.check.length, 1);
  assert.equal(h.calls.attestation, 0, 'do not advance to Iris after actor changed during original lookup');
  assert.equal(h.calls.prepare.length, 0);
});

// The same public deterministic key already used by cctp-action.test.mjs.
// It supplies synthetic original journal bytes only, never a real Wallet key.
const PUBLIC_TEST_SECRET = '0x' + '0'.repeat(63) + '1';
const PUBLIC_TEST_ACCOUNT = new Wallet(PUBLIC_TEST_SECRET).address.toLowerCase();
const terminalToken = new Interface(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)']);
const terminalMint = new Interface(['function receiveMessage(bytes,bytes) returns(bool)']);

async function originalTerminalHarness(t, {step, signed = false, knownHash = false, conflictingHash = false}) {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-cctp-original-terminal-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const journalPath = join(directory, 'journal.json'), routePath = join(directory, 'cross-chain.json'), time = 1800000000000;
  const networks = [ROUTE.source, ROUTE.destination].map((route, i) => validateNetwork({name: route.name, chainId: String(route.chainId), rpcUrl: `https://terminal-${i}.example.org`, symbol: 'ETH', decimals: 18, genesis: '0x' + String(i + 1).repeat(64)}));
  const context = {account: PUBLIC_TEST_ACCOUNT, revision: 1, locked: false};
  const configuration = {revision: 5, selected: networks[0].id, networks, tokens: []};
  const binding = {routeId: ROUTE.id, account: PUBLIC_TEST_ACCOUNT, recipient: RECIPIENT, amountUnits: '1000000', maxFeeUnits: '100',
    maxSourceGasFeeWei: '1000000000000000', maxDestinationGasFeeWei: '1000000000000000', sourceNetwork: networks[0], destinationNetwork: networks[1],
    context: {...context, epoch: 0}, configRevision: 5, expiresAt: time + 120000, quoteId: randomUUID()};
  const proof = {sourceTxHash: BURN_HASH, nonce: NONCE, message: message(binding), attestation: '0x' + '12'.repeat(65), amountReceived: '999925', feeExecuted: '75'};
  const intentId = randomUUID(), calls = {rpc: [], custody: 0, submit: 0, configWrites: 0};
  let queryOnly = false;
  const adapter = new CctpEVMAdapter({rpc: async (url, method, params) => {
    calls.rpc.push(method); assert.equal(queryOnly, false, 'terminal original lookup must not query or send RPC');
    const network = networks.find(n => n.rpcUrl === url); assert.ok(network);
    if (method === 'eth_chainId') return network.chainId;
    if (method === 'eth_getBlockByNumber') {assert.equal(params[0], '0x0'); return {hash: network.genesis}}
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_getTransactionCount') return '0x1';
    if (method === 'eth_gasPrice') return '0x3b9aca00';
    if (method === 'eth_estimateGas') return '0xc350';
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_call') {
      const selector = params[0].data.slice(0, 10);
      for (const name of ['balanceOf', 'allowance']) if (selector === terminalToken.getFunction(name).selector) return terminalToken.encodeFunctionResult(name, [1000000]);
      if (selector === terminalToken.getFunction('approve').selector) return terminalToken.encodeFunctionResult('approve', [true]);
      if (selector === terminalMint.getFunction('receiveMessage').selector) return terminalMint.encodeFunctionResult('receiveMessage', [true]);
      return '0x';
    }
    assert.fail('Fixture cannot send or perform any other RPC: ' + method);
  }});
  const config = {read: async () => copy(configuration), remove: async () => {calls.configWrites++; assert.fail('Original route must retain its network lock')}};
  const journal = new MultiJournal({filePath: journalPath});
  const service = new MultichainService({config, journal, adapter, getContext: async () => copy(context), now: () => time,
    withSecret: async () => {
      calls.custody++;
      const rows = await journal.list(networks[0].id, PUBLIC_TEST_ACCOUNT);
      assert.equal(rows.length, 1); assert.equal(rows[0].state, 'prepared'); assert.equal(rows[0].raw, null); assert.equal(rows[0].hash, null);
      // Reject after the real reservation, before invoking the signer callback.
      throw multiError('FIXTURE_CUSTODY_REFUSED', 'Controlled refusal before key callback');
    }});
  const review = await service.prepareCctpStep({intentId, step, binding, proof: step === 'mint' ? proof : null});
  if (!signed) {
    await assert.rejects(service.sendCctpStep(review.id, {account: PUBLIC_TEST_ACCOUNT, assert() {}, submit() {calls.submit++; assert.fail('Refused custody cannot submit')}}), {code: 'FIXTURE_CUSTODY_REFUSED'});
    assert.equal(calls.custody, 1); assert.equal(calls.submit, 0);
  } else {
    // Use the actual journal reservation's live cancellation permit. A reopened
    // record or renderer boolean cannot manufacture this durable terminal state.
    const original = {id: review.id, network: review.network, account: review.account, nonce: review.transaction.nonce, asset: review.asset, to: review.to, amount: review.amount,
      transaction: review.transaction, cctp: review.cctp, state: 'prepared', raw: null, hash: null, receipt: null, createdAt: time, updatedAt: time};
    const permit = await journal.reserve(original);
    try {
      const bytes = await adapter.sign(PUBLIC_TEST_SECRET, original);
      await journal.transition(original.id, {state: 'signed', ...bytes, updatedAt: time});
      await permit.cancelSigned(time);
    } finally {permit.retire()}
    assert.equal(calls.custody, 0);
  }
  const original = (await journal.list(review.network.id, PUBLIC_TEST_ACCOUNT))[0];
  assert.equal(original.state, signed ? 'local-cancelled-before-broadcast' : 'cancelled');
  assert.equal(original.raw === null, !signed); assert.equal(original.hash === null, !signed);
  const operation = {step, id: review.id, state: 'unknown', hash: conflictingHash ? '0x' + 'ee'.repeat(32) : knownHash ? original.hash : null};
  const record = {id: intentId, revision: 0, binding, state: step === 'approve' ? 'approval-pending' : step === 'burn' ? 'burn-pending' : 'mint-pending',
    operations: [...(step === 'mint' ? [{step: 'burn', id: randomUUID(), state: 'included', hash: BURN_HASH}] : []), operation],
    proof: step === 'mint' ? proof : null, destination: null, firstError: signed ? 'ORIGINAL_SIGNED_CANCELLED' : 'FIXTURE_CUSTODY_REFUSED', createdAt: time, updatedAt: time};
  const store = new CctpStore({filePath: routePath}); await store.insert(record);
  queryOnly = true;
  const cold = () => {
    const coldStore = new CctpStore({filePath: routePath});
    const wallet = new MultichainService({config, journal: new MultiJournal({filePath: journalPath}), adapter, getContext: async () => copy(context), now: () => time,
      pendingRouteNetwork: id => coldStore.pendingNetwork(id), withSecret: async () => {calls.custody++; assert.fail('Cold terminal observation must not enter custody')}});
    const reader = Object.fromEntries(['quote', 'attestation', 'destination'].map(name => [name, async () => assert.fail('Terminal observation must not request ' + name)]));
    return {wallet, store: coldStore, flow: new CctpFlow({wallet, reader, store: coldStore, now: () => time})};
  };
  return {cold, original, record, operation, networks, calls, journalPath, routePath, config, configuration};
}

for (const options of [
  {name: 'custody refusal before callback', step: 'approve'},
  {name: 'signed cancellation with unacknowledged original hash', step: 'burn', signed: true},
  {name: 'signed cancellation with known original hash and prior burn proof', step: 'mint', signed: true, knownHash: true},
]) test('original Main terminal observation ' + options.name + ' stays query-only across cold recovery', async t => {
  const h = await originalTerminalHarness(t, options), beforeCalls = copy(h.calls);
  const beforeJournal = await readFile(h.journalPath, 'utf8'), beforeRoute = await readFile(h.routePath, 'utf8');
  const expected = {...h.record, originalObservation: {version: 1, intentId: h.record.id, operationId: h.operation.id, step: options.step,
    account: h.record.binding.account, network: h.original.network, recordedState: h.original.state, hash: h.original.hash, view: 'query-only', routeOutcome: 'unknown'}};
  for (let restart = 0; restart < 2; restart++) {
    const {wallet, store, flow} = h.cold();
    const originalView = await wallet.checkCctpStep({id: h.operation.id, network: h.original.network, account: h.original.account, intentId:h.record.id, step:h.operation.step});
    const {raw, ...publicOriginal} = h.original;
    assert.deepEqual(originalView, publicOriginal, 'the real Main query retains its original terminal state and strips raw bytes');
    const observed = await flow.check(h.record.id);
    assert.deepEqual(observed, expected, 'original terminal evidence is a response projection, never new route readiness');
    if (raw) assert.equal(JSON.stringify(observed).includes(raw), false, 'signed custody bytes must never enter the route projection');
    assert.deepEqual(await flow.history(), [h.record]);
    assert.deepEqual(await store.get(h.record.id), h.record, 'retain local hash/null, proof, first cause and original revision');
    await assert.rejects(flow.prepareStep(h.record.id), {code: 'CCTP_CHECK_ORIGINAL'});
    await assert.rejects(flow.confirmStep({id: h.record.id, reviewId: h.operation.id}), {code: 'CCTP_CHECK_ORIGINAL'});
    assert.equal((await flow.cancel(h.record.id)).cancelled, false);
    for (const network of h.networks) {
      assert.equal(await store.pendingNetwork(network.id), 1);
      await assert.rejects(wallet.remove(network.id), {code: 'MULTICHAIN_RESOLUTION_REQUIRED'});
    }
    assert.equal(await readFile(h.journalPath, 'utf8'), beforeJournal, 'read-only original observation must not transition Main journal');
    assert.equal(await readFile(h.routePath, 'utf8'), beforeRoute, 'read-only original observation must not rewrite route history');
  }
  assert.deepEqual(h.calls, beforeCalls, 'cold observation must perform no new RPC, custody, submit or network write');
  assert.deepEqual(await h.config.read(), h.configuration);
});

test('original Main terminal observation refuses a different known hash without replacing durable history', async t => {
  const h = await originalTerminalHarness(t, {step: 'burn', signed: true, conflictingHash: true}), beforeCalls = copy(h.calls);
  const beforeJournal = await readFile(h.journalPath, 'utf8'), beforeRoute = await readFile(h.routePath, 'utf8');
  const {flow, store} = h.cold();
  await assert.rejects(flow.check(h.record.id), {code: 'CCTP_RESULT_MISMATCH'});
  assert.deepEqual(await store.get(h.record.id), h.record);
  assert.equal(await readFile(h.journalPath, 'utf8'), beforeJournal); assert.equal(await readFile(h.routePath, 'utf8'), beforeRoute);
  for (const network of h.networks) assert.equal(await store.pendingNetwork(network.id), 1);
  assert.deepEqual(h.calls, beforeCalls);
});
