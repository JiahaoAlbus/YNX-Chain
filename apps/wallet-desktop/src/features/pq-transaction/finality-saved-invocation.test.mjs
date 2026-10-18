import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {decodePQTransferRequest, preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {bindPQTransferFinalityContext, bindSavedPQTransferFinalityInvocation} from './finality-saved-invocation.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const packed = readFileSync(new URL('./fixtures/finality-c3-public.json.gz', import.meta.url));
assert.equal(sha256(packed), 'ef1562c14a3528e29928dd1889e5fa94416e1223e405fac2a7648829c0b43095');
const fixture = JSON.parse(gunzipSync(packed, {maxOutputLength:4 * 1024 * 1024}));
const success = fixture.cases.find(row => row.name === 'succeeded-transfer');
const rejected = fixture.cases.find(row => row.name === 'terminal-rejected-duplicate');
const wire = Buffer.from(success.expectedTransaction.nativeWire, 'base64');
const transfer = decodePQTransferRequest(wire).transfer;
const binding = {account:transfer.from, networkId:transfer.chainId};
const original = createPQOriginalRecord({account:binding.account, kind:'pq-transfer', operationId:'PUBLIC-c3-saved-invocation', request:preparePQTransferTransport(wire)});
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.from(JSON.stringify(value));
const pqError = error => typeof error?.code === 'string' && /^PQ_/.test(error.code);
const maxExpected = 4 * Math.ceil((24 * 1024 * 1024) / 3) + 4 * Math.ceil((8 * 1024 * 1024) / 3) + 8192;
const maxContext = maxExpected + 32768 + 1024;
const maxStdin = 80 * 1024 * 1024 + maxExpected + 1024;

// The original public fixture has NO host context. These 24 fields are a
// controlled syntax fixture with nonexistent PUBLIC-QA paths, not an original
// host, file provenance, Root, external pin, authority, or freshness evidence.
function controlledLightTrust(expected) {
  return {
    version:'YNX-CONSENSUS-PROOF-TRUST/v1', chainId:expected.block.chainId,
    migrationFile:'/PUBLIC-QA-NOT-A-HOST/migration.json', genesisFile:'/PUBLIC-QA-NOT-A-HOST/genesis.json',
    stateFile:'/PUBLIC-QA-NOT-A-HOST/state.json', scheduleFile:'/PUBLIC-QA-NOT-A-HOST/schedule.json',
    scheduleHash:'11'.repeat(32), consensusGenesisSHA256:'12'.repeat(32), originalGenesisHash:binding.networkId,
    migrationStateHash:'13'.repeat(32), runtimePlanFile:'', runtimePlanHash:'', engineHeight:'8', engineAppHash:'14'.repeat(32),
    expectedHeaderHeight:expected.block.headerHeight, expectedBlockHash:expected.block.blockHash,
    expectedStateHeight:expected.block.stateHeight, expectedStateAppHash:expected.block.stateAppHash,
    trustedLightBlockFile:'/PUBLIC-QA-NOT-A-HOST/trusted-light-block.json', trustedLightBlockSHA256:'15'.repeat(32),
    trustingPeriodNanoseconds:'1', maxClockDriftNanoseconds:'0', trustLevelNumerator:'1', trustLevelDenominator:'3',
  };
}
function controlledProof() {
  // Small format-only DATA for syntax negatives; no valid Comet signatures.
  return {version:'YNX-PQ-TRANSACTION-PROOF/v1',
    block:{version:'YNX-PQ-LIGHT-PROOF/v1', commitResult:'e30=', validatorsResult:'e30='},
    successor:{version:'YNX-PQ-LIGHT-PROOF/v1', commitResult:'e30=', validatorsResult:'e30='},
    transactionProof:'e30=', executionResult:'CAA=', executionProof:'e30='};
}
function pair(row = success, proof = controlledProof()) {
  const expected = clone(row.expectedTransaction);
  return {
    context:{version:'YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1', lightTrust:controlledLightTrust(expected), expectedTransaction:expected},
    stdin:{version:'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1', expected:clone(expected), proof:clone(proof)},
  };
}
const bind = (p = pair(), record = original, selected = binding) => bindSavedPQTransferFinalityInvocation(record, selected, bytes(p.context), bytes(p.stdin));
function noAuthority(result) {
  assert.deepEqual(Object.keys(result).sort(), ['expected','contextSha256','contextByteLength','stdinSha256','stdinByteLength',
    'classification','proofVerification','independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'].sort());
  assert.equal(result.classification, 'data'); assert.equal(result.proofVerification, 'not-performed');
  for (const key of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal']) assert.equal(result[key], false, key);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.expected));
  assert(Object.isFrozen(result.expected.block)); assert(Object.isFrozen(result.expected.successor));
}

test('saved successful public proof and controlled context bind the exact original with immutable DATA flags', () => {
  const p = pair(success, success.request.proof), context = bytes(p.context), stdin = bytes(p.stdin);
  assert.equal(Object.keys(p.context.lightTrust).length, 24);
  const result = bindSavedPQTransferFinalityInvocation(original, binding, context, stdin); noAuthority(result);
  assert.deepEqual(result.expected, success.expectedTransaction);
  assert.equal(result.contextSha256, sha256(context)); assert.equal(result.contextByteLength, context.length);
  assert.equal(result.stdinSha256, sha256(stdin)); assert.equal(result.stdinByteLength, stdin.length);
  assert.equal(result.expected.nativeWireHash, original.hash.slice(2));
  assert.notEqual(result.expected.block.chainId, binding.networkId);
  assert.equal(p.context.lightTrust.trustingPeriodNanoseconds, '1'); // No clock/expiry decision here.
});

test('saved rejected duplicate pair preserves its distinct index one and original transaction identity', () => {
  const result = bind(pair(rejected, rejected.request.proof)); noAuthority(result);
  assert.equal(result.expected.index, '1'); assert.equal(result.expected.nativeWireHash, success.expectedTransaction.nativeWireHash);
  assert.equal(result.expected.transactionHash, success.expectedTransaction.transactionHash);
  assert.notEqual(result.stdinSha256, bind(pair(success, success.request.proof)).stdinSha256);
  assert.equal(original.status, 'signed-unsubmitted');
});

test('context index one and stdin index zero are rejected even with identical original hashes and both headers', () => {
  const p = pair(); p.context.expectedTransaction.index = '1';
  assert.equal(p.context.expectedTransaction.nativeWireHash, p.stdin.expected.nativeWireHash);
  assert.equal(p.context.expectedTransaction.transactionHash, p.stdin.expected.transactionHash);
  assert.deepEqual(p.context.expectedTransaction.block, p.stdin.expected.block);
  assert.deepEqual(p.context.expectedTransaction.successor, p.stdin.expected.successor);
  assert.throws(() => bind(p), pqError);
  const reverse = pair(rejected); reverse.context.expectedTransaction.index = '0';
  assert.throws(() => bind(reverse), pqError);
});

test('semantic key order and whitespace may differ while exact original raw hashes and lengths remain distinct', () => {
  const p = pair();
  const reorder = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const ordinary = bind(p), context = Buffer.from('\n ' + JSON.stringify(reorder(p.context), null, 2) + '\t\n');
  const stdin = Buffer.from('\t' + JSON.stringify(reorder(p.stdin), null, 1) + '\n');
  const changed = bindSavedPQTransferFinalityInvocation(original, binding, context, stdin); noAuthority(changed);
  assert.deepEqual(changed.expected, ordinary.expected);
  assert.notEqual(changed.contextSha256, ordinary.contextSha256); assert.notEqual(changed.stdinSha256, ordinary.stdinSha256);
  assert.equal(changed.contextSha256, sha256(context)); assert.equal(changed.stdinSha256, sha256(stdin));
  assert.equal(changed.contextByteLength, context.length); assert.equal(changed.stdinByteLength, stdin.length);
});

test('both independently parsed targets must match the original wire, envelope, type, hashes and exact coordinates', () => {
  for (const side of ['context','stdin']) for (const mutate of [
    e => {e.nativeWire = Buffer.from('different original').toString('base64');},
    e => {e.nativeWireHash = '21'.repeat(32);}, e => {e.transactionHash = '22'.repeat(32);},
    e => {[e.nativeWireHash,e.transactionHash] = [e.transactionHash,e.nativeWireHash];},
    e => {e.envelope += '\n';}, e => {e.transactionType = 'pq_whole';},
    e => {e.block.blockHash = '23'.repeat(32);}, e => {e.successor.blockHash = '24'.repeat(32);},
    e => {e.successor.headerHeight = '11'; e.successor.stateHeight = '10';},
  ]) {
    const p = pair(); mutate(side === 'context' ? p.context.expectedTransaction : p.stdin.expected);
    assert.throws(() => bind(p), pqError);
  }
  assert.throws(() => bind(pair(), {...original, hash:'0x' + '25'.repeat(32)}), pqError);
  assert.throws(() => bind(pair(), original, {...binding, account:'0x' + '26'.repeat(20)}), pqError);
});

test('original light trust coordinates and genesis network digest must bind the saved context target', () => {
  for (const mutate of [
    l => {l.chainId = binding.networkId;}, l => {l.expectedHeaderHeight = '8';},
    l => {l.expectedBlockHash = '31'.repeat(32);}, l => {l.expectedStateHeight = '7';},
    l => {l.expectedStateAppHash = '32'.repeat(32);}, l => {l.originalGenesisHash = '33'.repeat(32);},
    l => {l.chainId = 'other-consensus-chain';},
  ]) {const p = pair(); mutate(p.context.lightTrust); assert.throws(() => bind(p), pqError);}
});

test('canonical absolute paths and optional runtime plan pair follow original trust syntax without reading files', () => {
  const p = pair(); p.context.lightTrust.runtimePlanFile = '/PUBLIC-QA-NOT-A-HOST/runtime.json'; p.context.lightTrust.runtimePlanHash = '34'.repeat(32);
  noAuthority(bind(p));
  for (const field of ['migrationFile','genesisFile','stateFile','scheduleFile','trustedLightBlockFile']) {
    for (const path of ['', 'relative.json', '/PUBLIC-QA/../state.json', '/PUBLIC-QA//state.json', '/PUBLIC-QA/./state.json', '/PUBLIC-QA/state.json/']) {
      const changed = pair(); changed.context.lightTrust[field] = path; assert.throws(() => bind(changed), pqError);
    }
  }
  for (const mutate of [
    l => {l.runtimePlanFile = '/PUBLIC-QA/runtime.json';}, l => {l.runtimePlanHash = '35'.repeat(32);},
    l => {l.runtimePlanFile = 'runtime.json'; l.runtimePlanHash = '35'.repeat(32);},
  ]) {const changed = pair(); mutate(changed.context.lightTrust); assert.throws(() => bind(changed), pqError);}
});

test('trust hashes are exact nonzero lowercase hex and all 24 light fields remain strings', () => {
  for (const field of ['scheduleHash','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','engineAppHash','trustedLightBlockSHA256']) {
    for (const hash of ['0'.repeat(64), 'AB'.repeat(32), '0x' + 'ab'.repeat(32), 'ab'.repeat(31)]) {
      const p = pair(); p.context.lightTrust[field] = hash; assert.throws(() => bind(p), pqError);
    }
  }
  for (const value of [null, 8, true, [], {}]) {const p = pair(); p.context.lightTrust.engineHeight = value; assert.throws(() => bind(p), pqError);}
  const wrongVersion = pair(); wrongVersion.context.lightTrust.version = 'unknown'; assert.throws(() => bind(wrongVersion), pqError);
});

test('trust integer and fraction boundaries retain BigInt precision and do not impose a clock decision', () => {
  for (const [numerator, denominator] of [['1','3'], ['1','1'], ['3074457345618258603','9223372036854775807']]) {
    const p = pair(); Object.assign(p.context.lightTrust, {engineHeight:'9223372036854775805', trustingPeriodNanoseconds:'9223372036854775807',
      maxClockDriftNanoseconds:'9223372036854775807', trustLevelNumerator:numerator, trustLevelDenominator:denominator});
    noAuthority(bind(p));
  }
  const zero = pair(); zero.context.lightTrust.engineHeight = '0'; noAuthority(bind(zero));
  for (const [field, value] of [
    ['engineHeight','9223372036854775806'], ['engineHeight','-1'], ['engineHeight','08'], ['engineHeight','8e0'],
    ['trustingPeriodNanoseconds','0'], ['trustingPeriodNanoseconds','9223372036854775808'],
    ['maxClockDriftNanoseconds','-1'], ['maxClockDriftNanoseconds','9223372036854775808'],
    ['trustLevelNumerator','0'], ['trustLevelDenominator','0'], ['trustLevelDenominator','9223372036854775808'],
  ]) {const p = pair(); p.context.lightTrust[field] = value; assert.throws(() => bind(p), pqError);}
  for (const [numerator, denominator] of [['1','4'], ['2','1'], ['3074457345618258602','9223372036854775807']]) {
    const p = pair(); Object.assign(p.context.lightTrust, {trustLevelNumerator:numerator, trustLevelDenominator:denominator});
    assert.throws(() => bind(p), pqError);
  }
});

test('proof DTO is mandatory closed bounded canonical DATA and cannot supply trust or an alternate target', () => {
  for (const mutate of [
    p => {p.version = 'unknown';}, p => {p.block.commitResult += '\n';}, p => {p.executionResult = 'AB==';},
    p => {p.executionProof = '';}, p => {p.transactionProof = null;}, p => {p.block.validatorsResult = [];},
    p => {p.authority = 'caller';}, p => {p.block.root = 'caller';}, p => {delete p.successor;},
  ]) {const p = pair(); mutate(p.stdin.proof); assert.throws(() => bind(p), pqError);}
  for (const proof of [null, [], 'proof']) {const p = pair(); p.stdin.proof = proof; assert.throws(() => bind(p), pqError);}
});

test('raw JSON rejects duplicate escaped aliases, missing or unknown fields, nulls, arrays and scalar type changes', () => {
  const p = pair(), context = bytes(p.context).toString(), stdin = bytes(p.stdin).toString();
  const malformedContext = [
    context.replace('{', '{"version":"ignored",'), context.replace('{', '{"\\u0076ersion":"ignored",'),
    context.replace('"engineHeight":"8"', '"engineHeight":"8","\\u0065ngineHeight":"8"'),
    context.replace('"engineHeight":"8",', ''), context.replace('"engineHeight":"8"', '"engineHeight":8'),
    context.replace('"engineHeight":"8"', '"engineHeight":null'), context.replace('"engineHeight":"8"', '"engineHeight":[]'),
    context.replace('"engineHeight":"8"', '"engineHeight":"8","extra":"caller"'),
    JSON.stringify([p.context]), 'null',
  ];
  for (const text of malformedContext) assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, Buffer.from(text), Buffer.from(stdin)), pqError);
  const malformedStdin = [
    stdin.replace('{', '{"version":"ignored",'), stdin.replace('{', '{"\\u0076ersion":"ignored",'),
    stdin.replace('"index":"0"', '"index":"0","\\u0069ndex":"0"'),
    stdin.replace('"index":"0"', '"index":0'), stdin.replace('"index":"0"', '"index":null'),
    stdin.replace('"index":"0"', '"index":[]'), stdin.replace('"index":"0",', ''),
    stdin.replace('"transactionProof":"e30="', '"transactionProof":"e30=","root":"caller"'),
    JSON.stringify([p.stdin]), 'false',
  ];
  for (const text of malformedStdin) assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, Buffer.from(context), Buffer.from(text)), pqError);
});

