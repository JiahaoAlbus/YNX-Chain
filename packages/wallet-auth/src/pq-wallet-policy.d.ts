import type {PQPublicBinding} from './pq-wallet-contract.js';
import type {PQNativeTransferInput, PQNativeTransfer, PQRegistrationIntentInput, PQRegistrationIntent, PQMigrationProofs, PQTransportRequest,PQClassicSignerPublicResult,PQClassicMigrationProof} from './pq-wallet-authorization.js';
export interface PQPolicyRecord { readonly algorithmVersion: 'YNX-BATCH/v0.1'; readonly owner: string; readonly pkA: string; readonly pkB: string; readonly revision: string; readonly registeredAt: string; readonly activeFrom: string; readonly ledgerNonce: string }
export interface PQRevocationRecord {readonly owner:string;readonly authorizingRevision:string;readonly throughRevision:string;readonly registeredAt:string;readonly revokedFrom:string;readonly ledgerNonce:string}
export interface PQAuthorizationDTO { readonly owner: string; readonly executionHeight: string; readonly ledgerNonce: string; readonly algorithmVersion: 'legacy' | 'YNX-BATCH/v0.1'; readonly enabled: boolean; readonly records: readonly PQPolicyRecord[]; readonly policyVersion?: 'YNX-ACCOUNT-POLICY/v1'|'YNX-ACCOUNT-POLICY/v2'; readonly revocations?: readonly PQRevocationRecord[]; readonly networkId?: string; readonly enableAt?: string; readonly activeRevision?: string }
declare const snapshot: unique symbol;
/** Immutable parsed DTO, retained by protected main. Parsing does not authenticate a node.
 * Renderer copies cannot recreate this local snapshot identity or an approval lease. */
export interface PQAuthorizationSnapshot extends PQAuthorizationDTO { readonly [snapshot]: never }
export type PQWalletAction = 'pq-native-transfer' | 'pq-account-migration' | 'legacy-native-transfer' | 'ethereum' | 'dex' | 'resource' | 'delegation' | 'recovery-authorization';
export interface PQPolicyDispatch { readonly mode: 'legacy' | 'pq'; readonly chainId: string; readonly nativeChainId: string; readonly owner: string; readonly executionHeight: string; readonly ledgerNonce: string; readonly nextNonce: string; readonly policyRevision: string; readonly activeRecord: PQPolicyRecord | null }
export interface PQTransferReviewPlan { readonly kind: 'pq-native-transfer'; readonly transfer: Readonly<PQNativeTransfer>; readonly policy: PQPolicyDispatch }
export interface PQMigrationReviewPlan { readonly kind: 'pq-account-migration'; readonly intent: Readonly<PQRegistrationIntent>; readonly policy: PQPolicyDispatch }
export const PQ_MAX_POLICY_RECORDS: 1024;
export const PQ_POLICY_REVOCATION_VERSION:'YNX-ACCOUNT-POLICY/v2';
/** Derived complete-history DATA only; never an authenticated checkpoint or grant. */
export function inspectPQAuthorizationView(snapshot:PQAuthorizationSnapshot,atHeight?:string|bigint):Readonly<{authorizationStatus:'legacy'|'pending_activation'|'active'|'revocation_pending'|'revoked';pqSigningEnabled:boolean;activeRecord:PQPolicyRecord|null;executionHeight:string}>;
export function parsePQAccountAuthorization(value: unknown, expected: {chainId: string; nativeChainId: string | bigint; owner: string}): PQAuthorizationSnapshot;
export function inspectPQWalletActionPolicy(snapshot: PQAuthorizationSnapshot, action: PQWalletAction): PQPolicyDispatch;
/** Height may advance monotonically while policy/nonce/records remain identical.
 * Any activation boundary, key/revision/pending/config change requires fresh review. */
export function assertPQAuthorizationCurrent(original: PQAuthorizationSnapshot, refreshed: PQAuthorizationSnapshot): undefined;
export function planPQNativeTransfer(snapshot: PQAuthorizationSnapshot, value: PQNativeTransferInput): PQTransferReviewPlan;
export function planPQAccountMigration(snapshot: PQAuthorizationSnapshot, value: PQRegistrationIntentInput): PQMigrationReviewPlan;
export function assertPQMigrationRequestPolicy(snapshot: PQAuthorizationSnapshot, wire: Uint8Array): PQMigrationReviewPlan;
/** Canonical conversion: chain record full lowercase hex -> backup full unpadded base64url.
 * Defaults to active revision; a pending/historical revision must be selected explicitly
 * by the original protected record, never by an untrusted backup preview. */
export function pqRegisteredPublicBinding(snapshot: PQAuthorizationSnapshot, revision?: string | bigint): PQPublicBinding;
/** Read-only status, not consensus finality or permission to retry an UNKNOWN original. */
export function classifyPQRegistration(snapshot: PQAuthorizationSnapshot, intent: PQRegistrationIntentInput): Readonly<{status: 'not_found' | 'registered_pending_activation' | 'active' | 'superseded'|'revocation_pending'|'revoked'; executionHeight: string; revision?: string; activationHeight?: string; retryAuthorized: false}>;
/** Pre-activation current-account proof only. The original protected Wallet authority
 * signs digest=SHA256(full canonical intent) as low-S DER using its lawful old key.
 * This helper contains no classic private key or signing callback and refuses active PQ. */
export function preparePQClassicMigrationAuthorization(snapshot: PQAuthorizationSnapshot, intent: PQRegistrationIntentInput): Readonly<{plan: PQMigrationReviewPlan; intentBytes: Uint8Array; digest: Uint8Array}>;
/** Original protected signer signs the existing helper's exact digest once;
 * this converts its PUBLIC result and rejects active PQ/classic fallback. */
export function preparePQClassicMigrationProof(snapshot:PQAuthorizationSnapshot,intent:PQRegistrationIntentInput,signature:PQClassicSignerPublicResult):PQClassicMigrationProof;
export function preparePQReviewedMigrationTransport(snapshot: PQAuthorizationSnapshot, proofs: PQMigrationProofs): Readonly<{plan: PQMigrationReviewPlan; request: PQTransportRequest}>;
