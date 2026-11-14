export const recoveryStatuses = ['NO_ORIGINAL_OPERATION', 'CIPHERTEXT_HELD_UNVERIFIED', 'UNKNOWN_RETAINED', 'REFUSED_RETAINED', 'RECOVERY_REQUIRED', 'UNAVAILABLE', 'OBSERVATION_PENDING'] as const;
export type RecoveryStatus = typeof recoveryStatuses[number];
export type RecoveryResult = Readonly<{status: RecoveryStatus; nativeBoundary: 'REQUIRED'; deviceAuthorization: 'REQUIRED'}>;
export type RecoveryModule = Readonly<{beginLocalRecoveryCheck(): Promise<unknown>; observeLocalRecoveryCheck(): Promise<unknown>}>;
const result = (status: RecoveryStatus): RecoveryResult => Object.freeze({status, nativeBoundary: 'REQUIRED', deviceAuthorization: 'REQUIRED'});
export function decodeRecovery(raw: unknown): RecoveryResult {
  if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error('RECOVERY_BOUNDARY_INVALID');
  const ds = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(ds).length !== 3) throw Error('RECOVERY_BOUNDARY_INVALID');
  for (const k of ['status', 'nativeBoundary', 'deviceAuthorization']) {
    if (!ds[k]?.enumerable || !Object.hasOwn(ds[k]!, 'value')) throw Error('RECOVERY_BOUNDARY_INVALID');
  }
  if (!recoveryStatuses.includes(ds.status!.value) || ds.nativeBoundary!.value !== 'REQUIRED' || ds.deviceAuthorization!.value !== 'REQUIRED') throw Error('RECOVERY_BOUNDARY_INVALID');
  return result(ds.status!.value);
}

/** Session-retained observation. No reset, cancel, alias, IDs or authorization input.
 * Unmount and observation timeout do not settle or replace the physical call.
 */
export class LocalRecoveryGate {
  private started = false;
  private module: Promise<RecoveryModule | null> | null = null;
  private active: Promise<RecoveryResult> | null = null;
  private snapshot: Readonly<{started: boolean; pending: boolean; result: RecoveryResult | null}> = Object.freeze({started: false, pending: false, result: null});
  private listeners = new Set<() => void>();
  constructor(private readonly load: () => Promise<RecoveryModule | null>) {}
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(pending: boolean, value: RecoveryResult | null) {
    this.snapshot = Object.freeze({started: this.started, pending, result: value});
    for (const fn of this.listeners) { try { fn(); } catch { /* UI cannot release work. */ } }
  }
  async inspect(timeoutMs = 31_000): Promise<RecoveryResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('RECOVERY_TIMEOUT_INVALID');
    if (!this.active) {
      const previous = this.snapshot.result;
      if (this.started && previous && previous.status !== 'OBSERVATION_PENDING') return previous;
      const begin = !this.started;
      this.started = true;
      this.module ??= Promise.resolve().then(this.load);
      const actual = this.module.then(async module => module
        ? decodeRecovery(await (begin ? module.beginLocalRecoveryCheck() : module.observeLocalRecoveryCheck()))
        : result('UNAVAILABLE')).catch(() => result('RECOVERY_REQUIRED'));
      this.active = actual;
      this.publish(true, previous);
      void actual.then(value => { this.active = null; this.publish(false, value); });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([this.active, new Promise<RecoveryResult>(resolve => {
        timer = setTimeout(() => resolve(result('OBSERVATION_PENDING')), timeoutMs);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
export const localRecoveryGate = new LocalRecoveryGate(() => import('./localRecoveryModule').then(m => m.loadLocalRecoveryModule()));
