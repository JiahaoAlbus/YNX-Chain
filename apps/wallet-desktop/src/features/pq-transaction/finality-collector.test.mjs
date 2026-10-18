import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTransferOriginal} from './transfer-binding.mjs';
import {PQ_FINALITY_COLLECTOR_SOURCE, PQ_FINALITY_COLLECTOR_LIMITS as limits,
  planPQTransferFinalityCollector, parsePQTransferFinalityCollector,
  validatePQTransactionProofDTO} from './finality-collector.mjs';

// The original signed wire is a producer fixture. Proof bytes below are only
// CONTROLLED transport grammar, deliberately NOT cryptographic Comet proofs.
const vector = JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz', import.meta.url)), {maxOutputLength: 8 * 1024 * 1024}));
const row = vector.originals.find(value => value.name === 'transfer-lost-response');
const binding = Object.freeze({account: vector.owner, networkId: vector.networkId});
const original = createPQOriginalRecord({account: binding.account, kind: 'pq-transfer', operationId: 'QA-finality-collector-original',
  request: preparePQTransferTransport(Buffer.from(row.wire, 'base64'))});
const prepared = preparePQTransferOriginal(original, binding);
const base64 = text => Buffer.from(text).toString('base64');
const proof = () => ({version: 'YNX-PQ-TRANSACTION-PROOF/v1',
  block: {version: 'YNX-PQ-LIGHT-PROOF/v1', commitResult: base64('controlled H commit, not a proof'), validatorsResult: base64('controlled H validators')},
  successor: {version: 'YNX-PQ-LIGHT-PROOF/v1', commitResult: base64('controlled H+1 commit'), validatorsResult: base64('controlled H+1 validators')},
  transactionProof: base64('controlled inclusion bytes'), executionResult: base64('controlled ABCI bytes'), executionProof: base64('controlled result proof bytes')});
const full = (status = 'collected', observedExecutionStatus = 'committed') => ({
  version: 'YNX-PQ-RPC-TRANSACTION-PROOF/v1', source: 'configured-comet-rpc', status, observedExecutionStatus,
  nativeTransactionHash: original.hash, abciTransactionHash: prepared.binding.abciTransactionHash,
  executionHeight: '42', cometIndex: 0, independentFinality: false, proofVerification: 'not-performed',
  ...(status === 'collected' ? {proof: proof()} : {}), ...(status === 'unavailable' ? {error: 'controlled remote error MUST NOT reach UI'} : {}),
});
const early = () => ({version: 'YNX-PQ-RPC-TRANSACTION-PROOF/v1', source: 'configured-comet-rpc', status: 'unavailable',
  nativeTransactionHash: '', abciTransactionHash: prepared.binding.abciTransactionHash, executionHeight: '0',
  independentFinality: false, proofVerification: 'not-performed', error: 'controlled early lookup failure'});
const bytes = value => Buffer.from(JSON.stringify(value));
const parse = (value, status = 200) => parsePQTransferFinalityCollector(original, binding, status, bytes(value));
const rejected = (value, status = 200) => assert.throws(() => parse(value, status), error => /^PQ_/.test(error.code));
const rejectedRaw = raw => assert.throws(() => parsePQTransferFinalityCollector(original, binding, 200, Buffer.from(raw)), error => /^PQ_/.test(error.code));
const replaceField = (object, path, value) => {
  let target = object;
  for (const name of path.slice(0, -1)) target = target[name];
  target[path.at(-1)] = value;
  return object;
};
const byteFields = [
  [['block', 'commitResult'], limits.commitBytes], [['block', 'validatorsResult'], limits.validatorsBytes],
  [['successor', 'commitResult'], limits.commitBytes], [['successor', 'validatorsResult'], limits.validatorsBytes],
  [['transactionProof'], limits.transactionProofBytes], [['executionResult'], limits.executionResultBytes],
  [['executionProof'], limits.executionProofBytes],
];

