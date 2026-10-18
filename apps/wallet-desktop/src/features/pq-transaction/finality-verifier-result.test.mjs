import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodePQTransferRequest, preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {parsePQTransferFinalityVerifierResult} from './finality-verifier-result.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const packed = readFileSync(new URL('./fixtures/finality-c3-public.json.gz', import.meta.url));
assert.equal(sha256(packed), 'ef1562c14a3528e29928dd1889e5fa94416e1223e405fac2a7648829c0b43095');
const fixture = JSON.parse(gunzipSync(packed, {maxOutputLength:4 * 1024 * 1024}));
const success = fixture.cases.find(value => value.name === 'succeeded-transfer');
const rejected = fixture.cases.find(value => value.name === 'terminal-rejected-duplicate');
const wire = Buffer.from(success.expectedTransaction.nativeWire, 'base64');
const transfer = decodePQTransferRequest(wire).transfer;
const binding = {account:transfer.from, networkId:transfer.chainId};
const original = createPQOriginalRecord({account:binding.account, kind:'pq-transfer', operationId:'PUBLIC-c3-stdout-original', request:preparePQTransferTransport(wire)});
const transactionVersion = 'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1';
const lightVersion = 'YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1';
const clone = value => JSON.parse(JSON.stringify(value));
const pqError = error => typeof error?.code === 'string' && /^PQ_/.test(error.code);
const observationFields = ['status','verifierCode','reportedOutcome','reportedExecutionSuccessful','executionCode',
  'account','operationId','kind','transactionType','nativeTransactionHash','abciTransactionHash','executionHeight','cometIndex',
  'independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal','proofVerification'];

// These are original public producer/receipt fixtures. This file neither runs
// the verifier nor establishes binary/host provenance, cryptographic validity,
// actual Comet deployment, user approval, or independent finality.
function responseBytes(response) {
  const value = {version:response.version, code:response.code};
  if (Object.hasOwn(response, 'error')) value.error = response.error;
  if (Object.hasOwn(response, 'result')) value.result = response.result;
  return Buffer.from(JSON.stringify(value) + '\n');
}
function capture(stdout = responseBytes(success.expectedResponse), overrides = {}) {
  return {stdout, stderr:new Uint8Array(), exitCode:0, signal:null, ...overrides};
}
const parse = (run = capture(), expected = success.expectedTransaction, record = original, selected = binding) =>
  parsePQTransferFinalityVerifierResult(record, selected, expected, run);
function mutateResult(mutate, row = success) {
  const response = clone(row.expectedResponse); mutate(response.result, response);
  return capture(responseBytes(response));
}
function noAuthority(result) {
  assert.deepEqual(Object.keys(result).sort(), ['observation','stdoutSha256','stdoutByteLength','stderrSha256','stderrByteLength'].sort());
  assert.deepEqual(Object.keys(result.observation).sort(), observationFields.slice().sort());
  for (const key of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal']) assert.equal(result.observation[key], false, key);
  assert.equal(result.observation.proofVerification, 'result-data-only');
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.observation));
}

test('actual successful public stdout matches original CLI receipt and projects only bound result DATA', () => {
  const stdout = responseBytes(success.expectedResponse), receipt = fixture.receipt.cases.find(value => value.name === success.name);
  assert.equal(sha256(stdout), receipt.stdoutSHA256); assert.equal(receipt.exitCode, 0);
  const result = parse(capture(stdout)); noAuthority(result);
  const o = result.observation;
  assert.equal(o.status, 'verifier-result-data'); assert.equal(o.verifierCode, receipt.code);
  assert.equal(o.reportedOutcome, 'succeeded'); assert.equal(o.reportedExecutionSuccessful, true); assert.equal(o.executionCode, '0');
  assert.equal(o.account, binding.account); assert.equal(o.operationId, original.operationId); assert.equal(o.kind, 'pq-transfer');
  assert.equal(o.transactionType, 'pq_transfer'); assert.equal(o.nativeTransactionHash, original.hash);
  assert.equal(o.abciTransactionHash, '0x' + success.expectedTransaction.transactionHash);
  assert.equal(o.executionHeight, '9'); assert.equal(o.cometIndex, 0);
  assert.equal(result.stdoutSha256, receipt.stdoutSHA256); assert.equal(result.stdoutByteLength, stdout.length);
  assert.equal(result.stderrSha256, sha256(new Uint8Array())); assert.equal(result.stderrByteLength, 0);
});

