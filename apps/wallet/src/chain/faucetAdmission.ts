import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { evmAddressFromYNX, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import { bindFaucetTransaction, type FaucetTransactionBinding } from "./faucetReceipt";

export const FAUCET_ADMISSION_VERSION = "ynx-faucet-request-v1";
export const FAUCET_ADMISSION_CHAIN = "0x1917";
export const FAUCET_ADMISSION_LIMIT = 32;
const PREFIX = "ynx.wallet.faucet-admission.v1.";
const MAX_STORAGE = 65536, MAX_RESPONSE = 16384;
const queues = new WeakMap<SecureStorageAdapter, Promise<unknown>>();
type Guard = () => void;
type Phase = "prepared" | "unknown" | "admission-acknowledged";
export type FaucetAdmissionScope = Readonly<{ authority: string; chainId: typeof FAUCET_ADMISSION_CHAIN; recipient: string }>;
export type FaucetAdmissionAcknowledgement = Readonly<{
  requestId: string; transactionHash: string; address: string; amount: number;
  transaction: FaucetTransactionBinding; replayed: boolean; httpStatus: 200 | 201;
}>;
export type FaucetAdmissionEntry = Readonly<{
  requestId: string; body: string; transactionHash: string; amount: number;
  phase: Phase; attempts: number; lastResult: string | null;
  acknowledgement: FaucetAdmissionAcknowledgement | null;
}>;
type Envelope = Readonly<{ version: 1; scope: FaucetAdmissionScope; revision: number; entries: readonly FaucetAdmissionEntry[] }>;
/** The trusted Native host supplies this adapter only after a coordinated release.
 * It must perform pinned HTTPS, refuse redirects and bound the response stream
 * before allocation. These metadata are an adapter contract, not UI attestations.
 * No production Fetch adapter or public endpoint is enabled by this module. */
export type FaucetAdmissionTransport = (request: Readonly<{ url: string; method: "POST"; body: string; requestId: string }>) => Promise<Readonly<{
  url: string; redirected: boolean; status: number; contentType: string; cacheControl: string; body: string;
}>>;
export class FaucetAdmissionError extends Error {
  constructor(readonly code: "FAUCET_ADMISSION_INVALID" | "FAUCET_ADMISSION_STORAGE" | "FAUCET_ADMISSION_PENDING" | "FAUCET_ADMISSION_CAPACITY" | "FAUCET_ADMISSION_UNAVAILABLE") {
    super(code === "FAUCET_ADMISSION_PENDING" ? "Review the original test YNXT request before starting another request." :
      code === "FAUCET_ADMISSION_CAPACITY" ? "The retained Faucet request history is full. Existing requests remain available." :
      code === "FAUCET_ADMISSION_UNAVAILABLE" ? "Durable Faucet requests are not enabled in this Wallet." :
      code === "FAUCET_ADMISSION_STORAGE" ? "The original Faucet request could not be stored and verified. Sending is paused." :
      "The Faucet request does not match its original recipient, amount or receipt.");
  }
}

/** Exact Go hashParts vector from Core90643ffd: SHA256 of each UTF-8 part
 * followed by NUL, including the FINAL NUL. Amount/recipient bind in history,
 * not this hash; a matching hash alone is never an acknowledgement. */
export function faucetAdmissionHash(requestId: string): string {
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(requestId)) invalid();
  return "0x" + bytesToHex(sha256(utf8ToBytes(`${FAUCET_ADMISSION_VERSION}\0${6423}\0${requestId}\0`)));
}

/** One shared storage adapter instance serializes all controller operations in
 * this process. Exact prewrite comparison/readback detects ordinary interference;
 * this is NOT a cross-process atomic compare-and-swap. A future host must use one
 * writer/adapter instance or a real platform lock for its full storage transaction.
 * Public request/receipt history is retained; no secret, nonce lookup or signing.
 */
