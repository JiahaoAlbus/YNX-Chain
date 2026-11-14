/** Public lifecycle projection only. No account, permit, ticket or crypto state. */
export const ownerStates = ['STARTING', 'LOCAL_PENDING', 'RECOVERY_PENDING', 'CLOSING', 'DRAIN_REQUIRED', 'CLOSE_UNRESOLVED', 'CLOSED', 'INIT_FAILED'] as const;
export const pendingStoreStates = ['FRESH', 'READY', 'RECONCILIATION_REQUIRED', 'UNKNOWN', 'CLOSED'] as const;
export const localGenesisStatuses = [16, 21, 22, 23, 24, 25, 34, 36, 41, 42, 43, 44] as const;
export type VeilLocalOwnerRead = Readonly<{
  status: 'OBSERVED'; ownerState: typeof ownerStates[number]; queued: number;
  pendingTickets: number; reopenedPendingRows: number;
  pendingStoreState: typeof pendingStoreStates[number] | null;
  failureRetained: boolean; nativeBoundary: 'REQUIRED';
  localGenesisAttempted: boolean; localGenesisStatus: typeof localGenesisStatuses[number] | null;
}> | Readonly<{ status: 'MODULE_UNAVAILABLE' | 'READ_FAILED' | 'READ_TIMEOUT' | 'INVALID_REPLY'; nativeBoundary: 'REQUIRED' }>;
export function ownerReadFailure(status: Exclude<VeilLocalOwnerRead['status'], 'OBSERVED'>): VeilLocalOwnerRead {
  return Object.freeze({ status, nativeBoundary: 'REQUIRED' });
}
function fields(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw new Error('VEIL_LOCAL_OWNER_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(k => typeof k !== 'string' || !keys.includes(k))) throw new Error('VEIL_LOCAL_OWNER_INVALID');
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) throw new Error('VEIL_LOCAL_OWNER_INVALID');
    copy[key] = d.value;
  }
  return copy;
}
function count(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 2147483647) throw new Error('VEIL_LOCAL_OWNER_INVALID');
  return raw;
}
export function decodeNativeLocalOwner(raw: unknown): VeilLocalOwnerRead {
  const r = fields(raw, ['ownerState', 'queued', 'pendingTickets', 'reopenedPendingRows', 'pendingStoreState', 'failureRetained', 'nativeBoundary', 'localGenesisAttempted', 'localGenesisStatus']);
  if (!ownerStates.includes(r.ownerState as typeof ownerStates[number]) || (r.pendingStoreState !== null && !pendingStoreStates.includes(r.pendingStoreState as typeof pendingStoreStates[number])) || typeof r.failureRetained !== 'boolean' || r.nativeBoundary !== 'REQUIRED') throw new Error('VEIL_LOCAL_OWNER_INVALID');
  if (typeof r.localGenesisAttempted !== 'boolean' ||
      (r.localGenesisStatus !== null && !localGenesisStatuses.includes(r.localGenesisStatus as typeof localGenesisStatuses[number])) ||
      (!r.localGenesisAttempted && r.localGenesisStatus !== null)) throw new Error('VEIL_LOCAL_OWNER_INVALID');
  return Object.freeze({ status: 'OBSERVED', ownerState: r.ownerState as typeof ownerStates[number], queued: count(r.queued), pendingTickets: count(r.pendingTickets), reopenedPendingRows: count(r.reopenedPendingRows), pendingStoreState: r.pendingStoreState as typeof pendingStoreStates[number] | null, failureRetained: r.failureRetained, nativeBoundary: 'REQUIRED', localGenesisAttempted: r.localGenesisAttempted, localGenesisStatus: r.localGenesisStatus as typeof localGenesisStatuses[number] | null });
}
/** R4 snapshot boundary re-owns the adapter projection; never accepts authority. */
export function decodeLocalOwnerProjection(raw: unknown): VeilLocalOwnerRead {
  const status = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'status') : undefined;
  if (!status || !Object.hasOwn(status, 'value')) throw new Error('VEIL_LOCAL_OWNER_INVALID');
  if (status.value === 'OBSERVED') {
    const r = fields(raw, ['status', 'ownerState', 'queued', 'pendingTickets', 'reopenedPendingRows', 'pendingStoreState', 'failureRetained', 'nativeBoundary', 'localGenesisAttempted', 'localGenesisStatus']);
    delete r.status; return decodeNativeLocalOwner(r);
  }
  const r = fields(raw, ['status', 'nativeBoundary']);
  if (!['MODULE_UNAVAILABLE', 'READ_FAILED', 'READ_TIMEOUT', 'INVALID_REPLY'].includes(r.status as string) || r.nativeBoundary !== 'REQUIRED') throw new Error('VEIL_LOCAL_OWNER_INVALID');
  return ownerReadFailure(r.status as Exclude<VeilLocalOwnerRead['status'], 'OBSERVED'>);
}
/** A JS deadline is observation uncertainty, never native cancellation/close.
 * Pending work remains shared after timeout until the same promise settles.
 */
