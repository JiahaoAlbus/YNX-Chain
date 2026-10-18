import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData, preparePQTransferOriginal} from './transfer-binding.mjs';

// DATA consumer of this fixed Protocol source, not an independent verifier.
export const PQ_FINALITY_COLLECTOR_SOURCE = 'c3c219d5a3c560a2e0a5627850e1fa1f45ecd2e6';
const collectorVersion = 'YNX-PQ-RPC-TRANSACTION-PROOF/v1';
const proofVersion = 'YNX-PQ-TRANSACTION-PROOF/v1';
const lightVersion = 'YNX-PQ-LIGHT-PROOF/v1';
// Original consensus/pq_transaction_proof.go, pq_light_proof.go and
// pq_contract_transaction.go limits. envelopeBytes is our local DATA cap.
export const PQ_FINALITY_COLLECTOR_LIMITS = Object.freeze({
  proofBytes: 80 * 1024 * 1024,
  envelopeBytes: 64 * 1024,
  lightProofBytes: 14 * 1024 * 1024,
  commitBytes: 8 * 1024 * 1024,
  validatorsBytes: 2 * 1024 * 1024,
  transactionProofBytes: 4 * Math.floor((24 * 1024 * 1024 + 2) / 3) + 64 * 1024,
  executionResultBytes: 1024 * 1024,
  executionProofBytes: 32 * 1024,
});
const limits = PQ_FINALITY_COLLECTOR_LIMITS;
const fail = code => { throw Object.assign(Error(code), {code}); };
const invalid = () => fail('PQ_FINALITY_COLLECTOR_INVALID');
const proofInvalid = () => fail('PQ_FINALITY_PROOF_DATA_INVALID');
const lightFields = ['version', 'commitResult', 'validatorsResult'];
const proofFields = ['version', 'block', 'successor', 'transactionProof', 'executionResult', 'executionProof'];
const collectorFields = ['version', 'source', 'status', 'observedExecutionStatus', 'nativeTransactionHash',
  'abciTransactionHash', 'executionHeight', 'cometIndex', 'independentFinality', 'proofVerification', 'proof', 'error'];
const lightJSONOverhead = JSON.stringify({version: lightVersion, commitResult: '', validatorsResult: ''}).length;
const proofJSONOverhead = JSON.stringify({version: proofVersion, block: null, successor: null,
  transactionProof: '', executionResult: '', executionProof: ''}).length - 8;

function closedData(value, fields, code) {
  if (types.isProxy(value)) fail(code);
  exactData(value, fields, code);
}

// Validate decoded byte length and pad bits without allocating decoded copies.
// Go []byte JSON uses standard padded base64, never base64url or whitespace.
function base64Data(value, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || value.length > 4 * Math.ceil(maximum / 3)) proofInvalid();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, end)) || (value.length / 4) * 3 - padding > maximum) proofInvalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = alphabet.indexOf(value[end - 1]);
  if (last < 0 || (padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) proofInvalid();
  return value;
}

function lightDTO(value) {
  closedData(value, lightFields, 'PQ_FINALITY_PROOF_DATA_INVALID');
  if (value.version !== lightVersion) proofInvalid();
  const result = Object.freeze({version: lightVersion,
    commitResult: base64Data(value.commitResult, limits.commitBytes),
    validatorsResult: base64Data(value.validatorsResult, limits.validatorsBytes)});
  if (lightJSONSize(result) > limits.lightProofBytes) proofInvalid();
  return result;
}
// All copied DTO strings are ASCII with no JSON escapes; these count the exact
// canonical JSON bytes without creating a second potentially large JSON string.
function lightJSONSize(value) {
  return lightJSONOverhead + value.commitResult.length + value.validatorsResult.length;
}
function proofJSONSize(value) {
  return proofJSONOverhead + lightJSONSize(value.block) + lightJSONSize(value.successor)
    + value.transactionProof.length + value.executionResult.length + value.executionProof.length;
}

/** Main-only, deeply frozen copied transport DTO. This checks no signatures,
 * Comet byte semantics, trust provenance, execution success or finality. */