test('actual duplicate rejection remains a terminal reported rejection despite normal CLI exit zero', () => {
  const stdout = responseBytes(rejected.expectedResponse), receipt = fixture.receipt.cases.find(value => value.name === rejected.name);
  assert.equal(sha256(stdout), receipt.stdoutSHA256);
  const result = parse(capture(stdout), rejected.expectedTransaction); noAuthority(result);
  assert.equal(result.observation.verifierCode, 'VERIFIED_TRANSACTION_REJECTED_DATA');
  assert.equal(result.observation.reportedOutcome, 'rejected'); assert.equal(result.observation.reportedExecutionSuccessful, false);
  assert.equal(result.observation.executionCode, '2'); assert.equal(result.observation.cometIndex, 1);
  assert.equal(result.observation.nativeTransactionHash, original.hash);
  assert.equal(rejected.expectedResponse.result.executionData, null);
  assert.equal(original.status, 'signed-unsubmitted'); // Fixture was not submitted here.
});

test('known transaction and original startup error profiles are bounded failure DATA without projected diagnostics', () => {
  const normal = ['INVALID_REQUEST','TRUST_CONTEXT_INVALID','TRUST_SOURCE_INVALID','PROOF_REJECTED'];
  for (const [version, codes] of [[transactionVersion, normal], [lightVersion, ['INVALID_ARGUMENTS', ...normal]]]) {
    for (const code of codes) {
      const raw = responseBytes({version, code, error:'PUBLIC_PRIVATE_DIAGNOSTIC_\u0000_\ufffd'});
      const result = parse(capture(raw, {exitCode:1})); noAuthority(result);
      assert.equal(result.observation.status, 'verifier-error-data'); assert.equal(result.observation.verifierCode, code);
      for (const key of ['reportedOutcome','reportedExecutionSuccessful','executionCode']) assert.equal(result.observation[key], null);
      assert.equal(result.observation.nativeTransactionHash, original.hash);
      assert.equal(JSON.stringify(result).includes('PUBLIC_PRIVATE_DIAGNOSTIC'), false);
    }
  }
  const boundary = {version:transactionVersion, code:'PROOF_REJECTED', error:'界'.repeat(1365) + 'x'};
  assert.equal(Buffer.byteLength(boundary.error), 4096);
  assert.equal(parse(capture(responseBytes(boundary), {exitCode:1})).observation.status, 'verifier-error-data');
  for (const error of ['', '界'.repeat(1366)]) assert.throws(() => parse(capture(responseBytes({...boundary, error}), {exitCode:1})), pqError);
});

test('process status, result version and error/result envelopes cannot contradict each other', () => {
  const error = {version:transactionVersion, code:'PROOF_REJECTED', error:'public failure'};
  for (const run of [
    capture(undefined, {exitCode:1}), capture(responseBytes(error)),
    capture(responseBytes({...error, code:'UNRECOGNIZED_FAILURE'}), {exitCode:1}),
    capture(responseBytes({...error, result:null}), {exitCode:1}),
    capture(responseBytes({...error, result:success.expectedResponse.result}), {exitCode:1}),
    capture(responseBytes({version:transactionVersion, code:'PROOF_REJECTED'}), {exitCode:1}),
    capture(responseBytes({...success.expectedResponse, error:'unexpected'})),
    capture(responseBytes({...success.expectedResponse, version:lightVersion})),
    capture(responseBytes({...success.expectedResponse, code:'VERIFIED_DATA'})),
  ]) assert.throws(() => parse(run), pqError);
});

test('both original hashes, host headers, target index and transaction type remain bound', () => {
  for (const mutate of [
    r => {r.transactionHash = '17'.repeat(32);}, r => {r.nativeWireHash = '18'.repeat(32);},
    r => {[r.transactionHash, r.nativeWireHash] = [r.nativeWireHash, r.transactionHash];},
    r => {r.transactionHash = '0x' + r.transactionHash;}, r => {r.nativeWireHash = r.nativeWireHash.toUpperCase();},
    r => {r.height = '10';}, r => {r.index = '1';}, r => {r.transactionType = 'account_migration';},
    r => {r.block.blockHash = '19'.repeat(32);}, r => {r.block.stateAppHash = '20'.repeat(32);},
    r => {r.block.headerHeight = '8';}, r => {r.block.stateHeight = '7';},
    r => {r.successor.blockHash = '21'.repeat(32);}, r => {r.successor.stateAppHash = '22'.repeat(32);},
    r => {r.successor.headerHeight = '11';}, r => {r.successor.stateHeight = '10';},
    r => {r.block.chainId = binding.networkId;}, r => {r.successor.chainId = 'other-consensus';},
  ]) assert.throws(() => parse(mutateResult(mutate)), pqError);
  assert.throws(() => parse(capture(), rejected.expectedTransaction), pqError);
  assert.throws(() => parse(capture(), success.expectedTransaction, {...original, hash:'0x' + '23'.repeat(32)}), pqError);
  assert.throws(() => parse(capture(), success.expectedTransaction, original, {...binding, account:'0x' + '24'.repeat(20)}), pqError);
});

