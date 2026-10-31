import type {PrivateBusinessRegistration,ProductSession,ProductSessionAccountContext} from './index.js';
export type OriginalAccountPolicyOperation=Readonly<{requestId:string;method:string;path:string;body:string;proofHeader:string|null;walletControlProofHeader:string|null;session:ProductSession|null;at:string;publication?:Readonly<{requestRaw:string;approvalRaw:string;completed:boolean}>|null}>;
export type OriginalReturnHostResponse=Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>;
export type OriginalReturnPublicationOutcome=Readonly<{state:'not_found';retryAuthorized:false}>|Readonly<{state:'pending'|'completed';reference:string;expiresAt:string;requestDigest:string;account:string;approvalDigest:string;retryAuthorized:false}>;
/** Fixed normal-service source wrapper, never selected by an HTTP caller.
 * Acquire/retain/recheck the original source, execute synchronously exactly once,
 * post-recheck and retain original cleanup/UNKNOWN. Cannot return a response.
 * After execute entered, later refusal does not undo the persisted original. */
export type OriginalAccountPolicyRunner=(operation:OriginalAccountPolicyOperation,execute:(context:ProductSessionAccountContext&Readonly<{required:true}>)=>undefined)=>Promise<void>;
export type OriginalAccountPolicyBinaryV5Operation=Readonly<{version:'5';requestId:string;method:'POST';path:'/api/v1/ide/deployments';bodyOriginal:Uint8Array;contentType:string;bodyDigest:string;bodyBinding:import('./product-session-proof-v5.js').ProductSessionHTTPBodyV5Binding;proofHeader:string;walletControlProofHeader:null;session:ProductSession;at:string}>;
/** Explicit original current-policy runner, never a text/body:'' fallback. */
export type OriginalAccountPolicyBinaryV5Runner=(operation:OriginalAccountPolicyBinaryV5Operation,execute:(context:ProductSessionAccountContext&Readonly<{required:true}>)=>undefined)=>Promise<void>;
export type OriginalDeveloperHTTPBinaryRequestV5=Readonly<{requestId:string;method:'POST';path:'/api/v1/ide/deployments';bodyOriginal:Uint8Array;contentType:string;proofHeader:string;expected:import('./product-session-device-v4.js').ProductSessionDeviceCurrentExpectedV4}>;
export declare const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION: 1;
/** Exact original HTTP bytes; the Host consumes the device proof once. */
export type OriginalDeveloperHTTPRequest=Readonly<{requestId:string;method:string;path:string;body:string;proofHeader:string}>;
declare const originalDeveloperHTTPCredential:unique symbol;
/** Same-process reference only; cannot be restored from JSON or supplied as a DTO. */
export type OriginalDeveloperHTTPCredential=Readonly<{[originalDeveloperHTTPCredential]:true}>;
/** DATA from independently provisioned Source; not a project grant or Native admission. */
export type OriginalDeveloperHTTPPrincipalDATA=Readonly<{
  version:'YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v1';principalOriginal:string;principalSHA256:string;
  profileDigest:string;currentRaw:string;method:string;path:string;bodyDigest:string;expiresAtMs:number;
  dataOnly:true;authorized:false;nativeAdmission:false;
}>;
export type OriginalDeveloperHTTPPrincipalDATAV5=Readonly<Omit<OriginalDeveloperHTTPPrincipalDATA,'version'>&{version:'YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v5';contentType:string;bodyBinding:import('./product-session-proof-v5.js').ProductSessionHTTPBodyV5Binding}>;
export type ProductSessionGatewayNodeHostOptions=Readonly<{
  now:()=>Date;statePath:string;tokenFactory:()=>string;
  centralBrowser?:boolean;centralBrowserEcosystem?:boolean;businessRevalidation?:boolean;
  privateBusinessRevalidation?:boolean;privateBackendRegistrations?:readonly PrivateBusinessRegistration[];
  centralBackend?:Readonly<{backendClients:readonly Readonly<{clientId:string;keyId:string;publicKey:string}>[];familySealKey:unknown}>;
  centralOIDC?:unknown;
  accountPolicy?:Readonly<{mode:'required';run:OriginalAccountPolicyRunner;runBinaryV5?:OriginalAccountPolicyBinaryV5Runner}>;
  deviceCurrent?:import('./product-session-device-v4.js').OriginalProductSessionDeviceCurrentSourceV4;
}>;
/** familySealKey must be a Node Buffer of 32 bytes; explicit central adoption and exact provisioned public keys are required. */
export declare class ProductSessionGatewayNodeHost {
  constructor(registry:unknown,options:ProductSessionGatewayNodeHostOptions);
  handler():(request:unknown,response:unknown)=>Promise<void>;
  snapshot():Readonly<Record<string,unknown>>;
  /** Original normal release acquisition, no config/provider/Root input. */
  supplyOriginalBinaryV5AccountPolicy():Promise<Readonly<{configured:true}>>;
  closeOriginalBinaryV5AccountPolicy():void;
  authenticateOriginalDeveloperHTTPRequestV5(input:OriginalDeveloperHTTPBinaryRequestV5):Promise<OriginalDeveloperHTTPCredential>;
  revalidateOriginalDeveloperHTTPRequestV5(input:OriginalDeveloperHTTPBinaryRequestV5):Promise<OriginalDeveloperHTTPCredential>;
  authenticateOriginalDeveloperHTTPRequest(input:OriginalDeveloperHTTPRequest):Promise<OriginalDeveloperHTTPCredential>;
  authenticateOriginalDeveloperHTTPRequestV4(input:OriginalDeveloperHTTPRequest&Readonly<{expected:import('./product-session-device-v4.js').ProductSessionDeviceCurrentExpectedV4}>):Promise<OriginalDeveloperHTTPCredential>;
  revalidateOriginalDeveloperHTTPRequestV4(input:OriginalDeveloperHTTPRequest&Readonly<{expected:import('./product-session-device-v4.js').ProductSessionDeviceCurrentExpectedV4}>):Promise<OriginalDeveloperHTTPCredential>;
  currentExistingDeveloperPrincipalV5(input:OriginalDeveloperHTTPBinaryRequestV5):Promise<OriginalDeveloperHTTPPrincipalDATAV5>;
  recheckExistingDeveloperPrincipalV5(input:OriginalDeveloperHTTPBinaryRequestV5):Promise<OriginalDeveloperHTTPPrincipalDATAV5>;
  currentExistingDeveloperPrincipal(input:OriginalDeveloperHTTPRequest):Promise<OriginalDeveloperHTTPPrincipalDATA>;
  /** Observation of an already-consumed original proof; never a new nonce or business execution. */
  revalidateOriginalDeveloperHTTPRequest(input:OriginalDeveloperHTTPRequest):Promise<OriginalDeveloperHTTPCredential>;
  recheckExistingDeveloperPrincipal(input:OriginalDeveloperHTTPRequest):Promise<OriginalDeveloperHTTPPrincipalDATA>;
  publishOriginalProductSessionReturn(input:Readonly<{requestId:string;request:unknown;approval:unknown}>):Promise<OriginalReturnHostResponse>;
  readOriginalProductSessionReturnChallenge(input:Readonly<{requestId:string;reference:string;request:unknown}>):Promise<OriginalReturnHostResponse>;
  completeOriginalProductSessionReturn(input:Readonly<{requestId:string;reference:string;request:unknown;completion:unknown}>):Promise<OriginalReturnHostResponse>;
  readOriginalProductSessionReturnCompletionOutcome(input:Readonly<{requestId:string;reference:string;request:unknown;completion:unknown}>):Promise<OriginalReturnHostResponse>;
  readOriginalProductSessionPublicationOutcome(input:Readonly<{requestId:string;publicationRequestId:string;request:unknown;approval:unknown}>):Promise<OriginalReturnHostResponse>;
  /** Metadata only; never permission to issue/retry an UNKNOWN publication. */
  readOriginalProductSessionReturnOutcome(requestId:string):OriginalReturnPublicationOutcome;
  revalidate(session:ProductSession,scopes:readonly string[],productId:string,at:Date,businessRevalidation?:boolean,accountContext?:ProductSessionAccountContext|null):Readonly<{active:true;session:ProductSession}>;
  /** Existing Native-owned transaction interface remains synchronous; no new
   * Native permission, terminal authority or larger body allowance is granted. */
  executeOriginalWalletServicePrivateTransaction(owner:object,accountContext?:ProductSessionAccountContext|null):Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>;
  /** Existing dispatcher awaits the fixed normal policy runner around the SAME
   * synchronous Native-owned transaction; no independent terminal/ACK grant. */
  executeOriginalWalletServicePrivateTransactionWithPolicy(owner:object):Promise<Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>>;
  handleOriginalWalletServicePrivateRequest(input:unknown,retained:unknown,association:unknown,accountContext?:ProductSessionAccountContext|null):Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>;
}

/** Actual same-process original Host credential view; DATA, not a grant. */
export interface OriginalDeveloperHTTPCredentialView {readonly session:ProductSession;readonly method:string;readonly path:string;readonly bodyDigest:string;readonly proofExpiresMS:number;readonly contentType?:string;readonly bodyBinding?:import('./product-session-proof-v5.js').ProductSessionHTTPBodyV5Binding}
export function readOriginalDeveloperHTTPCredential(credential:OriginalDeveloperHTTPCredential):Promise<Readonly<OriginalDeveloperHTTPCredentialView>>;
export function assertOriginalDeveloperHTTPCredentialCompletion(credential:OriginalDeveloperHTTPCredential):Readonly<OriginalDeveloperHTTPCredentialView>;