test('both raw inputs require fatal UTF-8, no BOM and exactly one JSON value', () => {
  const p = pair(), context = bytes(p.context), stdin = bytes(p.stdin);
  for (const side of ['context','stdin']) for (const make of [
    () => new Uint8Array(), () => Buffer.from([0xff]), () => Buffer.from([0xc0,0xaf]),
    body => Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),body]), body => Buffer.concat([body,Buffer.from('{}')]),
    body => Buffer.concat([body,Buffer.from([0])]), body => Buffer.concat([body,Buffer.from([0xe2,0x82])]),
  ]) {
    const altered = make(side === 'context' ? context : stdin);
    assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, side === 'context' ? altered : context, side === 'stdin' ? altered : stdin), pqError);
  }
});

test('raw byte views retain their own hashes and detached expected DATA after backing memory changes', () => {
  const p = pair(), context = bytes(p.context), stdin = bytes(p.stdin);
  const buffer = new Uint8Array(context.length + stdin.length + 11); buffer.set(context, 3); buffer.set(stdin, context.length + 7);
  const contextView = buffer.subarray(3, context.length + 3), stdinView = buffer.subarray(context.length + 7, context.length + stdin.length + 7);
  const result = bindSavedPQTransferFinalityInvocation(original, binding, contextView, stdinView); noAuthority(result);
  const contextHash = sha256(contextView), stdinHash = sha256(stdinView); buffer.fill(0);
  assert.equal(result.contextSha256, contextHash); assert.equal(result.stdinSha256, stdinHash);
  assert.deepEqual(result.expected, p.context.expectedTransaction);
  assert.throws(() => {result.expected.block.headerHeight = '99';}, TypeError);
});

