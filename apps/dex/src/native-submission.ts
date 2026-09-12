import { createNativeActionJournal, NativeActionJournalError, type NativeDraft, type NativeJournalStore } from './native-action-journal';
import { nativeLedgerAddress } from './native-snapshot';
import { parseNativeReceipt, type NativeReceipt, type NativeReceiptStatus } from './native-receipt';

export type NativeSubmission = Readonly<{
  version: 1; account: string; digest: string; hash: string; attemptedAt: string;
  status: 'unknown' | NativeReceiptStatus; observation: NativeReceipt | null;
}>;
type StoredSubmission = {
  version: 1; account: string; digest: string; hash: string; attemptedAt: string;
  readRevision: number; responseStatus: number | null; rawReceipt: unknown;
};
type Context = { store: NativeJournalStore; account: string; digest: string; hash: string; isCurrent: () => boolean };
const MAX_BYTES = 1024 * 1024;
function fail(code: string): never { throw new NativeActionJournalError(code); }
const entry = (account: string, hash: string) => `ff5b7d49:submission:${account}:${hash}`;
const assertCurrent = (input: Context) => { if (!input.isCurrent()) fail('NATIVE_SELECTION_CHANGED'); };

async function approved(store: NativeJournalStore, account: string, digest: string) {
  // Existing journal performs the canonical origin, signature, request/digest
  // and account checks through the frozen shared SDK; no second signer here.
  const draft = await createNativeActionJournal(store).read(account);
  if (!draft || draft.digest !== digest || draft.status !== 'approved' || !draft.signed || !draft.transactionHash) fail('NATIVE_APPROVED_INTENT_REQUIRED');
  return draft;
}

function observation(raw: unknown, status: number, draft: Readonly<NativeDraft>): NativeReceipt {
  const receipt = parseNativeReceipt(raw, draft.transactionHash!, status);
  if (receipt.transaction && (receipt.transaction.account !== nativeLedgerAddress(draft.request.account) ||
      receipt.transaction.action !== draft.request.action || receipt.transaction.pool !== draft.request.payload.poolId ||
      receipt.transaction.nonce !== String(draft.request.nonce))) fail('NATIVE_RECEIPT_BINDING_MISMATCH');
  return receipt;
}

function decode(value: string, draft: Readonly<NativeDraft>): StoredSubmission {
  if (value.length > MAX_BYTES) fail('NATIVE_SUBMISSION_RECORD_INVALID');
  let record: StoredSubmission;
  try { record = JSON.parse(value); } catch { fail('NATIVE_SUBMISSION_RECORD_INVALID'); }
  const fields = ['version', 'account', 'digest', 'hash', 'attemptedAt', 'readRevision', 'responseStatus', 'rawReceipt'];
  if (!record || typeof record !== 'object' || Object.keys(record).sort().join() !== fields.sort().join() ||
      record.version !== 1 || record.account !== draft.request.account || record.digest !== draft.digest || record.hash !== draft.transactionHash ||
      typeof record.attemptedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.attemptedAt) || !Number.isFinite(Date.parse(record.attemptedAt)) ||
      !Number.isSafeInteger(record.readRevision) || record.readRevision < 0) fail('NATIVE_SUBMISSION_RECORD_INVALID');
  if (record.responseStatus === null) {
    if (record.rawReceipt !== null) fail('NATIVE_SUBMISSION_RECORD_INVALID');
  } else observation(record.rawReceipt, record.responseStatus, draft);
  return record;
}

function view(record: StoredSubmission, draft: Readonly<NativeDraft>): NativeSubmission {
  const result = record.responseStatus === null ? null : observation(record.rawReceipt, record.responseStatus, draft);
  return Object.freeze({ version: 1, account: record.account, digest: record.digest, hash: record.hash,
    attemptedAt: record.attemptedAt, status: result?.status ?? 'unknown', observation: result });
}

// Persist only the validated observation envelope, not unrelated upstream
// transaction/event extensions. This keeps each durable IDB record bounded;
// signed wire bytes continue to live unchanged in the original intent.
function retainedReceipt(raw: unknown, status: number) {
  const value = raw as Record<string, unknown>;
  const pick = (object: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(key => [key, object[key]]));
  if (status === 404) return pick(value, ['status', 'transactionHash']);
  return { ...pick(value, ['schemaVersion', 'source', 'integerEncoding', 'status', 'consensusFinality']),
    transaction: pick(value.transaction as Record<string, unknown>, ['hash', 'from', 'type', 'to', 'nonce', 'fee', 'timestamp', 'blockNumber', 'blockHash']),
    durability: pick(value.durability as Record<string, unknown>, ['version', 'scope', 'checkpointHeight', 'checkpointHash', 'snapshotIntegrity']) };
}

export async function getNativeSubmissionStatus(store: NativeJournalStore, account: string, digest: string): Promise<NativeSubmission | null> {
  const draft = await approved(store, account, digest);
  const value = await store.update(entry(account, draft.transactionHash!), old => old);
  return value === null ? null : view(decode(value, draft), draft);
}

/** Streaming limit is a byte limit, not a post-allocation string check. The
 * timeout covers both response headers and the complete bounded body. No
 * redirects, cookies, caller-supplied origin, endpoint, or automatic retry. */