test('fixed source bounds and GET plan use the original outer ABCI hash', () => {
  assert.equal(PQ_FINALITY_COLLECTOR_SOURCE, 'c3c219d5a3c560a2e0a5627850e1fa1f45ecd2e6');
  assert.deepEqual(limits, {proofBytes: 83886080, envelopeBytes: 65536, lightProofBytes: 14680064,
    commitBytes: 8388608, validatorsBytes: 2097152, transactionProofBytes: 33619968,
    executionResultBytes: 1048576, executionProofBytes: 32768});
  const plan = planPQTransferFinalityCollector(original, binding);
  assert.deepEqual(plan, {method: 'GET', path: '/txs/' + prepared.binding.abciTransactionHash + '/pq-finality-proof'});
  assert.notEqual(prepared.binding.abciTransactionHash, original.hash);
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(limits));
});

test('collected committed observation remains unverified DATA with a main-only copied proof', () => {
  const input = full(), raw = bytes(input), originalBefore = JSON.stringify(original);
  const result = parsePQTransferFinalityCollector(original, binding, 200, raw);
  assert.deepEqual(Object.keys(result), ['observation', 'proof', 'rawSha256', 'byteLength']);
  assert.deepEqual(result.observation, {account: original.account, operationId: original.operationId,
    kind: 'pq-transfer', transactionType: 'pq_transfer', source: 'configured-comet-rpc', status: 'collected',
    observedExecutionStatus: 'committed', nativeTransactionHash: original.hash,
    abciTransactionHash: prepared.binding.abciTransactionHash, executionHeight: '42', cometIndex: 0,
    independentFinality: false, proofVerification: 'not-performed', consensusFinality: false, canRetry: false});
  assert.equal(result.rawSha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.byteLength, raw.length); assert.deepEqual(result.proof, input.proof);
  const before = JSON.stringify(result);
  raw.fill(0); input.proof.block.commitResult = base64('changed caller DTO'); input.status = 'forged';
  assert.equal(JSON.stringify(result), before); assert.equal(JSON.stringify(original), originalBefore);
  for (const item of [result, result.observation, result.proof, result.proof.block, result.proof.successor]) assert.ok(Object.isFrozen(item));
  assert.deepEqual(JSON.parse(JSON.stringify(result.observation)), result.observation);
  for (const forbidden of ['wire', 'to', 'amount', 'raw', 'error', 'proof', 'secret']) assert.equal(Object.hasOwn(result.observation, forbidden), false);
});

test('collected rejection stays distinct from committed and never becomes success or finality', () => {
  const result = parse(full('collected', 'rejected'));
  assert.equal(result.observation.observedExecutionStatus, 'rejected');
  assert.equal(result.observation.status, 'collected'); assert.ok(result.proof);
  assert.equal(result.observation.consensusFinality, false); assert.equal(result.observation.independentFinality, false);
  assert.equal(result.observation.proofVerification, 'not-performed');
  for (const name of ['executionSucceeded', 'finalized', 'success', 'submitted', 'included']) assert.equal(Object.hasOwn(result.observation, name), false);
});

test('pending retains both execution outcomes and coordinates without any proof or finality', () => {
  for (const outcome of ['committed', 'rejected']) {
    const result = parse(full('pending', outcome), 202);
    assert.equal(result.observation.status, 'pending'); assert.equal(result.observation.observedExecutionStatus, outcome);
    assert.equal(result.observation.executionHeight, '42'); assert.equal(result.proof, null);
    assert.equal(result.observation.independentFinality, false); assert.equal(result.observation.canRetry, false);
  }
});

test('unavailable accepts only early or complete coordinates and excludes remote error from output', () => {
  for (const input of [early(), full('unavailable'), full('unavailable', 'rejected')]) {
    const result = parse(input, 502);
    assert.equal(result.observation.status, 'unavailable'); assert.equal(result.proof, null);
    assert.equal(result.observation.nativeTransactionHash, input.nativeTransactionHash);
    assert.equal(result.observation.executionHeight, input.executionHeight);
    assert.equal(result.observation.observedExecutionStatus, input.observedExecutionStatus ?? null);
    assert.equal(JSON.stringify(result).includes(input.error), false);
  }
  rejected({...early(), nativeTransactionHash: original.hash}, 502);
  rejected({...early(), cometIndex: 0}, 502);
  rejected({...early(), observedExecutionStatus: 'committed'}, 502);
  rejected({...full('unavailable'), nativeTransactionHash: ''}, 502);
});

