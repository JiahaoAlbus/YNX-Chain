export interface OriginalShopV4GETRequestDATA {
 readonly method:'GET';readonly path:string;readonly body:'';
 readonly rawHeaders:readonly string[];
}
export interface OriginalShopV4GETContext {readonly signal:AbortSignal}
declare const authorization:unique symbol;
declare const originalServerOwner:unique symbol;
export interface OriginalShopV4GETAuthorization {readonly [authorization]:never}
export interface OriginalShopV4GETIdentityDATA {
 readonly networkId:string;readonly canonicalOwner:string;readonly account:string;
 readonly sessionBinding:string;readonly productId:'shop';readonly clientId:string;
 readonly platform:string;readonly applicationId:string;readonly bundleId:string|null;
 readonly packageId:string|null;readonly origin:string;readonly callback:string;
 readonly deviceId:string;readonly generation:string;readonly registrationId:string;
 readonly revision:string;readonly registrationDigest:string;
}
export interface OriginalShopV4GETVerifiedDATA {
 readonly authorization:OriginalShopV4GETAuthorization;readonly account:string;
 readonly role:'buyer'|'seller';readonly scopes:readonly string[];
 readonly sessionBinding:string;readonly identity:OriginalShopV4GETIdentityDATA;
 readonly signatureVerified:true;readonly identityVerified:true;
 readonly nonceConsumed:boolean;readonly sessionOriginal:string;
 readonly serverIssuerExpiresAtMs:number;readonly sessionExpiresAtMs:number;
 readonly proofExpiresAtMs:number;readonly loanUntilMs:number;
 /** The original P07 Store/route ACL must independently decide business access. */
 readonly businessAuthorized:false;
}
export interface OriginalShopV4GETServerOwner {
 readonly[originalServerOwner]:never;
 verifyOriginalGET(request:OriginalShopV4GETRequestDATA,context:OriginalShopV4GETContext):Promise<OriginalShopV4GETVerifiedDATA>;
 /** Original Go-held request revalidation only; never consumes another nonce. */
 observeOriginalGET(request:OriginalShopV4GETRequestDATA,context:OriginalShopV4GETContext):Promise<OriginalShopV4GETVerifiedDATA>;
 assertCurrent(authorization:OriginalShopV4GETAuthorization,sameRequest:OriginalShopV4GETRequestDATA,sameContext:OriginalShopV4GETContext):Promise<void>;
 releaseOriginalGET(authorization:OriginalShopV4GETAuthorization,sameRequest:OriginalShopV4GETRequestDATA,sameContext:OriginalShopV4GETContext):Promise<void>;
 drainOriginalGET(authorization:OriginalShopV4GETAuthorization,sameRequest:OriginalShopV4GETRequestDATA,sameContext:OriginalShopV4GETContext):Promise<void>;
 retire():void;join():Promise<void>;close():Promise<void>;drainPartial():Promise<void>;
 status():Readonly<{retired:boolean;pending:number;unknown:boolean;firstCausePresent:boolean;firstCause:unknown}>;
}
/** These three functions are exported from private product-pair-session-v4-source.js.
 * Any nonnull result.owner or thrown partial must be retained BEFORE error read.
 * Only error === null succeeds; false/0/undefined remain original failures.
 * No public constructor for a recognized owner is defined here. */
export type OriginalShopV4GETServerResult = Readonly<{owner:OriginalShopV4GETServerOwner|null;error:unknown}>;
