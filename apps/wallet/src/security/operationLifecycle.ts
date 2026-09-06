export const RECOVERY_DISPLAY_MS = 60_000;
const OPERATION_TTL_MS = 120_000;
export class WalletOperationCancelled extends Error {
  readonly code = "WALLET_OPERATION_CANCELLED";
  constructor() { super("Wallet operation expired or was cancelled. Review and authorize again."); }
}

export class WalletOperationLifecycle {
  private generation = 0;
  private active = true;
  private unlocked = false;
  private account: string | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly now: () => number = Date.now) {}
  selectedAccount(): string | null { return this.account; }
  isUnlocked(): boolean { return this.unlocked; }
  scope(): WalletOperationScope { return new WalletOperationScope(this, this.now); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  invalidate(): void { this.generation++; for (const listener of this.listeners) listener(); }
  lock(): void { this.unlocked = false; this.invalidate(); }
  setAccount(account: string | null): void { if (this.account !== account) { this.account = account; this.invalidate(); } }
  setAppState(state: string): void {
    this.active = state === "active";
    // A system biometric prompt can transiently make iOS inactive. It must still
    // return to active before completion; actual backgrounding cancels the lease.
    if (state === "background") this.lock();
  }
  unlock(lease: WalletOperationLease): void { lease.assert(); this.unlocked = true; }
  capture(): number { return this.generation; }
  time(): number { return this.now(); }
  assert(generation: number, account: string | null, requireUnlocked: boolean, deadline: number): void {
    if (!this.active || this.generation !== generation || this.account !== account || requireUnlocked && !this.unlocked || this.now() >= deadline) throw new WalletOperationCancelled();
  }
}

export class WalletOperationScope {
  private current: WalletOperationLease | null = null;
  constructor(private readonly lifecycle: WalletOperationLifecycle, private readonly now: () => number) {}
  begin({account = this.lifecycle.selectedAccount(), requireUnlocked = true, ttlMs = OPERATION_TTL_MS}: {account?: string | null; requireUnlocked?: boolean; ttlMs?: number} = {}): WalletOperationLease {
    if (this.current) throw new Error("A Wallet operation is already in progress");
    const lease = new WalletOperationLease(this, this.lifecycle, this.lifecycle.capture(), account, requireUnlocked, this.now() + ttlMs);
    this.current = lease;
    try { lease.assert(); } catch (error) { this.current = null; throw error; }
    return lease;
  }
  owns(lease: WalletOperationLease): boolean { return this.current === lease; }
  finish(lease: WalletOperationLease): void { lease.releaseSecrets(); if (this.current === lease) this.current = null; }
  cancel(): void { this.current?.releaseSecrets(); this.current = null; }
}

export class WalletOperationLease {
  private secretCleanups = new Set<() => void>();
  constructor(private readonly scope: WalletOperationScope, private readonly lifecycle: WalletOperationLifecycle, private readonly generation: number, readonly account: string | null, private readonly requireUnlocked: boolean, private readonly deadline: number) {}
  assert = (): void => { if (!this.scope.owns(this)) throw new WalletOperationCancelled(); this.lifecycle.assert(this.generation, this.account, this.requireUnlocked, this.deadline); };
  isCurrent(): boolean { try { this.assert(); return true; } catch { return false; } }
  ownsScope(): boolean { return this.scope.owns(this); }
  finish(): void { this.scope.finish(this); }
  releaseSecrets(): void { for (const cleanup of this.secretCleanups) cleanup(); this.secretCleanups.clear(); }
  holdSecret(value: string): Readonly<{read: () => string; clear: () => void}> {
    this.assert(); let material = value;
    const clear = () => { material = ""; clearTimeout(timer); unsubscribe(); this.secretCleanups.delete(clear); };
    const unsubscribe = this.lifecycle.subscribe(clear);
    const timer = setTimeout(clear, Math.max(0, this.deadline - this.lifecycle.time()));
    this.secretCleanups.add(clear);
    return Object.freeze({read: () => { this.assert(); if (!material) throw new WalletOperationCancelled(); return material; }, clear});
  }
  async step<T>(operation: () => Promise<T>): Promise<T> { this.assert(); const result = await operation(); this.assert(); return result; }
  async withSecret<T>(read: () => Promise<string>, use: (secret: string) => T | Promise<T>): Promise<T> {
    this.assert(); let secret = await read();
    try { this.assert(); const result = await use(secret); this.assert(); return result; }
    finally { secret = ""; } // Limits references; JavaScript strings cannot promise memory zeroization.
  }
}
