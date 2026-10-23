import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
export interface WalletTransactionPolicyRequest{
 readonly networkId:string;readonly nativeChainId:'6423';readonly owner:string;
 readonly operation:'transfer'|'migration'|'revocation' | 'typed-action';readonly at:string;
}
export interface WalletTransactionPolicyOriginal{
 readonly version:'YNX-WALLET-TRANSACTION-POLICY/v1'|'YNX-WALLET-TRANSACTION-POLICY/v2';readonly networkId:string;readonly nativeChainId:'6423';readonly canonicalOwner:string;
 /** v2 node observation DATA only; never a native durable/block checkpoint. */
 readonly observation?:Readonly<{kind:'comet-node-observed-app-state/v1';source:'comet-rpc';recordsView:'committed';committedHeight:string;committedAppHash:string;independentFinality:false}>;
 /** Complete sole-SDK snapshot, including pending records and v2 tombstones.
  * executionHeight is verified next H; ledgerNonce is not a signing approval. */
 readonly authorization:PQAuthorizationSnapshot;readonly observedAt:string;readonly expiresAt:string;
}
export interface PolicyOutcome{readonly original:WalletTransactionPolicyOriginal|null;readonly capturedRaw:string|null;readonly lastRecheckRaw:string|null;readonly unknown:boolean;readonly firstCausePresent:boolean;readonly firstCause:unknown;readonly cleanupFailed:boolean;readonly cleanupCause:unknown;}
export interface ReadonlyPolicyResource{assertCurrent():undefined;readOriginal():WalletTransactionPolicyOriginal;recheck():Promise<undefined>;retire():undefined;join():Promise<undefined>;close():Promise<undefined>;outcome():PolicyOutcome;}
declare const normalOriginal:unique symbol;
export interface OriginalWalletTransactionPolicy extends ReadonlyPolicyResource{readonly[normalOriginal]:never;}
export function acquireOriginalWalletTransactionPolicy(request:WalletTransactionPolicyRequest):Promise<OriginalWalletTransactionPolicy>;
export function isOriginalWalletTransactionPolicy(value:unknown):value is OriginalWalletTransactionPolicy;
export interface TransactionPolicyFailure extends Error{readonly code:'AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED';readonly cause:unknown;readonly partial:ReadonlyPolicyResource;}
/** PUBLIC test kernel never has the normal WeakSet brand or sign/send API. */
export class TransactionPolicyResourceKernel implements ReadonlyPolicyResource{
 constructor(request:WalletTransactionPolicyRequest,source:{readOriginal(request:WalletTransactionPolicyRequest):Promise<string>;recheck(request:WalletTransactionPolicyRequest,original:WalletTransactionPolicyOriginal):Promise<string>;retire():undefined;join():Promise<undefined>;close():Promise<undefined>},clock?:()=>number);
 initialize():Promise<undefined>;assertCurrent():undefined;readOriginal():WalletTransactionPolicyOriginal;recheck():Promise<undefined>;retire():undefined;join():Promise<undefined>;close():Promise<undefined>;outcome():PolicyOutcome;
}