test('raw views reject shared storage, accessors and proxies without invoking caller callbacks', () => {
  const p = pair(), context = bytes(p.context), stdin = bytes(p.stdin); let calls = 0;
  const proxy = value => new Proxy(value, {getPrototypeOf(){calls++; return Object.prototype;}, ownKeys(){calls++; return Reflect.ownKeys(value);}, get(){calls++; return undefined;}});
  const getter = (value, key) => {const result = {...value}; Object.defineProperty(result, key, {enumerable:true, get(){calls++; return value[key];}}); return result;};
  for (const side of ['context','stdin']) {
    const publicBytes = side === 'context' ? context : stdin;
    const shared = new Uint8Array(new SharedArrayBuffer(publicBytes.length)); shared.set(publicBytes);
    for (const changed of [shared, proxy(publicBytes), publicBytes.toString(), [], new Uint16Array([1]), new DataView(new ArrayBuffer(8))])
      assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, side === 'context' ? changed : context, side === 'stdin' ? changed : stdin), pqError);
  }
  assert.throws(() => bindSavedPQTransferFinalityInvocation(getter(original, 'wire'), binding, context, stdin), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(proxy(original), binding, context, stdin), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, getter(binding, 'networkId'), context, stdin), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, proxy(binding), context, stdin), pqError);
  assert.equal(calls, 0);
  const hostile = raw => {
    const view = Uint8Array.from(raw);
    for (const key of ['buffer','byteOffset','byteLength']) Object.defineProperty(view, key, {get(){calls++; throw Error('FOREIGN_GETTER');}});
    Object.defineProperty(view, Symbol.iterator, {value(){calls++; throw Error('FOREIGN_ITERATOR');}});
    Object.defineProperty(view, 'toJSON', {value(){calls++; throw Error('FOREIGN_JSON');}});
    return view;
  };
  const result = bindSavedPQTransferFinalityInvocation(original, binding, hostile(context), hostile(stdin));
  assert.equal(result.contextSha256, sha256(context)); assert.equal(result.stdinSha256, sha256(stdin)); assert.equal(calls, 0);
});