export function validatePQTransactionProofDTO(value) {
  closedData(value, proofFields, 'PQ_FINALITY_PROOF_DATA_INVALID');
  if (value.version !== proofVersion) proofInvalid();
  const result = Object.freeze({version: proofVersion, block: lightDTO(value.block), successor: lightDTO(value.successor),
    transactionProof: base64Data(value.transactionProof, limits.transactionProofBytes),
    executionResult: base64Data(value.executionResult, limits.executionResultBytes),
    executionProof: base64Data(value.executionProof, limits.executionProofBytes)});
  if (proofJSONSize(result) > limits.proofBytes) proofInvalid();
  return result;
}

// Only this three-level collector/proof/light object grammar is accepted. No
// arrays or arbitrary subtrees exist. Keys are decoded before duplicate checks,
// including escaped aliases which ordinary JSON.parse would silently overwrite.
function collectorJSON(text) {
  let at = 0, proofBytes = 0;
  const skip = () => {
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
      at++;
    }
  };
  const string = () => {
    if (text[at] !== '"') invalid();
    const start = at++;
    while (at < text.length) {
      const code = text.charCodeAt(at++);
      if (code === 34) {
        try { return JSON.parse(text.slice(start, at)); } catch { invalid(); }
      }
      if (code < 32) invalid();
      if (code === 92) at++;
    }
    invalid();
  };
  const object = kind => {
    skip();
    const start = at;
    if (text[at++] !== '{') invalid();
    const allowed = kind === 'collector' ? collectorFields : kind === 'proof' ? proofFields : lightFields;
    const result = {}, seen = new Set();
    skip();
    if (text[at] !== '}') {
      for (;;) {
        skip();
        const key = string();
        if (!allowed.includes(key) || seen.has(key)) invalid();
        seen.add(key); skip();
        if (text[at++] !== ':') invalid();
        skip();
        if (kind === 'collector' && key === 'proof') result[key] = object('proof');
        else if (kind === 'proof' && (key === 'block' || key === 'successor')) result[key] = object('light');
        else if (kind === 'collector' && key === 'cometIndex') {
          const begin = at;
          while (at < text.length && /[0-9]/.test(text[at])) at++;
          const token = text.slice(begin, at);
          if (!/^(0|[1-9][0-9]{0,9})$/.test(token)) invalid();
          result[key] = Number(token);
          if (result[key] > 0xffffffff) invalid();
        } else if (kind === 'collector' && key === 'independentFinality') {
          if (text.slice(at, at + 5) !== 'false') invalid();
          at += 5; result[key] = false;
        } else result[key] = string();
        skip();
        if (text[at] === '}') break;
        if (text[at++] !== ',') invalid();
      }
    }
    if (text[at++] !== '}') invalid();
    const size = Buffer.byteLength(text.slice(start, at), 'utf8');
    if (kind === 'proof') { if (size > limits.proofBytes) invalid(); proofBytes = size; }
    if (kind === 'light' && size > limits.lightProofBytes) invalid();
    return result;
  };
  const value = object('collector');
  skip();
  if (at !== text.length) invalid();
  return {value, proofBytes};
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const offsetOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;
const lengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
function snapshotBytes(value) {
  if (types.isProxy(value) || !types.isUint8Array(value)) invalid();
  // Intrinsic getters ignore attacker-defined buffer/length accessors. No
  // caller properties, custom iterator or toJSON are evaluated or propagated.
  try {
    const buffer = bufferOf.call(value), offset = offsetOf.call(value), length = lengthOf.call(value);
    if (types.isSharedArrayBuffer(buffer) || length === 0 || length > limits.proofBytes + limits.envelopeBytes) invalid();
    return Buffer.from(new Uint8Array(buffer, offset, length));
  } catch { invalid(); }
}

function originalBinding(original, binding) {
  closedData(binding, ['account', 'networkId'], 'PQ_TRANSACTION_INPUT_INVALID');
  closedData(original, ['version', 'account', 'kind', 'operationId', 'hash', 'wire', 'status'], 'PQ_TRANSACTION_INPUT_INVALID');
  return preparePQTransferOriginal(original, binding).binding;
}

/** No HTTP, authority, retry, persistence or side effect is performed. */
export function planPQTransferFinalityCollector(original, binding) {
  const prepared = originalBinding(original, binding);
  return Object.freeze({method: 'GET', path: '/txs/' + prepared.abciTransactionHash + '/pq-finality-proof'});
}

