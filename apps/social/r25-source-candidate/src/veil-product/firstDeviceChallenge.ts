import {captureRegistrationUiWindow, sameRegistrationUiWindow, type RegistrationUiWindow} from './firstDeviceEnrollment';
import {accountLoginGate} from './accountLogin';
import {localAuthenticationGate} from './localDeviceSetup';
import {challengeResult, decodeChallenge, type ChallengeModule, type ChallengeResult, type ChallengeStatus} from './firstDeviceChallengeBridge';
import type {VeilCopyKey} from './copy';

export const challengeCopy: Record<ChallengeStatus, VeilCopyKey> = {
  DEVICE_PROVISIONING_WALLET_PENDING: 'deviceProvisioningWalletPending',
  DEVICE_PROVISIONING_WALLET_DENIED: 'deviceProvisioningWalletDenied',
  DEVICE_PROVISIONING_REVIEW_PENDING: 'deviceProvisioningReviewPending',
  DEVICE_PROVISIONING_RECEIPT_OBSERVED: 'deviceProvisioningReceiptObserved',
  DEVICE_PROVISIONING_CANCELLED: 'deviceProvisioningCancelled',
  DEVICE_PROVISIONING_REVIEW_EXPIRED: 'deviceProvisioningExpired',
  DEVICE_PROVISIONING_REVIEW_UNAVAILABLE: 'deviceProvisioningUnavailable',
  DEVICE_PROVISIONING_UNKNOWN_RETAINED: 'deviceProvisioningUnknown',
  DEVICE_PROVISIONING_ORIGINAL_OBSERVED: 'deviceProvisioningOriginalObserved',
  DEVICE_PROVISIONING_ORIGINAL_PENDING_RESTORED: 'deviceProvisioningOriginalPendingRestored',
  STORAGE_REGISTRATION_UNKNOWN_RETAINED: 'registrationStorageUnknown',
  CORE_STARTUP_CURRENT_UNADMITTED: 'registrationRuntimeUnadmitted',
  CORE_STARTUP_RESOURCE_REQUIRED: 'registrationRuntimeResources',
  CORE_STARTUP_BOUNDARY_REFUSED: 'registrationRuntimeCheck',
  CORE_STARTUP_THREAD_REFUSED: 'registrationRuntimeSession',
  CORE_STARTUP_WINDOW_REFUSED: 'registrationRuntimeExpired',
  CORE_STARTUP_BUSY_RETAINED: 'registrationRuntimeBusy',
  CORE_STARTUP_BINDING_REFUSED: 'registrationRuntimeBinding',
  CORE_STARTUP_UNKNOWN_RETAINED: 'registrationRuntimeUnknown',
  ACCOUNT_SERVICE_INSTANCE_REQUIRED: 'registrationServiceUnavailable',
  ACCOUNT_CHANNEL_UNKNOWN_RETAINED: 'registrationUnknown',
  ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED: 'registrationProductUnavailable',
  NATIVE_PRODUCT_ATTACHED_OBSERVED: 'registrationCheckingProduct',
  SOURCE_CHECK_PENDING: 'registrationPending', SOURCE_EVIDENCE_UNADMITTED: 'registrationSourceUnadmitted',
  SOURCE_PROFILE_REQUIRED: 'registrationSourceUnavailable', SOURCE_NATIVE_INTERFACE_REQUIRED: 'registrationSourceUnavailable',
  SOURCE_CHECK_REJECTED: 'registrationUnknown', SOURCE_UNKNOWN_RETAINED: 'registrationUnknown', SOURCE_CHECK_CANCELED_RETAINED: 'registrationSourceCanceled',
  ORIGINAL_A_LOGIN_REQUIRED: 'registrationLogin', LOCAL_KEYS_REQUIRED: 'registrationKeys', UNAVAILABLE: 'registrationUnavailable',
  OBSERVATION_PENDING: 'registrationPending', CHALLENGE_REQUIRED: 'registrationReady', CHALLENGE_PENDING: 'registrationPending',
  ENROLLMENT_PENDING: 'registrationPending', ENROLLMENT_UNKNOWN_RETAINED: 'registrationUnknown', ENROLLMENT_EXPIRED_RETAINED: 'registrationUnknown', NATIVE_PROOF_AUTHORIZATION_REQUIRED: 'registrationIssued', ENROLLMENT_COMMITTED_UNVERIFIED: 'registrationIssued', CHALLENGE_ISSUED_UNVERIFIED: 'registrationIssued', CHALLENGE_UNKNOWN_RETAINED: 'registrationUnknown',
  CHALLENGE_CANCEL_PENDING: 'registrationCancelPending', CHALLENGE_CANCEL_UNKNOWN_RETAINED: 'registrationCancelUnknown',
  CHALLENGE_CANCELED: 'registrationCanceled', ORIGINAL_INTENT_REQUIRED: 'registrationUnknown',
};
export type ChallengePrerequisite = 'ORIGINAL_A_LOGIN_REQUIRED' | 'LOCAL_KEYS_REQUIRED' | null;
const canStart = (status: ChallengeStatus | undefined) => status === undefined || ['CHALLENGE_REQUIRED', 'ORIGINAL_A_LOGIN_REQUIRED', 'LOCAL_KEYS_REQUIRED'].includes(status);
const cancelable = (status: ChallengeStatus | undefined) => status !== undefined && (status.startsWith('DEVICE_PROVISIONING_') || status.startsWith('SOURCE_') || status.startsWith('CORE_STARTUP_') || status === 'STORAGE_REGISTRATION_UNKNOWN_RETAINED' || ['ACCOUNT_SERVICE_INSTANCE_REQUIRED', 'ACCOUNT_CHANNEL_UNKNOWN_RETAINED', 'CHALLENGE_PENDING', 'CHALLENGE_ISSUED_UNVERIFIED', 'ENROLLMENT_PENDING', 'ENROLLMENT_UNKNOWN_RETAINED', 'ENROLLMENT_EXPIRED_RETAINED', 'NATIVE_PROOF_AUTHORIZATION_REQUIRED', 'CHALLENGE_UNKNOWN_RETAINED'].includes(status));