export class LocalOwnerReadGate {
  private pending: Promise<VeilLocalOwnerRead> | null = null;
  async read(readOperation: () => Promise<unknown>, timeoutMs = 31000): Promise<VeilLocalOwnerRead> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 31000) throw new Error('VEIL_LOCAL_OWNER_TIMEOUT_BOUND');
    if (!this.pending) {
      const operation = Promise.resolve().then(readOperation).then(raw => {
        try { return decodeNativeLocalOwner(raw); } catch { return ownerReadFailure('INVALID_REPLY'); }
      }, () => ownerReadFailure('READ_FAILED'));
      this.pending = operation;
      void operation.then(() => { if (this.pending === operation) this.pending = null; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<VeilLocalOwnerRead>(resolve => { timer = setTimeout(() => resolve(ownerReadFailure('READ_TIMEOUT')), timeoutMs); });
    try { return await Promise.race([this.pending, deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

export type LocalOwnerReadModule = Readonly<{ readLocalOwnerState(): Promise<unknown> }>;
/** Actual production pipeline: load and native read are one retained operation. */
export async function readLoadedOwner(load: () => Promise<LocalOwnerReadModule | null>): Promise<VeilLocalOwnerRead> {
  let module: LocalOwnerReadModule | null;
  try { module = await load(); } catch { return ownerReadFailure('MODULE_UNAVAILABLE'); }
  if (!module) return ownerReadFailure('MODULE_UNAVAILABLE');
  let raw: unknown;
  try { raw = await module.readLocalOwnerState(); } catch { return ownerReadFailure('READ_FAILED'); }
  try { return decodeNativeLocalOwner(raw); } catch { return ownerReadFailure('INVALID_REPLY'); }
}
/** Total observation deadline starts before loader await. It does not settle,
 * clear or replace the actual load/read promise when a caller times out. */
export class LocalOwnerObservationGate {
  private pending: Promise<VeilLocalOwnerRead> | null = null;
  async observe(operation: () => Promise<VeilLocalOwnerRead>, timeoutMs = 31000): Promise<VeilLocalOwnerRead> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 31000) throw new Error('VEIL_LOCAL_OWNER_TIMEOUT_BOUND');
    if (!this.pending) {
      const actual = Promise.resolve().then(operation).then(value => {
        try { return decodeLocalOwnerProjection(value); } catch { return ownerReadFailure('INVALID_REPLY'); }
      }, () => ownerReadFailure('READ_FAILED'));
      this.pending = actual;
      void actual.then(() => { if (this.pending === actual) this.pending = null; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<VeilLocalOwnerRead>(resolve => { timer = setTimeout(() => resolve(ownerReadFailure('READ_TIMEOUT')), timeoutMs); });
    try { return await Promise.race([this.pending, deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
