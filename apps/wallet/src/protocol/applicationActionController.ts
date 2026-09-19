import {
  applicationActionRequestDigest, createApplicationActionReturnURL, createSignedApplicationAction,
  digestHex, parseApplicationActionRequest, parseApplicationActionReturnURL,
  parseApplicationActionWalletURL, verifySignedApplicationAction, walletIdentity,
} from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";
import { PRODUCT_SESSION_REGISTRY } from "./registry";

export type MobileApplicationActionRequest = Readonly<{
  version: "1"; chainId: "ynx_6423-1"; productId: "dex";
  platform: "android" | "ios" | "web"; applicationId: string; origin: string; callback: string;
  account: string; action: "dex_swap_exact_input" | "dex_swap_exact_output" | "dex_liquidity_add" | "dex_liquidity_remove";
  payload: Readonly<Record<string, string | number>>; nonce: number; requestId: string; state: string; issuedAt: string; expiresAt: string;
}>;
export type ApplicationActionReview = Readonly<{ id: string; request: MobileApplicationActionRequest; account: WalletAccount }>;
type Dependencies = {
  platform: "android" | "ios";
  storage: SecureStorageAdapter;
  selectedAccount: () => WalletAccount | null;
  withAccountSecret: <T>(account: string, assertCurrent: () => void, use: (secret: string, assertKeyCurrent: () => void) => T | Promise<T>) => Promise<T>;
  openURL: (url: string) => Promise<unknown>;
  now?: () => Date;
};
type Pending = { review: ApplicationActionReview; returnURL: string | null; consumed: boolean };
type RecordRow = { digest: string; requestId: string; stateHash: string; nonceHash: string; request: MobileApplicationActionRequest; status: "consumed" | "approved" | "rejected"; returnURL: string | null };
export const APPLICATION_ACTION_REPLAY_KEY = "ynx.wallet.application-action-v1.replay";
const MAX_RECORDS = 128;
const MAX_JOURNAL_CHARS = 1024 * 1024;
// Serialize read/modify/write across controller instances using the same adapter.
// A JS readback is not proof of disk durability. The platform's protected-storage
// write barrier remains authoritative; uncertain writes cannot be retried here.
const queues = new WeakMap<SecureStorageAdapter, Promise<unknown>>();
const uncertain = new WeakSet<SecureStorageAdapter>();

