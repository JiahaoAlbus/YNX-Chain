/// <reference types="node" />
import type {Buffer} from 'node:buffer';

/** Transport metadata only. descriptor is borrowed from Native for spawn's
 * child fd4 file action. Never close it or wrap it in a JS Socket. */
export interface OriginalIDEParentPending {
  readonly pending: true;
  readonly descriptor: number;
  readonly currentReference: string;
  readonly requestNonce: string;
}
export interface OriginalIDEParentHostOutcome {
  readonly nativeIntentRetained: boolean;
  readonly preludeStarted: boolean;
  readonly preludeComplete: boolean;
  readonly senderTaken: boolean;
  readonly retired: boolean;
  readonly unknown: boolean;
  readonly firstCausePresent: boolean;
  readonly firstCause: unknown;
  readonly cleanupCausePresent: boolean;
  readonly cleanupCause: unknown;
  readonly cleanupComplete: boolean;
}
/** Original Wallet main transport custody, NOT an IDE guard or a service grant.
 * reserve/read -> beginPrelude WITHOUT await -> spawn(pass borrowed fd as 4)
 * -> await begin -> takeSenderDescriptor -> one JS Socket -> raw frame/ACK.
 * Full/partial custody must be retained before any caller current check. */
export interface OriginalIDEParentHost {
  /** Same actual parent joint; caller owns the existing reader/writer. No replay. */
  handlePrivateServicePayload(rawFrameWithoutLF: string): Promise<string>;
  assertCurrent(): void;
  readPending(): OriginalIDEParentPending;
  /** Starts the actual Native worker synchronously; resolves undefined. */
  beginPrelude(): Promise<void>;
  /** One exact duplicate transfers to the caller, which must capture it before
   * any later fence and arrange its own Socket/cleanup. Native never closes it. */
  takeSenderDescriptor(): number;
  /** Original Native Buffer including LF; do not parse/rebuild for delivery. */
  readInstalledFrame(): Buffer;
  /** Pass only the original ACK line bytes with its LF removed; no new grant. */
  acknowledge(rawLineWithoutLF: Buffer): void;
  retire(): void;
  join(): Promise<void>;
  /** Same Promise and first result; no retry after false/undefined rejection.
   * Independently attempts retire, join and close even after a prior failure.
   * Caller must separately clean its transferred Socket/duplicate, if any. */
  close(): Promise<void>;
  outcome(): OriginalIDEParentHostOutcome;
}
/** Only an existing same-copy private joint configuration ref is accepted.
 * Native joint/intent refs are never returned. Reserve failures with partial
 * custody return a cleanup facade; invalid/retired/generic parent refs fail
 * closed. The ref must originate from the explicit typed IDE acquisition. */
export declare function reserveOriginalAuthIdentityIDEParentHost(originalJointConfiguration: object): OriginalIDEParentHost;

export interface OriginalAuthIdentityIDEStartupStatus {
  readonly initialized: boolean;
  readonly implementingModuleAvailable: boolean;
  readonly nativeQualified: false;
  readonly resourceSupplied: false;
}
/** Select the fixed dedicated Native acquireOriginalIDEAdministrationProfile()
 * dependency once for this original Vault. No profile/resource I/O occurs here.
 * This is separate from the existing generic startup; there is no fallback. */
export declare function initializeOriginalAuthIdentityIDEPrivateStartup(originalVault: object): void;
export declare function originalAuthIdentityIDEStartupStatus(originalVault: object): OriginalAuthIdentityIDEStartupStatus;
/** Requires typed startup above. Calls only the dedicated zero-argument Native
 * admin acquisition; no scope, path, descriptor or caller-selected source.
 * Returns the existing SDK private joint ref. Existing common read/current/
 * child/succession/retire/join/close functions retain the exact same lifecycle.
 * Partial admin custody is captured before read/current; failure retains its
 * first cause and cleanup debt, including original falsy causes. */
export declare function acquireOriginalAuthIdentityIDEJointConfiguration(originalVault: object, originalGuard: {assert(): void}): Promise<object>;