test('light result DATA retains complete linked anchors and reported verification booleans', () => {
  for (const mutate of [
    r => {r.block.version = 'legacy';}, r => {r.successor.classification = 'authority';},
    r => {r.block.genesisSha256 = '0'.repeat(64);}, r => {r.successor.genesisSha256 = '25'.repeat(32);},
    r => {r.successor.trustedHeight = '8';}, r => {r.successor.trustedBlockHash = '26'.repeat(32);},
    r => {r.block.validatorsHash = 'a'.repeat(63);}, r => {r.block.consensusHash = 'GG'.repeat(32);},
    r => {r.block.commitVerified = false;}, r => {r.successor.lightTransitionVerified = false;},
    r => {r.block.trustedHeight = '10';}, r => {r.successor.authorityThroughHeight = '8';},
  ]) assert.throws(() => parse(mutateResult(mutate)), pqError);
});

test('original authority window covers both headers through plus two within the snapshot int64 bound', () => {
  // Original newSnapshot caps through at MaxInt64-2; ParamsAt admits header
  // height at most through+2. H=9 and H+1=10 therefore allow through=8.
  const runAt = through => mutateResult(r => {r.block.authorityThroughHeight = through; r.successor.authorityThroughHeight = through;});
  noAuthority(parse(runAt('8')));
  const unexpectedlyAccepted = [];
  for (const through of ['0','7','9223372036854775806','9223372036854775807']) {
    try {parse(runAt(through)); unexpectedlyAccepted.push(through);}
    catch (error) {assert(pqError(error));}
  }
  assert.deepEqual(unexpectedlyAccepted, [], 'out-of-window or out-of-snapshot authority heights must be rejected');
});

test('success code, reported outcome, execution code and exact hash-bearing execution data must agree', () => {
  for (const mutate of [
    r => {r.executionCode = '2';}, r => {r.executionSuccessful = false;}, r => {r.outcome = 'rejected';},
    r => {r.executionData = null;}, r => {r.executionData = '';},
    r => {r.executionData = Buffer.from(r.transactionHash).toString('base64');},
    r => {r.executionData = Buffer.from('0x' + r.nativeWireHash).toString('base64');},
    r => {r.executionData += '\n';}, r => {r.included = false;}, r => {r.finalized = false;},
    r => {r.nativeGrant = true;}, r => {r.classification = 'grant';},
    (r, response) => {response.code = 'VERIFIED_TRANSACTION_REJECTED_DATA';},
  ]) assert.throws(() => parse(mutateResult(mutate)), pqError);
});

test('rejected transfer requires nonzero code, canonical null execution DATA and false success', () => {
  for (const mutate of [
    r => {r.executionCode = '0';}, r => {r.executionSuccessful = true;}, r => {r.outcome = 'succeeded';},
    r => {r.executionData = success.expectedResponse.result.executionData;},
    r => {r.executionData = '';},
    (r, response) => {response.code = 'VERIFIED_TRANSACTION_DATA';},
  ]) assert.throws(() => parse(mutateResult(mutate, rejected), rejected.expectedTransaction), pqError);
  // The original protobuf Unmarshal plus deterministic canonical encoding
  // leaves rejected DATA nil; bytes.Clone(nil) marshals as JSON null.
});

test('actual Whole partial stdout and transfer-labelled partial result never enter this transfer route', () => {
  assert.throws(() => parse(capture(responseBytes(fixture.whole.expectedResponse)), fixture.whole.expectedTransaction), pqError);
  assert.throws(() => parse(capture(responseBytes(fixture.whole.expectedResponse))), pqError);
  assert.throws(() => parse(mutateResult((r, response) => {
    response.code = 'VERIFIED_TRANSACTION_PARTIAL_DATA'; r.outcome = 'partial'; r.executionSuccessful = false;
  })), pqError);
  assert.throws(() => parse(mutateResult(r => {r.batchResults = [];})), pqError);
});

