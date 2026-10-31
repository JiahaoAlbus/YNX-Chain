import type {PQNativeAction,PQNativeActionInput} from '@ynx-chain/wallet-auth/pq-native-action';
import type {PQAuthorizationSnapshot,PQNativeActionReviewPlan} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import type {PQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import type {PQInvoiceReviewData} from './invoice-review-data.mjs';
export type PQTypedActionBinding=Readonly<{account:string;networkId:string}>;
export type PQTypedActionMetadata=PQTypedActionBinding & Readonly<{operationId:string;createdAt:string;expiresAt:string}>;
export type PQTypedActionReview=PQTypedActionMetadata & Readonly<{origin:'ynx-wallet:local-pq';action:PQNativeAction;requestDigest:string;policyRevision:string;executionHeight:string;pair:Readonly<{pkA:string;pkB:string}>;dataOnly:true;permissionGranted:false}>;
/** These are Main-only immutable correlation DATA, never approval/permission. */
export type PQInvoiceOriginals=Readonly<{termsMessage:Uint8Array;settlement:Readonly<{review:unknown;member:Uint8Array;original:PQTypedActionOriginalRead}>|null}>;
export function preparePQTypedActionReview(snapshot:PQAuthorizationSnapshot,input:PQNativeActionInput,metadata:PQTypedActionMetadata,invoiceOriginals?:PQInvoiceOriginals|null):PQTypedActionReview;
export type PQTypedInvoiceReviewData=PQInvoiceReviewData & Readonly<{operationId:string;requestDigest:string;policyRevision:string;executionHeight:string;createdAt:string;expiresAt:string;signingOnly:true;broadcastRequiresSeparateApproval:true}>;
export function readPQTypedActionInvoiceReviewData(review:PQTypedActionReview):PQTypedInvoiceReviewData|null;
export function cancelPQTypedActionReview(review:PQTypedActionReview):Readonly<{operationId:string;signerEntered:boolean;dataOnly:true;canRetry:false}>;
export function recheckPQTypedActionReview(review:PQTypedActionReview,refreshed:PQAuthorizationSnapshot,selectedBinding:PQTypedActionBinding,at?:number):PQNativeActionReviewPlan;
/** Capture returned bytes in original Main custody before post-sign guards. */
export function signPQReviewedTypedAction(review:PQTypedActionReview,refreshed:PQAuthorizationSnapshot,handle:PQWalletKeyHandle,selectedBinding:PQTypedActionBinding,at?:number):Uint8Array;
export function pqTypedActionInvocationData(review:PQTypedActionReview):Readonly<{operationId:string;signerEntered:boolean;dataOnly:true;canRetry:false}>;
export type PQTypedActionMemberData=Readonly<{operationId:string;account:string;networkId:string;action:PQNativeAction;pair:Readonly<{pkA:string;pkB:string}>;policyRevision:string;executionHeight:string;requestDigest:string;memberHash:string;purpose:'TX-BATCH';memberCount:1;memberIndex:0;signatureVerified:true;dataOnly:true;nativeAdmission:false;submitted:false;canRetry:false;clearsOriginal:false;consensusFinality:false}>;
export function inspectPQTypedActionMember(review:PQTypedActionReview,wire:Uint8Array):PQTypedActionMemberData;
/** Main retains and re-parses both original public snapshots via the SDK.
 * Read-only archived DATA never becomes a live/signable review. */
export type PQTypedActionOriginalRead=Readonly<{reviewSnapshot:PQAuthorizationSnapshot;signingSnapshot:PQAuthorizationSnapshot;selectedBinding:PQTypedActionBinding}>;
export function inspectPQTypedActionMember(archivedReview:unknown,wire:Uint8Array,original:PQTypedActionOriginalRead):PQTypedActionMemberData;
