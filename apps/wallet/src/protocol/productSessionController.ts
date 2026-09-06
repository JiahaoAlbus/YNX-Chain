import {
  createProductSessionReturnURL, digestHex, parseProductSessionRequest,
  parseProductSessionWalletURL, productSessionRequestDigest, signProductSessionApproval, walletIdentity,
} from "@ynx-chain/wallet-auth";
import type { SecureStorageAdapter, WalletAccount } from "../storage/walletRepository";
import { PRODUCT_SESSION_REGISTRY } from "./registry";

// The SDK validates every field before this narrower presentation type is used.
export type MobileProductSessionRequest = Readonly<{
  version: "2"; chainId: "ynx_6423-1"; productId: string; clientId: string;
  platform: "android" | "ios" | "web"; applicationId: string; bundleId: string | null; packageId: string | null;
  origin: string; callback: string; deviceId: string; deviceAlgorithm: "p256-sha256"; deviceKey: string;
  nonce: string; state: string; scopes: readonly string[]; purpose: string; issuedAt: string; expiresAt: string;
}>;
export type ProductSessionReview = Readonly<{
  id: string; request: MobileProductSessionRequest; account: WalletAccount;
}>;
type AuditAction = "intent-approved" | "request-rejected" | "approval-returned";
type Dependencies = {
  platform: "android" | "ios";
  storage: SecureStorageAdapter;
  selectedAccount: () => WalletAccount | null;
  withAccountSecret: <T>(account: string, assertCurrent: () => void, use: (secret: string, assertKeyCurrent: () => void) => T | Promise<T>) => Promise<T>;
  openURL: (url: string) => Promise<unknown>;
  audit?: (review: ProductSessionReview, action: AuditAction, at: Date) => Promise<unknown>;
  now?: () => Date;
};
type Pending = { review: ProductSessionReview; returnURL?: string; decision?: "approved" | "rejected" };
type Consumed = { digest: string; nonce: string; state: string; expiresAt: string };
export const PRODUCT_SESSION_REPLAY_KEY = "ynx.wallet.product-session-v2.replay";