/** Shared collector DATA grammar; expected hashes are caller-bound identity,
 * never a Host trust expectation. No transaction or signature parser here. */
export function decodePQFinalityCollectorData(expected, httpStatus, rawBytes) {
  if (![200, 202, 502].includes(httpStatus)) invalid();
  closedData(expected, ['nativeTransactionHash', 'abciTransactionHash'], 'PQ_FINALITY_COLLECTOR_INVALID');
  if (![expected.nativeTransactionHash, expected.abciTransactionHash].every(v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v))) invalid();
  const raw = snapshotBytes(rawBytes);
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw); } catch { invalid(); }
  const {value, proofBytes} = collectorJSON(text);
  if (raw.length - proofBytes > limits.envelopeBytes) invalid();
  const required = ['version', 'source', 'status', 'nativeTransactionHash', 'abciTransactionHash', 'executionHeight', 'independentFinality', 'proofVerification'];
  if (required.some(key => !Object.hasOwn(value, key)) || value.version !== collectorVersion
    || value.source !== 'configured-comet-rpc' || value.independentFinality !== false || value.proofVerification !== 'not-performed') invalid();
  if (value.abciTransactionHash !== expected.abciTransactionHash
    || (value.nativeTransactionHash !== '' && value.nativeTransactionHash !== expected.nativeTransactionHash)) fail('PQ_FINALITY_ORIGINAL_MISMATCH');
  if (!/^(0|[1-9][0-9]{0,18})$/.test(value.executionHeight) || BigInt(value.executionHeight) >= 9223372036854775807n) invalid();
  const terminal = value.executionHeight !== '0';
  if (terminal) {
    if (value.nativeTransactionHash !== expected.nativeTransactionHash || !Object.hasOwn(value, 'cometIndex')
      || !['committed', 'rejected'].includes(value.observedExecutionStatus)) invalid();
  } else if (value.nativeTransactionHash !== '' || Object.hasOwn(value, 'cometIndex') || Object.hasOwn(value, 'observedExecutionStatus')) invalid();
  if (httpStatus === 200) {
    if (value.status !== 'collected' || !terminal || !Object.hasOwn(value, 'proof') || Object.hasOwn(value, 'error')) invalid();
  } else if (httpStatus === 202) {
    if (value.status !== 'pending' || !terminal || Object.hasOwn(value, 'proof') || Object.hasOwn(value, 'error')) invalid();
  } else if (value.status !== 'unavailable' || Object.hasOwn(value, 'proof') || typeof value.error !== 'string' || value.error.length === 0) invalid();
  const proof = httpStatus === 200 ? validatePQTransactionProofDTO(value.proof) : null;
  if (proof) value.proof = proof;
  return Object.freeze({view: Object.freeze(value), proof,
    rawSha256: createHash('sha256').update(raw).digest('hex'), byteLength: raw.length});
}

/** Raw bytes remain with the original Main caller for its existing evidence
 * persistence. Only observation may cross public UI; proof stays main-only. */
export function parsePQTransferFinalityCollector(original, binding, httpStatus, rawBytes) {
  if (![200, 202, 502].includes(httpStatus)) invalid();
  const prepared = originalBinding(original, binding);
  const {view: value, proof, rawSha256, byteLength} = decodePQFinalityCollectorData({
    nativeTransactionHash: prepared.hash, abciTransactionHash: prepared.abciTransactionHash}, httpStatus, rawBytes);
  const observation = Object.freeze({account: prepared.account, operationId: prepared.operationId,
    kind: 'pq-transfer', transactionType: 'pq_transfer', source: 'configured-comet-rpc', status: value.status,
    observedExecutionStatus: value.observedExecutionStatus ?? null,
    nativeTransactionHash: value.nativeTransactionHash, abciTransactionHash: prepared.abciTransactionHash,
    executionHeight: value.executionHeight, cometIndex: value.cometIndex ?? null,
    independentFinality: false, proofVerification: 'not-performed', consensusFinality: false, canRetry: false});
  return Object.freeze({observation, proof, rawSha256, byteLength});
}
