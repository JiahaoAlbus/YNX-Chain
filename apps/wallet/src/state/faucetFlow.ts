import { FaucetClaimController, type FaucetClaimView, type FaucetClaimRPC } from "../chain/faucetClaim";
import type { FaucetAdmissionTransport } from "../chain/faucetAdmission";
import { createProductionFaucetSession, NATIVE_FAUCET_AUTHORITY, NATIVE_FAUCET_CHAIN_ORIGIN } from "../chain/faucetNativeSession";
import { faucetTransportReadiness } from "../../modules/ynx-faucet-transport";
import { WalletOperationCancelled, WalletOperationLifecycle, type WalletOperationLease } from "../security/operationLifecycle";
import type { SecureStorageHealth } from "../storage/secureStorageHealth";
import type { SecureStorageAdapter } from "../storage/walletRepository";
import type { walletCopy } from "../i18n/i18n";

type Session = Readonly<{ rpc: FaucetClaimRPC; transport: FaucetAdmissionTransport }>;
export type FaucetConfiguration = Readonly<{ amount: number; createSession(signal: AbortSignal): Session | null }>;
export type FaucetAction = "review" | "submit" | "check" | "complete";
export type FaucetFlowState = Readonly<{
  phase: "closed" | "loading" | "ready" | "failed" | "paused";
  busy: FaucetAction | "read" | null;
  view: FaucetClaimView | null;
  error: "unavailable" | "read" | "storage" | "operation" | null;
  available: boolean;
}>;

// The service's configurable default/max are not present in its RPC model.
// A release must bind the actual amount as well as platform/endpoint acceptance.
// Do not substitute the faucetd source default or a runtime/global JS override.
const PRODUCTION_AMOUNT: number | null = null;
export function productionFaucetConfiguration(): FaucetConfiguration | null {
  if (!faucetTransportReadiness.productionEnabled || PRODUCTION_AMOUNT === null) return null;
  return Object.freeze({ amount: PRODUCTION_AMOUNT, createSession: createProductionFaucetSession });
}

const ACTION_TTL_MS = 120_000;
type Attempt = { lease: WalletOperationLease; abort: AbortController; timer: ReturnType<typeof setTimeout> };

/** One mounted account screen owns one flow. It has no key/biometric access and
 * uses the shared storage adapter. Local loading is read-only; only an explicit
 * action can prepare an ID or obtain a fresh, cancellable native session.
 */
export class FaucetFlow {
  private readonly scope;
  private readonly local: FaucetClaimController;
  private readonly configuration: FaucetConfiguration | null;
  private readonly listeners = new Set<() => void>();
  private current: Attempt | null = null;
  private attached = false;
  private detachListeners: (() => void) | null = null;
  private state: FaucetFlowState;

  constructor(private readonly dependencies: Readonly<{
    account: string; operations: WalletOperationLifecycle; storage: SecureStorageAdapter;
    health: SecureStorageHealth; randomBytesAsync(length: number): Promise<Uint8Array>;
    configuration: FaucetConfiguration | null;
  }>) {
    this.scope = dependencies.operations.scope();
    const config = dependencies.configuration;
    this.configuration = config && Number.isSafeInteger(config.amount) && config.amount > 0
      ? Object.freeze({ amount: config.amount, createSession: config.createSession }) : null;
    this.local = this.controller();
    this.state = Object.freeze({ phase: "closed", busy: null, view: null, error: null, available: this.configuration !== null });
  }

