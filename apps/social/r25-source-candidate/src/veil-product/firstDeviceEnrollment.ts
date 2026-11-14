/** Original process-local registration only. All source/pair/challenge data stays native. */
export const runtimeCoreStartupStatuses = [
  'CORE_STARTUP_CURRENT_UNADMITTED', 'CORE_STARTUP_RESOURCE_REQUIRED',
  'CORE_STARTUP_BOUNDARY_REFUSED', 'CORE_STARTUP_THREAD_REFUSED',
  'CORE_STARTUP_WINDOW_REFUSED', 'CORE_STARTUP_BUSY_RETAINED',
  'CORE_STARTUP_BINDING_REFUSED', 'CORE_STARTUP_UNKNOWN_RETAINED',
] as const;
export const deviceProvisioningStatuses = [
  'DEVICE_PROVISIONING_WALLET_PENDING', 'DEVICE_PROVISIONING_WALLET_DENIED',
  'DEVICE_PROVISIONING_REVIEW_PENDING', 'DEVICE_PROVISIONING_RECEIPT_OBSERVED',
  'DEVICE_PROVISIONING_CANCELLED', 'DEVICE_PROVISIONING_REVIEW_EXPIRED',
  'DEVICE_PROVISIONING_REVIEW_UNAVAILABLE', 'DEVICE_PROVISIONING_UNKNOWN_RETAINED',
  'DEVICE_PROVISIONING_ORIGINAL_OBSERVED', 'DEVICE_PROVISIONING_ORIGINAL_PENDING_RESTORED',
] as const;
export const enrollmentStatuses = [
  ...deviceProvisioningStatuses,
  ...runtimeCoreStartupStatuses,
  'STORAGE_REGISTRATION_UNKNOWN_RETAINED',
  'ORIGINAL_A_LOGIN_REQUIRED', 'LOCAL_KEYS_REQUIRED', 'UNAVAILABLE', 'OBSERVATION_PENDING',
  'CHALLENGE_REQUIRED', 'CHALLENGE_PENDING', 'CHALLENGE_ISSUED_UNVERIFIED',
  'CHALLENGE_UNKNOWN_RETAINED', 'CHALLENGE_CANCEL_PENDING', 'CHALLENGE_CANCEL_UNKNOWN_RETAINED',
  'CHALLENGE_CANCELED', 'ORIGINAL_INTENT_REQUIRED', 'ENROLLMENT_PENDING',
  'ENROLLMENT_UNKNOWN_RETAINED', 'ENROLLMENT_EXPIRED_RETAINED',
  'NATIVE_PROOF_AUTHORIZATION_REQUIRED', 'ENROLLMENT_COMMITTED_UNVERIFIED',
  'SOURCE_CHECK_PENDING', 'SOURCE_EVIDENCE_UNADMITTED', 'SOURCE_PROFILE_REQUIRED',
  'SOURCE_CHECK_REJECTED', 'SOURCE_CHECK_CANCELED_RETAINED', 'SOURCE_UNKNOWN_RETAINED',
  'SOURCE_NATIVE_INTERFACE_REQUIRED',
  'ACCOUNT_SERVICE_INSTANCE_REQUIRED', 'ACCOUNT_CHANNEL_UNKNOWN_RETAINED',
  'ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED', 'NATIVE_PRODUCT_ATTACHED_OBSERVED',
] as const;
export type EnrollmentStatus = typeof enrollmentStatuses[number];
export type EnrollmentResult = Readonly<{ status: EnrollmentStatus; nativeBoundary: 'REQUIRED'; deviceAuthorization: 'REQUIRED' }>;
export interface EnrollmentModule {
  prepareFirstDeviceEnrollment(): Promise<unknown>;
  observeFirstDeviceEnrollment(): Promise<unknown>;
}
const result = (status: EnrollmentStatus): EnrollmentResult => Object.freeze({ status, nativeBoundary: 'REQUIRED', deviceAuthorization: 'REQUIRED' });
export function decodeEnrollment(value: unknown): EnrollmentResult {
  if (!value || typeof value !== 'object') throw new Error('INVALID_ENROLLMENT_PROJECTION');
  const prototype = Object.getPrototypeOf(value);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (prototype !== Object.prototype && prototype !== null || Reflect.ownKeys(fields).length !== 3 ||
      !['status', 'nativeBoundary', 'deviceAuthorization'].every(k => fields[k]?.enumerable && 'value' in fields[k]!)) throw new Error('INVALID_ENROLLMENT_PROJECTION');
  const status = fields.status!.value;
  if (!enrollmentStatuses.includes(status) || fields.nativeBoundary!.value !== 'REQUIRED' || fields.deviceAuthorization!.value !== 'REQUIRED') throw new Error('INVALID_ENROLLMENT_PROJECTION');
  return result(status);
}
export function bindEnrollmentModule(value: unknown): EnrollmentModule | null {
  if (!value || typeof value !== 'object') return null;
  const module = value as Partial<EnrollmentModule>;
  if (typeof module.prepareFirstDeviceEnrollment !== 'function' || typeof module.observeFirstDeviceEnrollment !== 'function') return null;
  const prepare = module.prepareFirstDeviceEnrollment.bind(value);
  const observe = module.observeFirstDeviceEnrollment.bind(value);
  return Object.freeze({ prepareFirstDeviceEnrollment: () => prepare(), observeFirstDeviceEnrollment: () => observe() });
}
/** Process-local UI lifetime only; never sent to Native or used as permission. */
export type RegistrationUiWindow = Readonly<{login: object; local: object}> | null;
export const captureRegistrationUiWindow = (window: RegistrationUiWindow): RegistrationUiWindow =>
  window === null ? null : Object.freeze({login: window.login, local: window.local});
