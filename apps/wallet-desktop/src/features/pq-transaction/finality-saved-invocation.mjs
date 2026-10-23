import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {types} from 'node:util';
import {preparePQTransferFinalityTarget, preparePQReviewedTypedActionFinalityTarget} from './finality-invocation.mjs';
import {validatePQTransactionProofDTO} from './finality-collector.mjs';

// Fixed normal transaction.go / trust.go DATA grammar, unchanged between
// Protocol c3c219d and 57d2d90. Original Main retains the exact source bytes.
// This checks neither host provenance nor any source file, clock or signature.
const maxInt64 = 9223372036854775807n;
const maxExpected = 4 * Math.ceil((24 << 20) / 3) + 4 * Math.ceil((8 << 20) / 3) + (8 << 10);
const maxLightTrust = 32 << 10, maxProof = 80 << 20;
const maxContext = maxExpected + maxLightTrust + 1024, maxStdin = maxProof + maxExpected + 1024;
const contextVersion = 'YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1';
const stdinVersion = 'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1';
const statementFields = ['chainId','headerHeight','blockHash','stateHeight','stateAppHash'];
const expectedFields = ['block','successor','transactionType','envelope','nativeWire','transactionHash','nativeWireHash','index'];
const lightTrustFields = ['version','chainId','migrationFile','genesisFile','stateFile','scheduleFile',
  'scheduleHash','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','runtimePlanFile','runtimePlanHash',
  'engineHeight','engineAppHash','expectedHeaderHeight','expectedBlockHash','expectedStateHeight','expectedStateAppHash',
  'trustedLightBlockFile','trustedLightBlockSHA256','trustingPeriodNanoseconds','maxClockDriftNanoseconds',
  'trustLevelNumerator','trustLevelDenominator'];
const fields = {
  context:['version','lightTrust','expectedTransaction'], stdin:['version','expected','proof'],
  lightTrust:lightTrustFields, expected:expectedFields, statement:statementFields,
  proof:['version','block','successor','transactionProof','executionResult','executionProof'],
  lightProof:['version','commitResult','validatorsResult'],
};
const fail = code => {throw Object.assign(Error(code), {code});};
const invalid = () => fail('PQ_FINALITY_SAVED_INVOCATION_INVALID');
const mismatch = () => fail('PQ_FINALITY_SAVED_INVOCATION_MISMATCH');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get;
const offsetOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get;
const lengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get;
function snapshot(value, maximum) {
  if (types.isProxy(value) || !types.isUint8Array(value)) invalid();
  try {
    const buffer = bufferOf.call(value), offset = offsetOf.call(value), length = lengthOf.call(value);
    if (types.isSharedArrayBuffer(buffer) || length === 0 || length > maximum) invalid();
    return Buffer.from(new Uint8Array(buffer, offset, length));
  } catch { invalid(); }
}

// Only the two saved three-level object grammars exist here. All leaves are
// strings. Decoded keys reject duplicates, including escaped aliases, before
// JSON.parse can discard evidence. Bound nested RAW JSON, not re-encoded JSON.
function savedJSON(raw, rootKind) {
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(raw); } catch { invalid(); }
  let at = 0;
  const space = () => {
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) break;
      at++;
    }
  };
  const string = () => {
    if (text[at++] !== '"') invalid();
    const start = at - 1;
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
    space(); const start = at;
    if (text[at++] !== '{') invalid();
    const result = {}, seen = new Set(), allowed = fields[kind];
    space();
    if (text[at] !== '}') for (;;) {
      space(); const key = string();
      if (!allowed.includes(key) || seen.has(key)) invalid();
      seen.add(key); space(); if (text[at++] !== ':') invalid(); space();
      if (kind === 'context' && key === 'lightTrust') result[key] = object('lightTrust');
      else if ((kind === 'context' && key === 'expectedTransaction') || (kind === 'stdin' && key === 'expected')) result[key] = object('expected');
      else if (kind === 'stdin' && key === 'proof') result[key] = object('proof');
      else if (kind === 'expected' && (key === 'block' || key === 'successor')) result[key] = object('statement');
      else if (kind === 'proof' && (key === 'block' || key === 'successor')) result[key] = object('lightProof');
      else result[key] = string();
      space(); if (text[at] === '}') break; if (text[at++] !== ',') invalid();
    }
    if (text[at++] !== '}' || seen.size !== allowed.length) invalid();
    const maximum = kind === 'lightTrust' ? maxLightTrust : kind === 'expected' ? maxExpected
      : kind === 'proof' ? maxProof : kind === 'lightProof' ? 14 << 20 : null;
    if (maximum !== null && Buffer.byteLength(text.slice(start, at), 'utf8') > maximum) invalid();
    return result;
  };
  const result = object(rootKind); space(); if (at !== text.length) invalid(); return result;
}

