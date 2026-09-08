export const STORAGE_WRITE_UNCERTAIN = "ERR_STORAGE_WRITE_UNCERTAIN";

export class SecureStorageRestartRequired extends Error {
  readonly code = STORAGE_WRITE_UNCERTAIN;
  constructor() {
    super("Secure storage could not confirm a disk write. Fully close and reopen Wallet before trying again.");
  }
}

/** UI mirrors the native process barrier. Only the exact native error can set
 * this state; neither an English message nor a cancelled OS prompt can do so.
 * There is deliberately no reset. Native storage remains authoritative after
 * a JS reload, when the next read encounters the native process barrier again.
 */
export class SecureStorageHealth {
  private restartRequired = false;
  private readonly listeners = new Set<() => void>();

  get requiresRestart(): boolean { return this.restartRequired; }

  observe(error: unknown): void {
    if (this.restartRequired || !error || typeof error !== "object" ||
        !("code" in error) || error.code !== STORAGE_WRITE_UNCERTAIN) return;
    this.restartRequired = true;
    for (const listener of this.listeners) {
      // One failed UI subscriber must not prevent other scopes from locking,
      // or replace the storage failure returned to the caller.
      try { listener(); } catch { /* Native barrier still blocks storage. */ }
    }
  }

  assertHealthy(): void {
    if (this.restartRequired) throw new SecureStorageRestartRequired();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.restartRequired) listener();
    return () => { this.listeners.delete(listener); };
  }
}