export const sameRegistrationUiWindow = (before: RegistrationUiWindow, after: RegistrationUiWindow): boolean =>
  before === null ? after === null : after !== null && before.login === after.login && before.local === after.local;
export class FirstDeviceEnrollmentGate {
  private module: Promise<EnrollmentModule | null> | undefined;
  private active: Promise<EnrollmentResult> | undefined;
  private attempted = false;
  private productObservationNotified = false;
  private state: Readonly<{ pending: boolean; result?: EnrollmentResult }> = Object.freeze({ pending: false });
  private listeners = new Set<() => void>();
  constructor(private readonly load: () => Promise<EnrollmentModule | null>,
    private readonly onProductObservation: () => void = () => {},
    private readonly prerequisite: () => 'ORIGINAL_A_LOGIN_REQUIRED' | 'LOCAL_KEYS_REQUIRED' | null = () => null,
    private readonly registrationUiWindow: () => RegistrationUiWindow = () => null) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  canPrepare = () => !this.active && !this.attempted && this.prerequisite() === null && this.state.result?.status === 'CHALLENGE_ISSUED_UNVERIFIED';
  observe = () => this.run(false);
  prepareByUser = () => this.run(true);
  private publish(pending: boolean, value?: EnrollmentResult) {
    this.state = Object.freeze({ pending, ...(value ? { result: value } : {}) });
    for (const listener of this.listeners) {
      try { listener(); } catch { /* UI observers cannot release or rewrite the original native call. */ }
    }
  }
  private run(prepare: boolean): Promise<EnrollmentResult> {
    if (this.active) return this.active;
    if (prepare && !this.canPrepare()) return Promise.resolve(this.state.result ?? result('UNAVAILABLE'));
    const selectedWindow = prepare ? captureRegistrationUiWindow(this.registrationUiWindow()) : null;
    const work = Promise.resolve().then(async () => {
      const module = await (this.module ??= this.load());
      if (!module) return result('UNAVAILABLE');
      const current = decodeEnrollment(await module.observeFirstDeviceEnrollment());
      if (!prepare || current.status !== 'CHALLENGE_ISSUED_UNVERIFIED' || this.attempted) return current;
      // Observation may outlive login cancellation or local authentication.
      // This only refuses work; Native still independently verifies its original.
      const missing = this.prerequisite();
      if (missing) return result(missing);
      if (!sameRegistrationUiWindow(selectedWindow, this.registrationUiWindow())) return result('ORIGINAL_INTENT_REQUIRED');
      this.attempted = true; // physical invocation may outlive UI; never clear on timeout/unmount
      return decodeEnrollment(await module.prepareFirstDeviceEnrollment());
    }).catch(() => result('ENROLLMENT_UNKNOWN_RETAINED')).then(value => {
      if (value.status.startsWith('DEVICE_PROVISIONING_') || value.status.startsWith('SOURCE_') || value.status.startsWith('CORE_STARTUP_') || value.status === 'STORAGE_REGISTRATION_UNKNOWN_RETAINED' || ['ENROLLMENT_PENDING', 'ENROLLMENT_UNKNOWN_RETAINED', 'ENROLLMENT_EXPIRED_RETAINED',
        'NATIVE_PROOF_AUTHORIZATION_REQUIRED', 'ENROLLMENT_COMMITTED_UNVERIFIED',
        'ACCOUNT_SERVICE_INSTANCE_REQUIRED', 'ACCOUNT_CHANNEL_UNKNOWN_RETAINED',
        'ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED', 'NATIVE_PRODUCT_ATTACHED_OBSERVED', 'CHALLENGE_CANCELED',
        'CHALLENGE_CANCEL_PENDING', 'CHALLENGE_CANCEL_UNKNOWN_RETAINED'].includes(value.status)) this.attempted = true;
      // A public observation can invalidate a stale view, never supply authority.
      // Notify once before publication so reentrant observers cannot repeat it.
      // Subsequent polling must not keep erasing the user's conversation view.
      if (value.status === 'NATIVE_PRODUCT_ATTACHED_OBSERVED' && !this.productObservationNotified) {
        this.productObservationNotified = true;
        try { this.onProductObservation(); } catch { /* Retain the actual native result. */ }
      }
      this.active = undefined; this.publish(false, value); return value;
    });
    this.active = work;
    // Reserve the original promise before notifying observers: a synchronous
    // reentrant read/continue must join this call, never dispatch another one.
    this.publish(true, this.state.result);
    return work;
  }
}
