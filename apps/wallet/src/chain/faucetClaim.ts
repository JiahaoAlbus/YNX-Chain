import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import { FaucetAdmissionController, type FaucetAdmissionEntry, type FaucetAdmissionScope, type FaucetAdmissionTransport } from "./faucetAdmission";
import { createFaucetDurabilityEvidence, FAUCET_LEDGER_PROFILE, parseFaucetDurableReceipt } from "./faucetReceipt";
import { NATIVE_DURABILITY_MODEL, parseNativeDurabilityModel, parseNativeDurabilityState, type NativeDurabilityStatus } from "./nativeDurability";

type Guard = () => void;
export type FaucetReadMethod = "eth_chainId" | "ynx_getFaucetModel" | "ynx_getDurabilityModel" | "ynx_getTransactionDurability" | "eth_getTransactionReceipt";
/** A trusted, bounded native transport supplies already validated JSON-RPC
 * results. This interface does not enable fetch or choose a public endpoint. */
export type FaucetClaimRPC = Readonly<{ origin: string; request(method: FaucetReadMethod, params: readonly string[]): Promise<unknown> }>;
type Evidence = Readonly<Record<string, unknown>>;
type ReceiptRecord = Readonly<{ requestId: string; evidence: Evidence; completed: boolean }>;
type Scope = FaucetAdmissionScope & Readonly<{ chainOrigin: string }>;
type Journal = Readonly<{ version: 1; scope: Scope; revision: number; receipts: readonly ReceiptRecord[] }>;
export type FaucetClaimView = Readonly<{
  entry: FaucetAdmissionEntry | null;
  evidence: Evidence | null;
  verification: "unverified" | "stored-snapshot" | "fresh-read";
  observedStatus: NativeDurabilityStatus | null;
  completedRequestIds: readonly string[];
  consensusFinality: false;
  balanceVerified: false;
}>;
export class FaucetClaimError extends Error {
  constructor(readonly code: "FAUCET_CLAIM_STORAGE" | "FAUCET_CLAIM_PENDING" | "FAUCET_CLAIM_UNAVAILABLE" | "FAUCET_CLAIM_INVALID" | "FAUCET_CLAIM_NOT_DURABLE") {
    super(code === "FAUCET_CLAIM_STORAGE" ? "The original Faucet receipt could not be stored and verified. The request remains retained." :
      code === "FAUCET_CLAIM_PENDING" ? "Finish reviewing the original test YNXT request before starting another." :
      code === "FAUCET_CLAIM_UNAVAILABLE" ? "The native Faucet receipt transport is not available." :
      code === "FAUCET_CLAIM_NOT_DURABLE" ? "The original request has no freshly verified durable receipt yet." :
      "The Faucet receipt does not match its original request, chain or storage record.");
  }
}
const queues = new WeakMap<SecureStorageAdapter, Promise<unknown>>();
const MAX_JOURNAL = 131072;
export const FAUCET_REQUEST_MODEL = Object.freeze({
  version: "ynx-faucet-request-v1", chainId: "0x1917", requestIdPattern: "^[A-Za-z0-9_-]{32,128}$",
  transactionHashScheme: "sha256-nul-domain-decimal-chain-id-request-id",
  idempotencyScope: "retained-chain-transaction-history", legacyRequestSafeRetry: false,
  consensusFinality: false, durability: NATIVE_DURABILITY_MODEL,
});
function invalid(): never { throw new FaucetClaimError("FAUCET_CLAIM_INVALID"); }

/** One active claim is retained even after admission ACK. A fresh request is
 * permitted only after explicit completion with a freshly verified receipt.
 * Journal storage is separate from the admission marker: a failed receipt write
 * never deletes or rolls back that original marker. Native production wiring
 * and its HTTP byte/cancellation barriers remain separate release prerequisites.
 */
export class FaucetClaimController {
  readonly scope: Scope;
  private readonly admission: FaucetAdmissionController;
  private readonly journalKey: string;
  constructor(private readonly storage: SecureStorageAdapter, scope: FaucetAdmissionScope, chainOrigin: string,
    private readonly options: Readonly<{ rpc?: FaucetClaimRPC; transport?: FaucetAdmissionTransport; randomBytes?: (length: number) => Uint8Array }> = {}) {
    const origin = new URL(chainOrigin);
    if (origin.protocol !== "https:" || origin.origin !== chainOrigin || origin.port || origin.username || origin.password) invalid();
    this.admission = new FaucetAdmissionController(storage, scope, options);
    this.scope = Object.freeze({ ...this.admission.scope, chainOrigin });
    if (options.rpc && options.rpc.origin !== chainOrigin) invalid();
    this.journalKey = "ynx.wallet.faucet-receipts.v1." + bytesToHex(sha256(utf8ToBytes(JSON.stringify(this.scope))));
  }

  read(): Promise<FaucetClaimView> { return this.serial(async () => this.view(await this.load())); }