test('signed int64 gas values including minimum and totals above uint32 preserve source ranges', () => {
  for (const gas of ['-9223372036854775808','-1','0','9223372036854775807']) {
    const result = parse(mutateResult(r => {r.gasWanted = gas; r.gasUsed = gas; r.total = '9223372036854775807';}));
    noAuthority(result); assert.equal(result.observation.reportedOutcome, 'succeeded');
  }
  assert.equal(parse(mutateResult(r => {r.total = '4294967296';})).observation.cometIndex, 0);
});

test('noncanonical and out-of-range numeric strings fail without Number coercion', () => {
  for (const mutate of [
    r => {r.gasWanted = '-9223372036854775809';}, r => {r.gasUsed = '9223372036854775808';},
    r => {r.gasWanted = '-0';}, r => {r.gasUsed = '+1';}, r => {r.gasUsed = '01';},
    r => {r.gasUsed = 1;}, r => {r.gasUsed = '1e3';}, r => {r.gasUsed = '1.0';},
    r => {r.total = '0';}, r => {r.total = '-1';}, r => {r.total = '9223372036854775808';},
    r => {r.total = '03';}, r => {r.index = '4294967296';}, r => {r.index = 0;},
    r => {r.executionCode = '4294967296';}, r => {r.executionCode = '00';},
    r => {r.block.authorityThroughHeight = '9223372036854775808';},
  ]) assert.throws(() => parse(mutateResult(mutate)), pqError);
  assert.throws(() => parse(mutateResult(r => {r.total = '1';}, rejected), rejected.expectedTransaction), pqError);
});

test('duplicate and escaped-alias keys, unknown or missing fields, arrays and wrong scalar types are rejected', () => {
  const text = responseBytes(success.expectedResponse).toString('utf8');
  for (const malformed of [
    text.replace('{', '{"version":"ignored",'),
    text.replace('{', '{"\\u0076ersion":"ignored",'),
    text.replace('"height":"9"', '"height":"9","height":"9"'),
    text.replace('"height":"9"', '"height":"9","\\u0068eight":"9"'),
    text.replace('"classification":"data"', '"classification":"data","root":"caller"'),
    text.replace('"gasWanted":"0",', ''), text.replace('"gasWanted":"0"', '"gasWanted":null'),
    text.replace('"gasWanted":"0"', '"gasWanted":[]'), text.replace('"included":true', '"included":"true"'),
    JSON.stringify([success.expectedResponse]), 'null', '0', '"response"',
  ]) assert.throws(() => parse(capture(Buffer.from(malformed))), pqError);
  const extra = clone(success.expectedResponse); extra.result.block.unrecognized = true;
  assert.throws(() => parse(capture(responseBytes(extra))), pqError);
});

test('stdout requires one strict UTF-8 JSON value, with no BOM, invalid encoding or trailing payload', () => {
  const stdout = responseBytes(success.expectedResponse);
  for (const raw of [
    new Uint8Array(), Buffer.from([0xff]), Buffer.from([0xc0,0xaf]),
    Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), stdout]),
    Buffer.concat([stdout, Buffer.from('{}')]), Buffer.concat([stdout, Buffer.from('null')]),
    Buffer.concat([stdout, Buffer.from([0])]), Buffer.concat([stdout, Buffer.from([0xe2,0x82])]),
  ]) assert.throws(() => parse(capture(raw)), pqError);
});

test('byte views are captured exactly, detached from later mutation, while binary stderr stays private', () => {
  const stdout = responseBytes(success.expectedResponse), backing = new Uint8Array(stdout.length + 12);
  backing.fill(0x55); backing.set(stdout, 5); const view = backing.subarray(5, 5 + stdout.length);
  const stderr = Uint8Array.from([0xff,0xfe,0, ...Buffer.from('PRIVATE_BINARY_STDERR_SENTINEL')]);
  const expectedOut = sha256(view), expectedErr = sha256(stderr);
  const result = parse(capture(view, {stderr})); noAuthority(result);
  assert.equal(result.stdoutSha256, expectedOut); assert.equal(result.stdoutByteLength, stdout.length);
  assert.equal(result.stderrSha256, expectedErr); assert.equal(result.stderrByteLength, stderr.length);
  backing.fill(0); stderr.fill(0);
  assert.equal(result.stdoutSha256, expectedOut); assert.equal(result.stderrSha256, expectedErr);
  assert.equal(JSON.stringify(result).includes('PRIVATE_BINARY_STDERR_SENTINEL'), false);
  assert.throws(() => {result.observation.reportedOutcome = 'caller-approved';}, TypeError);
});