test('HTTP status, collection status, proof presence and error presence cannot contradict', () => {
  for (const [value, status] of [
    [full(), 202], [full(), 502], [full('pending'), 200], [full('pending'), 502],
    [full('unavailable'), 200], [full('unavailable'), 202],
    [{...full('pending'), proof: proof()}, 202], [{...early(), proof: proof()}, 502],
    [{...full(), error: 'hidden'}, 200], [{...full('pending'), error: 'hidden'}, 202],
    [{...early(), error: ''}, 502], [{...full(), proof: null}, 200],
  ]) rejected(value, status);
  const noProof = full(); delete noProof.proof; rejected(noProof);
  const noError = early(); delete noError.error; rejected(noError, 502);
  for (const status of [0, 201, 204, 400, 500, '200', NaN]) rejected(full(), status);
});

test('both hashes must bind the actual journal transfer on every accepted response status', () => {
  for (const [value, status] of [[full(), 200], [full('pending'), 202], [early(), 502], [full('unavailable'), 502]]) {
    for (const hash of ['', '0x' + 'ab'.repeat(32), original.hash, prepared.binding.abciTransactionHash.toUpperCase()]) {
      rejected({...value, abciTransactionHash: hash}, status);
    }
    const omitted = {...value}; delete omitted.abciTransactionHash; rejected(omitted, status);
    const omittedNative = {...value}; delete omittedNative.nativeTransactionHash; rejected(omittedNative, status);
    rejected({...value, nativeTransactionHash: '0x' + 'fe'.repeat(32)}, status);
    rejected({...value, nativeTransactionHash: prepared.binding.abciTransactionHash}, status);
  }
  rejected({...full(), nativeTransactionHash: ''});
});

test('height and index preserve canonical source integer bounds, not lossy numeric aliases', () => {
  for (const height of ['0', '01', '-1', '1.0', '1e2', '', '9223372036854775807', '18446744073709551615', 42]) rejected({...full(), executionHeight: height});
  for (const index of [-1, 0.1, 4294967296, '0', null, true]) rejected({...full(), cometIndex: index});
  const noIndex = full(); delete noIndex.cometIndex; rejected(noIndex);
  for (const token of ['-0', '0.0', '0e0', '00', '1e1']) rejectedRaw(JSON.stringify(full()).replace('"cometIndex":0', '"cometIndex":' + token));
  const result = parse({...full(), executionHeight: '9223372036854775806', cometIndex: 4294967295});
  assert.equal(result.observation.executionHeight, '9223372036854775806'); assert.equal(result.observation.cometIndex, 4294967295);
});

test('collector version/source/finality claims and every required field are closed', () => {
  for (const patch of [{version: 'v2'}, {source: 'other-node'}, {independentFinality: true},
    {proofVerification: 'verified'}, {observedExecutionStatus: 'partial'}, {status: 'success'},
    {consensusFinality: true}, {authority: true}, {raw: 'private'}, {error: 'private'}]) rejected({...full(), ...patch});
  for (const key of Object.keys(full())) {
    const value = full(); delete value[key]; rejected(value);
  }
});

test('duplicate JSON names and escaped aliases are rejected at all three object levels', () => {
  const text = JSON.stringify(full());
  for (const raw of [
    text.replace('"status":"collected"', '"status":"pending","status":"collected"'),
    text.replace('"status":"collected"', '"status":"collected","\\u0073tatus":"collected"'),
    text.replace('"proof":{', '"proof":{"version":"YNX-PQ-TRANSACTION-PROOF/v1",'),
    text.replace('"block":{', '"block":{"\\u0076ersion":"YNX-PQ-LIGHT-PROOF/v1",'),
    text.replace('"successor":{', '"successor":{"commitResult":"AA==",'),
  ]) rejectedRaw(raw);
});