/** UI observation lifetime only. Native validates the actual original objects.
 * No reset, persistence DTO, owner creation, auth callback or accepted factory. */
export class FirstDeviceChallengeGate {
  private module: Promise<ChallengeModule | null> | null = null;
  private active: Promise<ChallengeResult> | null = null;
  private begun = false;
  private canceled = false;
  private cancelUnconfirmed = false;
  private listeners = new Set<() => void>();
  private snapshot: Readonly<{pending: boolean; result: ChallengeResult | null; begun: boolean; canceled: boolean; cancelUnconfirmed: boolean}> = Object.freeze({pending: false, result: null, begun: false, canceled: false, cancelUnconfirmed: false});
  constructor(private readonly load: () => Promise<ChallengeModule | null>, private readonly prerequisite: () => ChallengePrerequisite,
    private readonly registrationUiWindow: () => RegistrationUiWindow = () => null) {}
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  readonly canContinue = () => !this.active && !this.begun && !this.canceled && this.prerequisite() === null && canStart(this.snapshot.result?.status);
  readonly canCancel = () => !this.active && !this.canceled && cancelable(this.snapshot.result?.status) &&
    !(this.cancelUnconfirmed && this.snapshot.result?.status === 'CHALLENGE_PENDING');
  private publish(pending: boolean, result: ChallengeResult | null) {
    this.snapshot = Object.freeze({pending, result, begun: this.begun, canceled: this.canceled, cancelUnconfirmed: this.cancelUnconfirmed});
    for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot release native work. */ } }
  }
  observe(timeoutMs = 31_000) { return this.run('observe', timeoutMs); }
  continueByUser(timeoutMs = 31_000) { return this.run('begin', timeoutMs); }
  cancelByUser(timeoutMs = 31_000) { return this.run('cancel', timeoutMs); }
  private async run(action: 'observe' | 'begin' | 'cancel', timeoutMs: number): Promise<ChallengeResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('INVALID_CHALLENGE_OBSERVATION');
    // A competing press observes the actual pending call; it never queues cancel.
    if (!this.active) {
      if (action === 'begin' && !this.canContinue()) {
        const missing = this.prerequisite();
        return missing ? challengeResult(missing) : this.snapshot.result ?? challengeResult('CHALLENGE_REQUIRED');
      }
      if (action === 'cancel' && !this.canCancel()) return this.snapshot.result ?? challengeResult('CHALLENGE_REQUIRED');
      const selectedWindow = action === 'begin' ? captureRegistrationUiWindow(this.registrationUiWindow()) : null;
      this.module ??= Promise.resolve().then(this.load);
      const actual = this.module.then(async module => {
        if (!module) return challengeResult('UNAVAILABLE');
        if (action === 'observe') return decodeChallenge(await module.observeFirstDeviceChallenge());
        if (action === 'begin') {
          // Native may already have auto-issued while JS was elsewhere. Read
          // first; even an explicit click cannot re-begin pending/unknown work.
          const observed = decodeChallenge(await module.observeFirstDeviceChallenge());
          if (!canStart(observed.status)) return observed;
          const missing = this.prerequisite(); // recheck after the await
          if (missing) return challengeResult(missing);
          if (!sameRegistrationUiWindow(selectedWindow, this.registrationUiWindow())) return challengeResult('ORIGINAL_INTENT_REQUIRED');
          this.begun = true; // sticky before any physical begin, including throw
          return decodeChallenge(await module.beginFirstDeviceChallenge());
        }
        this.canceled = true;
        this.cancelUnconfirmed = true;
        const observed = decodeChallenge(await module.cancelFirstDeviceChallenge());
        // Module handoff pending is NOT a queued cancellation acknowledgment.
        // A later explicit user action may ask again; observation never does.
        if (observed.status === 'CHALLENGE_PENDING') this.canceled = false;
        this.cancelUnconfirmed = observed.status !== 'CHALLENGE_CANCELED';
        return observed;
      }).catch(() => challengeResult(action === 'cancel' ? 'CHALLENGE_CANCEL_UNKNOWN_RETAINED' : 'CHALLENGE_UNKNOWN_RETAINED'));
      this.active = actual;
      this.publish(true, this.snapshot.result);
      void actual.then(value => {
        if (this.active !== actual) return;
        this.active = null;
        // Once native reported an existing/uncertain operation, later DTOs
        // cannot release that UI fence or justify another begin.
        if (value.status.startsWith('DEVICE_PROVISIONING_') || value.status.startsWith('SOURCE_') || value.status.startsWith('CORE_STARTUP_') || value.status === 'STORAGE_REGISTRATION_UNKNOWN_RETAINED' || ['ACCOUNT_SERVICE_INSTANCE_REQUIRED', 'ACCOUNT_CHANNEL_UNKNOWN_RETAINED', 'ENROLLMENT_ACCEPTED_PRODUCT_SOURCE_REQUIRED', 'NATIVE_PRODUCT_ATTACHED_OBSERVED', 'ENROLLMENT_COMMITTED_UNVERIFIED', 'OBSERVATION_PENDING', 'CHALLENGE_PENDING', 'CHALLENGE_ISSUED_UNVERIFIED', 'ENROLLMENT_PENDING', 'ENROLLMENT_UNKNOWN_RETAINED', 'ENROLLMENT_EXPIRED_RETAINED', 'NATIVE_PROOF_AUTHORIZATION_REQUIRED', 'CHALLENGE_UNKNOWN_RETAINED', 'CHALLENGE_CANCEL_PENDING', 'CHALLENGE_CANCEL_UNKNOWN_RETAINED', 'CHALLENGE_CANCELED', 'ORIGINAL_INTENT_REQUIRED'].includes(value.status)) this.begun = true;
        if (value.status === 'CHALLENGE_CANCELED') this.cancelUnconfirmed = false;
        this.publish(false, value);
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.active, new Promise<ChallengeResult>(resolve => {
      timer = setTimeout(() => resolve(challengeResult('OBSERVATION_PENDING')), timeoutMs);
    })]); } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
export const firstDeviceChallengeGate = new FirstDeviceChallengeGate(
  () => import('./firstDeviceChallengeModule').then(m => m.loadFirstDeviceChallengeModule()),
  () => {
    const login = accountLoginGate.getSnapshot();
    if (login.pending || login.intent !== 'newIdentityFirstDevice' || login.status !== 'ACCOUNT_OBSERVED') return 'ORIGINAL_A_LOGIN_REQUIRED';
    const local = localAuthenticationGate.getSnapshot();
    return !local.pending && local.result?.status === 'LOCAL_KEYS_AUTHENTICATED' ? null : 'LOCAL_KEYS_REQUIRED';
  },
  () => ({login: accountLoginGate.getSnapshot(), local: localAuthenticationGate.getSnapshot()}),
);
