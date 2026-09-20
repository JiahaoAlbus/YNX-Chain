import {
  canonicalJSON, createFinanceOrderApprovalReturnURL, createSignedFinanceOrderApproval,
  createSignedFinanceOrderApprovalRevocation, digestHex, financeOrderApprovalDigest,
  parseFinanceOrderApprovalRequest, parseFinanceOrderApprovalReturnURL,
  parseFinanceOrderApprovalWalletURL, parseSignedFinanceOrderApproval,
  parseSignedFinanceOrderApprovalRevocation, verifySignedFinanceOrderApproval,
  verifySignedFinanceOrderApprovalRevocation, walletIdentity,
} from "@ynx-chain/wallet-auth";
import type { FinanceOrderApprovalRequest, SignedFinanceOrderApproval, SignedFinanceOrderApprovalRevocation } from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";
import { PRODUCT_SESSION_REGISTRY } from "./registry";

export type FinanceOrderApprovalReview = Readonly<{
  id: string; request: FinanceOrderApprovalRequest; account: WalletAccount;
  decision: "pending" | "approved" | "rejected" | "revoked";
}>;
type Dependencies = {
  storage: SecureStorageAdapter;
  selectedAccount: () => WalletAccount | null;
  withAccountSecret: <T>(account: string, assertCurrent: () => void, use: (secret: string, assertKeyCurrent: () => void) => T | Promise<T>) => Promise<T>;
  currentTime: (assertCurrent: () => void) => Promise<Date>;
  openURL: (url: string) => Promise<unknown>;
};
type Status = "reserved" | "approved" | "rejected" | "revoked";
type RecordRow = {
  digest: string; requestId: string; callbackStateHash: string; nonceHash: string; challengeHash: string; orderHash: string;
  request: FinanceOrderApprovalRequest; status: Status; approval: SignedFinanceOrderApproval | null;
  revocation: SignedFinanceOrderApprovalRevocation | null; returnURL: string | null;
};
type Pending = { review: FinanceOrderApprovalReview; returnURL: string | null; status: "pending" | "approved" | "rejected" | "revoked" };

export const FINANCE_ORDER_APPROVAL_REPLAY_KEY = "ynx.wallet.finance-order-approval-v1.replay";
const MAX_RECORDS = 128, MAX_JOURNAL_CHARS = 1024 * 1024;
// React Native has one Wallet JS runtime, while multiple adapter wrappers can
// still address the same native secure store. Serialize the journal globally
// so object identity cannot split one replay domain.
let journalQueue: Promise<unknown> = Promise.resolve();
let journalUncertain = false;

export class FinanceOrderApprovalController {
  private pending: Pending | null = null;
  private generation = 0;
  private busy = false;
  constructor(private readonly dependencies: Dependencies) { if (typeof dependencies.currentTime !== "function") throw new Error("Finance order approval requires authenticated authority time"); }
  get current(): FinanceOrderApprovalReview | null { return this.pending?.review ?? null; }
  hasReturn(id: string): boolean { return this.pending?.review.id === id && this.pending.returnURL !== null; }
  canRevoke(id: string): boolean { return this.pending?.review.id === id && this.pending.status === "approved"; }

  /** Uses the authenticated authority clock. Device wall time may schedule this
   * check, but never decides whether signing remains available. */
  async isExpired(id: string): Promise<boolean> {
    const pending = this.requirePending(id), generation = this.generation;
    this.check(pending, generation);
    const at = await this.time(() => this.check(pending, generation));
    this.check(pending, generation);
    return at.getTime() >= Date.parse(pending.review.request.unsigned.expiresAt);
  }

  async receive(url: string): Promise<FinanceOrderApprovalReview> {
    return this.exclusive(async () => {
      this.healthy(); const generation = this.generation;
      const at = await this.time(() => this.assertGeneration(generation));
      const request = parseFinanceOrderApprovalWalletURL(url, at);
      const id = financeOrderApprovalDigest(request.unsigned);
      const selectedValue = this.dependencies.selectedAccount(), selected = selectedValue ? Object.freeze({ ...selectedValue }) : null;
      if (!selected || selected.account !== request.unsigned.account || selected.accountPublicKey !== request.unsigned.accountPublicKey) throw new Error("Select the exact Wallet account named by this Finance order approval before reviewing it");
      if (this.pending?.review.id === id) { this.check(this.pending, generation); return this.pending.review; }
      if (this.pending) throw new Error("Finish the current Finance order approval before opening another Wallet request");
      const records = await this.readRecords(at); this.assertGeneration(generation); this.assertAccount(selected);
      const same = records.find(row => row.digest === id);
      if (same?.status === "reserved") throw new Error("This Finance order approval has an uncertain signing result; Wallet will not sign it again");
      if (!same) this.assertUnused(records, this.row(request, id));
      const decision = same?.status ?? "pending";
      const review = Object.freeze({ id, request, account: selected, decision: decision as FinanceOrderApprovalReview["decision"] });
      this.pending = { review, returnURL: same?.returnURL ?? null, status: decision as Pending["status"] };
      return review;
    });
  }

