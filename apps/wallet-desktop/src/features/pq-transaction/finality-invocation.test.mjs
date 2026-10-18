import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {preparePQTransferOriginal} from './transfer-binding.mjs';
import {preparePQTransferFinalityInvocation} from './finality-invocation.mjs';

const vector = JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz', import.meta.url))));
const row = vector.originals.find(value => value.name === 'transfer-lost-response');
const account = vector.owner, networkId = vector.networkId, binding = {account, networkId};
const original = createPQOriginalRecord({account, kind:'pq-transfer', operationId:'PUBLIC-finality-input', request:preparePQTransferTransport(Buffer.from(row.wire, 'base64'))});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const invoke = (expected, proof = controlledProof(), record = original, selected = binding) => preparePQTransferFinalityInvocation(record, selected, expected, proof);
const invalidTarget = {code:'PQ_FINALITY_INVOCATION_TARGET_INVALID'};
const mismatch = {code:'PQ_FINALITY_INVOCATION_ORIGINAL_MISMATCH'};

function target(height = 29n) {
  const wire = Buffer.from(row.wire, 'base64');
  const envelope = Buffer.from('{"version":1,"type":"pq_transfer","wireHex":"' + wire.toString('hex') + '"}');
  return {
    block:{chainId:'ynx-public-consensus-fixture', headerHeight:String(height), blockHash:'ab'.repeat(32), stateHeight:String(height - 1n), stateAppHash:'cd'.repeat(32)},
    successor:{chainId:'ynx-public-consensus-fixture', headerHeight:String(height + 1n), blockHash:'ef'.repeat(32), stateHeight:String(height), stateAppHash:'12'.repeat(32)},
    transactionType:'pq_transfer', envelope:envelope.toString('base64'), nativeWire:wire.toString('base64'),
    transactionHash:sha256(envelope), nativeWireHash:sha256(wire), index:'0',
  };
}
function controlledProof() {
  // Deliberately not cryptographic evidence: these are bounded transport
  // strings only. The normal verifier would reject the empty Comet objects.
  return {version:'YNX-PQ-TRANSACTION-PROOF/v1',
    block:{version:'YNX-PQ-LIGHT-PROOF/v1', commitResult:'e30=', validatorsResult:'e30='},
    successor:{version:'YNX-PQ-LIGHT-PROOF/v1', commitResult:'e30=', validatorsResult:'e30='},
    transactionProof:'e30=', executionResult:'CAA=', executionProof:'e30='};
}

test('normal CLI input echoes exact original envelope and independent host coordinates as DATA only', () => {
  const expected = target(), result = invoke(expected), input = JSON.parse(result.stdin);
  const plan = preparePQTransferOriginal(original, binding);
  assert.deepEqual(Object.keys(result), ['expected','stdin','stdinByteLength','stdinSha256']);
  assert.deepEqual(Object.keys(input), ['version','expected','proof']);
  assert.equal(input.version, 'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1');
  assert.deepEqual(input.expected, expected); assert.deepEqual(input.proof, controlledProof());
  assert.notEqual(input.expected.block.chainId, networkId);
  assert.equal('0x' + input.expected.transactionHash, plan.binding.abciTransactionHash);
  assert.equal('0x' + input.expected.nativeWireHash, original.hash);
  assert.notEqual(input.expected.transactionHash, input.expected.nativeWireHash);
  assert.equal(typeof result.stdin, 'string'); assert.equal(result.stdinByteLength, Buffer.byteLength(result.stdin));
  assert.equal(result.stdinSha256, sha256(Buffer.from(result.stdin, 'utf8')));
  for (const flag of ['finalized','consensusFinality','verified','nativeGrant','approved']) assert.equal(Object.hasOwn(result, flag), false);
});

test('decimal targets preserve precision above Number.MAX_SAFE_INTEGER and enforce original CLI bounds', () => {
  for (const height of [9007199254740993n, 9223372036854775804n]) {
    const expected = target(height); expected.index = '4294967295';
    const output = JSON.parse(invoke(expected).stdin);
    assert.equal(output.expected.block.headerHeight, String(height));
    assert.equal(output.expected.successor.headerHeight, String(height + 1n));
    assert.equal(output.expected.index, '4294967295');
  }
  for (const mutate of [
    e => {e.index = '4294967296';}, e => {e.index = 0;}, e => {e.index = '00';},
    e => {e.block.headerHeight = '029';}, e => {e.block.headerHeight = 29;},
    e => {e.block.headerHeight = '+29';}, e => {e.block.headerHeight = '2.9e1';},
    e => {e.block.headerHeight = '-1';}, e => {e.block.headerHeight = '0';},
    e => {e.block.headerHeight = '18446744073709551616';},
  ]) {const expected = target(); mutate(expected); assert.throws(() => invoke(expected), invalidTarget);}
  assert.throws(() => invoke(target(9223372036854775805n)), invalidTarget);
});