test('outer raw byte limits reject cap plus one before accepting any saved invocation', () => {
  const p = pair(), context = bytes(p.context), stdin = bytes(p.stdin);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, new Uint8Array(maxContext + 1), stdin), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, context, new Uint8Array(maxStdin + 1)), pqError);
});

test('raw nested light trust, expected and proof spans retain original independent transport caps', () => {
  const p = pair(), expected = JSON.stringify(p.context.expectedTransaction), light = JSON.stringify(p.context.lightTrust), proof = JSON.stringify(p.stdin.proof);
  const contextWith = (l, e) => Buffer.from('{"version":"YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1","lightTrust":' + l + ',"expectedTransaction":' + e + '}');
  const stdinWith = (e, pr) => Buffer.from('{"version":"YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1","expected":' + e + ',"proof":' + pr + '}');
  const padded = (text, size) => '{' + ' '.repeat(size - text.length) + text.slice(1);
  noAuthority(bindSavedPQTransferFinalityInvocation(original, binding, contextWith(padded(light,32768),expected), bytes(p.stdin)));
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, contextWith(padded(light,32769),expected), bytes(p.stdin)), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, contextWith(light,padded(expected,maxExpected + 1)), bytes(p.stdin)), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, bytes(p.context), stdinWith(padded(expected,maxExpected + 1),proof)), pqError);
  assert.throws(() => bindSavedPQTransferFinalityInvocation(original, binding, bytes(p.context), stdinWith(expected,padded(proof,80 * 1024 * 1024 + 1))), pqError);
});

