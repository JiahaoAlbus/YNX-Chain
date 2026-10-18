// Public DATA projection only. Its input must come from the original journal
// or BFT parser; this module supplies no authority, transport or finality proof.
const kinds = ['pq-transfer', 'pq-migration', 'pq-revocation'];
const statuses = ['signed-unsubmitted', 'submission-unknown', 'rejection-observed', 'inclusion-observed'];
const hashPattern = /^0x[0-9a-f]{64}$/;
const accountPattern = /^0x[0-9a-f]{40}$/;
const invalid = () => { throw Object.assign(new Error('The original PQ progress could not be verified.'), {code: 'PQ_TRANSACTION_PROGRESS_INVALID'}); };

function record(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key =>
    typeof key !== 'string' || !required.includes(key) && !optional.includes(key) ||
    !Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true)) invalid();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

function bindingOf(value) {
  const bound = record(value, ['account', 'hash', 'kind']);
  if (typeof bound.account !== 'string' || !accountPattern.test(bound.account) ||
      typeof bound.hash !== 'string' || !hashPattern.test(bound.hash) || !kinds.includes(bound.kind)) invalid();
  return bound;
}

function sameOriginal(value, binding) {
  if (value.account !== binding.account || value.hash !== binding.hash || value.kind !== binding.kind ||
      value.retryAuthorized !== false || value.clearsOriginal !== false || value.consensusFinality !== false) invalid();
}

function uint64(value, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) invalid();
  const number = BigInt(value);
  if (number > 18446744073709551615n || positive && number === 0n) invalid();
}

function cause(value) {
  if (value === null) return;
  const entry = record(value, ['kind', 'value', 'code']);
  if (!['error', 'object', 'undefined', 'boolean', 'number', 'string'].includes(entry.kind) ||
      entry.code !== null && (typeof entry.code !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(entry.code))) invalid();
  if (['error', 'object', 'undefined'].includes(entry.kind) && entry.value !== null ||
      entry.kind === 'boolean' && typeof entry.value !== 'boolean' ||
      entry.kind === 'number' && entry.value !== null && (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) ||
      entry.kind === 'string' && !['', 'redacted'].includes(entry.value)) invalid();
  // Even already-redacted diagnostic metadata does not belong in this view.
}

function view(binding, status, source, storage = {}) {
  // A rejection proves neither successful admission nor absence from the chain.
  // Match the original journal's submitted semantics: only observed inclusion
  // establishes true, and only an unsubmitted original establishes false.
  const observed = status === 'inclusion-observed' ? true : status === 'signed-unsubmitted' ? false : null;
  return Object.freeze({...binding, status, source, submitted: observed, included: observed,
    consensusFinality: false, canRetry: false, clearsOriginal: false,
    storageConfirmed: storage.storageConfirmed ?? null,
    metadataConfirmed: storage.metadataConfirmed ?? null,
    localResultHeld: storage.localResultHeld ?? null});
}

function journalView(input, binding) {
  const value = record(input, ['account', 'hash', 'kind', 'status', 'storageConfirmed', 'metadataConfirmed',
    'localResultHeld', 'firstCause', 'storageCause', 'retryAuthorized', 'clearsOriginal', 'consensusFinality']);
  sameOriginal(value, binding);
  if (!statuses.includes(value.status) || ['storageConfirmed', 'metadataConfirmed', 'localResultHeld'].some(key => typeof value[key] !== 'boolean') ||
      value.metadataConfirmed && !value.storageConfirmed || value.status === 'signed-unsubmitted' &&
      (value.storageConfirmed || value.metadataConfirmed || value.localResultHeld)) invalid();
  cause(value.firstCause); cause(value.storageCause);
  return view(binding, value.status, 'local-journal', value);
}

function bftView(input, binding) {
  const value = record(input, ['account', 'hash', 'kind', 'source', 'nativeTransactionHash', 'outcome',
    'executionHeight', 'retryAuthorized', 'clearsOriginal', 'consensusFinality', 'producerDurability'],
    ['abciTransactionHash', 'decimalFields', 'cometIndex', 'signedRevocation', 'feeLotFlowObserved', 'feeEffectsVerified']);
  sameOriginal(value, binding);
  if (value.source !== 'comet-rpc' || value.nativeTransactionHash !== binding.hash || value.producerDurability !== false ||
      !['outcome-unknown', 'rejection-observed', 'bft-inclusion-observed'].includes(value.outcome)) invalid();
  if (Object.hasOwn(value, 'abciTransactionHash') &&
      (typeof value.abciTransactionHash !== 'string' || !hashPattern.test(value.abciTransactionHash))) invalid();
  const included = value.outcome === 'bft-inclusion-observed';
  uint64(value.executionHeight, included);
  if (value.outcome === 'outcome-unknown' && value.executionHeight !== '0') invalid();
  if (included) {
    if (!Object.hasOwn(value, 'abciTransactionHash') || !Number.isSafeInteger(value.cometIndex) || value.cometIndex < 0 || value.cometIndex > 4294967295) invalid();
    const decimals = record(value.decimalFields, ['amount', 'fee', 'nonce']);
    uint64(decimals.amount); uint64(decimals.nonce, true);
    if (decimals.fee !== '1') invalid();
  } else if (Object.hasOwn(value, 'decimalFields') || Object.hasOwn(value, 'cometIndex')) invalid();
  if (included && binding.kind === 'pq-revocation') {
    const revocation = record(value.signedRevocation, ['authorizingRevision', 'throughRevision', 'executeAt', 'revokeAt']);
    for (const number of Object.values(revocation)) uint64(number, true);
    if (revocation.executeAt !== value.executionHeight || value.feeLotFlowObserved !== true || value.feeEffectsVerified !== false) invalid();
  } else if (['signedRevocation', 'feeLotFlowObserved', 'feeEffectsVerified'].some(key => Object.hasOwn(value, key))) invalid();
  return view(binding, included ? 'inclusion-observed' : value.outcome === 'rejection-observed' ? 'rejection-observed' : 'submission-unknown', 'comet-rpc');
}

/** Accept only the closed public result from readPQProgress or parsePQBFT*.
 * Invalid input throws a fixed safe error; it must not replace a prior view. */
export function projectPQTransactionProgress(input, binding) {
  try {
    const expected = bindingOf(binding);
    const status = input && Object.getOwnPropertyDescriptor(input, 'status');
    return status ? journalView(input, expected) : bftView(input, expected);
  } catch { invalid(); }
}

/** A failed read supplies no new chain facts and never changes the original. */
export function pqProgressReadUnavailable(binding) {
  try { return view(bindingOf(binding), 'unavailable', 'unavailable'); }
  catch { invalid(); }
}
