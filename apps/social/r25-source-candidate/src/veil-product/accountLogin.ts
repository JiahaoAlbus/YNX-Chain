import {decodeLoginFailureDiagnostic, type LoginFailureDiagnostic} from './loginFailureDiagnostic';
import type {AccountEntryCase} from './accountEntry';
import {decodeReturnLinkDiagnostic, type ReturnLinkDiagnostic} from './returnLinkDiagnostic';

export const accountLoginStatuses = ['UNAVAILABLE', 'VERIFIED_CALLBACK_REQUIRED', 'AUTHORIZATION_OPENED', 'AWAIT_CALLBACK', 'REVIEW_REQUIRED', 'ACCOUNT_OBSERVED', 'CANCELLED', 'REFUSED', 'BUSY', 'OBSERVATION_PENDING', 'CLOSED'] as const;
export type AccountLoginStatus = typeof accountLoginStatuses[number];
export type AccountLoginResult = Readonly<{status: AccountLoginStatus; deviceAuthorization: 'REQUIRED'}>;
export type AccountLoginOriginal = Readonly<{status: AccountLoginStatus; deviceAuthorization: 'REQUIRED'; scope: 'PROCESS' | 'NATIVE_STORAGE'; originalState: 'ABSENT' | 'RETAINED' | 'UNAVAILABLE'; intent: AccountEntryCase | null}>;
/** UI ownership only; never appended to the native two-field projection. */
export type AccountLoginOriginalState = AccountLoginOriginal['originalState'] | 'UNREAD' | 'PENDING';
export type AccountLoginSnapshot = Readonly<{intent: AccountEntryCase | null; status: AccountLoginStatus | null; pending: boolean; originalState?: AccountLoginOriginalState; diagnostic?: ReturnLinkDiagnostic; failureDiagnostic?: LoginFailureDiagnostic}>;
export type AccountLoginModule = Readonly<{
  beginAccountLogin(intent: 'A' | 'B' | 'C' | 'D'): Promise<unknown>;
  observeAccountLogin(): Promise<unknown>;
  cancelAccountLogin(): Promise<unknown>;
  readAccountLoginOriginal?(): Promise<unknown>;
  readAccountLoginDiagnostic?(): Promise<unknown>;
  readAccountLoginFailureDiagnostic?(): Promise<unknown>;
}>;
const result = (status: AccountLoginStatus): AccountLoginResult => Object.freeze({status, deviceAuthorization: 'REQUIRED'});
const intents = Object.freeze({newIdentityFirstDevice: 'A', existingIdentityAddDevice: 'B', restoreIdentity: 'C', revokedDeviceAttempt: 'D'} as const);

/** Native original association only; storage scope never grants account/device authority. */
export function decodeAccountLoginOriginal(raw: unknown): AccountLoginOriginal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw Error('INVALID_ACCOUNT_LOGIN_ORIGINAL');
  const fields = Object.getOwnPropertyDescriptors(raw);
  const names = ['version', 'scope', 'originalState', 'originalCase', 'status', 'deviceAuthorization'];
  if (Reflect.ownKeys(fields).length !== names.length || Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !names.includes(key))) throw Error('INVALID_ACCOUNT_LOGIN_ORIGINAL');
  for (const name of names) if (!fields[name]?.enumerable || !Object.hasOwn(fields[name], 'value')) throw Error('INVALID_ACCOUNT_LOGIN_ORIGINAL');
  const scope: unknown = fields.scope?.value;
  if (fields.version?.value !== 1 || (scope !== 'PROCESS' && scope !== 'NATIVE_STORAGE')) throw Error('INVALID_ACCOUNT_LOGIN_ORIGINAL');
  const originalState: unknown = fields.originalState?.value;
  const selected: unknown = fields.originalCase?.value;
  if (!['ABSENT', 'RETAINED', 'UNAVAILABLE'].includes(originalState as string)) throw Error('INVALID_ACCOUNT_LOGIN_ORIGINAL');
  const intent = (Object.keys(intents) as AccountEntryCase[]).find(key => intents[key] === selected) ?? null;
  if (originalState === 'RETAINED' ? intent === null : selected !== null) throw Error('INVALID_ACCOUNT_LOGIN_ORIGINAL');
  const observed = decodeAccountLogin({status: fields.status?.value, deviceAuthorization: fields.deviceAuthorization?.value});
  return Object.freeze({...observed, scope, originalState: originalState as AccountLoginOriginal['originalState'], intent});
}

