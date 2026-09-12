// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createNativeActionJournal, type NativeJournalStore } from './native-action-journal';
import { getNativeSubmissionStatus, refreshNativeSubmission, submitNativeAction } from './native-submission';
import { nativeFixture } from './fixtures/native-fixture';
import golden from './fixtures/finance-receipt-fixture.json';
import { createApplicationActionReturnURL, type NativeRequest } from './vendor/application-actions-browser.mjs';
import registry from './vendor/native-action-registry.json';

// Public fixed test key 1. This suite has no external network, Wallet or funds.
const SIGNER = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const ACCOUNT = 'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
const NOW = new Date('2026-09-12T11:30:00.000Z');
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
class Store implements NativeJournalStore {
  values = new Map<string, string>(); tail: Promise<unknown> = Promise.resolve();
  update(key: string, change: (value: string | null) => string | null): Promise<string | null> {
    const task = this.tail.then(() => { const next = change(this.values.get(key) ?? null); if (next === null) this.values.delete(key); else this.values.set(key, next); return next; });
    this.tail = task.catch(() => {}); return task;
  }
}
function sign(request: NativeRequest) {
  const payload = { poolId: request.payload.poolId, assetIn: request.payload.assetIn, amountIn: request.payload.amountIn, minAmountOut: request.payload.minAmountOut, deadlineUnix: request.payload.deadlineUnix };
  const unsigned = { version: 1, chainId: 6423, type: 'application_action', signer: SIGNER, nonce: request.nonce, action: request.action, payload,
    payloadHash: sha(JSON.stringify(payload)), fee: 1, aiUnits: 0, payUnits: 0, publicKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' };
  const signature = secp256k1.sign(Buffer.from(sha(JSON.stringify({ domain: 'YNX_APPLICATION_ACTION_V1', ...unsigned })), 'hex'), Buffer.from('0'.repeat(63) + '1', 'hex'), { prehash: false, format: 'der', lowS: true });
  return JSON.stringify({ ...unsigned, signature: Buffer.from(signature).toString('hex') });
}
async function setup() {
  const store = new Store(), journal = createNativeActionJournal(store), snapshot = nativeFixture(SIGNER);
  const pending = await journal.prepare({ account: ACCOUNT, action: 'dex_swap_exact_input', snapshot,
    payload: { poolId: snapshot.pools[0].id, assetIn: 'YNXT', amountIn: 10, minAmountOut: 1, deadlineUnix: Date.now() / 1000 + 240 } });
  const signed = sign(pending.request);
  const draft = await journal.acceptReturn(ACCOUNT, createApplicationActionReturnURL(registry, pending.request, { status: 'approved', signed }));
  const input = { store, account: ACCOUNT, digest: draft.digest, hash: draft.transactionHash!, confirmed: true as const, isCurrent: () => true };
  const receipt = structuredClone(golden);
  receipt.transaction = { ...receipt.transaction, hash: input.hash, from: SIGNER, type: draft.request.action, to: String(draft.request.payload.poolId), nonce: String(draft.request.nonce) };
  return { store, journal, draft, signed, input, receipt };
}
const json = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status, headers: { 'content-type': 'application/json' } });
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubGlobal('location', { origin: 'https://dex.ynxweb4.com' }); transport = vi.fn(); vi.stubGlobal('fetch', transport); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('explicit native signed submission and same-hash recovery; local synthetic fixtures only', () => {
  it('durably claims before the one POST and sends Wallet bytes unchanged; GET alone determines observed status', async () => {
    const { input, store, signed, receipt } = await setup();
    transport.mockImplementation(async (path, options) => {
      expect([...store.values.keys()].filter(k => k.includes(':submission:'))).toHaveLength(1);
      return options.method === 'POST' ? json({ transaction: { hash: input.hash }, replayed: false }) : json(receipt);
    });
    const result = await submitNativeAction(input);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenNthCalledWith(1, '/v1/native-transactions', expect.objectContaining({ method: 'POST', body: signed, credentials: 'omit', redirect: 'error', headers: expect.objectContaining({ 'X-YNX-Transaction-Hash': input.hash }) }));
    expect(transport).toHaveBeenNthCalledWith(2, '/v1/native-transactions/' + input.hash, expect.objectContaining({ method: 'GET' }));
    expect(result).toMatchObject({ status: 'durable', observation: { consensusFinality: false, transaction: { account: SIGNER, nonce: '4' } } });
    expect((await getNativeSubmissionStatus(store, ACCOUNT, input.digest))?.status).toBe('durable');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('a cold reopen/second tab never posts twice for the signed hash', async () => {
    const { input } = await setup();
    transport.mockImplementation(async (path, opts) => opts.method === 'POST' ? json({}) : json({ status: 'not_found', transactionHash: input.hash }, 404));
    const results = await Promise.allSettled(Array.from({ length: 24 }, () => submitNativeAction(input)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(transport.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    await expect(submitNativeAction({ ...input })).rejects.toMatchObject({ code: 'NATIVE_ALREADY_SUBMITTED' });
    expect((await refreshNativeSubmission(input)).status).toBe('not_found');
    expect(transport.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it('lost ACK and transient not_found retain exact intent; next explicit GET can prove durability', async () => {
    const { input, journal, signed, receipt } = await setup();
    transport.mockRejectedValueOnce(Error('connection lost')).mockResolvedValueOnce(json({ status: 'not_found', transactionHash: input.hash }, 404));
    expect((await submitNativeAction(input)).status).toBe('not_found');
    expect((await journal.read(ACCOUNT))?.signed).toBe(signed);
    transport.mockResolvedValueOnce(json(receipt)); expect((await refreshNativeSubmission(input)).status).toBe('durable');
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('HTTP errors, HTML ACKs and mismatched receipts never manufacture failed or successful transactions', async () => {
    const { input, receipt } = await setup(); receipt.transaction.nonce = '9';
    transport.mockResolvedValueOnce(new Response('<html>fallback</html>', { status: 200 })).mockResolvedValueOnce(json(receipt));
    expect((await submitNativeAction(input)).status).toBe('unknown');
    transport.mockResolvedValueOnce(json({ error: 'not a receipt' }, 503));
    expect((await refreshNativeSubmission(input)).status).toBe('unknown');
    expect(transport.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });
  it('requires separate confirmation, exact account/hash/digest and unexpired signed deadline before network', async () => {
    const { input } = await setup();
    for (const bad of [{ ...input, confirmed: false }, { ...input, hash: '0x' + 'a'.repeat(64) }, { ...input, digest: 'wrong' }, { ...input, account: 'ynx1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3z4qf3ax' }, { ...input, isCurrent: () => false }])
      await expect(submitNativeAction(bad as typeof input)).rejects.toThrow();
    vi.setSystemTime(new Date(NOW.getTime() + 241_000)); await expect(submitNativeAction(input)).rejects.toMatchObject({ code: 'NATIVE_SIGNED_DEADLINE_EXPIRED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('selection loss after commit prevents POST; attempt remains available for recovery only', async () => {
    const { input, store } = await setup(); let current = true;
    const real = store.update.bind(store); store.update = async (key, change) => { const result = await real(key, change); if (key.includes(':submission:')) current = false; return result; };
    await expect(submitNativeAction({ ...input, isCurrent: () => current })).rejects.toMatchObject({ code: 'NATIVE_SELECTION_CHANGED' });
    expect(transport).not.toHaveBeenCalled(); expect([...store.values.keys()].some(k => k.includes(':submission:'))).toBe(true);
  });
  it('storage abort or false commit cannot authorize a POST', async () => {
    const { input, store } = await setup(); const real = store.update.bind(store);
    store.update = (key, change) => key.includes(':submission:') ? Promise.reject(Error('disk blocked')) : real(key, change);
    await expect(submitNativeAction(input)).rejects.toThrow('disk blocked'); expect(transport).not.toHaveBeenCalled();
    store.update = (key, change) => key.includes(':submission:') ? Promise.resolve(null) : real(key, change);
    await expect(submitNativeAction(input)).rejects.toMatchObject({ code: 'NATIVE_DRAFT_PERSISTENCE_FAILED' }); expect(transport).not.toHaveBeenCalled();
  });
  it('bounds POST/header/body timeouts and does not retry; timed-out POST only proceeds to GET', async () => {
    const { input } = await setup();
    transport.mockImplementationOnce((_url, options) => new Promise((_done, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout')))))
      .mockResolvedValueOnce(json({ status: 'not_found', transactionHash: input.hash }, 404));
    const task = submitNativeAction(input); await vi.advanceTimersByTimeAsync(10_001);
    expect((await task).status).toBe('not_found'); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('rejects oversized or invalid UTF-8 receipt stream without replacing an unknown observation', async () => {
    const { input } = await setup();
    transport.mockResolvedValueOnce(json({})).mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
    expect((await submitNativeAction(input)).status).toBe('unknown');
    transport.mockResolvedValueOnce(new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }));
    expect((await refreshNativeSubmission(input)).status).toBe('unknown');
  });
  it('a later not_found cannot erase local durable proof', async () => {
    const { input, receipt } = await setup(); transport.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(receipt)); await submitNativeAction(input);
    transport.mockResolvedValueOnce(json({ status: 'not_found', transactionHash: input.hash }, 404));
    expect((await refreshNativeSubmission(input)).status).toBe('durable');
  });
  it('cross-tab read generation fences late stale responses', async () => {
    const { input, receipt } = await setup(); transport.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ status: 'not_found', transactionHash: input.hash }, 404)); await submitNativeAction(input);
    let resolveOld!: (response: Response) => void;
    transport.mockImplementationOnce(() => new Promise<Response>(done => { resolveOld = done; }));
    const old = refreshNativeSubmission(input); for (let i = 0; i < 30 && !resolveOld; i++) await Promise.resolve();
    expect(resolveOld).toBeTypeOf('function'); transport.mockResolvedValueOnce(json(receipt));
    expect((await refreshNativeSubmission(input)).status).toBe('durable');
    resolveOld(json({ status: 'not_found', transactionHash: input.hash }, 404)); await old;
    expect((await getNativeSubmissionStatus(input.store, ACCOUNT, input.digest))?.status).toBe('durable');
  });
});