export class FaucetAdmissionController {
  readonly scope: FaucetAdmissionScope;
  private readonly storageKey: string;
  private readonly url: string;
  constructor(private readonly storage: SecureStorageAdapter, scope: FaucetAdmissionScope,
    private readonly options: Readonly<{ transport?: FaucetAdmissionTransport; randomBytes?: (length: number) => Uint8Array }> = {}) {
    this.scope = parseScope(scope);
    this.url = this.scope.authority + "/request";
    this.storageKey = PREFIX + bytesToHex(sha256(utf8ToBytes(JSON.stringify(this.scope))));
  }
  read(): Promise<readonly FaucetAdmissionEntry[]> { return this.serial(async () => (await this.load()).value.entries); }

  /** Call only for an explicit reviewed user intent. Concurrent duplicate prepare
   * calls reuse the outstanding body; a changed amount cannot replace it. */
  prepare(amount: number, assertCurrent: Guard): Promise<FaucetAdmissionEntry> {
    wholeAmount(amount);
    return this.serial(async () => {
      assertCurrent(); const loaded = await this.load(); assertCurrent();
      const pending = loaded.value.entries.find(entry => entry.phase !== "admission-acknowledged");
      if (pending) { if (pending.amount !== amount) throw new FaucetAdmissionError("FAUCET_ADMISSION_PENDING"); return pending; }
      if (loaded.value.entries.length >= FAUCET_ADMISSION_LIMIT) throw new FaucetAdmissionError("FAUCET_ADMISSION_CAPACITY");
      const random = this.options.randomBytes ? this.options.randomBytes(32) : globalThis.crypto?.getRandomValues(new Uint8Array(32));
      if (!(random instanceof Uint8Array) || random.length !== 32) invalid();
      const requestId = "wallet_" + bytesToHex(random);
      if (loaded.value.entries.some(entry => entry.requestId === requestId)) invalid();
      const entry = parseEntry({ requestId, amount, body: canonicalBody(requestId, this.scope.recipient, amount),
        transactionHash: faucetAdmissionHash(requestId), phase: "prepared", attempts: 0, lastResult: null, acknowledgement: null }, this.scope);
      await this.save(loaded, [...loaded.value.entries, entry]); assertCurrent(); return entry;
    });
  }

