/** Local device preparation is never account or device authority. */
export const localDeviceSetupStatuses = ['LOCAL_INITIALIZATION_PENDING', 'RECOVERY_REQUIRED', 'AUTHENTICATION_CANCELLED', 'SCREEN_LOCK_REQUIRED', 'UNAVAILABLE'] as const;
export type LocalDeviceSetupResult = Readonly<{
  status: typeof localDeviceSetupStatuses[number] | 'OBSERVATION_TIMEOUT';
  nativeBoundary: 'REQUIRED'; deviceAuthorization: 'REQUIRED';
}>;
export type LocalDeviceSetupModule = Readonly<{initializeLocalDevice(locale: 'en' | 'zh'): Promise<unknown>}>;
const unavailable = (): LocalDeviceSetupResult => Object.freeze({status:'UNAVAILABLE',nativeBoundary:'REQUIRED',deviceAuthorization:'REQUIRED'});
export function decodeLocalDeviceSetup(raw: unknown): LocalDeviceSetupResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null,Object.prototype].includes(Object.getPrototypeOf(raw))) throw Error('INVALID_LOCAL_DEVICE_SETUP');
  const descriptors=Object.getOwnPropertyDescriptors(raw),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==3 || keys.some(k=>typeof k!=='string'||!['status','nativeBoundary','deviceAuthorization'].includes(k))) throw Error('INVALID_LOCAL_DEVICE_SETUP');
  for(const key of ['status','nativeBoundary','deviceAuthorization']) {
    const d=descriptors[key];
    if(!d||!d.enumerable||!Object.hasOwn(d,'value')) throw Error('INVALID_LOCAL_DEVICE_SETUP');
  }
  const status:unknown=descriptors.status?.value;
  if(!localDeviceSetupStatuses.includes(status as typeof localDeviceSetupStatuses[number]) || descriptors.nativeBoundary?.value!=='REQUIRED' || descriptors.deviceAuthorization?.value!=='REQUIRED') throw Error('INVALID_LOCAL_DEVICE_SETUP');
  return Object.freeze({status:status as typeof localDeviceSetupStatuses[number],nativeBoundary:'REQUIRED',deviceAuthorization:'REQUIRED'});
}

/** Observe the same physical native call across JS timeouts. No automatic retry,
 * replacement loader or success cache; the durable native intent owns recovery.
 */