test('byte snapshots reject shared storage and use Uint8Array intrinsics without caller getters or iterators', () => {
  const stdout = responseBytes(success.expectedResponse), stdoutShared = new Uint8Array(new SharedArrayBuffer(stdout.length));
  stdoutShared.set(stdout);
  assert.throws(() => parse(capture(stdoutShared)), pqError);
  assert.throws(() => parse(capture(stdout, {stderr:new Uint8Array(new SharedArrayBuffer(1))})), pqError);
  let calls = 0;
  const hostile = bytes => {
    const value = Uint8Array.from(bytes);
    for (const key of ['buffer','byteOffset','byteLength']) Object.defineProperty(value, key, {get(){calls++; throw Error('FOREIGN_GETTER');}});
    Object.defineProperty(value, Symbol.iterator, {value(){calls++; throw Error('FOREIGN_ITERATOR');}});
    Object.defineProperty(value, 'toJSON', {value(){calls++; throw Error('FOREIGN_JSON');}});
    return value;
  };
  const stderr = Uint8Array.from([0xff,0xfe,0,65]);
  const result = parse(capture(hostile(stdout), {stderr:hostile(stderr)}));
  assert.equal(calls, 0); assert.equal(result.stdoutSha256, sha256(stdout)); assert.equal(result.stderrSha256, sha256(stderr));
  assert.equal(result.stdoutByteLength, stdout.length); assert.equal(result.stderrByteLength, stderr.length);
});

test('stdout and stderr independently accept at most 64 KiB and refuse overflow', () => {
  const stdout = responseBytes(success.expectedResponse), padded = Buffer.alloc(65536, 32); stdout.copy(padded);
  assert.equal(parse(capture(padded, {stderr:Buffer.alloc(65536, 0xff)})).stdoutByteLength, 65536);
  assert.throws(() => parse(capture(Buffer.concat([padded, Buffer.from(' ')]))), pqError);
  assert.throws(() => parse(capture(stdout, {stderr:new Uint8Array(65537)})), pqError);
});

test('caller accessors and proxies are rejected without invoking foreign callbacks', () => {
  let calls = 0;
  const getter = (value, key) => {const copy = {...value}; Object.defineProperty(copy, key, {enumerable:true, get(){calls++; return value[key];}}); return copy;};
  const proxy = value => new Proxy(value, {getPrototypeOf(){calls++; return Object.prototype;}, ownKeys(){calls++; return Reflect.ownKeys(value);}, get(){calls++; return undefined;}});
  for (const run of [getter(capture(), 'stdout'), getter(capture(), 'exitCode'), proxy(capture()), capture(proxy(new Uint8Array([1]))), capture(undefined, {stderr:proxy(new Uint8Array())})]) assert.throws(() => parse(run), pqError);
  assert.throws(() => parse(capture(), getter(success.expectedTransaction, 'block')), pqError);
  assert.throws(() => parse(capture(), proxy(success.expectedTransaction)), pqError);
  const expected = clone(success.expectedTransaction); expected.block = proxy(expected.block); assert.throws(() => parse(capture(), expected), pqError);
  assert.throws(() => parse(capture(), success.expectedTransaction, getter(original, 'wire')), pqError);
  assert.throws(() => parse(capture(), success.expectedTransaction, proxy(original)), pqError);
  assert.throws(() => parse(capture(), success.expectedTransaction, original, getter(binding, 'account')), pqError);
  assert.throws(() => parse(capture(), success.expectedTransaction, original, proxy(binding)), pqError);
  assert.equal(calls, 0);
});

test('signals, missing exit status and exotic capture values do not become failure or success observations', () => {
  for (const overrides of [
    {exitCode:null}, {exitCode:2}, {exitCode:-1}, {exitCode:'0'}, {exitCode:NaN},
    {signal:'SIGTERM'}, {signal:''}, {signal:undefined}, {exitCode:null, signal:'SIGKILL'},
    {stdout:'string'}, {stdout:[]}, {stdout:new Uint16Array([1])}, {stdout:new DataView(new ArrayBuffer(8))},
    {stderr:null}, {stderr:'string'}, {additional:'caller'},
  ]) assert.throws(() => parse(capture(undefined, overrides)), pqError);
  const missing = capture(); delete missing.stderr; assert.throws(() => parse(missing), pqError);
});
