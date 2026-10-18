import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPQTransactionProgress, pqProgressReadUnavailable} from './progress-view.mjs';

// Public-shape unit controls only; no Source, transaction or finality claim.
const binding = Object.freeze({account: '0x' + '1'.repeat(40), hash: '0x' + '2'.repeat(64), kind: 'pq-transfer'});
const journal = (status = 'submission-unknown', patch = {}) => ({...binding, status,
  storageConfirmed: status !== 'signed-unsubmitted', metadataConfirmed: status !== 'signed-unsubmitted',
  localResultHeld: false, firstCause: null, storageCause: null,
  retryAuthorized: false, clearsOriginal: false, consensusFinality: false, ...patch});
const bft = (outcome = 'bft-inclusion-observed', patch = {}) => ({...binding, source: 'comet-rpc',
  nativeTransactionHash: binding.hash, outcome, executionHeight: outcome === 'bft-inclusion-observed' ? '9007199254740994' : '0',
  ...(outcome === 'bft-inclusion-observed' ? {abciTransactionHash: '0x' + '3'.repeat(64), decimalFields: {amount: '3', fee: '1', nonce: '9007199254740994'}, cometIndex: 0} : {}),
  retryAuthorized: false, clearsOriginal: false, consensusFinality: false, producerDurability: false, ...patch});
const reject = (value, expected = binding) => assert.throws(() => projectPQTransactionProgress(value, expected),
  error => error.code === 'PQ_TRANSACTION_PROGRESS_INVALID' && !error.message.includes('PRIVATE_TEST'));

test('journal projection keeps unsubmitted, unknown, rejection and inclusion distinct without claiming finality', () => {
  for (const [status, fact] of [['signed-unsubmitted', false], ['submission-unknown', null], ['rejection-observed', null], ['inclusion-observed', true]]) {
    const value = projectPQTransactionProgress(journal(status), binding);
    assert.equal(value.status, status); assert.equal(value.submitted, fact); assert.equal(value.included, fact);
    assert.equal(value.consensusFinality, false); assert.equal(value.canRetry, false); assert.equal(value.clearsOriginal, false);
    assert.equal(value.source, 'local-journal'); assert.ok(Object.isFrozen(value));
  }
});

test('an inclusion held in memory remains an observation with explicit unconfirmed storage', () => {
  const value = projectPQTransactionProgress(journal('inclusion-observed', {storageConfirmed: false, metadataConfirmed: false, localResultHeld: true}), binding);
  assert.equal(value.included, true); assert.equal(value.storageConfirmed, false); assert.equal(value.metadataConfirmed, false);
  assert.equal(value.localResultHeld, true); assert.equal(value.consensusFinality, false);
});

test('Comet inclusion, unknown and rejection project only the bound observation', () => {
  for (const [outcome, status, fact] of [['bft-inclusion-observed', 'inclusion-observed', true], ['outcome-unknown', 'submission-unknown', null], ['rejection-observed', 'rejection-observed', null]]) {
    const value = projectPQTransactionProgress(bft(outcome), binding);
    assert.equal(value.status, status); assert.equal(value.submitted, fact); assert.equal(value.included, fact);
    assert.equal(value.storageConfirmed, null); assert.equal(value.source, 'comet-rpc'); assert.equal(value.canRetry, false);
    assert.equal(value.consensusFinality, false); assert.equal('abciTransactionHash' in value, false);
  }
});

test('failed read reports unavailable without fabricating UNKNOWN, submission, absence or storage facts', () => {
  const value = pqProgressReadUnavailable(binding);
  assert.equal(value.status, 'unavailable'); assert.equal(value.submitted, null); assert.equal(value.included, null);
  assert.equal(value.storageConfirmed, null); assert.equal(value.canRetry, false); assert.equal(value.clearsOriginal, false);
  assert.equal(value.consensusFinality, false); assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});

test('all public projections have one closed serializable output shape', () => {
  const expected = ['account', 'hash', 'kind', 'status', 'source', 'submitted', 'included', 'consensusFinality', 'canRetry', 'clearsOriginal', 'storageConfirmed', 'metadataConfirmed', 'localResultHeld'].sort();
  for (const value of [projectPQTransactionProgress(journal(), binding), projectPQTransactionProgress(bft(), binding), pqProgressReadUnavailable(binding)]) {
    assert.deepEqual(Object.keys(value).sort(), expected); assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  }
});

test('account, hash and kind mismatch cannot retarget either source', () => {
  for (const input of [journal(), bft()]) for (const patch of [{account: '0x' + '4'.repeat(40)}, {hash: '0x' + '4'.repeat(64)}, {kind: 'pq-migration'}]) reject({...input, ...patch});
  reject(bft('bft-inclusion-observed', {nativeTransactionHash: '0x' + '4'.repeat(64)}));
});