  /** Explicit original-ID retry only. There is no timer, replacement ID or reset.
   * Once dispatch may have started, a late result is archived to its original scope
   * before checking the UI lease. A cancelled screen never receives that result. */
  submit(requestId: string, assertCurrent: Guard): Promise<FaucetAdmissionEntry> {
    faucetAdmissionHash(requestId);
    return this.serial(async () => {
      assertCurrent(); let loaded = await this.load(); assertCurrent();
      let entry = loaded.value.entries.find(item => item.requestId === requestId); if (!entry) invalid();
      if (entry.phase === "admission-acknowledged") return entry;
      if (!this.options.transport) throw new FaucetAdmissionError("FAUCET_ADMISSION_UNAVAILABLE");
      if (entry.attempts >= 1000000) throw new FaucetAdmissionError("FAUCET_ADMISSION_CAPACITY");
      entry = parseEntry({ ...entry, phase: "unknown", attempts: entry.attempts + 1, lastResult: "dispatch-unknown" }, this.scope);
      loaded = await this.replace(loaded, entry); assertCurrent();
      let next = entry;
      try {
        const response = await this.options.transport(Object.freeze({ url: this.url, method: "POST", body: entry.body, requestId }));
        next = this.observe(entry, response);
      } catch { next = parseEntry({ ...entry, lastResult: "transport-unknown" }, this.scope); }
      // The first dispatch marker remains if outcome persistence/readback fails.
      // Preserve the latest durable write; never restore an older envelope.
      await this.replace(loaded, next); assertCurrent(); return next;
    });
  }
  private observe(entry: FaucetAdmissionEntry, response: Awaited<ReturnType<FaucetAdmissionTransport>>): FaucetAdmissionEntry {
    try {
      const meta = record(response, ["url", "redirected", "status", "contentType", "cacheControl", "body"]);
      if (meta.url !== this.url || meta.redirected !== false || !Number.isInteger(meta.status) ||
        typeof meta.contentType !== "string" || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(meta.contentType) ||
        meta.cacheControl !== "no-store" || typeof meta.body !== "string" || meta.body.length > MAX_RESPONSE || utf8ToBytes(meta.body).length > MAX_RESPONSE) invalid();
      const body = record(JSON.parse(meta.body));
      if (body.requestId !== entry.requestId || body.transactionHash !== entry.transactionHash) invalid();
      if (meta.status === 200 || meta.status === 201) {
        keys(body, ["transaction", "address", "amount", "nativeSymbol", "requestId", "truthfulStatus", "transactionHash", "status"], ["replayed", "retrySameRequest"]);
        if (body.address !== evmAddressFromYNX(this.scope.recipient) || body.amount !== entry.amount || body.nativeSymbol !== "YNXT" ||
          body.status !== "accepted" || body.truthfulStatus !== "rpc-backed-faucet" ||
          (meta.status === 200 ? body.replayed !== true : body.replayed !== undefined && body.replayed !== false) ||
          (body.retrySameRequest !== undefined && body.retrySameRequest !== false)) invalid();
        const acknowledgement = parseAcknowledgement({ requestId: body.requestId, transactionHash: body.transactionHash,
          address: body.address, amount: body.amount, transaction: bindFaucetTransaction(body.transaction, body.address, entry.amount), replayed: body.replayed === true, httpStatus: meta.status }, entry, this.scope);
        return parseEntry({ ...entry, phase: "admission-acknowledged", lastResult: "admission-acknowledged", acknowledgement }, this.scope);
      }
      keys(body, ["error", "requestId", "transactionHash", "status", "retrySameRequest"]);
      if (typeof body.error !== "string" || body.error.length > 512 || typeof body.retrySameRequest !== "boolean") invalid();
      const valid = meta.status === 409 && body.status === "request_id_conflict" && body.retrySameRequest === false ||
        meta.status === 429 && body.status === "rate_limited" && body.retrySameRequest === true ||
        meta.status === 503 && ["upstream_capability_unavailable", "admission_unavailable", "transaction_result_uncertain", "receipt_persistence_uncertain", "stored_receipt_invalid"].includes(body.status) &&
          (body.retrySameRequest === true || body.status === "stored_receipt_invalid");
      if (!valid) invalid();
      return parseEntry({ ...entry, lastResult: body.status }, this.scope);
    } catch { return parseEntry({ ...entry, lastResult: "invalid-response" }, this.scope); }
  }
  private async load(): Promise<{ raw: string | null; value: Envelope }> {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (raw === null) return { raw, value: freeze({ version: 1 as const, scope: this.scope, revision: 0, entries: [] }) };
      if (typeof raw !== "string" || raw.length > MAX_STORAGE) invalid();
      return { raw, value: parseEnvelope(JSON.parse(raw), this.scope) };
    } catch { throw new FaucetAdmissionError("FAUCET_ADMISSION_STORAGE"); }
  }
  private async replace(loaded: { raw: string | null; value: Envelope }, entry: FaucetAdmissionEntry) {
    return this.save(loaded, loaded.value.entries.map(item => item.requestId === entry.requestId ? entry : item));
  }
  private async save(loaded: { raw: string | null; value: Envelope }, entries: readonly FaucetAdmissionEntry[]) {
    try {
      const value = parseEnvelope({ ...loaded.value, revision: loaded.value.revision + 1, entries }, this.scope), raw = JSON.stringify(value);
      if (raw.length > MAX_STORAGE || await this.storage.getItem(this.storageKey) !== loaded.raw) invalid();
      await this.storage.setItem(this.storageKey, raw);
      const readback = await this.storage.getItem(this.storageKey);
      if (readback !== raw) invalid();
      parseEnvelope(JSON.parse(readback), this.scope); return { raw, value };
    } catch { throw new FaucetAdmissionError("FAUCET_ADMISSION_STORAGE"); }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.storage) ?? Promise.resolve()).catch(() => {}).then(work); queues.set(this.storage, next); return next;
  }
}

