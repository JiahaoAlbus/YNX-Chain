import type {PQPublicBinding} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import type {PQAuthorizationSnapshot,PQPolicyRecord,inspectPQAuthorizationView} from '@ynx-chain/wallet-auth/pq-wallet-policy';
export interface RegisteredBindingReadRequest{
 readonly networkId:string;
 readonly nativeChainId:'6423';
 readonly owner:string;
 readonly operation:'read-registered-binding';
 readonly at:string;
}
export interface RegisteredBindingObservation{
 readonly version:'YNX-WALLET-REGISTERED-BINDING/v1';
 readonly publicBinding:Readonly<PQPublicBinding>;
 readonly authorization:PQAuthorizationSnapshot;
 readonly registration:Readonly<PQPolicyRecord>;
 readonly checkpoint:Readonly<{kind:'trusted-node-committed/v1';height:string;blockHash:string;integrity:string}>;
 readonly committedView:ReturnType<typeof inspectPQAuthorizationView>;
 readonly nextView:ReturnType<typeof inspectPQAuthorizationView>;
 readonly observedAt:string;
 readonly expiresAt:string;
 readonly dataOnly:true;
 readonly restorationAuthorized:false;
 readonly adoptionAuthorized:false;
 readonly signingAuthorized:false;
 readonly transactionAuthorized:false;
 readonly retryAuthorized:false;
}
declare const original:unique symbol;
export interface OriginalWalletRegisteredBinding{
 readonly [original]:never;
 assertCurrent():undefined;
 readOriginal():Readonly<RegisteredBindingObservation>;
 recheck():Promise<undefined>;
 retire():undefined;
 join():Promise<undefined>;
 close():Promise<undefined>;
 outcome():Readonly<{original:Readonly<RegisteredBindingObservation>|null;capturedRaw:string|null;lastRecheckRaw:string|null;unknown:boolean;firstCausePresent:boolean;firstCause:unknown;cleanupFailed:boolean;cleanupCause:unknown}>;
}
export function acquireOriginalWalletRegisteredBinding(request:RegisteredBindingReadRequest):Promise<OriginalWalletRegisteredBinding>;
export function isOriginalWalletRegisteredBinding(value:unknown):value is OriginalWalletRegisteredBinding;
/** Factory failure may retain exact source custody; caller must close it. */
export interface RegisteredBindingReadFailure extends Error{readonly code:'AUTH_WALLET_REGISTERED_BINDING_NOT_SUPPLIED';readonly cause:unknown;readonly partial:Pick<OriginalWalletRegisteredBinding,'retire'|'join'|'close'|'outcome'>;}