export class LocalDeviceSetupGate {
  private active: Promise<LocalDeviceSetupResult> | null = null;
  private readonly listeners = new Set<()=>void>();
  readonly isPending = () => this.active !== null;
  readonly subscribe = (listener:()=>void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed() { for (const listener of this.listeners) { try { listener(); } catch { /* A UI observer cannot release native ownership. */ } } }
  constructor(private readonly load:()=>Promise<LocalDeviceSetupModule|null>) {}
  async observe(locale:'en'|'zh',timeoutMs=31_000):Promise<LocalDeviceSetupResult> {
    if((locale!=='en'&&locale!=='zh')||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120_000) throw Error('INVALID_LOCAL_DEVICE_SETUP_OBSERVATION');
    if(!this.active) {
      const actual=Promise.resolve().then(this.load).then(async module=>{
        if(!module) return unavailable();
        return decodeLocalDeviceSetup(await module.initializeLocalDevice(locale));
      }).catch(unavailable);
      this.active=actual;
      this.changed();
      void actual.then(()=>{if(this.active===actual){this.active=null;this.changed();}});
    }
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<LocalDeviceSetupResult>(resolve=>{timer=setTimeout(()=>resolve(Object.freeze({status:'OBSERVATION_TIMEOUT',nativeBoundary:'REQUIRED',deviceAuthorization:'REQUIRED'})),timeoutMs);});
    try{return await Promise.race([this.active,deadline]);}
    finally{if(timer!==undefined)clearTimeout(timer);}
  }
}
export const localDeviceSetupGate = new LocalDeviceSetupGate(()=>import('./localDeviceSetupModule').then(module=>module.loadLocalDeviceSetupModule()));

export type LocalAuthenticationStatus = 'LOCAL_SETUP_REQUIRED' | 'LOCAL_INSPECTION_REQUIRED' | 'AUTHENTICATION_ELIGIBLE' | 'AUTHENTICATION_PENDING' | 'LOCAL_KEYS_AUTHENTICATED' | 'AUTHENTICATION_CANCELLED' | 'SCREEN_LOCK_REQUIRED' | 'RECOVERY_REQUIRED' | 'UNAVAILABLE';
export type LocalAuthenticationResult = Readonly<{status: LocalAuthenticationStatus; nativeBoundary: 'REQUIRED'; deviceAuthorization: 'REQUIRED'}>;
export type LocalAuthenticationModule = Readonly<{readLocalDeviceAuthenticationEligibility(): Promise<unknown>; continueLocalDevice(locale: 'en' | 'zh'): Promise<unknown>; observeLocalDeviceAuthentication(): Promise<unknown>}>;
export const canContinueLocalAuthentication = (status: LocalAuthenticationStatus) => ['LOCAL_SETUP_REQUIRED', 'LOCAL_INSPECTION_REQUIRED', 'AUTHENTICATION_PENDING', 'AUTHENTICATION_CANCELLED', 'SCREEN_LOCK_REQUIRED'].includes(status);
const authenticationResult = (status: LocalAuthenticationStatus): LocalAuthenticationResult => Object.freeze({status, nativeBoundary: 'REQUIRED', deviceAuthorization: 'REQUIRED'});
export function decodeLocalAuthentication(raw: unknown): LocalAuthenticationResult {
  if (!raw || typeof raw !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw Error('INVALID_LOCAL_AUTHENTICATION');
  const ds = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(ds).length !== 3) throw Error('INVALID_LOCAL_AUTHENTICATION');
  for (const key of ['status', 'nativeBoundary', 'deviceAuthorization']) {
    if (!ds[key]?.enumerable || !Object.hasOwn(ds[key]!, 'value')) throw Error('INVALID_LOCAL_AUTHENTICATION');
  }
  if (!['LOCAL_SETUP_REQUIRED', 'LOCAL_INSPECTION_REQUIRED', 'AUTHENTICATION_ELIGIBLE', 'AUTHENTICATION_PENDING', 'LOCAL_KEYS_AUTHENTICATED', 'AUTHENTICATION_CANCELLED', 'SCREEN_LOCK_REQUIRED', 'RECOVERY_REQUIRED', 'UNAVAILABLE'].includes(ds.status!.value) || ds.nativeBoundary!.value !== 'REQUIRED' || ds.deviceAuthorization!.value !== 'REQUIRED') throw Error('INVALID_LOCAL_AUTHENTICATION');
  return authenticationResult(ds.status!.value);
}

/** A new system prompt is allowed only on explicit press after observed cancel
 * or missing screen lock. Native input/pair remains the same. No reset API. */
export class LocalAuthenticationGate {
  private module: Promise<LocalAuthenticationModule | null> | null = null;
  private active: Promise<LocalAuthenticationResult> | null = null;
  private snapshot: Readonly<{pending: boolean; result: LocalAuthenticationResult | null}> = Object.freeze({pending: false, result: null});
  private listeners = new Set<() => void>();
  constructor(private readonly load: () => Promise<LocalAuthenticationModule | null>) {}
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(pending: boolean, result: LocalAuthenticationResult | null) {
    this.snapshot = Object.freeze({pending, result});
    for (const fn of this.listeners) { try { fn(); } catch { /* UI cannot cancel work. */ } }
  }
  async inspect(locale: 'en' | 'zh', timeoutMs = 31_000): Promise<LocalAuthenticationResult> {
    if (!['en', 'zh'].includes(locale) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('INVALID_AUTHENTICATION_OBSERVATION');
    if (!this.active) {
      const previous = this.snapshot.result;
      if (previous && !canContinueLocalAuthentication(previous.status)) return previous;
      const observe = previous?.status === 'AUTHENTICATION_PENDING';
      this.module ??= Promise.resolve().then(this.load);
      const actual = this.module.then(async module => {
        if (!module) return authenticationResult('UNAVAILABLE');
        if (!observe) {
          const eligibility = decodeLocalAuthentication(await module.readLocalDeviceAuthenticationEligibility());
          if (eligibility.status !== 'AUTHENTICATION_ELIGIBLE') {
            if (!['LOCAL_SETUP_REQUIRED', 'LOCAL_INSPECTION_REQUIRED', 'RECOVERY_REQUIRED', 'UNAVAILABLE'].includes(eligibility.status)) throw Error('INVALID_AUTHENTICATION_ELIGIBILITY');
            return eligibility;
          }
        }
        const value = decodeLocalAuthentication(await (observe ? module.observeLocalDeviceAuthentication() : module.continueLocalDevice(locale)));
        if (value.status === 'AUTHENTICATION_ELIGIBLE') throw Error('ELIGIBILITY_IS_NOT_COMPLETION');
        return value;
      })
        .catch(() => authenticationResult('RECOVERY_REQUIRED'));
      this.active = actual;
      this.publish(true, previous);
      void actual.then(value => { this.active = null; this.publish(false, value); });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.active, new Promise<LocalAuthenticationResult>(resolve => {
      timer = setTimeout(() => resolve(authenticationResult('AUTHENTICATION_PENDING')), timeoutMs);
    })]); } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
export const localAuthenticationGate = new LocalAuthenticationGate(() => import('./localDeviceSetupModule').then(m => m.loadLocalAuthenticationModule()));