async function readJSON(path: string, method: 'GET' | 'POST', body?: string, hash?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(path, { method, body, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: method === 'POST' ? { Accept: 'application/json', 'Content-Type': 'application/json', 'X-YNX-Transaction-Hash': hash! } : { Accept: 'application/json' } });
    if (response.redirected || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '') ||
        Number(response.headers.get('content-length') ?? 0) > MAX_BYTES || !response.body) fail('NATIVE_RESPONSE_INVALID');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) fail('NATIVE_RESPONSE_INVALID');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { status: response.status, raw: JSON.parse(text) as unknown };
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => { /* no secret-bearing transport error output */ });
  }
}

/** User-requested GET only. A not_found result can be a checkpoint observed
 * during an in-flight Core write, not permission to allocate a fresh nonce.
 * Cross-tab read generations fence stale responses. Local durable proof never
 * regresses to a transient not_found and is never promoted to consensus finality. */
export async function refreshNativeSubmission(input: Context): Promise<NativeSubmission> {
  assertCurrent(input);
  const draft = await approved(input.store, input.account, input.digest);
  assertCurrent(input);
  if (draft.transactionHash !== input.hash) fail('NATIVE_DRAFT_BINDING_MISMATCH');
  const key = entry(input.account, input.hash);
  const start = await input.store.update(key, old => {
    assertCurrent(input);
    if (old === null) fail('NATIVE_SUBMISSION_REQUIRED');
    const record = decode(old, draft);
    if (record.readRevision >= Number.MAX_SAFE_INTEGER) fail('NATIVE_SUBMISSION_RECORD_INVALID');
    return JSON.stringify({ ...record, readRevision: record.readRevision + 1 });
  });
  assertCurrent(input);
  if (start === null) fail('NATIVE_DRAFT_PERSISTENCE_FAILED');
  const before = decode(start, draft);
  let incoming: Awaited<ReturnType<typeof readJSON>>;
  try { incoming = await readJSON('/v1/native-transactions/' + input.hash, 'GET'); observation(incoming.raw, incoming.status, draft); }
  catch { assertCurrent(input); return (await getNativeSubmissionStatus(input.store, input.account, input.digest))!; }
  assertCurrent(input);
  const saved = await input.store.update(key, old => {
    assertCurrent(input);
    if (old === null) fail('NATIVE_SUBMISSION_RECORD_INVALID');
    const current = decode(old, draft);
    if (current.readRevision !== before.readRevision) return old;
    const prior = view(current, draft), next = observation(incoming.raw, incoming.status, draft);
    if ((prior.status === 'durable' && next.status !== 'durable') ||
        (prior.status === 'pending_durable' && !['pending_durable', 'durable'].includes(next.status))) return old;
    return JSON.stringify({ ...current, responseStatus: incoming.status, rawReceipt: retainedReceipt(incoming.raw, incoming.status) });
  });
  assertCurrent(input);
  if (saved === null) fail('NATIVE_DRAFT_PERSISTENCE_FAILED');
  return view(decode(saved, draft), draft);
}

/** Exactly one first POST per immutable signed intent, after durable claim and
 * separate product confirmation. No callback, mount, reload, timer, or GET can
 * invoke this. Lost ACK, abort, HTTP rejection or crash retains bytes/hash and
 * the claim; recovery is same-hash GET, never an automatic repeat or re-sign. */
export async function submitNativeAction(input: Context & { confirmed: true }): Promise<NativeSubmission> {
  if (input.confirmed !== true) fail('NATIVE_CONFIRMATION_REQUIRED');
  assertCurrent(input);
  const draft = await approved(input.store, input.account, input.digest);
  assertCurrent(input);
  if (draft.transactionHash !== input.hash || new TextEncoder().encode(draft.signed!).byteLength > 16384) fail('NATIVE_DRAFT_BINDING_MISMATCH');
  if (Number(draft.request.payload.deadlineUnix) <= Math.floor(Date.now() / 1000)) fail('NATIVE_SIGNED_DEADLINE_EXPIRED');
  const initial: StoredSubmission = { version: 1, account: input.account, digest: input.digest, hash: input.hash,
    attemptedAt: new Date().toISOString(), readRevision: 0, responseStatus: null, rawReceipt: null };
  const encoded = JSON.stringify(initial);
  const saved = await input.store.update(entry(input.account, input.hash), old => {
    assertCurrent(input);
    if (old !== null) { decode(old, draft); fail('NATIVE_ALREADY_SUBMITTED'); }
    return encoded;
  });
  if (saved !== encoded) fail('NATIVE_DRAFT_PERSISTENCE_FAILED');
  assertCurrent(input);
  if (Number(draft.request.payload.deadlineUnix) <= Math.floor(Date.now() / 1000)) fail('NATIVE_SIGNED_DEADLINE_EXPIRED');
  try { await readJSON('/v1/native-transactions', 'POST', draft.signed!, input.hash); }
  catch { /* ACK is not execution or durability evidence. Reconcile by hash. */ }
  assertCurrent(input);
  return refreshNativeSubmission(input);
}
