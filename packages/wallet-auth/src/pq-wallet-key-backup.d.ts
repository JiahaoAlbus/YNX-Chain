import type {PQPublicBinding} from './pq-wallet-contract.js';
import type {PQProductSessionSigningPlan,PQProductSessionApproval} from './product-session-pq-approval.js';
import type {PQAuthorizationSnapshot} from './pq-wallet-policy.js';
import type {PQNativeTransferInput, PQRegistrationIntentInput, PQTransportRequest} from './pq-wallet-authorization.js';
declare const custody: unique symbol;
/** Opaque protected-main custody. This is NOT a migrated-account or signing grant. */
export interface PQWalletKeyHandle { readonly [custody]: never }
export function createPQWalletKeyHandle(network: {chainId: string; owner: string}): Promise<PQWalletKeyHandle>;
export function readPQWalletKeyPublic(handle: PQWalletKeyHandle): PQPublicBinding;
export function destroyPQWalletKeyHandle(handle: PQWalletKeyHandle): boolean;
export function pqWalletKeyCleanupUnresolved(): boolean;
export function readPQWalletKeyCleanupOutcome(handle: PQWalletKeyHandle): Readonly<{retired: boolean; cleanupComplete: boolean; cleanupUnknown: boolean}>;
export function exportPQWalletBackup(handle: PQWalletKeyHandle, credential: string): Promise<Uint8Array>;
/** Atomic import and public-key recomputation for both keys. expectedBinding must be supplied
 * by the protected original/chain source; the backup's preview is not a trusted registration.
 * This returns key custody only. Activation/registration and current user authorization remain required. */
export function restorePQWalletKeyHandle(wire: Uint8Array, credential: string, expectedBinding: PQPublicBinding): Promise<PQWalletKeyHandle>;
/** These typed crypto operations create no permission or RPC effect. Only invoke
 * inside the original Wallet pending-review/WeakMap approval and keyAccess.run lease,
 * with original guard asserts before/after and a current snapshot revision fence. */
export function signPQWalletNativeTransfer(handle: PQWalletKeyHandle, transfer: PQNativeTransferInput, snapshot: PQAuthorizationSnapshot): PQTransportRequest;
/** Proposed pair only, N1 Whole ACCOUNT-MIGRATION; never current-account authorization. */
export function createPQWalletMigrationPossession(handle: PQWalletKeyHandle, intent: PQRegistrationIntentInput): Uint8Array;
/** Active OLD pair only, Member ACCOUNT-MIGRATION. No classic fallback. */
export function signPQWalletCurrentMigration(handle: PQWalletKeyHandle, intent: PQRegistrationIntentInput, snapshot: PQAuthorizationSnapshot): Uint8Array;
/** Protected main only, within original pending review/keyAccess/permission guards.
 * No generic raw signer, classic fallback, RPC effect or new permission engine. */
export function signPQWalletProductSessionApproval(handle:PQWalletKeyHandle,reviewPlan:PQProductSessionSigningPlan,at?:Date):PQProductSessionApproval;