export function decodeAccountLogin(raw: unknown): AccountLoginResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw Error('INVALID_ACCOUNT_LOGIN');
  const fields = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(fields);
  if (keys.length !== 2 || keys.some(key => key !== 'status' && key !== 'deviceAuthorization')) throw Error('INVALID_ACCOUNT_LOGIN');
  for (const key of ['status', 'deviceAuthorization']) {
    const descriptor = fields[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error('INVALID_ACCOUNT_LOGIN');
  }
  const status: unknown = fields.status?.value;
  if (typeof status !== 'string' || !accountLoginStatuses.includes(status as AccountLoginStatus) || fields.deviceAuthorization?.value !== 'REQUIRED') throw Error('INVALID_ACCOUNT_LOGIN');
  return result(status as AccountLoginStatus);
}

/** Public projection only. Native owns the original attempt and browser secrets.
 * Observation timeout retains this physical call; no auto start/retry/cancel.
 */
export class AccountLoginGate {
  private active: Promise<AccountLoginResult> | null = null;
  private activeKey: string | null = null;
  private originalIntent: AccountEntryCase | null = null;
  private beginSelected = false;
  private originalState: AccountLoginOriginalState = 'UNREAD';
  private module: Promise<AccountLoginModule | null> | null = null;
  private status: AccountLoginStatus | null = null;
  private diagnostic: ReturnLinkDiagnostic | undefined;
  private failureDiagnostic: LoginFailureDiagnostic | undefined;
  private snapshot: AccountLoginSnapshot = Object.freeze({intent: null, status: null, pending: false, originalState: 'UNREAD'});
  private readonly listeners = new Set<() => void>();
  readonly isPending = () => this.active !== null;
  readonly getSnapshot = () => this.snapshot;
  readonly canSelectIntent = (intent: AccountEntryCase) => Object.hasOwn(intents, intent) && (this.originalState === 'ABSENT' || this.originalState === 'RETAINED') && (this.originalIntent === null || this.originalIntent === intent);
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  constructor(private readonly load: () => Promise<AccountLoginModule | null>) {}
  private changed() {
    this.snapshot = Object.freeze({intent: this.originalIntent, status: this.status, pending: this.active !== null, originalState: this.originalState, ...(this.diagnostic ? {diagnostic: this.diagnostic} : {}), ...(this.failureDiagnostic ? {failureDiagnostic: this.failureDiagnostic} : {})});
    for (const listener of this.listeners) { try { listener(); } catch { /* UI cannot release native custody. */ } }
  }
  /** Foreground/remount observation never infers a new intent or begins login. */
  async observeOriginal(timeoutMs = 31_000): Promise<AccountLoginResult> {
    return this.originalIntent === null ? result('REVIEW_REQUIRED') : this.execute('observe', this.originalIntent, timeoutMs);
  }