export class ApplicationActionController {
  private pending: Pending | null = null;
  private generation = 0;
  private busy = false;
  private readonly now: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.now = dependencies.now ?? (() => new Date()); }
  get current(): ApplicationActionReview | null { return this.pending?.review ?? null; }
  hasReturn(id: string): boolean { return this.pending?.review.id === id && this.pending.returnURL !== null; }

  async receive(url: string): Promise<ApplicationActionReview> {
    return this.exclusive(async () => {
      this.healthy();
      const generation = this.generation;
      const request = parseApplicationActionWalletURL(PRODUCT_SESSION_REGISTRY, url, this.now()) as MobileApplicationActionRequest;
      if (request.platform !== "web" && request.platform !== this.dependencies.platform) throw new Error("Application action platform does not match this Wallet device");
      const id = applicationActionRequestDigest(request);
      const selectedValue = this.dependencies.selectedAccount();
      const selected = selectedValue ? Object.freeze({ ...selectedValue }) : null;
      if (!selected || selected.account !== request.account) throw new Error("Select the exact account named by this application action before reviewing it");
      if (this.pending?.review.id === id) { this.check(this.pending, generation); return this.pending.review; }
      if (this.pending) throw new Error("Finish the current Wallet action before opening another");
      const records = await this.readRecords();
      this.assertGeneration(generation); this.assertAccount(selected);
      const same = records.find(row => row.digest === id);
      if (same && !same.returnURL) throw new Error("This application action was already consumed; Wallet will not sign it again");
      if (!same) this.assertUnused(records, this.row(request, id));
      const review = Object.freeze({ id, request, account: Object.freeze({ ...selected }) });
      this.pending = { review, returnURL: same?.returnURL ?? null, consumed: !!same };
      return review;
    });
  }

  // Root UI calls this synchronously on close, lock, background, account switch
  // and storage quarantine. Key access also supplies the actual OS/lifecycle lease.
  cancel(): void { this.generation++; this.pending = null; }

  async approve(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id), generation = this.generation;
      this.checkUndecided(pending, generation);
      if (!pending.review.account.backupConfirmed) throw new Error("Confirm this account's backup before signing an application action");
      const records = await this.readRecords();
      this.checkUndecided(pending, generation); this.assertUnused(records, this.row(pending.review.request, id));
      await this.dependencies.withAccountSecret(pending.review.account.account, () => this.check(pending, generation), async (secret, assertKeyCurrent) => {
        const guard = () => { assertKeyCurrent(); this.check(pending, generation); };
        guard();
        const identity = walletIdentity(secret);
        if (identity.account !== pending.review.account.account || identity.accountPublicKey !== pending.review.account.accountPublicKey) throw new Error("Stored signing account does not match the reviewed account");
        await this.mutate(async () => {
          guard();
          const current = await this.readRecords(); guard();
          this.assertUnused(current, this.row(pending.review.request, id));
          if (current.length >= MAX_RECORDS) throw new Error("Application action replay journal is full; wait for existing requests to expire");
          const row = this.row(pending.review.request, id);
          // Mark the local decision before attempting persistence. A failed or
          // cancelled write must never turn this attempt back into signable UI.
          pending.consumed = true;
          await this.writeRecords([...current, row]); guard();
          const request = pending.review.request;
          const signed = createSignedApplicationAction({ accountSecret: secret, action: request.action, payload: request.payload, nonce: request.nonce });
          guard();
          verifySignedApplicationAction(signed.payload, { account: request.account, action: request.action, payload: request.payload, nonce: request.nonce });
          const returnURL = createApplicationActionReturnURL(PRODUCT_SESSION_REGISTRY, request, { status: "approved", signed: signed.payload }, this.now());
          // Parse the final encoded return before storing or opening it.
          parseApplicationActionReturnURL(PRODUCT_SESSION_REGISTRY, returnURL, request, this.now());
          guard();
          await this.writeRecords([...current, { ...row, status: "approved", returnURL }]); guard();
          pending.returnURL = returnURL;
        });
      });
      await this.deliver(pending, generation);
    });
  }

  async reject(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id), generation = this.generation;
      this.checkUndecided(pending, generation);
      await this.mutate(async () => {
        this.checkUndecided(pending, generation);
        const records = await this.readRecords(); this.checkUndecided(pending, generation);
        this.assertUnused(records, this.row(pending.review.request, id));
        if (records.length >= MAX_RECORDS) throw new Error("Application action replay journal is full; wait for existing requests to expire");
        const returnURL = createApplicationActionReturnURL(PRODUCT_SESSION_REGISTRY, pending.review.request, { status: "rejected", reason: "USER_REJECTED" }, this.now());
        pending.consumed = true;
        await this.writeRecords([...records, { ...this.row(pending.review.request, id), status: "rejected", returnURL }]);
        this.check(pending, generation); pending.returnURL = returnURL;
      });
      await this.deliver(pending, generation);
    });
  }

  async retryReturn(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id);
      if (!pending.returnURL) throw new Error("No persisted application action result is available to return");
      await this.deliver(pending, this.generation);
    });
  }

  private async deliver(pending: Pending, generation: number): Promise<void> {
    this.check(pending, generation);
    const records = await this.readRecords(); this.check(pending, generation);
    const row = records.find(item => item.digest === pending.review.id);
    if (!row?.returnURL || row.returnURL !== pending.returnURL) throw new Error("Persisted application action result is unavailable or changed");
    parseApplicationActionReturnURL(PRODUCT_SESSION_REGISTRY, row.returnURL, pending.review.request, this.now());
    this.check(pending, generation);
    await this.dependencies.openURL(row.returnURL);
    // Opening the registered application normally backgrounds Wallet. Preserve
    // the already signed/returned fact without clearing any newer UI selection.
    if (this.pending === pending) this.pending = null;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("A Wallet application action is already in progress");
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const storage = this.dependencies.storage;
    const previous = queues.get(storage) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => { this.healthy(); return operation(); });
    queues.set(storage, next);
    try { return await next; } finally { if (queues.get(storage) === next) queues.delete(storage); }
  }
  private requirePending(id: string): Pending {
    if (!this.pending || this.pending.review.id !== id) throw new Error("Application action review is no longer active");
    return this.pending;
  }
  private healthy(): void {
    if (uncertain.has(this.dependencies.storage)) throw new Error("Application action storage result is uncertain; restart Wallet before continuing");
  }
  private assertGeneration(generation: number): void {
    this.healthy();
    if (generation !== this.generation) throw new Error("Application action was cancelled; review a new request");
  }
  private assertAccount(account: WalletAccount): void {
    const current = this.dependencies.selectedAccount();
    if (!current || current.account !== account.account || current.accountPublicKey !== account.accountPublicKey || current.backupConfirmed !== account.backupConfirmed) throw new Error("Selected Wallet account changed during application action review");
  }
  private check(pending: Pending, generation: number): void {
    this.assertGeneration(generation);
    if (this.pending !== pending) throw new Error("Application action review was replaced");
    this.assertAccount(pending.review.account);
    parseApplicationActionRequest(PRODUCT_SESSION_REGISTRY, pending.review.request, this.now());
  }
  private checkUndecided(pending: Pending, generation: number): void {
    this.check(pending, generation);
    if (pending.consumed) throw new Error("Application action is already consumed; only retry returning its persisted result");
  }
  private row(request: MobileApplicationActionRequest, digest: string): RecordRow {
    return { digest, requestId: request.requestId, stateHash: digestHex("YNX_APPLICATION_ACTION_STATE_V1", { state: request.state }), nonceHash: digestHex("YNX_APPLICATION_ACTION_NONCE_V1", { account: request.account, nonce: request.nonce }), request, status: "consumed", returnURL: null };
  }
  private assertUnused(records: RecordRow[], candidate: RecordRow): void {
    if (records.some(row => row.digest === candidate.digest || row.requestId === candidate.requestId || row.stateHash === candidate.stateHash || (row.nonceHash === candidate.nonceHash && row.status !== "rejected" && candidate.status !== "rejected"))) throw new Error("Application action request, state or account nonce was already consumed");
  }
  private async readRecords(): Promise<RecordRow[]> {
    this.healthy();
    const raw = await this.dependencies.storage.getItem(APPLICATION_ACTION_REPLAY_KEY); this.healthy();
    if (raw === null) return [];
    if (raw.length > MAX_JOURNAL_CHARS) throw new Error("Application action replay journal is too large");
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("Application action replay journal is invalid"); }
    const journal = exactObject(value, ["schemaVersion", "records"]);
    if (journal.schemaVersion !== 1 || !Array.isArray(journal.records) || journal.records.length > MAX_RECORDS) throw new Error("Application action replay journal is invalid");
    const records: RecordRow[] = [];
    for (const item of journal.records) {
      const row = exactObject(item, ["digest", "requestId", "stateHash", "nonceHash", "request", "status", "returnURL"]);
      const rawRequest = row.request as MobileApplicationActionRequest;
      // Historical rows are validated at their own issuance time, then pruned.
      // Expiry never makes malformed or mismatched persisted data acceptable.
      const request = parseApplicationActionRequest(PRODUCT_SESSION_REGISTRY, rawRequest, new Date(rawRequest?.issuedAt)) as MobileApplicationActionRequest;
      const digest = applicationActionRequestDigest(request), expected = this.row(request, digest);
      if (["digest", "requestId", "stateHash", "nonceHash"].some(key => row[key] !== expected[key as keyof RecordRow]) || (row.returnURL !== null && typeof row.returnURL !== "string")) throw new Error("Application action replay record binding is invalid");
      if (row.returnURL === null) {
        if (row.status !== "consumed") throw new Error("Application action replay status is invalid");
      } else {
        const result = parseApplicationActionReturnURL(PRODUCT_SESSION_REGISTRY, row.returnURL as string, request, new Date(request.issuedAt));
        if (result.status !== row.status) throw new Error("Application action replay decision is invalid");
      }
      const parsed = { ...expected, status: row.status as RecordRow["status"], returnURL: row.returnURL as string | null };
      this.assertUnused(records, parsed);
      records.push(parsed);
    }
    const now = this.now().getTime();
    if (!Number.isFinite(now)) throw new Error("Application action current time is invalid");
    return records.filter(row => Date.parse(row.request.expiresAt) > now);
  }
  private async writeRecords(records: RecordRow[]): Promise<void> {
    this.healthy();
    const encoded = JSON.stringify({ schemaVersion: 1, records });
    if (encoded.length > MAX_JOURNAL_CHARS) throw new Error("Application action replay journal is too large");
    try {
      await this.dependencies.storage.setItem(APPLICATION_ACTION_REPLAY_KEY, encoded);
      const actual = await this.dependencies.storage.getItem(APPLICATION_ACTION_REPLAY_KEY);
      if (actual !== encoded) throw new Error("Application action replay journal failed exact readback");
    } catch (error) { uncertain.add(this.dependencies.storage); throw error; }
    this.healthy();
  }
}

function exactObject(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join("\n") !== [...fields].sort().join("\n")) throw new Error("Application action replay journal has unknown or missing fields");
  return value as Record<string, unknown>;
}