function parseScope(input: unknown): FaucetAdmissionScope {
  const value = record(input, ["authority", "chainId", "recipient"]);
  if (typeof value.authority !== "string" || value.chainId !== FAUCET_ADMISSION_CHAIN || typeof value.recipient !== "string") invalid();
  const url = new URL(value.authority);
  if (url.protocol !== "https:" || url.origin !== value.authority || url.port || url.username || url.password ||
    ynxAddressFromEVM(evmAddressFromYNX(value.recipient)) !== value.recipient) invalid();
  return Object.freeze({ authority: value.authority, chainId: FAUCET_ADMISSION_CHAIN, recipient: value.recipient });
}
function canonicalBody(requestId: string, recipient: string, amount: number): string { return JSON.stringify({ requestId, address: recipient, amount }); }
function wholeAmount(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(); }
function parseAcknowledgement(input: unknown, entry: Pick<FaucetAdmissionEntry, "requestId" | "transactionHash" | "amount">, scope: FaucetAdmissionScope): FaucetAdmissionAcknowledgement {
  const value = record(input, ["requestId", "transactionHash", "address", "amount", "transaction", "replayed", "httpStatus"]);
  if (value.requestId !== entry.requestId || value.transactionHash !== entry.transactionHash || value.address !== evmAddressFromYNX(scope.recipient) || value.amount !== entry.amount ||
    !(value.httpStatus === 200 && value.replayed === true || value.httpStatus === 201 && value.replayed === false)) invalid();
  const transaction = bindFaucetTransaction(record(value.transaction, ["hash", "type", "from", "to", "amount", "fee", "nonce"]), value.address, entry.amount);
  if (transaction.hash !== entry.transactionHash) invalid();
  return freeze({ requestId: value.requestId, transactionHash: value.transactionHash, address: value.address, amount: value.amount, transaction, replayed: value.replayed, httpStatus: value.httpStatus });
}
function parseEntry(input: unknown, scope: FaucetAdmissionScope): FaucetAdmissionEntry {
  const value = record(input, ["requestId", "body", "transactionHash", "amount", "phase", "attempts", "lastResult", "acknowledgement"]);
  wholeAmount(value.amount);
  if (faucetAdmissionHash(value.requestId) !== value.transactionHash || value.body !== canonicalBody(value.requestId, scope.recipient, value.amount) ||
    !["prepared", "unknown", "admission-acknowledged"].includes(value.phase) || !Number.isSafeInteger(value.attempts) || value.attempts < 0 || value.attempts > 1000000 ||
    !(value.lastResult === null || ["dispatch-unknown", "transport-unknown", "invalid-response", "upstream_capability_unavailable", "admission_unavailable", "transaction_result_uncertain", "receipt_persistence_uncertain", "stored_receipt_invalid", "request_id_conflict", "rate_limited", "admission-acknowledged"].includes(value.lastResult))) invalid();
  if (value.phase === "prepared" ? value.attempts !== 0 || value.lastResult !== null || value.acknowledgement !== null : value.attempts < 1 || value.lastResult === null) invalid();
  let acknowledgement = null;
  if (value.phase === "admission-acknowledged") { if (value.lastResult !== "admission-acknowledged") invalid(); acknowledgement = parseAcknowledgement(value.acknowledgement, value as FaucetAdmissionEntry, scope); }
  else if (value.acknowledgement !== null || value.lastResult === "admission-acknowledged") invalid();
  return freeze({ requestId: value.requestId, body: value.body, transactionHash: value.transactionHash, amount: value.amount, phase: value.phase, attempts: value.attempts, lastResult: value.lastResult, acknowledgement });
}
function parseEnvelope(input: unknown, scope: FaucetAdmissionScope): Envelope {
  const value = record(input, ["version", "scope", "revision", "entries"]);
  if (value.version !== 1 || JSON.stringify(parseScope(value.scope)) !== JSON.stringify(scope) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.entries) || value.entries.length > FAUCET_ADMISSION_LIMIT) invalid();
  const entries: FaucetAdmissionEntry[] = value.entries.map((entry: unknown) => parseEntry(entry, scope));
  if (new Set(entries.map(entry => entry.requestId)).size !== entries.length || entries.filter(entry => entry.phase !== "admission-acknowledged").length > 1) invalid();
  return freeze({ version: 1 as const, scope, revision: value.revision, entries });
}
function record(input: unknown, required?: readonly string[]): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  for (const key of Reflect.ownKeys(input)) if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value")) invalid();
  if (required) keys(input as Record<string, any>, required);
  return input as Record<string, any>;
}
function keys(value: Record<string, any>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function invalid(): never { throw new FaucetAdmissionError("FAUCET_ADMISSION_INVALID"); }