  cancel(): void { this.generation++; this.pending = null; }

  async approve(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id), generation = this.generation; this.checkPending(pending, generation);
      if (!pending.review.account.backupConfirmed) throw new Error("Confirm this account's backup before signing a Finance order approval");
      const preflight = await this.time(() => this.checkPending(pending, generation));
      parseFinanceOrderApprovalRequest(pending.review.request, preflight);
      const records = await this.readRecords(preflight); this.checkPending(pending, generation); this.assertUnused(records, this.row(pending.review.request, id));
      if (records.length >= MAX_RECORDS) throw new Error("Finance order approval replay journal is full; wait for existing approvals to expire");
      await this.dependencies.withAccountSecret(pending.review.account.account, () => this.checkPending(pending, generation), async (secret, assertKeyCurrent) => {
        const guard = () => { assertKeyCurrent(); this.checkPending(pending, generation); };
        guard(); const identity = walletIdentity(secret);
        if (identity.account !== pending.review.account.account || identity.accountPublicKey !== pending.review.account.accountPublicKey) throw new Error("Stored signing account does not match the reviewed Finance order account");
        const at = await this.time(guard); guard(); parseFinanceOrderApprovalRequest(pending.review.request, at);
        await this.mutate(async () => {
          guard(); const current = await this.readRecords(at); guard(); this.assertUnused(current, this.row(pending.review.request, id));
          const row = this.row(pending.review.request, id);
          await this.writeRecords([...current, row]); guard();
          const signingAt = await this.time(guard); guard(); parseFinanceOrderApprovalRequest(pending.review.request, signingAt);
          const approval = createSignedFinanceOrderApproval({ accountSecret: secret, approval: pending.review.request.unsigned }, signingAt); guard();
          verifySignedFinanceOrderApproval(approval, pending.review.request.unsigned, signingAt);
          const returnURL = createFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, pending.review.request, { status: "approved", approval }, signingAt);
          parseFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, returnURL, pending.review.request, signingAt); guard();
          await this.writeRecords([...current, { ...row, status: "approved", approval, returnURL }]); guard(); pending.status = "approved"; pending.returnURL = returnURL;
        });
      });
      await this.deliver(pending, generation);
    });
  }

  async reject(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id), generation = this.generation; this.checkPending(pending, generation);
      const at = await this.time(() => this.checkPending(pending, generation)); parseFinanceOrderApprovalRequest(pending.review.request, at);
      await this.mutate(async () => {
        this.checkPending(pending, generation); const records = await this.readRecords(at); this.checkPending(pending, generation);
        this.assertUnused(records, this.row(pending.review.request, id));
        if (records.length >= MAX_RECORDS) throw new Error("Finance order approval replay journal is full; wait for existing approvals to expire");
        const returnURL = createFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, pending.review.request, { status: "rejected", reason: "USER_REJECTED" }, at);
        pending.status = "rejected"; const row = { ...this.row(pending.review.request, id), status: "rejected" as const, returnURL };
        await this.writeRecords([...records, row]); this.check(pending, generation); pending.returnURL = returnURL;
      });
      await this.deliver(pending, generation);
    });
  }

  async revokeUnused(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id), generation = this.generation;
      if (pending.status !== "approved") throw new Error("Only an approved, unexpired Finance proof can be revoked before Finance consumes it");
      this.check(pending, generation);
      await this.dependencies.withAccountSecret(pending.review.account.account, () => this.check(pending, generation), async (secret, assertKeyCurrent) => {
        const guard = () => { assertKeyCurrent(); this.check(pending, generation); };
        guard(); const identity = walletIdentity(secret);
        if (identity.account !== pending.review.account.account || identity.accountPublicKey !== pending.review.account.accountPublicKey) throw new Error("Stored signing account does not match the reviewed Finance order account");
        const at = await this.time(guard); guard(); parseFinanceOrderApprovalRequest(pending.review.request, at);
        await this.mutate(async () => {
          guard(); const records = await this.readRecords(at); guard();
          const index = records.findIndex(row => row.digest === id), existing = records[index];
          if (!existing || existing.status !== "approved" || !existing.approval || !existing.returnURL) throw new Error("Finance approval is no longer locally eligible for unused-proof revocation");
          const signingAt = await this.time(guard); guard(); parseFinanceOrderApprovalRequest(pending.review.request, signingAt);
          const revocation = createSignedFinanceOrderApprovalRevocation({ accountSecret: secret, approval: existing.approval }, signingAt); guard();
          verifySignedFinanceOrderApprovalRevocation(revocation, existing.approval, pending.review.request.unsigned, signingAt);
          const returnURL = createFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, pending.review.request, { status: "revoked", approval: existing.approval, revocation }, signingAt);
          parseFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, returnURL, pending.review.request, signingAt, existing.approval); guard();
          const next = [...records]; next[index] = { ...existing, status: "revoked", revocation, returnURL };
          await this.writeRecords(next); guard(); pending.status = "revoked"; pending.returnURL = returnURL;
        });
      });
      await this.deliver(pending, generation);
    });
  }

  async retryReturn(id: string): Promise<void> {
    return this.exclusive(async () => { const pending = this.requirePending(id); if (!pending.returnURL) throw new Error("No persisted Finance order approval result is available to return"); await this.deliver(pending, this.generation); });
  }

  private async deliver(pending: Pending, generation: number): Promise<void> {
    this.check(pending, generation); const at = await this.time(() => this.check(pending, generation)); parseFinanceOrderApprovalRequest(pending.review.request, at);
    const records = await this.readRecords(at); this.check(pending, generation);
    const row = records.find(item => item.digest === pending.review.id);
    if (!row?.returnURL || row.returnURL !== pending.returnURL) throw new Error("Persisted Finance order approval result is unavailable or changed");
    parseFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, row.returnURL, row.request, at, row.approval);
    this.check(pending, generation); await this.dependencies.openURL(row.returnURL);
    if (this.pending === pending) this.pending = null;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> { if (this.busy) throw new Error("A Finance order approval action is already in progress"); this.busy = true; try { return await operation(); } finally { this.busy = false; } }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> { const next = journalQueue.catch(() => {}).then(() => { this.healthy(); return operation(); }); journalQueue = next; return await next; }
  private requirePending(id: string): Pending { if (!this.pending || this.pending.review.id !== id) throw new Error("Finance order approval review is no longer active"); return this.pending; }
  private async time(assertCurrent: () => void): Promise<Date> { assertCurrent(); const value = await this.dependencies.currentTime(assertCurrent); assertCurrent(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Finance authority time is unavailable"); return new Date(value.getTime()); }
  private healthy(): void { if (journalUncertain) throw new Error("Finance order approval storage result is uncertain; restart Wallet before continuing"); }
  private assertGeneration(generation: number): void { this.healthy(); if (generation !== this.generation) throw new Error("Finance order approval was cancelled; review a new request"); }
  private assertAccount(account: WalletAccount): void { const current = this.dependencies.selectedAccount(); if (!current || current.account !== account.account || current.accountPublicKey !== account.accountPublicKey || current.backupConfirmed !== account.backupConfirmed) throw new Error("Selected Wallet account changed during Finance order approval review"); }
  private check(pending: Pending, generation: number): void { this.assertGeneration(generation); if (this.pending !== pending) throw new Error("Finance order approval review was replaced"); this.assertAccount(pending.review.account); }
  private checkPending(pending: Pending, generation: number): void { this.check(pending, generation); if (pending.status !== "pending") throw new Error("Finance order approval already has a local decision; only return or revoke the persisted result"); }
  private row(request: FinanceOrderApprovalRequest, digest: string): RecordRow { const value = request.unsigned; return { digest, requestId: value.requestId, callbackStateHash: value.callbackStateHash, nonceHash: digestHex("YNX_FINANCE_ORDER_APPROVAL_NONCE_V1", { account: value.account, nonce: value.nonce }), challengeHash: digestHex("YNX_FINANCE_ORDER_APPROVAL_CHALLENGE_V1", { account: value.account, challengeId: value.challengeId }), orderHash: value.orderHash, request, status: "reserved", approval: null, revocation: null, returnURL: null }; }
  private assertUnused(records: RecordRow[], candidate: RecordRow): void { if (records.some(row => row.digest === candidate.digest || row.requestId === candidate.requestId || row.callbackStateHash === candidate.callbackStateHash || row.nonceHash === candidate.nonceHash || row.challengeHash === candidate.challengeHash || row.orderHash === candidate.orderHash)) throw new Error("Finance order approval request, callback state, challenge, nonce or order was already decided"); }

  private async readRecords(at: Date): Promise<RecordRow[]> {
    this.healthy(); const raw = await this.dependencies.storage.getItem(FINANCE_ORDER_APPROVAL_REPLAY_KEY); this.healthy();
    if (raw === null) return []; if (raw.length > MAX_JOURNAL_CHARS) throw new Error("Finance order approval replay journal is too large");
    let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("Finance order approval replay journal is invalid"); }
    const journal = exactObject(value, ["records", "schemaVersion"]); if (journal.schemaVersion !== 1 || !Array.isArray(journal.records) || journal.records.length > MAX_RECORDS) throw new Error("Finance order approval replay journal is invalid");
    const records: RecordRow[] = [];
    for (const item of journal.records) {
      const row = exactObject(item, ["approval", "callbackStateHash", "challengeHash", "digest", "nonceHash", "orderHash", "request", "requestId", "returnURL", "revocation", "status"]);
      const rawRequest = row.request as FinanceOrderApprovalRequest, request = parseFinanceOrderApprovalRequest(rawRequest, new Date(rawRequest?.unsigned?.issuedAt));
      const digest = financeOrderApprovalDigest(request.unsigned), expected = this.row(request, digest);
      for (const key of ["digest", "requestId", "callbackStateHash", "nonceHash", "challengeHash", "orderHash"] as const) if (row[key] !== expected[key]) throw new Error("Finance order approval replay record binding is invalid");
      if (row.returnURL !== null && typeof row.returnURL !== "string") throw new Error("Finance order approval replay return URL is invalid");
      let status = row.status as Status, approval: SignedFinanceOrderApproval | null = null, revocation: SignedFinanceOrderApprovalRevocation | null = null;
      if (status === "reserved") { if (row.approval !== null || row.revocation !== null || row.returnURL !== null) throw new Error("Finance reserved approval record is invalid"); }
      else if (status === "approved") { approval = parseSignedFinanceOrderApproval(row.approval); if (row.revocation !== null || !row.returnURL) throw new Error("Finance approved record is invalid"); }
      else if (status === "rejected") { if (row.approval !== null || row.revocation !== null || !row.returnURL) throw new Error("Finance rejected record is invalid"); }
      else if (status === "revoked") { approval = parseSignedFinanceOrderApproval(row.approval); revocation = parseSignedFinanceOrderApprovalRevocation(row.revocation); if (!row.returnURL) throw new Error("Finance revoked record is invalid"); }
      else throw new Error("Finance order approval replay status is invalid");
      if (row.returnURL) {
        const historical = new Date(revocation?.revokedAt ?? approval?.issuedAt ?? request.unsigned.issuedAt);
        const result = parseFinanceOrderApprovalReturnURL(PRODUCT_SESSION_REGISTRY, row.returnURL as string, request, historical, approval);
        if (result.status !== status || result.status === "approved" && canonicalJSON(result.approval) !== canonicalJSON(approval) || result.status === "revoked" && canonicalJSON(result.revocation) !== canonicalJSON(revocation)) throw new Error("Finance order approval replay decision is invalid");
      }
      const parsed = { ...expected, status, approval, revocation, returnURL: row.returnURL as string | null }; this.assertUnused(records, parsed); records.push(parsed);
    }
    const now = at.getTime(); if (!Number.isFinite(now)) throw new Error("Finance order approval current time is invalid");
    return records.filter(row => Date.parse(row.request.unsigned.expiresAt) > now);
  }

  private async writeRecords(records: RecordRow[]): Promise<void> {
    this.healthy(); const encoded = JSON.stringify({ schemaVersion: 1, records });
    if (encoded.length > MAX_JOURNAL_CHARS) throw new Error("Finance order approval replay journal is too large");
    try { await this.dependencies.storage.setItem(FINANCE_ORDER_APPROVAL_REPLAY_KEY, encoded); const actual = await this.dependencies.storage.getItem(FINANCE_ORDER_APPROVAL_REPLAY_KEY); if (actual !== encoded) throw new Error("Finance order approval replay journal failed exact readback"); }
    catch (error) { journalUncertain = true; throw error; }
    this.healthy();
  }
}

function exactObject(value: unknown, fields: string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n") || Reflect.ownKeys(value).length !== fields.length) throw new Error("Finance order approval replay journal has unknown or missing fields");
  for (const key of fields) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Finance order approval replay journal cannot contain accessors"); }
  return value as Record<string, any>;
}
