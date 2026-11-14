import { decodeExecuteReply, decodeSnapshotReply, ownCallContext, ownProductCommand, type VeilCallContext, type VeilExecuteReply, type VeilSnapshotReply } from './productBoundary';
import type { VeilProductCommand } from './productModel';

/** Public native observations, never an account model or command authority. */
export type ProductPortModule = Readonly<{
  readNativeProductState(): Promise<unknown>;
  subscribeNativeProductInvalidation(): Promise<unknown>;
  unsubscribeNativeProductInvalidation(): Promise<unknown>;
  readNativeProductSnapshot?(context: string): Promise<unknown>;
  executeNativeProductCommand?(command: string, context: string): Promise<unknown>;
}>;

/** Normal calls share one native owner. Re-observing a receipt never dispatches
 * it twice, even after rejection. This class supplies no authority or retry loop. */
export class NormalProductCalls {
  private module: Promise<ProductPortModule | null> | null = null;
  private highWater = 0;
  private flight: Promise<unknown> | null = null;
  private last: Readonly<{ key: string; promise: Promise<unknown> }> | null = null;
  constructor(private readonly load: () => Promise<ProductPortModule | null>) {}
  private invoke<T>(context: VeilCallContext, command: VeilProductCommand | null,
    call: (module: ProductPortModule | null) => Promise<T>): Promise<T> {
    const key = JSON.stringify([context, command]);
    if (this.last?.key === key) return this.last.promise as Promise<T>;
    if (this.flight || context.callId <= this.highWater) return Promise.reject(new Error('VEIL_PRODUCT_ORIGINAL_RETAINED'));
    this.highWater = context.callId;
    const original = Promise.resolve().then(() => {
      this.module ??= this.load().catch(() => null);
      return this.module;
    }).then(call);
    this.last = Object.freeze({ key, promise: original });
    this.flight = original;
    void original.finally(() => { if (this.flight === original) this.flight = null; }).catch(() => undefined);
    return original;
  }
  read(rawContext: VeilCallContext): Promise<VeilSnapshotReply | null> {
    const context = ownCallContext(rawContext);
    if (context.action !== 'readSnapshot') throw new Error('VEIL_PRODUCT_CONTEXT_INVALID');
    return this.invoke(context, null, async module => {
      if (!module?.readNativeProductSnapshot || !module.executeNativeProductCommand) return null;
      const raw = await module.readNativeProductSnapshot(JSON.stringify(context));
      return Object.freeze({ context, snapshot: decodeSnapshotReply(raw, context) });
    });
  }
  execute(rawCommand: VeilProductCommand, rawContext: VeilCallContext): Promise<VeilExecuteReply> {
    const command = ownProductCommand(rawCommand), context = ownCallContext(rawContext);
    if (context.action !== command.type || context.accountViewRef === null ||
      context.viewRevision === null || (command.type !== 'reviewRecovery' && command.viewRevision !== context.viewRevision))
      throw new Error('VEIL_PRODUCT_CONTEXT_INVALID');
    return this.invoke(context, command, async module => {
      if (!module?.readNativeProductSnapshot || !module.executeNativeProductCommand)
        return Object.freeze({ context, result: Object.freeze({ kind: 'error' as const, code: 'UNAVAILABLE' as const }) });
      // Post-dispatch rejection reaches the controller's UNKNOWN path. It is
      // never rewritten as definite-not-applied UNAVAILABLE or a retry permit.
      const raw = await module.executeNativeProductCommand(JSON.stringify(command), JSON.stringify(context));
      return Object.freeze({ context, result: decodeExecuteReply(raw, context, command) });
    });
  }
}
export type AcceptedDeviceObservation = Readonly<{
  version: 1; kind: 'accepted-device-observation'; account: string; device: string;
  rootDigest: string; registrationDigest: string; finalDigest: string; currentDigest: string;
  currentSequence: string; revocationCheckpointDigest: string;
  observedIssuedMS: number; observedExpiresMS: number;
}>;
export type ProtectedMessageSessionObservation = Readonly<{
  version: 1; kind: 'protected-message-session-observation'; device: AcceptedDeviceObservation;
  local: Readonly<{name:string;deviceId:number}>; remote: Readonly<{name:string;deviceId:number}>;
  purposeDigest:string; selectedSessionDigest:string; relationDigest:string; checkpointDigest:string;
  relationRevision:string; purposeExpiresMS:number;
}>;
type InventoryFields = Readonly<{epoch:string;ownerStatus:number;closed:boolean;entryCount:number;enginePresent:boolean;changed:boolean;deviceAuthorization:'REQUIRED'}>;
export type ProductInventory = InventoryFields & (
  Readonly<{status:'INVENTORY_ONLY'}> |
  Readonly<{status:'DEVICE_OBSERVED';acceptedDevice:AcceptedDeviceObservation}> |
  Readonly<{status:'SESSION_OBSERVED';acceptedDevice:AcceptedDeviceObservation;protectedSession:ProtectedMessageSessionObservation}>
);
export type ProductPortState = ProductInventory | Readonly<{status:'UNAVAILABLE'|'CLOSED'|'PENDING'}>;
function bad(): never { throw new Error('VEIL_PRODUCT_INVENTORY_INVALID'); }
function ownRecord(raw: unknown, required: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return bad();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== required.length || required.some(k => !Object.hasOwn(descriptors, k)) ||
      keys.some(k => typeof k !== 'string' || !descriptors[k]?.enumerable || !Object.hasOwn(descriptors[k]!, 'value'))) return bad();
  const owned: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of keys as string[]) owned[k] = descriptors[k]!.value;
  return owned;
}
/** Decode only public evidence already observed by the original native owner.
 * No deadline, digest, status or identifier here can authorize an operation. */
