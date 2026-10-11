import { createHash } from 'node:crypto';
import { AtomicMultiFile, exactObject, multiError } from './multichain-config.mjs';

// BTC/TRON only: the existing EVM journal and every existing profile remain
// unchanged. This ledger stores transaction evidence, never seed/key material.
const states = new Set(['prepared', 'signing', 'signed-unsubmitted', 'submitted-unconfirmed', 'unknown', 'included', 'failed', 'cancelled']);
const terminal = new Set(['included', 'failed', 'cancelled']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const binding = r => digest([r.family, r.networkId, r.account, r.request, r.outpoints]);
const fail = () => { throw multiError('FAMILY_CUSTODY_CONFLICT', 'Keep the original transaction and check its outcome.'); };
function publicJSON(value, depth = 0) {
  if (depth > 24) fail();
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > 200000) fail(); return; }
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail(); return; }
  if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' && Array.isArray(value)) continue;
    if (typeof key !== 'string' || /^(?:privateKey|secret|secretHex|phrase|mnemonic|seed|password|entropyHex)$/i.test(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value')) fail();
    publicJSON(descriptor.value, depth + 1);
  }
}
function validate(value) {
  exactObject(value, ['version', 'records']);
  if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 512) fail();
  const ids = new Set();
  for (const r of value.records) {
    exactObject(r, ['id', 'family', 'networkId', 'account', 'request', 'binding', 'outpoints', 'state', 'result', 'resultDigest', 'receipt', 'queryEvidence', 'revision', 'createdAt', 'updatedAt']);
    if (!Number.isSafeInteger(r.revision) || r.revision < 0) fail();
    if (typeof r.id !== 'string' || !/^[0-9a-f-]{36}$/.test(r.id) || ids.has(r.id) || !['bitcoin', 'tron'].includes(r.family) || typeof r.networkId !== 'string' || !r.networkId || typeof r.account !== 'string' || !r.account || !states.has(r.state) || !Array.isArray(r.outpoints) || r.outpoints.length > 512 || r.outpoints.some(p => typeof p !== 'string' || !/^[0-9a-f]{64}:[0-9]+$/.test(p)) || new Set(r.outpoints).size !== r.outpoints.length || r.family === 'tron' && r.outpoints.length || !Number.isSafeInteger(r.createdAt) || !Number.isSafeInteger(r.updatedAt) || r.createdAt < 0 || r.updatedAt < r.createdAt) fail();
    ids.add(r.id); publicJSON(r.request); publicJSON(r.result);
    if (r.queryEvidence !== undefined) publicJSON(r.queryEvidence);
    if (binding(r) !== r.binding || (r.result === null ? r.resultDigest !== null : digest(r.result) !== r.resultDigest)) fail();
    if (['prepared', 'signing', 'cancelled'].includes(r.state) && r.result !== null || ['signed-unsubmitted', 'submitted-unconfirmed', 'included', 'failed'].includes(r.state) && r.result === null) fail();
    if (r.receipt !== null) validateReceipt(r.receipt, r.result?.txid);
    if (['included', 'failed'].includes(r.state) && r.receipt === null) fail();
  }
  return value;
}
function validateReceipt(receipt, txid) {
  exactObject(receipt, ['txid', 'blockHash', 'blockHeight', 'success', 'confirmationScope']);
  if (receipt.txid !== txid || !/^[0-9a-f]{64}$/.test(receipt.txid) || !/^[0-9a-f]{64}$/.test(receipt.blockHash) || typeof receipt.blockHeight !== 'string' || !/^(0|[1-9][0-9]*)$/.test(receipt.blockHeight) || typeof receipt.success !== 'boolean' || receipt.confirmationScope !== 'rpc-block-inclusion') fail();
}
export class FamilyCustody {
  #held = new Map();
  constructor({ filePath, file, verifyResult, now = Date.now }) {
    if (typeof verifyResult !== 'function') throw new Error('Family result verification is required');
    this.verifyResult = verifyResult; this.now = now;
    this.file = file ?? new AtomicMultiFile({ filePath, initial: { version: 1, records: [] }, validate, maxBytes: 5000000 });
  }
  async list() {
    const records = (await this.file.read()).records.map(r => ({ ...structuredClone(r), state: r.state === 'signing' ? 'unknown' : r.state }));
    for (const [id, held] of this.#held) {
      const index = records.findIndex(r => r.id === id);
      const record = { ...structuredClone(held.record), state: 'unknown', result: structuredClone(held.result), resultDigest: digest(held.result) };
      if (index < 0) records.push(record); else records[index] = record;
    }
    for (const r of records) if (r.result !== null) this.verifyResult(r, r.result);
    return records;
  }
  async reserve({ id, family, networkId, account, request, outpoints = [] }) {
    publicJSON(request);
    const record = { id, family, networkId, account, request: structuredClone(request), binding: null, outpoints: [...outpoints], state: 'prepared', result: null, resultDigest: null, receipt: null, queryEvidence: null, revision: 0, createdAt: this.now(), updatedAt: this.now() };
    record.binding = binding(record);
    validate({ version: 1, records: [record] });
    if (this.#held.size) fail();
    await this.file.mutate(value => {
      if (value.records.some(r => r.id === id || !terminal.has(r.state) && r.family === family && r.networkId === networkId && r.account === account || r.state !== 'cancelled' && r.family === 'bitcoin' && r.networkId === networkId && r.outpoints.some(p => outpoints.includes(p)))) fail();
      value.records.push(record); return value;
    });
    let live = true, begun = false, armed = false, captured = false;
    const change = async (expected, state, result = null) => this.file.mutate(value => {
      const r = value.records.find(r => r.id === id);
      if (!live || !r || r.binding !== record.binding || !expected.includes(r.state) || r.result !== null && digest(r.result) !== digest(result)) fail();
      if (result !== null) { publicJSON(result); this.verifyResult(record, result); }
      Object.assign(r, { state, result: structuredClone(result), resultDigest: result === null ? null : digest(result), receipt: null, revision: r.revision + 1, updatedAt: Math.max(r.updatedAt, this.now()) }); return value;
    });
    // This authority is returned only for a new reservation, never reconstructed
    // by reading a previous record. No restart or query creates signing authority.
    return Object.freeze({
      beginSigning: async () => {
        if (!live || begun) fail(); begun = true;
        await change(['prepared'], 'signing');
        armed = true;
      },
      capture: result => {
        if (!live || !armed || captured) fail(); publicJSON(result); this.verifyResult(record, result);
        captured = true; this.#held.set(id, { record, result: structuredClone(result) });
      },
      saveProduced: async () => {
        if (!captured || !this.#held.has(id)) fail();
        const held = this.#held.get(id);
        await change(['signing', 'unknown'], 'signed-unsubmitted', held.result);
        this.#held.delete(id);
      },
      markSubmissionStarted: async () => {
        if (!captured || this.#held.has(id)) fail();
        const r = (await this.file.read()).records.find(r => r.id === id);
        await change(['signed-unsubmitted'], 'submitted-unconfirmed', r?.result);
        // This records dispatch uncertainty only. It does NOT grant broadcast.
      },
      uncertain: async () => {
        if (!begun) fail(); const held = this.#held.get(id);
        const r = (await this.file.read()).records.find(r => r.id === id);
        await change(['signing', 'signed-unsubmitted', 'submitted-unconfirmed', 'unknown'], 'unknown', held?.result ?? r?.result ?? null);
        this.#held.delete(id);
      },
      cancelBeforeSigning: async () => { if (begun) fail(); await change(['prepared'], 'cancelled'); live = false; },
      retire: () => { live = false; }
    });
  }
  async check(id, query) {
    if (typeof query !== 'function' || this.#held.has(id)) fail();
    const record = (await this.list()).find(r => r.id === id);
    if (!record) fail();
    // A pre-sign cancellation is terminal. A lost result is not an invitation
    // to reconstruct it by signing: there is nothing reliable to query yet.
    if (record.state === 'cancelled' || record.result === null) return { ...record, queryable: false };
    this.verifyResult(record, record.result);
    let observation;
    try { observation = await query(structuredClone(record)); }
    catch (error) { observation = { networkId: record.networkId, txid: record.result.txid, state: 'unknown', receipt: null, evidence: {queryError: typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'FAMILY_QUERY_UNAVAILABLE'} }; }
    exactObject(observation, ['networkId', 'txid', 'state', 'receipt', 'evidence']);
    publicJSON(observation.evidence ?? null);
    if (observation.networkId !== record.networkId || observation.txid !== record.result.txid || !['unknown', 'submitted-unconfirmed', 'included', 'failed'].includes(observation.state)) fail();
    if (['included', 'failed'].includes(observation.state)) {
      validateReceipt(observation.receipt, record.result.txid);
      if (observation.receipt.success !== (observation.state === 'included')) fail();
    } else if (observation.receipt !== null) fail();
    await this.file.mutate(value => {
      const current = value.records.find(r => r.id === id);
      if (!current || current.binding !== record.binding || current.resultDigest !== record.resultDigest || current.revision !== record.revision || current.state !== record.state && !(current.state === 'signing' && record.state === 'unknown')) fail();
      Object.assign(current, { state: observation.state, receipt: observation.receipt, queryEvidence: structuredClone(observation.evidence ?? null), revision: current.revision + 1, updatedAt: Math.max(current.updatedAt, this.now()) }); return value;
    });
    return (await this.list()).find(r => r.id === id);
  }
}