  prepare(amount: number, guard: Guard): Promise<FaucetClaimView> {
    return this.serial(async () => {
      guard(); const state = await this.load(); guard();
      const current = this.active(state);
      if (current) {
        if (current.amount !== amount) throw new FaucetClaimError("FAUCET_CLAIM_PENDING");
        return this.view(state);
      }
      // Completion records are historical local snapshots. A cold start, lost
      // completion response or changed node cannot turn them into current proof.
      const previous = state.entries.at(-1);
      if (previous && !(await this.observe(previous, guard)).evidence) throw new FaucetClaimError("FAUCET_CLAIM_NOT_DURABLE");
      await this.admission.prepare(amount, guard);
      const next = await this.load(); guard(); return this.view(next);
    });
  }

  submit(requestId: string, guard: Guard): Promise<FaucetClaimView> {
    return this.serial(async () => {
      guard(); const state = await this.load(); guard();
      const entry = this.requireActive(state, requestId);
      // ACK recovery is a read; do not demand another admission or create an ID.
      if (entry.acknowledgement) return this.view(state);
      await this.preflight(guard);
      await this.admission.submit(entry.requestId, guard, () => this.preflight(guard));
      const next = await this.load(); guard(); return this.view(next);
    });
  }

  check(requestId: string, guard: Guard): Promise<FaucetClaimView> {
    return this.serial(() => this.verify(requestId, guard, false));
  }

  complete(requestId: string, guard: Guard): Promise<FaucetClaimView> {
    // Completion re-reads chain evidence. A stored object or UI flag is not an
    // authorization to replace the original claim with a new request ID.
    return this.serial(() => this.verify(requestId, guard, true));
  }

  private async verify(requestId: string, guard: Guard, complete: boolean): Promise<FaucetClaimView> {
    guard(); const state = await this.load(); guard();
    // Allow explicit completion retry when its durable journal write succeeded
    // but the caller lost the result. Never revisit an older completed claim.
    const latest = state.entries.at(-1);
    const entry = complete && !this.active(state) && latest?.requestId === requestId ? latest : this.requireActive(state, requestId);
    const observed = await this.observe(entry, guard);
    if (!observed.evidence) {
      if (complete) throw new FaucetClaimError("FAUCET_CLAIM_NOT_DURABLE");
      return this.view(state, "unverified", observed.status);
    }
    const record = Object.freeze({ requestId, evidence: observed.evidence, completed: complete });
    const receipts = [...state.journal.receipts.filter(item => item.requestId !== requestId), record];
    const next = await this.save(state, receipts); guard();
    const fresh = await this.observe(entry, guard);
    if (!fresh.evidence) {
      if (complete) throw new FaucetClaimError("FAUCET_CLAIM_NOT_DURABLE");
      return this.view(next, "unverified", fresh.status);
    }
    return Object.freeze({ ...this.view(next, complete ? "unverified" : "fresh-read", complete ? null : "durable"),
      evidence: complete ? null : fresh.evidence });
  }

  private async observe(entry: FaucetAdmissionEntry, guard: Guard): Promise<{ status: NativeDurabilityStatus; evidence: Evidence | null }> {
    if (!entry.acknowledgement) throw new FaucetClaimError("FAUCET_CLAIM_NOT_DURABLE");
    await this.preflight(guard);
    const observed = parseNativeDurabilityState(await this.rpc("ynx_getTransactionDurability", [entry.transactionHash], guard), entry.transactionHash);
    if (observed.status !== "durable") { await this.preflight(guard); return { status: observed.status, evidence: null }; }
    const receipt = parseFaucetDurableReceipt(await this.rpc("eth_getTransactionReceipt", [entry.transactionHash], guard), entry.acknowledgement.transaction);
    if (receipt.blockNumber !== observed.blockNumber || receipt.blockHash !== observed.blockHash) invalid();
    // Independent checkpoints may advance, but both proofs bind the same block.
    await this.preflight(guard);
    return { status: "durable", evidence: createFaucetDurabilityEvidence(this.scope.chainOrigin, NATIVE_DURABILITY_MODEL, receipt, entry.acknowledgement.transaction) };
  }

  private async rpc(method: FaucetReadMethod, params: readonly string[], guard: Guard): Promise<unknown> {
    guard(); const rpc = this.options.rpc;
    if (!rpc || rpc.origin !== this.scope.chainOrigin) throw new FaucetClaimError("FAUCET_CLAIM_UNAVAILABLE");
    const value = await rpc.request(method, Object.freeze([...params])); guard();
    if (rpc.origin !== this.scope.chainOrigin) invalid();
    return value;
  }
  private async preflight(guard: Guard): Promise<void> {
    if (await this.rpc("eth_chainId", [], guard) !== this.scope.chainId) invalid();
    const model = exact(await this.rpc("ynx_getFaucetModel", [], guard), Object.keys(FAUCET_REQUEST_MODEL));
    for (const [key, value] of Object.entries(FAUCET_REQUEST_MODEL)) {
      if (key === "durability") parseNativeDurabilityModel(model[key]);
      else if (model[key] !== value) invalid();
    }
    parseNativeDurabilityModel(await this.rpc("ynx_getDurabilityModel", [], guard));
    if (await this.rpc("eth_chainId", [], guard) !== this.scope.chainId) invalid();
  }