export class ProductSessionController {
  private pending: Pending | null = null;
  private generation = 0;
  private busy = false;
  private readonly now: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.now = dependencies.now ?? (() => new Date()); }

  get current(): ProductSessionReview | null { return this.pending?.review ?? null; }
  hasReturn(id: string): boolean { return this.pending?.review.id === id && !!this.pending.returnURL; }

  async receive(url: string): Promise<ProductSessionReview> {
    return this.exclusive(async () => {
      const generation = this.generation;
      const at = this.now();
      // No legacy parser or migration fallback: only the canonical v2 envelope is eligible.
      const request = parseProductSessionWalletURL(PRODUCT_SESSION_REGISTRY, url, at) as MobileProductSessionRequest;
      if (new URL(url).port) throw new Error("Wallet authorization route cannot contain a port");
      if (request.platform !== "web" && request.platform !== this.dependencies.platform) throw new Error("Request platform does not match this Wallet device");
      const id = productSessionRequestDigest(PRODUCT_SESSION_REGISTRY, request, at);
      if (this.pending?.review.id === id) return this.pending.review;
      if (this.pending) throw new Error("Finish or reject the current Wallet request before opening another");
      const account = this.dependencies.selectedAccount();
      if (!account) throw new Error("Create or import an account, then start a new product connection request");
      const records = await this.readConsumed(at);
      this.assertGeneration(generation);
      this.assertAccount(account);
      this.assertUnused(records, this.binding(request, id));
      const review = Object.freeze({ id, request, account: Object.freeze({ ...account }) });
      this.pending = { review };
      return review;
    });
  }

  // Called synchronously before backgrounding, locking, replacing or switching an account.
  cancel(): void { this.generation++; this.pending = null; }

  async approve(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id);
      const generation = this.generation;
      if (pending.returnURL) throw new Error("This decision is already signed; retry returning the existing result");
      this.check(pending, generation);
      if (!pending.review.account.backupConfirmed) throw new Error("Confirm the selected account backup before authorizing products");
      // Reject known replay/storage failures before asking the OS for this key.
      const records = await this.readConsumed(this.now());
      this.check(pending, generation);
      this.assertUnused(records, this.binding(pending.review.request, pending.review.id));
      await this.dependencies.withAccountSecret(pending.review.account.account, () => this.check(pending, generation), async (secret, assertKeyCurrent) => {
        assertKeyCurrent(); this.check(pending, generation);
        const identity = walletIdentity(secret);
        if (identity.account !== pending.review.account.account || identity.accountPublicKey !== pending.review.account.accountPublicKey) throw new Error("Stored signing account does not match the reviewed account");
        // Cancelling the actual OS decryption above leaves the original request
        // available for another explicit approval. Consumption still precedes
        // signing and survives any later lock, storage error or callback failure.
        await this.dependencies.audit?.(pending.review, "intent-approved", this.now());
        assertKeyCurrent(); this.check(pending, generation);
        await this.consume(pending, generation, assertKeyCurrent);
        assertKeyCurrent(); this.check(pending, generation);
        const at = this.now();
        const approval = signProductSessionApproval(PRODUCT_SESSION_REGISTRY, pending.review.request, {
          accountSecret: secret, scopes: pending.review.request.scopes, expiresAt: pending.review.request.expiresAt,
        }, at);
        if (approval.account !== pending.review.account.account) throw new Error("Approval account does not match the reviewed account");
        pending.returnURL = createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, pending.review.request, { result: "approved", approval }, at);
        pending.decision = "approved";
      });
      await this.deliver(pending, generation);
    });
  }

  async reject(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id);
      const generation = this.generation;
      if (pending.returnURL) throw new Error("This decision is already final; retry returning the existing result");
      this.check(pending, generation);
      await this.dependencies.audit?.(pending.review, "request-rejected", this.now());
      this.check(pending, generation);
      await this.consume(pending, generation);
      this.check(pending, generation);
      pending.returnURL = createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY, pending.review.request, { result: "rejected", reason: "user_rejected" }, this.now());
      pending.decision = "rejected";
      await this.deliver(pending, generation);
    });
  }

  async retryReturn(id: string): Promise<void> {
    return this.exclusive(async () => {
      const pending = this.requirePending(id);
      if (!pending.returnURL) throw new Error("No completed decision is available to return");
      await this.deliver(pending, this.generation);
    });
  }

  private async deliver(pending: Pending, generation: number): Promise<void> {
    this.check(pending, generation);
    await this.dependencies.openURL(pending.returnURL!);
    // Opening the product normally backgrounds Wallet. It does not undo a delivered decision.
    if (this.pending === pending) this.pending = null;
    if (pending.decision === "approved") await this.dependencies.audit?.(pending.review, "approval-returned", this.now());
  }

  private check(pending: Pending, generation: number): void {
    this.assertGeneration(generation);
    if (this.pending !== pending) throw new Error("Wallet request is no longer active");
    this.assertAccount(pending.review.account);
    parseProductSessionRequest(PRODUCT_SESSION_REGISTRY, pending.review.request, this.now());
  }
  private assertGeneration(generation: number): void {
    if (generation !== this.generation) throw new Error("Wallet request was cancelled; return to the product to reconnect");
  }
  private assertAccount(account: WalletAccount): void {
    const selected = this.dependencies.selectedAccount();
    if (!selected || selected.account !== account.account || selected.accountPublicKey !== account.accountPublicKey || selected.backupConfirmed !== account.backupConfirmed) throw new Error("Selected Wallet account changed; review a new product request");
  }
  private requirePending(id: string): Pending {
    if (!this.pending || this.pending.review.id !== id) throw new Error("Wallet request is no longer active");
    return this.pending;
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("A Wallet request operation is already in progress");
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  private binding(request: MobileProductSessionRequest, digest: string): Consumed {
    return { digest, nonce: digestHex("YNX_MOBILE_PRODUCT_SESSION_NONCE_V2", { nonce: request.nonce }), state: digestHex("YNX_MOBILE_PRODUCT_SESSION_STATE_V2", { state: request.state }), expiresAt: request.expiresAt };
  }
  private assertUnused(records: Consumed[], binding: Consumed): void {
    if (records.some((record) => record.digest === binding.digest || record.nonce === binding.nonce || record.state === binding.state)) throw new Error("Wallet request was already consumed; start a new product connection request");
  }
  private async consume(pending: Pending, generation: number, assertKeyCurrent: () => void = () => {}): Promise<void> {
    assertKeyCurrent();
    const records = await this.readConsumed(this.now());
    assertKeyCurrent(); this.check(pending, generation);
    const binding = this.binding(pending.review.request, pending.review.id);
    this.assertUnused(records, binding);
    if (records.length >= 256) throw new Error("Wallet request capacity reached; wait for outstanding requests to expire");
    const serialized = JSON.stringify({ schemaVersion: 2, consumed: [...records, binding] });
    await this.dependencies.storage.setItem(PRODUCT_SESSION_REPLAY_KEY, serialized);
    assertKeyCurrent(); this.check(pending, generation);
    const readback = await this.dependencies.storage.getItem(PRODUCT_SESSION_REPLAY_KEY);
    assertKeyCurrent(); this.check(pending, generation);
    if (readback !== serialized) throw new Error("Wallet replay consumption could not be verified. This request may already be consumed; do not automatically replace or approve it again.");
  }
  private async readConsumed(at: Date): Promise<Consumed[]> {
    const raw = await this.dependencies.storage.getItem(PRODUCT_SESSION_REPLAY_KEY);
    if (raw === null) return [];
    let value: any;
    try { value = JSON.parse(raw); } catch { throw new Error("Wallet v2 replay storage is unreadable"); }
    if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "consumed,schemaVersion" || value.schemaVersion !== 2 || !Array.isArray(value.consumed) || value.consumed.length > 256) throw new Error("Wallet v2 replay storage is invalid");
    for (const record of value.consumed) {
      if (!record || typeof record !== "object" || Object.keys(record).sort().join() !== "digest,expiresAt,nonce,state" || ![record.digest, record.nonce, record.state].every((item) => typeof item === "string" && /^[0-9a-f]{64}$/.test(item)) || typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt)) || new Date(record.expiresAt).toISOString() !== record.expiresAt) throw new Error("Wallet v2 replay storage is invalid");
    }
    return value.consumed.filter((record: Consumed) => Date.parse(record.expiresAt) > at.getTime());
  }
}
