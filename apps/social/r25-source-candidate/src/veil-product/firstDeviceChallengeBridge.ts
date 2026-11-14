import { enrollmentStatuses } from './firstDeviceEnrollment';

// Both normal native methods expose the same bounded, non-authorizing projection.
export const challengeStatuses = enrollmentStatuses;
export type ChallengeStatus = typeof challengeStatuses[number];
export type ChallengeResult = Readonly<{status: ChallengeStatus; nativeBoundary: 'REQUIRED'; deviceAuthorization: 'REQUIRED'}>;
export type ChallengeModule = Readonly<{
  beginFirstDeviceChallenge(): Promise<unknown>;
  observeFirstDeviceChallenge(): Promise<unknown>;
  cancelFirstDeviceChallenge(): Promise<unknown>;
}>;
export const challengeResult = (status: ChallengeStatus): ChallengeResult => Object.freeze({status, nativeBoundary: 'REQUIRED', deviceAuthorization: 'REQUIRED'});
export function decodeChallenge(raw: unknown): ChallengeResult {
  if (!raw || typeof raw !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) throw Error('INVALID_CHALLENGE_BOUNDARY');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).length !== 3) throw Error('INVALID_CHALLENGE_BOUNDARY');
  for (const key of ['status', 'nativeBoundary', 'deviceAuthorization']) {
    if (!fields[key]?.enumerable || !Object.hasOwn(fields[key]!, 'value')) throw Error('INVALID_CHALLENGE_BOUNDARY');
  }
  if (!challengeStatuses.includes(fields.status!.value) || fields.nativeBoundary!.value !== 'REQUIRED' || fields.deviceAuthorization!.value !== 'REQUIRED') throw Error('INVALID_CHALLENGE_BOUNDARY');
  return challengeResult(fields.status!.value);
}
/** Fixed no-argument adapter. No identifiers, credentials or provider choice. */
export function bindChallengeModule(module: ChallengeModule | null): ChallengeModule | null {
  if (!module || typeof module.beginFirstDeviceChallenge !== 'function' || typeof module.observeFirstDeviceChallenge !== 'function' || typeof module.cancelFirstDeviceChallenge !== 'function') return null;
  return Object.freeze({beginFirstDeviceChallenge: () => module.beginFirstDeviceChallenge(), observeFirstDeviceChallenge: () => module.observeFirstDeviceChallenge(), cancelFirstDeviceChallenge: () => module.cancelFirstDeviceChallenge()});
}