test('direct context export matches the saved invocation target and exposes only frozen closed context DATA', () => {
  const p = pair(), context = bytes(p.context);
  const result = bindPQTransferFinalityContext(original, binding, context), saved = bind(p);
  assert.deepEqual(Object.keys(result).sort(), ['expected','lightTrust','contextSha256','contextByteLength','classification',
    'proofVerification','independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'].sort());
  assert.deepEqual(result.expected, saved.expected); assert.deepEqual(result.lightTrust, p.context.lightTrust);
  assert.equal(Object.keys(result.lightTrust).length, 24); assert(Object.values(result.lightTrust).every(value => typeof value === 'string'));
  assert.equal(result.contextSha256, saved.contextSha256); assert.equal(result.contextByteLength, context.length);
  assert.equal(result.classification, 'data'); assert.equal(result.proofVerification, 'not-performed');
  for (const key of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal']) assert.equal(result[key], false);
  for (const value of [result,result.expected,result.expected.block,result.expected.successor,result.lightTrust]) assert(Object.isFrozen(value));
  // expected and lightTrust are explicit main-only string DTOs. No raw context
  // bytes, stdin, proof, capture object or original record is returned.
  for (const key of ['contextBytes','stdin','stdinBytes','proof','original','raw']) assert.equal(Object.hasOwn(result, key), false);
});

test('direct context has detached immutable expected and lightTrust copies after raw source mutation', () => {
  const p = pair(), context = bytes(p.context), backing = new Uint8Array(context.length + 6);
  backing.fill(0x55); backing.set(context, 3);
  const view = backing.subarray(3, context.length + 3), expectedHash = sha256(view);
  const result = bindPQTransferFinalityContext(original, binding, view);
  backing.fill(0); p.context.lightTrust.originalGenesisHash = 'ff'.repeat(32); p.context.expectedTransaction.index = '9';
  assert.equal(result.contextSha256, expectedHash); assert.equal(result.contextByteLength, context.length);
  assert.equal(result.expected.index, '0'); assert.equal(result.lightTrust.originalGenesisHash, binding.networkId);
  assert.throws(() => {result.lightTrust.engineHeight = '99';}, TypeError);
  assert.throws(() => {result.expected.block.blockHash = 'aa'.repeat(32);}, TypeError);
});

test('direct context rejects original hash and light target disagreements without needing stdin', () => {
  for (const mutate of [
    c => {c.expectedTransaction.nativeWireHash = '61'.repeat(32);},
    c => {c.expectedTransaction.transactionHash = '62'.repeat(32);},
    c => {c.expectedTransaction.nativeWire = Buffer.from('different original').toString('base64');},
    c => {c.lightTrust.originalGenesisHash = '63'.repeat(32);},
    c => {c.lightTrust.expectedBlockHash = '64'.repeat(32);},
    c => {c.lightTrust.expectedHeaderHeight = '8'; c.lightTrust.expectedStateHeight = '7';},
    c => {delete c.lightTrust.engineHeight;}, c => {c.lightTrust.extra = 'caller';},
  ]) {
    const p = pair(); mutate(p.context);
    assert.throws(() => bindPQTransferFinalityContext(original, binding, bytes(p.context)), pqError);
  }
  const context = bytes(pair().context);
  assert.throws(() => bindPQTransferFinalityContext({...original, hash:'0x' + '65'.repeat(32)}, binding, context), pqError);
  assert.throws(() => bindPQTransferFinalityContext(original, {...binding, networkId:'66'.repeat(32)}, context), pqError);
});
