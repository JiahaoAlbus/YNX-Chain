import type {PQPublicBinding} from './pq-wallet-contract.js';
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