test('unknown fields, missing nested fields and arbitrary JSON subtrees cannot enter the proof DTO', () => {
  for (const path of [[], ['proof'], ['proof', 'block'], ['proof', 'successor']]) {
    let value = full(), target = value;
    for (const name of path) target = target[name];
    Object.defineProperty(target, '__proto__', {value: 'untrusted', enumerable: true}); rejected(value);
  }
  for (const scope of [[], ['block'], ['successor']]) {
    const input = proof(); let target = input;
    for (const name of scope) target = target[name];
    for (const key of Object.keys(target)) {
      const copy = proof(); let part = copy;
      for (const name of scope) part = part[name];
      delete part[key]; assert.throws(() => validatePQTransactionProofDTO(copy), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
    }
  }
  for (const invalid of [null, [], {extra: 'x'}, 'proof']) rejected({...full(), proof: invalid});
  rejected(replaceField(full(), ['proof', 'block'], []));
});

test('proof DTO copying rejects getters, nonenumerable/symbol extras, prototypes and proxies without execution', () => {
  let calls = 0;
  for (const path of [[], ['block'], ['successor']]) {
    const value = proof(); let target = value;
    for (const name of path) target = target[name];
    Object.defineProperty(target, 'version', {enumerable: true, get() { calls++; return 'forged'; }});
    assert.throws(() => validatePQTransactionProofDTO(value), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
  }
  for (const decorate of [value => Object.defineProperty(value, 'hidden', {value: 'secret'}),
    value => Object.defineProperty(value, Symbol('secret'), {value: true}),
    value => Object.setPrototypeOf(value, {extra: true})]) {
    assert.throws(() => validatePQTransactionProofDTO(decorate(proof())), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
  }
  const proxy = new Proxy(proof(), {getPrototypeOf() { calls++; return Object.prototype; }});
  assert.throws(() => validatePQTransactionProofDTO(proxy), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
  const input = proof(), result = validatePQTransactionProofDTO(input), before = JSON.stringify(result);
  assert.notEqual(input, result); assert.notEqual(input.block, result.block); assert.notEqual(input.successor, result.successor);
  input.block.commitResult = 'AA=='; input.successor.validatorsResult = 'AA=='; input.transactionProof = 'AA==';
  assert.equal(JSON.stringify(result), before); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.block));
  assert.equal(calls, 0);
});

test('every byte field requires canonical nonempty standard base64 with canonical pad bits', () => {
  for (const [path] of byteFields) {
    for (const value of ['', 'A', 'AA', 'AA=', 'A===', '====', 'AA_-', 'AA==\n', 'AB==', 'AAB=', null, 7]) {
      assert.throws(() => validatePQTransactionProofDTO(replaceField(proof(), path, value)), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
    }
    for (const value of ['AA==', 'AAA=', 'AAAA', '+/8=']) assert.doesNotThrow(() => validatePQTransactionProofDTO(replaceField(proof(), path, value)));
  }
  for (const path of [['version'], ['block', 'version'], ['successor', 'version']]) {
    assert.throws(() => validatePQTransactionProofDTO(replaceField(proof(), path, 'wrong-version')), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
  }
});

test('all actual decoded proof byte limits reject one byte above without decoding allocation', () => {
  for (const [path, maximum] of byteFields) {
    const oversized = Buffer.alloc(maximum + 1).toString('base64');
    assert.throws(() => validatePQTransactionProofDTO(replaceField(proof(), path, oversized)), {code: 'PQ_FINALITY_PROOF_DATA_INVALID'});
  }
  const atBoundary = Buffer.alloc(limits.executionProofBytes).toString('base64');
  assert.equal(validatePQTransactionProofDTO({...proof(), executionProof: atBoundary}).executionProof, atBoundary);
});

test('raw collector total, envelope and nested light JSON sizes are independently bounded', () => {
  const tooLong = Buffer.alloc(limits.proofBytes + limits.envelopeBytes + 1);
  assert.throws(() => parsePQTransferFinalityCollector(original, binding, 200, tooLong), {code: 'PQ_FINALITY_COLLECTOR_INVALID'});
  rejected({...early(), error: 'x'.repeat(limits.envelopeBytes)}, 502);
  rejectedRaw(' '.repeat(limits.envelopeBytes) + JSON.stringify(full()));
  rejectedRaw(JSON.stringify(full()).replace('"block":{', '"block":{' + ' '.repeat(limits.lightProofBytes)));
});

test('fatal UTF-8, BOM, trailing content and malformed JSON fail with bounded errors', () => {
  for (const raw of [Buffer.from([0xc0, 0xaf]), Buffer.from([0xe2, 0x82]), Buffer.from([0xff]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes(full())]), Buffer.from('null'), Buffer.from('[]'),
    Buffer.from(JSON.stringify(full()) + '{}'), Buffer.from(JSON.stringify(full()).slice(0, -1) + ',}'),
    Buffer.from(JSON.stringify(full()).replace('"collected"', '"bad\\x00secret"'))]) {
    assert.throws(() => parsePQTransferFinalityCollector(original, binding, 200, raw), error => error.code === 'PQ_FINALITY_COLLECTOR_INVALID' && error.message === error.code);
  }
});

test('only byte views are consumed, with correct offsets and no caller accessors or extras propagated', () => {
  for (const input of [JSON.stringify(full()), full(), null, new Uint16Array(2), new DataView(new ArrayBuffer(4)),
    new Uint8Array(new SharedArrayBuffer(8)), new Proxy(bytes(full()), {})]) {
    assert.throws(() => parsePQTransferFinalityCollector(original, binding, 200, input), {code: 'PQ_FINALITY_COLLECTOR_INVALID'});
  }
  const raw = bytes(full()), combined = Buffer.concat([Buffer.from('prefix'), raw, Buffer.from('suffix')]);
  const view = new Uint8Array(combined.buffer, combined.byteOffset + 6, raw.length);
  let calls = 0;
  for (const name of ['buffer', 'byteLength', 'byteOffset', 'toJSON', 'secret']) Object.defineProperty(view, name, {get() { calls++; throw Error('must not execute'); }});
  const result = parsePQTransferFinalityCollector(original, binding, 200, view), before = JSON.stringify(result);
  combined.fill(0);
  assert.equal(result.rawSha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.byteLength, raw.length); assert.equal(JSON.stringify(result), before); assert.equal(calls, 0);
});

test('original account/network/wire identity and exact caller objects remain mandatory and untouched', () => {
  let calls = 0;
  const getterBinding = {...binding}; Object.defineProperty(getterBinding, 'account', {enumerable: true, get() { calls++; return binding.account; }});
  const getterOriginal = {...original}; Object.defineProperty(getterOriginal, 'wire', {enumerable: true, get() { calls++; return original.wire; }});
  for (const [input, context] of [[original, getterBinding], [getterOriginal, binding],
    [{...original, extra: 'secret'}, binding], [original, {...binding, extra: true}],
    [{...original, hash: '0x' + '00'.repeat(32)}, binding], [original, {...binding, account: '0x' + '00'.repeat(20)}],
    [original, {...binding, networkId: '00'.repeat(32)}]]) {
    assert.throws(() => parsePQTransferFinalityCollector(input, context, 200, bytes(full())), error => /^PQ_/.test(error.code));
    assert.throws(() => planPQTransferFinalityCollector(input, context), error => /^PQ_/.test(error.code));
  }
  assert.equal(calls, 0); assert.equal(original.status, 'signed-unsubmitted');
});

test('whitespace and object order are DATA-equivalent while raw byte fingerprints remain exact', () => {
  const input = full(), reordered = Object.fromEntries(Object.entries(input).reverse());
  const raw = Buffer.from(' \n' + JSON.stringify(reordered, null, 2) + '\t');
  const compact = parse(input), spaced = parsePQTransferFinalityCollector(original, binding, 200, raw);
  assert.deepEqual(spaced.observation, compact.observation); assert.deepEqual(spaced.proof, compact.proof);
  assert.notEqual(spaced.rawSha256, compact.rawSha256);
  assert.equal(spaced.rawSha256, createHash('sha256').update(raw).digest('hex')); assert.equal(spaced.byteLength, raw.length);
});
