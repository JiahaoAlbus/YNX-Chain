import type {FirstDeviceChallengeGate} from './firstDeviceChallenge';
import type {EnrollmentResult, EnrollmentStatus, FirstDeviceEnrollmentGate} from './firstDeviceEnrollment';

export type DeviceRegistrationAction = 'challenge' | 'enroll';
type ChallengeControl = Pick<FirstDeviceChallengeGate, 'getSnapshot' | 'subscribe' | 'canContinue' | 'canCancel' | 'observe' | 'continueByUser' | 'cancelByUser'>;
type EnrollmentControl = Pick<FirstDeviceEnrollmentGate, 'snapshot' | 'subscribe' | 'canPrepare' | 'observe' | 'prepareByUser'>;
export type DeviceRegistrationSnapshot = Readonly<{
  pending: boolean; action: DeviceRegistrationAction | null;
  status: EnrollmentStatus | null; canCancel: boolean; cancelUnconfirmed: boolean;
}>;

/** P02-01 UI binding to the EXISTING native-owned first-device operation.
 * This is not a new proof/Device/Ref transport or a generic Native export.
 * Each user click authorizes one existing stage; observation never starts one.
 */
export class PeerDeviceRegistrationController {
  private flight: Promise<EnrollmentResult> | null = null;
  private listeners = new Set<() => void>();
  private detach: Array<() => void> = [];
  private snapshot: DeviceRegistrationSnapshot | null = null;
  // Presentation only: an older enrollment read must not mask the actual
  // explicit operation or a later completion of that same Native call.
  private challengeResult: EnrollmentResult | null | undefined;
  private enrollmentResult: EnrollmentResult | undefined;
  private presentedResult: EnrollmentResult | null = null;
  constructor(private readonly challenge: ChallengeControl, private readonly enrollment: EnrollmentControl) {}

  readonly getSnapshot = (): DeviceRegistrationSnapshot => {
    const challenge = this.challenge.getSnapshot(), enrollment = this.enrollment.snapshot();
    const challengeChanged = challenge.result !== this.challengeResult;
    const enrollmentChanged = enrollment.result !== this.enrollmentResult;
    if (enrollmentChanged && enrollment.result) this.presentedResult = enrollment.result;
    else if (challengeChanged && challenge.result) this.presentedResult = challenge.result;
    this.challengeResult = challenge.result; this.enrollmentResult = enrollment.result;
    const pending = this.flight !== null || challenge.pending || enrollment.pending;
    const canceled = challenge.canceled || challenge.cancelUnconfirmed;
    // A cancellation owns the presentation even when an older enrollment read
    // still says ISSUED. Neither projection grants device/history access.
    const status = canceled ? challenge.result?.status ?? null : this.presentedResult?.status ?? null;
    const action: DeviceRegistrationAction | null = pending || canceled ? null :
      this.enrollment.canPrepare() && challenge.result?.status === 'CHALLENGE_ISSUED_UNVERIFIED' ? 'enroll' :
      this.challenge.canContinue() ? 'challenge' : null;
    const next = {pending, action, status, canCancel: !pending && this.challenge.canCancel(), cancelUnconfirmed: challenge.cancelUnconfirmed};
    if (!this.snapshot || (Object.keys(next) as Array<keyof DeviceRegistrationSnapshot>).some(key => next[key] !== this.snapshot![key])) this.snapshot = Object.freeze(next);
    return this.snapshot;
  };
  private publish = () => {
    this.getSnapshot();
    for (const listener of this.listeners) try { listener(); } catch { /* UI cannot release the physical native call. */ }
  };
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.detach = [this.challenge.subscribe(this.publish), this.enrollment.subscribe(this.publish)];
    let live = true;
    return () => {
      if (!live) return;
      live = false; this.listeners.delete(listener);
      if (!this.listeners.size) for (const release of this.detach.splice(0)) release();
      // Unmounting never cancels, resets or replaces the native original.
    };
  };
  private run(work: () => Promise<EnrollmentResult>): Promise<EnrollmentResult> {
    if (this.flight) return this.flight;
    const original = Promise.resolve().then(work).then(result => {
      // Capture both old read references alongside the actual operation reply.
      // A new gate publication may supersede this display, never dispatch work.
      this.challengeResult = this.challenge.getSnapshot().result;
      this.enrollmentResult = this.enrollment.snapshot().result;
      this.presentedResult = result;
      return result;
    });
    this.flight = original; this.publish();
    void original.finally(() => { if (this.flight === original) { this.flight = null; this.publish(); } }).catch(() => {});
    return original;
  }
  private async readOriginal(): Promise<EnrollmentResult> {
    await this.challenge.observe();
    return this.enrollment.observe();
  }
  observeOriginal = () => this.run(() => this.readOriginal());

  registerPeerDevice = (offered: DeviceRegistrationAction): Promise<EnrollmentResult> => {
    if (this.flight) return this.flight;
    const current = this.getSnapshot().action;
    return this.run(async () => {
      // Use live gates rather than getSnapshot(): this controller's own flight
      // intentionally disables the UI while this original operation is held.
      const challenge = this.challenge.getSnapshot();
      const canceled = challenge.canceled || challenge.cancelUnconfirmed;
      if (current !== offered || canceled || challenge.pending || this.enrollment.snapshot().pending) return this.readOriginal();
      if (offered === 'challenge' && this.challenge.canContinue()) {
        const issued = await this.challenge.continueByUser();
        // Refresh the next existing stage, but require a separate user click
        // before prepareFirstDeviceEnrollment can perform the registration.
        return issued.status === 'CHALLENGE_ISSUED_UNVERIFIED' ? this.enrollment.observe() : issued;
      }
      if (offered === 'enroll' && challenge.result?.status === 'CHALLENGE_ISSUED_UNVERIFIED' && this.enrollment.canPrepare()) return this.enrollment.prepareByUser();
      return this.readOriginal();
    });
  };
  cancelOriginal = () => this.run(() => this.challenge.canCancel() ? this.challenge.cancelByUser() : this.readOriginal());
}