test('host anchors require nonzero lowercase hashes, same chain, adjacent headers and exact preceding states', () => {
  for (const mutate of [
    e => {e.block.blockHash = '0'.repeat(64);}, e => {e.successor.stateAppHash = '0'.repeat(64);},
    e => {e.block.blockHash = 'AB'.repeat(32);}, e => {e.block.stateAppHash = '0x' + e.block.stateAppHash;},
    e => {e.successor.headerHeight = '31'; e.successor.stateHeight = '30';},
    e => {e.block.stateHeight = '27';}, e => {e.successor.stateHeight = '28';},
    e => {e.successor.chainId = 'other-consensus-chain';}, e => {e.block.chainId = '';},
    e => {e.block.chainId = '界'.repeat(17);}, e => {e.block.chainId = '\ud800';},
    e => {e.transactionHash = '0'.repeat(64);}, e => {e.nativeWireHash = '0'.repeat(64);},
  ]) {const expected = target(); mutate(expected); assert.throws(() => invoke(expected), invalidTarget);}
});

test('canonical base64 and both SHA identities must equal the retained original, including envelope bytes', () => {
  for (const mutate of [
    e => {e.nativeWire += '\n';}, e => {e.envelope += ' ';},
    e => {e.nativeWire = Buffer.from('different original').toString('base64');},
    e => {const changed = Buffer.from(e.envelope, 'base64').toString().replace('{', '{ '); e.envelope = Buffer.from(changed).toString('base64'); e.transactionHash = sha256(changed);},
    e => {[e.transactionHash, e.nativeWireHash] = [e.nativeWireHash, e.transactionHash];},
    e => {e.transactionHash = '77'.repeat(32);}, e => {e.nativeWireHash = '88'.repeat(32);},
    e => {e.transactionType = 'pq_whole';},
  ]) {const expected = target(); mutate(expected); assert.throws(() => invoke(expected), mismatch);}
  const expected = target(); expected.nativeWireHash = '0x' + expected.nativeWireHash;
  assert.throws(() => invoke(expected), invalidTarget);
});

test('returned target and exact stdin are detached immutable copies of host and collector input', () => {
  const expected = target(), proof = controlledProof(), result = invoke(expected, proof);
  const saved = result.stdin, savedHash = result.stdinSha256;
  expected.block.blockHash = '34'.repeat(32); expected.successor.headerHeight = '99'; expected.index = '7';
  proof.block.commitResult = 'bm90LW9yaWdpbmFs'; proof.executionProof = 'eA==';
  assert.equal(result.stdin, saved); assert.equal(result.stdinSha256, savedHash);
  assert.equal(result.expected.block.blockHash, 'ab'.repeat(32)); assert.equal(result.expected.index, '0');
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.expected));
  assert(Object.isFrozen(result.expected.block)); assert(Object.isFrozen(result.expected.successor));
  assert.throws(() => {result.expected.block.headerHeight = '31';}, TypeError);
  assert.deepEqual(JSON.parse(result.stdin).proof, controlledProof());
});

test('unknown fields and accessors cannot supply host coordinates or collector proof', () => {
  let calls = 0;
  const expected = target(); Object.defineProperty(expected.block, 'headerHeight', {enumerable:true, get(){calls++; return '29';}});
  assert.throws(() => invoke(expected), invalidTarget);
  const root = target(); Object.defineProperty(root, 'block', {enumerable:true, get(){calls++; return target().block;}});
  assert.throws(() => invoke(root), invalidTarget);
  const proof = controlledProof(); Object.defineProperty(proof, 'block', {enumerable:true, get(){calls++; return controlledProof().block;}});
  assert.throws(() => invoke(target(), proof)); assert.equal(calls, 0);
  const selected = {...binding}; Object.defineProperty(selected, 'account', {enumerable:true, get(){calls++; return account;}});
  assert.throws(() => invoke(target(), controlledProof(), original, selected), invalidTarget);
  const record = {...original}; Object.defineProperty(record, 'wire', {enumerable:true, get(){calls++; return original.wire;}});
  assert.throws(() => invoke(target(), controlledProof(), record), invalidTarget);
  const proxy = value => new Proxy(value, {getPrototypeOf(){calls++; return Object.prototype;}, ownKeys(){calls++; return Reflect.ownKeys(value);}, get(){calls++; return undefined;}});
  assert.throws(() => invoke(proxy(target())), invalidTarget);
  const nestedProxy = target(); nestedProxy.block = proxy(nestedProxy.block); assert.throws(() => invoke(nestedProxy), invalidTarget);
  assert.throws(() => invoke(target(), controlledProof(), proxy(original)), invalidTarget);
  assert.throws(() => invoke(target(), controlledProof(), original, proxy(binding)), invalidTarget);
  assert.throws(() => invoke(target(), proxy(controlledProof()))); assert.equal(calls, 0);
  assert.throws(() => invoke({...target(), trustRoot:'caller-root'}), invalidTarget);
  const nested = target(); nested.block.clock = 'caller-clock'; assert.throws(() => invoke(nested), invalidTarget);
});

test('whole collector HTTP DATA and wrong account/network cannot become a verifier invocation', () => {
  assert.throws(() => invoke(target(), {status:'collected', proof:controlledProof()}));
  assert.throws(() => invoke(target(), null));
  assert.throws(() => invoke(target(), controlledProof(), original, {...binding, account:'0x' + '42'.repeat(20)}), {code:'PQ_TRANSACTION_ORIGINAL_BINDING'});
  assert.throws(() => invoke(target(), controlledProof(), original, {...binding, networkId:'aa'.repeat(32)}), {code:'PQ_TRANSACTION_NETWORK_BINDING'});
});
