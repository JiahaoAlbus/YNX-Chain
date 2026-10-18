import type {PrivateBusinessRegistration,ProductSession,ProductSessionAccountContext} from './index.js';
export type OriginalAccountPolicyOperation=Readonly<{requestId:string;method:string;path:string;body:string;proofHeader:string|null;walletControlProofHeader:string|null;session:ProductSession|null;at:string;publication?:Readonly<{requestRaw:string;approvalRaw:string;completed:boolean}>|null}>;
export type OriginalReturnHostResponse=Readonly<{status:number;headers:Readonly<Record<string,string>>;body:string}>;
export type OriginalReturnPublicationOutcome=Readonly<{state:'not_found';retryAuthorized:false}>|Readonly<{state:'pending'|'completed';reference:string;expiresAt:string;requestDigest:string;account:string;approvalDigest:string;retryAuthorized:false}>;
/** Fixed normal-service source wrapper, never selected by an HTTP caller.
 * Acquire/retain/recheck the original source, execute synchronously exactly once,
 * post-recheck and retain original cleanup/UNKNOWN. Cannot return a response.
 * After execute entered, later refusal does not undo the persisted original. */
export type OriginalAccountPolicyRunner=(operation:OriginalAccountPolicyOperation,execute:(context:ProductSessionAccountContext&Readonly<{required:true}>)=>undefined)=>Promise<void>;
export declare const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION: 1;
export type ProductSessionGatewayNodeHostOptions=Readonly<{
  now:()=>Date;statePath:string;tokenFactory:()=>string;
  centralBrowser?:boolean;centralBrowserEcosystem?:boolean;businessRevalidation?:boolean;
  privateBusinessRevalidation?:boolean;privateBackendRegistrations?:readonly PrivateBusinessRegistration[];
  centralBackend?:Readonly<{backendClients:readonly Readonly<{clientId:string;keyId:string;publicKey:string}>[];familySealKey:unknown}>;
  centralOIDC?:unknown;
  accountPolicy?:Readonly<{mode:'required';run:OriginalAccountPolicyRunner}>;
}>;
/** familySealKey must be a Node Buffer of 32 bytes; explicit central adoption and exact provisioned public keys are required. */
export declare class ProductSessionGatewayNodeHost {
  constructor(registry:unknown,options:ProductSessionGatewayNodeHostOptions);
  handler():(request:unknown,response:unknown)=>Promise<void>;
  snapshot():Readonly<Record<string,unknown>>;
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
