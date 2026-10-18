import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData, preparePQTransferOriginal} from './transfer-binding.mjs';
import {validatePQTransactionProofDTO} from './finality-collector.mjs';

// Pinned normal CLI profile: Protocol c3c219d transaction.go and trust.go.
// These bound DATA transport only; the normal CLI must still load its original
// externally pinned host context, validate provenance, and verify the proof.
const requestVersion = 'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1';
const maxInt64 = 9223372036854775807n;
const maxEnvelopeBytes = 24 << 20, maxNativeWireBytes = 8 << 20;
const base64Bound = bytes => 4 * Math.ceil(bytes / 3);
const maxExpectedBytes = base64Bound(maxEnvelopeBytes) + base64Bound(maxNativeWireBytes) + (8 << 10);
const maxInputBytes = (80 << 20) + maxExpectedBytes + 1024;
const targetFields = ['block','successor','transactionType','envelope','nativeWire','transactionHash','nativeWireHash','index'];
const statementFields = ['chainId','headerHeight','blockHash','stateHeight','stateAppHash'];
const fail = code => {throw Object.assign(Error(code), {code});};
const targetInvalid = () => fail('PQ_FINALITY_INVOCATION_TARGET_INVALID');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function dataCopy(value, fields) {
  if (types.isProxy(value)) targetInvalid();
  exactData(value, fields, 'PQ_FINALITY_INVOCATION_TARGET_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(fields.map(field => [field, descriptors[field].value]));
}
function decimal(value, maximum, nonzero = false) {
  if (typeof value !== 'string' || value.length > 19 || !/^(0|[1-9][0-9]*)$/.test(value)) targetInvalid();
  const number = BigInt(value);
  if (number > maximum || nonzero && number === 0n) targetInvalid();
  return number;
}
function nonzeroHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) targetInvalid();
}
function statement(value) {
  const result = dataCopy(value, statementFields);
  if (statementFields.some(field => typeof result[field] !== 'string')) targetInvalid();
  // Comet's chain ID is independently fixed by the original host/genesis. It
  // is not the Wallet network's 64-character digest and is not derived here.
  if (!result.chainId.length || result.chainId.length > 50) targetInvalid();
  const chainBytes = Buffer.from(result.chainId, 'utf8');
  if (!chainBytes.length || chainBytes.length > 50 || chainBytes.toString('utf8') !== result.chainId) targetInvalid();
  const height = decimal(result.headerHeight, maxInt64 - 1n, true);
  const stateHeight = decimal(result.stateHeight, maxInt64 - 2n);
  if (height !== stateHeight + 1n) targetInvalid();
  nonzeroHash(result.blockHash); nonzeroHash(result.stateAppHash);
  return Object.freeze(result);
}

/** Main-only input DATA. A plain object does not establish host provenance.
 * The original owner must obtain hostExpectedTransaction from its independent
 * pinned context, then invoke the normal pinned CLI with that same context.
 * collectorProof is only its proof DTO, never the raw collector HTTP response.
 * No file/CLI/network effect or approval/finality result is produced here. */
export function preparePQTransferFinalityInvocation(original, binding, hostExpectedTransaction, collectorProof) {
  const {account, networkId} = dataCopy(binding, ['account','networkId']);
  const originalCopy = dataCopy(original, ['version','account','kind','operationId','hash','wire','status']);
  const plan = preparePQTransferOriginal(originalCopy, {account, networkId});
  const wire = Buffer.from(plan.request.body);
  if (!wire.length || wire.length > maxNativeWireBytes) fail('PQ_FINALITY_INVOCATION_BYTES_EXCEEDED');
  // Preserve Go's normal EncodePQTransaction struct field order and lowerhex.
  const envelope = Buffer.from(JSON.stringify({version:1, type:'pq_transfer', wireHex:wire.toString('hex')}), 'utf8');
  if (envelope.length > maxEnvelopeBytes) fail('PQ_FINALITY_INVOCATION_BYTES_EXCEEDED');
  const nativeHash = digest(wire), transactionHash = digest(envelope);
  if (plan.binding.hash !== '0x' + nativeHash || plan.binding.abciTransactionHash !== '0x' + transactionHash) fail('PQ_FINALITY_INVOCATION_ORIGINAL_MISMATCH');

  const selected = dataCopy(hostExpectedTransaction, targetFields);
  const block = statement(selected.block), successor = statement(selected.successor);
  const height = BigInt(block.headerHeight);
  if (height >= maxInt64 - 2n || BigInt(successor.headerHeight) !== height + 1n || block.chainId !== successor.chainId) targetInvalid();
  decimal(selected.index, 4294967295n);
  nonzeroHash(selected.transactionHash); nonzeroHash(selected.nativeWireHash);
  if (typeof selected.envelope !== 'string' || selected.envelope.length > base64Bound(maxEnvelopeBytes) || typeof selected.nativeWire !== 'string' || selected.nativeWire.length > base64Bound(maxNativeWireBytes)) targetInvalid();
  // Exact equality to locally rebuilt canonical standard base64 also rejects
  // base64url, ignored whitespace, alternate pad bits and replacement bytes.
  if (selected.transactionType !== 'pq_transfer' || selected.envelope !== envelope.toString('base64') || selected.nativeWire !== wire.toString('base64') || selected.transactionHash !== transactionHash || selected.nativeWireHash !== nativeHash) fail('PQ_FINALITY_INVOCATION_ORIGINAL_MISMATCH');
  const expected = Object.freeze({...selected, block, successor});
  if (Buffer.byteLength(JSON.stringify(expected), 'utf8') > maxExpectedBytes) fail('PQ_FINALITY_INVOCATION_BYTES_EXCEEDED');
  const proof = validatePQTransactionProofDTO(collectorProof);
  const stdin = JSON.stringify({version:requestVersion, expected, proof});
  const stdinByteLength = Buffer.byteLength(stdin, 'utf8');
  if (stdinByteLength > maxInputBytes) fail('PQ_FINALITY_INVOCATION_BYTES_EXCEEDED');
  // A string retains exact immutable UTF-8 input; a frozen Buffer wrapper
  // would leave its bytes mutable. The normal owner writes these exact bytes.
  return Object.freeze({expected, stdin, stdinByteLength, stdinSha256:digest(stdin)});
}
