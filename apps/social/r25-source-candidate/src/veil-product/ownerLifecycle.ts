import {decodeNativeLocalOwner, type VeilLocalOwnerRead} from './localOwner';
export const closeStatuses = ['NOT_SELECTED', 'NOT_OPENED', 'OBSERVATION_PENDING', 'CLOSED_LOCAL_ONLY', 'PENDING_RECONCILIATION_REQUIRED', 'CLOSE_RECEIPT_FAILED'] as const;
export type OwnerLifecycle = Readonly<{closeStatus: typeof closeStatuses[number]; nativeBoundary: 'REQUIRED'; owner: VeilLocalOwnerRead | null}>;
export type OwnerLifecycleModule = Readonly<{closeLocalOwner(): Promise<unknown>; observeLocalOwnerLifecycle(): Promise<unknown>}>;
export function decodeOwnerLifecycle(raw: unknown): OwnerLifecycle {
  if (!raw || typeof raw !== 'object' || ![null,Object.prototype].includes(Object.getPrototypeOf(raw))) throw Error('INVALID_OWNER_LIFECYCLE');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).length !== 3 || !['closeStatus','nativeBoundary','owner'].every(k => fields[k]?.enumerable && Object.hasOwn(fields[k]!, 'value'))) throw Error('INVALID_OWNER_LIFECYCLE');
  const closeStatus = fields.closeStatus?.value;
  if (!closeStatuses.includes(closeStatus) || fields.nativeBoundary?.value !== 'REQUIRED') throw Error('INVALID_OWNER_LIFECYCLE');
  const owner = fields.owner?.value === null ? null : decodeNativeLocalOwner(fields.owner?.value);
  if (closeStatus === 'NOT_OPENED' && owner !== null) throw Error('INVALID_OWNER_LIFECYCLE');
  if (closeStatus === 'CLOSED_LOCAL_ONLY' && (owner?.status !== 'OBSERVED' || owner.ownerState !== 'CLOSED')) throw Error('INVALID_OWNER_LIFECYCLE');
  return Object.freeze({closeStatus,nativeBoundary:'REQUIRED',owner});
}
type Snapshot = Readonly<{selected: boolean; pending: boolean; result: OwnerLifecycle | null; observationFailed: boolean}>;
/** Process-local UI receipt ownership, not a durable recovery or release proof. */
export class OwnerLifecycleGate {
  private module: Promise<OwnerLifecycleModule | null> | null = null;
  private active: Promise<void> | null = null;
  private state: Snapshot = Object.freeze({selected:false,pending:false,result:null,observationFailed:false});
  private listeners = new Set<() => void>();
  constructor(private readonly load: () => Promise<OwnerLifecycleModule | null>) {}
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(delta: Partial<Snapshot>) {this.state = Object.freeze({...this.state,...delta}); for (const listener of this.listeners) {try {listener();} catch {}}}
  observe(): Promise<void> {return this.run(false);}
  closeOriginal(): Promise<void> {return this.run(true);}
  private run(close: boolean): Promise<void> {
    if (this.active) return this.active;
    const select = close && !this.state.selected;
    // Sticky before asynchronous module load. No retry after rejection/timeout.
    if (select) this.publish({selected:true});
    this.module ??= Promise.resolve().then(this.load);
    const actual = this.module.then(async module => {
      if (!module) throw Error('MODULE_UNAVAILABLE');
      if (select) {try {await module.closeLocalOwner();} catch { /* Read the actual retained receipt; do not claim release. */ }}
      const result = decodeOwnerLifecycle(await module.observeLocalOwnerLifecycle());
      this.publish({result,observationFailed:false});
    }).catch(() => {this.publish({observationFailed:true});}).finally(() => {
      if (this.active === actual) {this.active=null; this.publish({pending:false});}
    });
    this.active = actual; this.publish({pending:true}); return actual;
  }
}
export const ownerLifecycleGate = new OwnerLifecycleGate(() => import('./ownerLifecycleModule').then(m => m.loadOwnerLifecycleModule()));