function decimal(value, maximum, nonzero = false) {
  if (value.length > 19 || !/^(0|[1-9][0-9]*)$/.test(value)) invalid();
  const result = BigInt(value);
  if (result > maximum || nonzero && result === 0n) invalid();
  return result;
}
function hash(value) {
  if (!/^[0-9a-f]{64}$/.test(value) || /^0{64}$/.test(value)) invalid();
}
function absolutePath(value) {
  // Match the pinned Unix host's filepath.Clean, including trailing slashes.
  // No path is opened or resolved against the filesystem.
  if (!value || value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value || !posix.isAbsolute(value)) invalid();
  const clean = posix.normalize(value).replace(/\/$/, '') || '/';
  if (clean !== value) invalid();
}
function lightTrust(value, expected, networkId) {
  if (value.version !== 'YNX-CONSENSUS-PROOF-TRUST/v1') invalid();
  const chainBytes = Buffer.from(value.chainId, 'utf8');
  if (!chainBytes.length || chainBytes.length > 50 || chainBytes.toString('utf8') !== value.chainId) invalid();
  for (const key of ['migrationFile','genesisFile','stateFile','scheduleFile','trustedLightBlockFile']) absolutePath(value[key]);
  for (const key of ['scheduleHash','consensusGenesisSHA256','originalGenesisHash','migrationStateHash','engineAppHash','trustedLightBlockSHA256']) hash(value[key]);
  if ((value.runtimePlanFile === '') !== (value.runtimePlanHash === '')) invalid();
  if (value.runtimePlanFile !== '') { absolutePath(value.runtimePlanFile); hash(value.runtimePlanHash); }
  decimal(value.engineHeight, maxInt64 - 2n);
  decimal(value.trustingPeriodNanoseconds, maxInt64, true);
  decimal(value.maxClockDriftNanoseconds, maxInt64);
  const numerator = decimal(value.trustLevelNumerator, maxInt64, true);
  const denominator = decimal(value.trustLevelDenominator, maxInt64, true);
  if (numerator > denominator || numerator < denominator / 3n + (denominator % 3n === 0n ? 0n : 1n)) invalid();
  // prepareTarget already validates these exact coordinates and the adjacent
  // header. The original chain digest is distinct from Comet's chain ID.
  for (const [key, target] of [['chainId','chainId'],['expectedHeaderHeight','headerHeight'],['expectedBlockHash','blockHash'],
    ['expectedStateHeight','stateHeight'],['expectedStateAppHash','stateAppHash']]) if (value[key] !== expected.block[target]) mismatch();
  if (value.originalGenesisHash !== networkId) mismatch();
}
function sameExpected(left, right) {
  for (const key of expectedFields) {
    if (key === 'block' || key === 'successor') {
      for (const field of statementFields) if (left[key][field] !== right[key][field]) mismatch();
    } else if (left[key] !== right[key]) mismatch();
  }
}

/** Shared private DATA parser for original Main's Host export and saved-input
 * consumers. It does not establish that any Host produced these bytes. */
export function bindPQTransferFinalityContext(original, binding, contextBytes) {
  return bindContext(contextBytes, expected => preparePQTransferFinalityTarget(original, binding, expected),
    () => Object.getOwnPropertyDescriptor(binding, 'networkId').value);
}

/** Same strict raw context grammar for the reviewed typed original. These
 * bytes remain DATA, not evidence of an independently qualified Host. */
export function bindPQReviewedTypedActionFinalityContext(review, raw, original, contextBytes) {
  return bindContext(contextBytes, expected => preparePQReviewedTypedActionFinalityTarget(review, raw, original, expected),
    () => Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(original, 'selectedBinding').value, 'networkId').value);
}

function bindContext(contextBytes, prepareTarget, networkId) {
  const contextRaw = snapshot(contextBytes, maxContext), context = savedJSON(contextRaw, 'context');
  if (context.version !== contextVersion) invalid();
  const expected = prepareTarget(context.expectedTransaction);
  // prepareTarget has rejected proxies/accessors and validated exact binding.
  lightTrust(context.lightTrust, expected, networkId());
  return Object.freeze({expected, lightTrust:Object.freeze(context.lightTrust),
    contextSha256:digest(contextRaw), contextByteLength:contextRaw.length, classification:'data', proofVerification:'not-performed',
    independentFinality:false, consensusFinality:false, nativeGrant:false, canRetry:false, clearsOriginal:false});
}

/** Main-only DATA binding used before normal dispatch and during cold restore.
 * The caller retains context/stdin bytes and their original evidence refs.
 * Success is no assertion of original host/source authenticity or finality.
 * It performs no file, process, network, time, approval or journal operation. */
export function bindSavedPQTransferFinalityInvocation(original, binding, contextBytes, stdinBytes) {
  const context = bindPQTransferFinalityContext(original, binding, contextBytes);
  return bindSaved(context, stdinBytes, expected => preparePQTransferFinalityTarget(original, binding, expected));
}

export function bindSavedPQReviewedTypedActionFinalityInvocation(review, raw, original, contextBytes, stdinBytes) {
  const context = bindPQReviewedTypedActionFinalityContext(review, raw, original, contextBytes);
  return bindSaved(context, stdinBytes, expected => preparePQReviewedTypedActionFinalityTarget(review, raw, original, expected));
}

function bindSaved(context, stdinBytes, prepareTarget) {
  const stdinRaw = snapshot(stdinBytes, maxStdin), stdin = savedJSON(stdinRaw, 'stdin');
  if (stdin.version !== stdinVersion) invalid();
  const expected = context.expected;
  const inputExpected = prepareTarget(stdin.expected);
  sameExpected(expected, inputExpected);
  validatePQTransactionProofDTO(stdin.proof);
  return Object.freeze({expected, contextSha256:context.contextSha256, contextByteLength:context.contextByteLength,
    stdinSha256:digest(stdinRaw), stdinByteLength:stdinRaw.length, classification:'data', proofVerification:'not-performed',
    independentFinality:false, consensusFinality:false, nativeGrant:false, canRetry:false, clearsOriginal:false});
}