export function decodeAcceptedDeviceObservation(raw: unknown): AcceptedDeviceObservation {
  const r = ownRecord(raw, ['version', 'kind', 'account', 'device', 'rootDigest',
    'registrationDigest', 'finalDigest', 'currentDigest', 'currentSequence',
    'revocationCheckpointDigest', 'observedIssuedMS', 'observedExpiresMS']);
  if (r.version !== 1 || r.kind !== 'accepted-device-observation') return bad();
  for (const key of ['account', 'device']) {
    if (typeof r[key] !== 'string' || !/^[!-~]{1,512}$/.test(r[key])) return bad();
  }
  for (const key of ['rootDigest', 'registrationDigest', 'finalDigest', 'currentDigest', 'revocationCheckpointDigest']) {
    if (typeof r[key] !== 'string' || !/^[0-9a-f]{64}$/.test(r[key]) || /^0+$/.test(r[key])) return bad();
  }
  if (typeof r.currentSequence !== 'string' || !/^[1-9][0-9]{0,19}$/.test(r.currentSequence) ||
      BigInt(r.currentSequence) > 18446744073709551615n) return bad();
  const issued = r.observedIssuedMS, expires = r.observedExpiresMS;
  if (typeof issued !== 'number' || typeof expires !== 'number' ||
      !Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued < 0 || expires <= issued) return bad();
  return Object.freeze(r) as AcceptedDeviceObservation;
}
export function decodeProtectedMessageSession(raw: unknown): ProtectedMessageSessionObservation {
  const r = ownRecord(raw, ['version','kind','device','local','remote','purposeDigest',
    'selectedSessionDigest','relationDigest','checkpointDigest','relationRevision','purposeExpiresMS']);
  if (r.version !== 1 || r.kind !== 'protected-message-session-observation') return bad();
  const address = (raw: unknown) => {
    const a = ownRecord(raw, ['name','deviceId']);
    if (typeof a.name !== 'string' || !a.name.length || a.name.includes('\u0000') ||
        !Number.isInteger(a.deviceId) || Number(a.deviceId) < 1 || Number(a.deviceId) > 127) return bad();
    let bytes = 0;
    for (let i = 0; i < a.name.length; i++) {
      const code = a.name.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = a.name.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) return bad();
        bytes += 4;
      } else {
        if (code >= 0xdc00 && code <= 0xdfff) return bad();
        bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
      }
      if (bytes > 128) return bad();
    }
    return Object.freeze({name:a.name,deviceId:Number(a.deviceId)});
  };
  const local = address(r.local), remote = address(r.remote);
  if (local.name === remote.name && local.deviceId === remote.deviceId) return bad();
  for (const key of ['purposeDigest','selectedSessionDigest','relationDigest','checkpointDigest'])
    if (typeof r[key] !== 'string' || !/^[0-9a-f]{64}$/.test(r[key]) || /^0+$/.test(r[key])) return bad();
  if (typeof r.relationRevision !== 'string' || !/^[1-9][0-9]{0,19}$/.test(r.relationRevision) ||
      BigInt(r.relationRevision) > 18446744073709551615n ||
      typeof r.purposeExpiresMS !== 'number' || !Number.isSafeInteger(r.purposeExpiresMS) || r.purposeExpiresMS <= 0) return bad();
  return Object.freeze({...r, local, remote, device:decodeAcceptedDeviceObservation(r.device)}) as ProtectedMessageSessionObservation;
}
export function decodeProductInventory(raw:unknown):ProductPortState {
  if (!raw || typeof raw !== 'object') return bad();
  const status = Object.getOwnPropertyDescriptor(raw, 'status');
  if (!status || !Object.hasOwn(status, 'value')) return bad();
  if (status.value !== 'INVENTORY_ONLY' && status.value !== 'DEVICE_OBSERVED' && status.value !== 'SESSION_OBSERVED') {
    const r = ownRecord(raw, ['status']);
    if (typeof r.status !== 'string' || !['UNAVAILABLE','CLOSED','PENDING'].includes(r.status)) return bad();
    return Object.freeze({status:r.status as 'UNAVAILABLE'|'CLOSED'|'PENDING'});
  }
  const session = status.value === 'SESSION_OBSERVED';
  const observed = status.value === 'DEVICE_OBSERVED' || session;
  const r = ownRecord(raw, ['status','epoch','ownerStatus','closed','entryCount','enginePresent','changed','deviceAuthorization', ...(observed ? ['acceptedDevice'] : []), ...(session ? ['protectedSession'] : [])]);
  if (typeof r.epoch !== 'string' || !/^[1-9][0-9]{0,18}$/.test(r.epoch) || BigInt(r.epoch) > 9223372036854775807n ||
      !Number.isInteger(r.ownerStatus) || Number(r.ownerStatus) < 0 || Number(r.ownerStatus) > 2147483647 ||
      !Number.isInteger(r.entryCount) || Number(r.entryCount) < 0 || Number(r.entryCount) > 32 ||
      typeof r.closed !== 'boolean' || typeof r.enginePresent !== 'boolean' ||
      typeof r.changed !== 'boolean' || r.deviceAuthorization !== 'REQUIRED') return bad();
  if (observed) {
    if (r.closed || r.ownerStatus === 16 || r.ownerStatus === 25) return bad();
    r.acceptedDevice = decodeAcceptedDeviceObservation(r.acceptedDevice);
  }
  if (session) {
    if (r.ownerStatus !== 0) return bad();
    const projection = decodeProtectedMessageSession(r.protectedSession);
    const device = r.acceptedDevice as AcceptedDeviceObservation;
    for (const key of Object.keys(device) as (keyof AcceptedDeviceObservation)[])
      if (device[key] !== projection.device[key]) return bad();
    r.protectedSession = projection;
  }
  return Object.freeze(r) as ProductInventory;
}
/** Change detection is for refreshing a view, not permission or revocation push. */
export function productObservationKey(value: ProductPortState): string {
  if (value.status !== 'INVENTORY_ONLY' && value.status !== 'DEVICE_OBSERVED' && value.status !== 'SESSION_OBSERVED') return value.status;
  return JSON.stringify([value.status, value.epoch, value.ownerStatus, value.closed,
    value.entryCount, value.enginePresent, value.status !== 'INVENTORY_ONLY' ? value.acceptedDevice : null,
    value.status === 'SESSION_OBSERVED' ? value.protectedSession : null]);
}
export class ProductInventoryObservation {
  private module:Promise<ProductPortModule|null>|null=null;
  private flight:Promise<ProductPortState>|null=null;
  private attached=false;
  private detaching:Promise<void>|null=null;
  private listeners=new Set<()=>void>();
  private timer:ReturnType<typeof setTimeout>|null=null;
  private last:string|null=null;
  constructor(private readonly load:()=>Promise<ProductPortModule|null>){}
  private loaded(){return this.module??=this.load().catch(()=>null);}
  read():Promise<ProductPortState> {
    if(this.flight)return this.flight;
    const original=this.sample();this.flight=original;
    void original.finally(()=>{if(this.flight===original)this.flight=null;}).catch(()=>undefined);
    return original;
  }
  private async sample():Promise<ProductPortState>{
    try {
      // A read started during cleanup waits for the original unsubscribe and
      // samples the real inventory. Cleanup has no product-state result.
      await this.detaching;
      const module=await this.loaded();if(!module)return Object.freeze({status:'UNAVAILABLE'});
      const starting=this.listeners.size>0&&!this.attached;
      if(starting)this.attached=true; // Retain cleanup even if subscription's response fails.
      return decodeProductInventory(await(starting?module.subscribeNativeProductInvalidation():module.readNativeProductState()));
    }catch{return Object.freeze({status:'UNAVAILABLE'});}
  }
  subscribe(listener:()=>void):()=>void {
    this.listeners.add(listener);if(this.listeners.size===1)void this.pump();
    let live=true;
    return ()=>{if(!live)return;live=false;this.listeners.delete(listener);if(!this.listeners.size){if(this.timer)clearTimeout(this.timer);this.timer=null;void this.detach();}};
  }
  private detach():Promise<void>{
    if(this.detaching)return this.detaching;
    const original=this.performDetach();this.detaching=original;
    void original.finally(()=>{if(this.detaching===original)this.detaching=null;}).catch(()=>undefined);
    return original;
  }
  private async performDetach(){
    await this.flight;
    if(this.listeners.size||!this.attached)return;
    const module=await this.loaded();
    if(this.listeners.size||!this.attached||!module)return;
    try {
      await module.unsubscribeNativeProductInvalidation();
      this.attached=false;
    } catch { /* Original native failure retained. */ }
  }
  private async pump(){
    const result=await this.read();
    if(!this.listeners.size){await this.detach();return;}
    const key=productObservationKey(result);
    const changed=this.last!==null&&this.last!==key;this.last=key;
    if(changed)for(const listener of [...this.listeners])try{listener();}catch{/* isolate observers */}
    if(this.timer)clearTimeout(this.timer);
    // Sampling is not revocation push or a pending-operation progress scheduler.
    this.timer=setTimeout(()=>{this.timer=null;void this.pump();},1000);
  }
}