  /** Recover a lost JS selection from the existing native process owner. */
  async recoverOriginal(timeoutMs = 31_000): Promise<AccountLoginResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('INVALID_ACCOUNT_LOGIN_OBSERVATION');
    if (this.originalIntent !== null) return this.observeOriginal(timeoutMs);
    if (this.active && this.activeKey !== 'recover') return result('BUSY');
    if (!this.active) {
      if (this.module === null) this.module = Promise.resolve().then(this.load);
      const call = this.module.then(async module => {
        if (!module) { this.originalState = 'UNAVAILABLE'; return result('UNAVAILABLE'); }
        if (!module.readAccountLoginOriginal) { this.originalState = 'UNAVAILABLE'; return result('REVIEW_REQUIRED'); }
        const observed = decodeAccountLoginOriginal(await module.readAccountLoginOriginal());
        this.originalState = observed.originalState;
        if (observed.originalState === 'RETAINED') {
          if (this.originalIntent !== null && this.originalIntent !== observed.intent) return result('BUSY');
          this.originalIntent = observed.intent;
          this.beginSelected = true;
        }
        return result(observed.status);
      }).catch(() => { this.originalState = 'UNAVAILABLE'; return result('REVIEW_REQUIRED'); });
      this.active = call; this.activeKey = 'recover'; this.originalState = 'PENDING'; this.status = 'OBSERVATION_PENDING'; this.changed();
      void call.then(reply => { if (this.active === call) { this.status = reply.status; this.active = null; this.activeKey = null; this.changed(); } });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<AccountLoginResult>(resolve => { timer = setTimeout(() => resolve(result('OBSERVATION_PENDING')), timeoutMs); });
    try { return await Promise.race([this.active, deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }

  /** Explicit user continuation of the SAME native-stored request, never a new intent. */
  async resumeOriginal(timeoutMs = 31_000): Promise<AccountLoginResult> {
    return this.originalIntent === null ? result('REVIEW_REQUIRED') : this.execute('resume', this.originalIntent, timeoutMs);
  }

  async execute(operation: 'begin' | 'observe' | 'cancel' | 'resume', intent: AccountEntryCase, timeoutMs = 31_000): Promise<AccountLoginResult> {
    if (!Object.hasOwn(intents, intent) || !['begin', 'observe', 'cancel', 'resume'].includes(operation) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('INVALID_ACCOUNT_LOGIN_OBSERVATION');
    if (this.activeKey === 'recover') return result('BUSY');
    if (operation === 'begin' && this.originalIntent === null) {
      if (this.originalState === 'UNREAD') {
        const observed = await this.recoverOriginal(timeoutMs);
        if (this.activeKey === 'recover') return observed;
        const currentState = this.getSnapshot().originalState;
        if (currentState !== 'ABSENT' && currentState !== 'RETAINED') return observed;
      } else if (this.originalState !== 'ABSENT' && this.originalState !== 'RETAINED') return result('REVIEW_REQUIRED');
    }
    // Retain before load/preflight/native effects. Neither cancellation nor an
    // immediate snapshot proves native custody ended. There is no reset API.
    if (this.originalIntent === null) {
      if (operation !== 'begin') return result('REVIEW_REQUIRED');
      this.originalIntent = intent;
      this.originalState = 'RETAINED';
    } else if (this.originalIntent !== intent) return result('BUSY');
    // A later same-intent begin is observation ONLY, never another native start.
    const key = operation === 'begin' ? (!this.beginSelected || this.activeKey === 'begin' ? 'begin' : 'observe') : operation;
    if (this.active && this.activeKey !== key) return result('BUSY');
    if (!this.active) {
      if (key === 'begin') this.beginSelected = true;
      if (this.module === null) this.module = Promise.resolve().then(this.load);
      const call = this.module.then(async module => {
        if (!module) return result('UNAVAILABLE');
        if (key === 'resume') {
          if (!module.readAccountLoginOriginal) return result('REVIEW_REQUIRED');
          const original = decodeAccountLoginOriginal(await module.readAccountLoginOriginal());
          if (original.scope !== 'NATIVE_STORAGE' || original.originalState !== 'RETAINED' || original.intent !== intent || original.status === 'CANCELLED' || original.status === 'CLOSED') return result('REVIEW_REQUIRED');
        }
        const raw = await (key === 'begin' || key === 'resume' ? module.beginAccountLogin(intents[intent]) : key === 'observe' ? module.observeAccountLogin() : module.cancelAccountLogin());
        // Separate low-sensitivity observation; cannot delay or change login outcome.
        if (module.readAccountLoginDiagnostic) void Promise.resolve().then(() => module.readAccountLoginDiagnostic!()).then(value => {
          const diagnostic = decodeReturnLinkDiagnostic(value);
          if (this.diagnostic?.state !== 'REJECTED' && (!this.diagnostic || diagnostic.state === 'REJECTED' || diagnostic.completedChecks >= this.diagnostic.completedChecks && !(this.diagnostic.state === 'PASSED' && diagnostic.state !== 'PASSED'))) { this.diagnostic = diagnostic; this.changed(); }
        }).catch(() => {});
        if (module.readAccountLoginFailureDiagnostic) void Promise.resolve().then(() => module.readAccountLoginFailureDiagnostic!()).then(value => {
          const diagnostic = decodeLoginFailureDiagnostic(value);
          if (!this.failureDiagnostic || this.failureDiagnostic.state === 'NOT_RECORDED') { this.failureDiagnostic = diagnostic; this.changed(); }
        }).catch(() => {});
        return decodeAccountLogin(raw);
      }).catch(() => result('REVIEW_REQUIRED'));
      this.active = call; this.activeKey = key; this.status = 'OBSERVATION_PENDING'; this.changed();
      void call.then(reply => { if (this.active === call) { this.status = reply.status; this.active = null; this.activeKey = null; this.changed(); } });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<AccountLoginResult>(resolve => { timer = setTimeout(() => resolve(result('OBSERVATION_PENDING')), timeoutMs); });
    try { return await Promise.race([this.active, deadline]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

export const accountLoginGate = new AccountLoginGate(() => import('./accountLoginModule').then(value => value.loadAccountLoginModule()));