test('wire, raw response, secrets, extra fields and symbols never enter the projection', () => {
  for (const input of [journal(), bft()]) {
    for (const key of ['wire', 'raw', 'text', 'secret', 'privateKey', 'extra']) reject({...input, [key]: 'PRIVATE_TEST'});
    reject({...input, [Symbol('PRIVATE_TEST')]: true});
  }
  reject(journal(), {...binding, secret: 'PRIVATE_TEST'});
  assert.throws(() => pqProgressReadUnavailable({...binding, raw: 'PRIVATE_TEST'}), {code: 'PQ_TRANSACTION_PROGRESS_INVALID'});
});

test('top-level, nested and binding getters are refused without invocation', () => {
  let reads = 0;
  for (const key of ['status', 'firstCause', 'account']) {
    const input = journal(); Object.defineProperty(input, key, {enumerable: true, get() { reads++; return 'PRIVATE_TEST'; }}); reject(input);
  }
  const decimals = {amount: '3', fee: '1', nonce: '2'};
  Object.defineProperty(decimals, 'nonce', {enumerable: true, get() { reads++; return '2'; }}); reject(bft('bft-inclusion-observed', {decimalFields: decimals}));
  const expected = {...binding}; Object.defineProperty(expected, 'hash', {enumerable: true, get() { reads++; return binding.hash; }}); reject(journal(), expected);
  assert.equal(reads, 0);
});

test('non-records, inherited data, nonenumerable fields and throwing proxies fail with a safe fixed error', () => {
  for (const input of [null, [], false, Object.create(journal()), new Date(), new Proxy({}, {ownKeys() { throw Error('PRIVATE_TEST'); }})]) reject(input);
  const input = journal(); Object.defineProperty(input, 'status', {value: 'submission-unknown', enumerable: false}); reject(input);
});

test('caller claims cannot upgrade retry, deletion, finality, durability or journal storage', () => {
  for (const input of [journal(), bft()]) for (const key of ['retryAuthorized', 'clearsOriginal', 'consensusFinality']) for (const value of [true, 'false', 0]) reject({...input, [key]: value});
  reject(bft('bft-inclusion-observed', {producerDurability: true}));
  reject(journal('submission-unknown', {storageConfirmed: false, metadataConfirmed: true}));
  reject(journal('signed-unsubmitted', {localResultHeld: true}));
  reject(journal('finalized')); reject(journal('durable'));
});

test('redacted first and storage causes are validated but never exposed', () => {
  const value = projectPQTransactionProgress(journal('submission-unknown', {
    firstCause: {kind: 'boolean', value: false, code: null}, storageCause: {kind: 'string', value: 'redacted', code: 'SAVE_FAILED'}
  }), binding);
  assert.equal('firstCause' in value, false); assert.equal(JSON.stringify(value).includes('SAVE_FAILED'), false);
  for (const entry of [{kind: 'string', value: 'PRIVATE_TEST', code: null}, {kind: 'number', value: NaN, code: null}, {kind: 'object', value: {}, code: null}, {kind: 'error', value: null, code: null, raw: 'PRIVATE_TEST'}]) reject(journal('submission-unknown', {firstCause: entry}));
});

test('BFT shape rejects wrong source, unsafe integers, missing inclusion evidence and extra nested data', () => {
  for (const patch of [{source: 'authoritative_producer'}, {executionHeight: 30}, {executionHeight: '18446744073709551616'}, {executionHeight: '0'}, {cometIndex: -1}, {cometIndex: 4294967296}, {abciTransactionHash: undefined}, {decimalFields: {amount: '3', fee: '1', nonce: '02'}}, {decimalFields: {amount: '3', fee: '1', nonce: '2', raw: 'PRIVATE_TEST'}}]) reject(bft('bft-inclusion-observed', patch));
  reject(bft('outcome-unknown', {executionHeight: '1'})); reject(bft('rejection-observed', {cometIndex: 0}));
});

test('revocation inclusion accepts only its existing bound public shape without treating fee effects as verified', () => {
  const expected = {...binding, kind: 'pq-revocation'};
  const input = bft('bft-inclusion-observed', {kind: expected.kind,
    signedRevocation: {authorizingRevision: '1', throughRevision: '2', executeAt: '9007199254740994', revokeAt: '9007199254740995'},
    feeLotFlowObserved: true, feeEffectsVerified: false});
  const value = projectPQTransactionProgress(input, expected);
  assert.equal(value.included, true); assert.equal(value.consensusFinality, false); assert.equal('feeEffectsVerified' in value, false);
  reject({...input, feeEffectsVerified: true}, expected);
  reject({...input, signedRevocation: {...input.signedRevocation, executeAt: '31'}}, expected);
  reject({...input, kind: 'pq-transfer'});
});

test('later input mutation or a failed read cannot mutate a previous valid projection or original binding', () => {
  const input = journal('inclusion-observed'), before = {...binding};
  const view = projectPQTransactionProgress(input, binding);
  input.status = 'submission-unknown'; input.hash = '0x' + '5'.repeat(64); pqProgressReadUnavailable(binding);
  assert.equal(view.status, 'inclusion-observed'); assert.equal(view.hash, binding.hash); assert.deepEqual(binding, before);
});