  snapshot(): FaucetFlowState { return this.state; }
  amount(): number | null { return this.configuration?.amount ?? null; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Called from the component effect, never from a React render/constructor. */
  attach(): () => void {
    if (this.attached) throw new Error("Faucet screen is already attached");
    this.attached = true;
    const stop = () => this.cancel();
    const removeOperation = this.dependencies.operations.subscribe(stop);
    const removeHealth = this.dependencies.health.subscribe(stop);
    this.detachListeners = () => { removeOperation(); removeHealth(); };
    return () => { this.cancel(); this.attached = false; this.detachListeners?.(); this.detachListeners = null; };
  }

  /** Close, inactive/background, account invalidation and quarantine all abort
   * synchronously. Cancellation retains journals and never claims zero dispatch.
   * No automatic retry or resumption occurs when the app becomes active again.
   */
  cancel(): void {
    const previous = this.current;
    this.current = null;
    this.scope.cancel();
    if (previous) { clearTimeout(previous.timer); previous.lease.finish(); }
    this.publish({ phase: "paused", busy: null, view: null, error: null });
    // Abort listeners can run synchronously. Never overwrite a newer action
    // they may start after this owner was already invalidated.
    previous?.abort.abort();
  }

  async load(): Promise<void> {
    const attempt = this.begin("read");
    if (!attempt) return;
    try {
      this.guard(attempt);
      this.publish({ phase: "loading", view: null, error: null });
      this.guard(attempt);
      const view = await this.local.read(); this.guard(attempt); this.publish({ phase: "ready", view });
    }
    catch { if (this.owns(attempt)) this.publish({ phase: "failed", error: "read" }); }
    finally { this.finish(attempt); }
  }

  allowed(action: FaucetAction): boolean {
    if (!this.attached || this.current || this.state.phase !== "ready" || !this.state.available || !this.configuration ||
        this.dependencies.health.requiresRestart || !this.dependencies.operations.isUnlocked() ||
        this.dependencies.operations.selectedAccount() !== this.dependencies.account) return false;
    const view = this.state.view, entry = view?.entry;
    if (!view) return false;
    if (action === "review") return !entry;
    if (!entry) return false;
    if (action === "submit") return !entry.acknowledgement && entry.lastResult !== "request_id_conflict" && entry.lastResult !== "stored_receipt_invalid";
    if (action === "check") return !!entry.acknowledgement;
    return !!entry.acknowledgement && view.verification === "fresh-read" && !!view.evidence && view.observedStatus === "durable";
  }

  async act(action: FaucetAction): Promise<void> {
    if (!this.allowed(action)) return;
    // Freeze the exact displayed original ID. An HTTP task ID never replaces it.
    const requestId = this.state.view?.entry?.requestId;
    const attempt = this.begin(action);
    if (!attempt) return;
    let entropy: Uint8Array | undefined;
    this.publish({ error: null, ...(this.state.view?.verification === "fresh-read" ? {
      view: Object.freeze({ ...this.state.view, verification: "stored-snapshot" as const, observedStatus: null }),
    } : {}) });
    try {
      this.guard(attempt);
      const session = this.configuration!.createSession(attempt.abort.signal);
      this.guard(attempt);
      if (!session) { this.publish({ available: false, error: "unavailable" }); return; }
      let consumed = false;
      if (action === "review") {
        // Expo async uses the native CSPRNG; its synchronous API can fall back
        // to Math.random in remote debugging. Zero even a late cancelled result.
        entropy = await this.dependencies.randomBytesAsync(32);
        this.guard(attempt);
        if (!(entropy instanceof Uint8Array) || entropy.length !== 32) throw new Error("Faucet entropy unavailable");
      }
      const controller = this.controller(session, (length) => {
        this.guard(attempt);
        if (consumed || length !== 32 || !entropy || entropy.length !== 32) throw new Error("Faucet entropy unavailable");
        consumed = true; return entropy;
      });
      const guard = () => this.guard(attempt);
      const view = action === "review" ? await controller.prepare(this.configuration!.amount, guard)
        : action === "submit" ? await controller.submit(requestId!, guard)
        : action === "check" ? await controller.check(requestId!, guard)
        : await controller.complete(requestId!, guard);
      this.guard(attempt);
      this.publish({ phase: "ready", view });
    } catch (error) {
      if (!this.owns(attempt)) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      // A failed persistence/readback can already have changed disk. Disable
      // actions; never restore the previous journal or assume there is no entry.
      if (code === "FAUCET_CLAIM_STORAGE" || code === "FAUCET_ADMISSION_STORAGE") {
        this.publish({ phase: "failed", view: null, error: "storage" });
      } else {
        try {
          this.guard(attempt);
          const view = await this.local.read(); this.guard(attempt);
          this.publish({ phase: "ready", view, error: "operation" });
        } catch { if (this.owns(attempt)) this.publish({ phase: "failed", view: null, error: "read" }); }
      }
    } finally { entropy?.fill(0); this.finish(attempt); }
  }

  private controller(session?: Session, randomBytes?: (length: number) => Uint8Array): FaucetClaimController {
    return new FaucetClaimController(this.dependencies.storage,
      { authority: NATIVE_FAUCET_AUTHORITY, chainId: "0x1917", recipient: this.dependencies.account },
      NATIVE_FAUCET_CHAIN_ORIGIN, { rpc: session?.rpc, transport: session?.transport, randomBytes });
  }
  private begin(busy: NonNullable<FaucetFlowState["busy"]>): Attempt | null {
    if (!this.attached || this.current || this.dependencies.health.requiresRestart) return null;
    let attempt: Attempt | null = null;
    try {
      const lease = this.scope.begin({ account: this.dependencies.account, ttlMs: ACTION_TTL_MS });
      attempt = { lease, abort: new AbortController(), timer: setTimeout(() => {
        if (this.current === attempt) this.cancel();
      }, ACTION_TTL_MS) };
      this.current = attempt;
      this.guard(attempt);
      this.publish({ busy });
      this.guard(attempt);
      return attempt;
    } catch { if (attempt && this.current === attempt) this.cancel(); return null; }
  }
  private guard(attempt: Attempt): void {
    this.dependencies.health.assertHealthy();
    if (!this.attached || this.current !== attempt || attempt.abort.signal.aborted) throw new WalletOperationCancelled();
    attempt.lease.assert();
  }
  private owns(attempt: Attempt): boolean { try { this.guard(attempt); return true; } catch { return false; } }
  private finish(attempt: Attempt): void {
    // Old promises/finally must not clear a new action's busy state or timer.
    const owner = this.current === attempt;
    if (owner) this.current = null;
    clearTimeout(attempt.timer); attempt.lease.finish();
    if (owner) this.publish({ busy: null });
    attempt.abort.abort();
  }
  private publish(update: Partial<FaucetFlowState>): void {
    this.state = Object.freeze({ ...this.state, ...update });
    for (const listener of this.listeners) listener();
  }
}

/** Display facts from the controller. Stored evidence never becomes current
 * proof simply because it exists. No balance arithmetic or finality badge. */
export function faucetStatusCopy(view: FaucetClaimView): Readonly<{ title: Parameters<typeof walletCopy>[1]; body: Parameters<typeof walletCopy>[1] }> {
  const entry = view.entry;
  if (!entry) return { title: view.completedRequestIds.length ? "Receipt review saved." : "No saved request", body: "This is a testnet request. Test YNXT has no monetary value." };
  if (view.verification === "fresh-read" && view.observedStatus === "durable" && view.evidence && entry.acknowledgement)
    return { title: "Block receipt checked", body: "The node's local snapshot covers this transaction. Balance and consensus finality have not been verified." };
  if (view.verification === "stored-snapshot") return { title: "Saved receipt copy — check again", body: "No block receipt has been verified yet." };
  if (view.observedStatus === "pending_durable") return { title: "Result not confirmed", body: "The node saved the pending request. No block receipt has been verified yet." };
  if (view.observedStatus) return { title: "Result not confirmed", body: "This request is still pending verification." };
  if (entry.acknowledgement) return { title: "Request received", body: "The request was received. Your balance has not been verified." };
  if (entry.lastResult === "request_id_conflict") return { title: "Result not confirmed", body: "The original request does not match the service record. Keep it for review." };
  if (entry.lastResult === "stored_receipt_invalid") return { title: "Result not confirmed", body: "The service cannot verify the original receipt yet. Keep this request." };
  if (entry.lastResult === "rate_limited") return { title: "Result not confirmed", body: "Too many requests. Retry the original request manually later." };
  return entry.phase === "prepared" && entry.attempts === 0
    ? { title: "Not sent", body: "This is a testnet request. Test YNXT has no monetary value." }
    : { title: "Result not confirmed", body: "This request may already have been processed. Keep its original ID and amount." };
}
