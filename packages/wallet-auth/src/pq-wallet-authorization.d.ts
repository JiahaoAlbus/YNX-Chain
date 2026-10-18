import type {PQPublicBinding} from './pq-wallet-contract.js';
export type PQU64 = string | bigint;
export interface PQNativeTransferInput { chainId: string; nativeChainId: PQU64; from: string; to: string; amount: PQU64; fee: PQU64; nonce: PQU64 }
export interface PQNativeTransfer extends Omit<PQNativeTransferInput, 'nativeChainId' | 'amount' | 'fee' | 'nonce'> { nativeChainId: string; amount: string; fee: string; nonce: string }
export interface PQRegistrationKeys { chainId: string; owner: string; algorithmVersion: 'YNX-BATCH/v0.1'; pkA: string; pkB: string }
export interface PQRegistrationIntentInput extends PQRegistrationKeys { priorRevision: PQU64; newRevision: PQU64; ledgerNonce: PQU64; activateAt: PQU64 }
export interface PQRegistrationIntent extends PQRegistrationKeys { priorRevision: string; newRevision: string; ledgerNonce: string; activateAt: string }
export interface PQRevocationIntentInput extends PQRegistrationKeys {authorizingRevision:PQU64;throughRevision:PQU64;ledgerNonce:PQU64;executeAt:PQU64;revokeAt:PQU64}
export interface PQRevocationIntent extends PQRegistrationKeys {authorizingRevision:string;throughRevision:string;ledgerNonce:string;executeAt:string;revokeAt:string}
export interface PQRevocationProofs {intent:PQRevocationIntentInput;currentPQMember:Uint8Array}
export interface PQDecodedRevocation {readonly intent:Readonly<PQRevocationIntent>;readonly intentBytes:Uint8Array;readonly currentPQMember:Uint8Array;readonly pkA:string;readonly pkB:string;readonly purpose:'ACCOUNT-REVOCATION';readonly N:1;readonly index:0;readonly transportHash:string}
export interface PQMigrationProofs { intent: PQRegistrationIntentInput; classicPublicKey: Uint8Array; classicSignature: Uint8Array; currentPQMember: Uint8Array; newKeyWholeProof: Uint8Array }
export interface PQDecodedMigration extends Omit<PQMigrationProofs, 'intent'> { intent: PQRegistrationIntent; intentBytes: Uint8Array; currentAuthorization: 'legacy' | 'pq' }
/** Request description only, no network write. body returns a detached copy each time.
 * A successful submission/admission is not finality. Persist original bytes/hash;
 * UNKNOWN must be reconciled through the original hash before any new nonce/action. */
export interface PQTransportRequest { readonly method: 'POST'; readonly path: string; readonly contentType: 'application/octet-stream'; readonly body: Uint8Array; readonly transportHash: string; readonly admissionIsFinality: false }
export const PQ_TRANSFER_DOMAIN: 'YNX-NATIVE-TRANSFER/v2';
export const PQ_REGISTRATION_DOMAIN: 'YNX-ACCOUNT-REGISTRATION/v1';
export const PQ_MIGRATION_DOMAIN: 'YNX-ACCOUNT-MIGRATION/v1';
export const PQ_REVOCATION_INTENT_DOMAIN:'YNX-ACCOUNT-REVOCATION/v1';
export const PQ_REVOCATION_DOMAIN:'YNX-ACCOUNT-REVOCATION-ENVELOPE/v1';
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
/** Existing Chain grammar only. Decoding validates full context and exact N1;
 * it does not verify signature math, registration, user approval or finality. */
export function normalizePQRevocationIntent(value:PQRevocationIntentInput):Readonly<PQRevocationIntent>;
export function encodePQRevocationIntent(value:PQRevocationIntentInput):Uint8Array;
export function decodePQRevocationIntent(wire:Uint8Array):Readonly<PQRevocationIntent>;
export function encodePQRevocationRequest(value:PQRevocationProofs):Uint8Array;
export function decodePQRevocationRequest(wire:Uint8Array):PQDecodedRevocation;
/** No RPC write, retry or classic fallback. Persist original bytes/hash before
 * submission; UNKNOWN must be reconciled, never replaced with a new intent. */
export function preparePQRevocationTransport(wire:Uint8Array):PQTransportRequest;
/** Public original signer output only, fixed 0x lowercase SEC1 pub and 32-byte
 * r/s. A private key, signature callback, chain grant or permission is not input. */
export interface PQClassicSignerPublicResult {readonly publicKey:string;readonly r:string;readonly s:string}
export interface PQClassicMigrationProof {readonly classicPublicKey:Uint8Array;readonly classicSignature:Uint8Array}
/** Canonical DER/compressed public-key conversion + exact intent/owner math;
 * normal main should use preparePQClassicMigrationProof for the policy gate. */
export function encodePQClassicMigrationProof(intent:PQRegistrationIntentInput,signature:PQClassicSignerPublicResult):PQClassicMigrationProof;