  private async load() {
    try {
      const entries = await this.admission.read(), raw = await this.storage.getItem(this.journalKey);
      if (raw !== null && (typeof raw !== "string" || raw.length > MAX_JOURNAL || utf8ToBytes(raw).length > MAX_JOURNAL)) invalid();
      const journal = this.parseJournal(raw === null ? { version: 1, scope: this.scope, revision: 0, receipts: [] } : JSON.parse(raw), entries);
      const state = { entries, raw, journal }; this.active(state); return state;
    } catch { throw new FaucetClaimError("FAUCET_CLAIM_STORAGE"); }
  }
  private async save(state: Awaited<ReturnType<FaucetClaimController["load"]>>, receipts: readonly ReceiptRecord[]) {
    try {
      const journal = this.parseJournal({ ...state.journal, revision: state.journal.revision + 1, receipts }, state.entries);
      const raw = JSON.stringify(journal);
      if (raw.length > MAX_JOURNAL || utf8ToBytes(raw).length > MAX_JOURNAL || await this.storage.getItem(this.journalKey) !== state.raw) invalid();
      await this.storage.setItem(this.journalKey, raw);
      if (await this.storage.getItem(this.journalKey) !== raw) invalid();
      return { ...state, raw, journal: this.parseJournal(JSON.parse(raw), state.entries) };
    } catch { throw new FaucetClaimError("FAUCET_CLAIM_STORAGE"); }
  }
  private parseJournal(input: unknown, entries: readonly FaucetAdmissionEntry[]): Journal {
    const journal = exact(input, ["version", "scope", "revision", "receipts"]);
    const scope = exact(journal.scope, ["authority", "chainId", "recipient", "chainOrigin"]);
    if (Object.keys(this.scope).some(key => scope[key] !== this.scope[key as keyof Scope]) || journal.version !== 1 ||
        !Number.isSafeInteger(journal.revision) || journal.revision < 0 || !Array.isArray(journal.receipts) || journal.receipts.length > 32) invalid();
    const receipts = journal.receipts.map((input: unknown): ReceiptRecord => {
      const item = exact(input, ["requestId", "evidence", "completed"]);
      if (typeof item.requestId !== "string" || typeof item.completed !== "boolean") invalid();
      const entry = entries.find(entry => entry.requestId === item.requestId);
      if (!entry?.acknowledgement) invalid();
      const evidence = exact(item.evidence, ["version", "profile", "origin", "chainId", "capability", "receipt"]);
      if (evidence.version !== 1 || evidence.profile !== FAUCET_LEDGER_PROFILE || evidence.origin !== this.scope.chainOrigin || evidence.chainId !== this.scope.chainId) invalid();
      return Object.freeze({ requestId: item.requestId, completed: item.completed,
        evidence: createFaucetDurabilityEvidence(this.scope.chainOrigin, evidence.capability, evidence.receipt, entry.acknowledgement.transaction) });
    });
    if (new Set(receipts.map((item: ReceiptRecord) => item.requestId)).size !== receipts.length) invalid();
    return Object.freeze({ version: 1, scope: this.scope, revision: journal.revision, receipts: Object.freeze(receipts) });
  }
  private active(state: { entries: readonly FaucetAdmissionEntry[]; journal: Journal }): FaucetAdmissionEntry | null {
    const completed = new Set(state.journal.receipts.filter(item => item.completed).map(item => item.requestId));
    const remaining = state.entries.filter(entry => !completed.has(entry.requestId));
    if (remaining.length > 1) throw new FaucetClaimError("FAUCET_CLAIM_PENDING");
    return remaining[0] ?? null;
  }
  private requireActive(state: { entries: readonly FaucetAdmissionEntry[]; journal: Journal }, requestId: string): FaucetAdmissionEntry {
    const entry = this.active(state); if (!entry || entry.requestId !== requestId) invalid(); return entry;
  }
  private view(state: { entries: readonly FaucetAdmissionEntry[]; journal: Journal }, verification?: FaucetClaimView["verification"], observedStatus: NativeDurabilityStatus | null = null): FaucetClaimView {
    const entry = this.active(state), evidence = state.journal.receipts.find(item => item.requestId === entry?.requestId)?.evidence ?? null;
    return Object.freeze({ entry, evidence, verification: verification ?? (evidence ? "stored-snapshot" : "unverified"), observedStatus,
      completedRequestIds: Object.freeze(state.journal.receipts.filter(item => item.completed).map(item => item.requestId)), consensusFinality: false, balanceVerified: false });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.storage) ?? Promise.resolve()).catch(() => {}).then(work); queues.set(this.storage, next); return next;
  }
}

function exact(input: unknown, fields: readonly string[]): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Reflect.ownKeys(input).length !== fields.length) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
  }
  return input as Record<string, any>;
}
