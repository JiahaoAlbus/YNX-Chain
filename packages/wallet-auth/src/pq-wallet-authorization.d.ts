import type {PQPublicBinding} from './pq-wallet-contract.js';
export type PQU64 = string | bigint;
export interface PQNativeTransferInput { chainId: string; nativeChainId: PQU64; from: string; to: string; amount: PQU64; fee: PQU64; nonce: PQU64 }
export interface PQNativeTransfer extends Omit<PQNativeTransferInput, 'nativeChainId' | 'amount' | 'fee' | 'nonce'> { nativeChainId: string; amount: string; fee: string; nonce: string }
export interface PQRegistrationKeys { chainId: string; owner: string; algorithmVersion: 'YNX-BATCH/v0.1'; pkA: string; pkB: string }
export interface PQRegistrationIntentInput extends PQRegistrationKeys { priorRevision: PQU64; newRevision: PQU64; ledgerNonce: PQU64; activateAt: PQU64 }
export interface PQRegistrationIntent extends PQRegistrationKeys { priorRevision: string; newRevision: string; ledgerNonce: string; activateAt: string }
export interface PQMigrationProofs { intent: PQRegistrationIntentInput; classicPublicKey: Uint8Array; classicSignature: Uint8Array; currentPQMember: Uint8Array; newKeyWholeProof: Uint8Array }
export interface PQDecodedMigration extends Omit<PQMigrationProofs, 'intent'> { intent: PQRegistrationIntent; intentBytes: Uint8Array; currentAuthorization: 'legacy' | 'pq' }
/** Request description only, no network write. body returns a detached copy each time.
 * A successful submission/admission is not finality. Persist original bytes/hash;
 * UNKNOWN must be reconciled through the original hash before any new nonce/action. */
export interface PQTransportRequest { readonly method: 'POST'; readonly path: string; readonly contentType: 'application/octet-stream'; readonly body: Uint8Array; readonly transportHash: string; readonly admissionIsFinality: false }
export const PQ_TRANSFER_DOMAIN: 'YNX-NATIVE-TRANSFER/v2';
export const PQ_REGISTRATION_DOMAIN: 'YNX-ACCOUNT-REGISTRATION/v1';
export const PQ_MIGRATION_DOMAIN: 'YNX-ACCOUNT-MIGRATION/v1';
export const PQ_POLICY_VERSION: 'YNX-ACCOUNT-POLICY/v1';
export const PQ_U64_MAX: bigint;
export function pqU64(value: PQU64): bigint;
export function pqCanonicalAddress(value: string): string;
export function pqHex(value: string, size: number): Uint8Array;
export function normalizePQNativeTransfer(value: PQNativeTransferInput): Readonly<PQNativeTransfer>;
export function encodePQNativeTransfer(value: PQNativeTransferInput): Uint8Array;
export function decodePQNativeTransfer(wire: Uint8Array): Readonly<PQNativeTransfer>;
export function normalizePQRegistrationIntent(value: PQRegistrationIntentInput): Readonly<PQRegistrationIntent>;
export function pqPublicBindingToRegistrationKeys(value: PQPublicBinding): Readonly<PQRegistrationKeys>;
export function encodePQRegistrationIntent(value: PQRegistrationIntentInput): Uint8Array;
export function decodePQRegistrationIntent(wire: Uint8Array): Readonly<PQRegistrationIntent>;
/** Binds full intent/context and N1 new-key Whole, validates the classic branch;
 * PQ signature math and actual current registration are not granted by decoding. */
export function decodePQMigrationRequest(wire: Uint8Array): PQDecodedMigration;
export function encodePQMigrationRequest(value: PQMigrationProofs): Uint8Array;
export function pqWireHash(wire: Uint8Array): string;
export function preparePQAuthorizationQuery(owner: string): Readonly<{method: 'GET'; path: string}>;
export function preparePQOriginalLookup(hash: string): Readonly<{method: 'GET'; path: string}>;
export function preparePQMigrationTransport(wire: Uint8Array): PQTransportRequest;
/** Structural/context binding and exact N1 only; not account authority, signature
 * math validation, chain admission or finality. All returned data are detached/frozen. */
export function decodePQTransferRequest(wire: Uint8Array): Readonly<{transfer: Readonly<PQNativeTransfer>; purpose: 'TX-BATCH'; N: 1; index: 0; pkA: string; pkB: string; transportHash: string}>;
export function preparePQTransferTransport(wire: Uint8Array): PQTransportRequest;
