declare module '@ynx-chain/wallet-auth' {
  export const PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN:'https://wallet-auth.ynxweb4.com';
  export const WALLET_AUTHORIZE_ROUTE:'ynxwallet://authorize';
  export type ProductBinding=Readonly<{requestingProduct:string;bundleId:string;callbacks:readonly string[];scopes:readonly string[];maxScopes?:number}>;
  export type AuthorizationRequest=Readonly<{version:'1';nonce:string;chainId:'ynx_6423-1';requestingProduct:string;productClientId:string;bundleId:string;productDeviceAlgorithm:'p256-sha256';productDeviceKey:string;callback:string;scopes:readonly string[];purpose:string;issuedAt:string;expiresAt:string}>;
  export type AuthorizationResponse=Readonly<{version:'1';requestDigest:string;nonce:string;chainId:'ynx_6423-1';requestingProduct:string;productClientId:string;bundleId:string;productDeviceAlgorithm:'p256-sha256';productDeviceKey:string;callback:string;account:string;accountPublicKey:string;grantedScopes:readonly string[];purpose:string;issuedAt:string;expiresAt:string;walletSignature:string}>;
  export type AuthorizationRejection=Readonly<{version:'1';decision:'rejected';requestDigest:string;nonce:string;chainId:'ynx_6423-1';requestingProduct:string;productClientId:string;bundleId:string;callback:string;decisionCode:'USER_REJECTED';rejectedAt:string;authorityGranted:false;grantedScopes:readonly []}>;
  export function canonicalJSON(value:unknown):string;
  export function parseAuthorizationRequest(input:string|unknown,options:{now?:Date;registry:Record<string,ProductBinding>}):AuthorizationRequest;
  export function createAuthorizationRejection(request:AuthorizationRequest,input:{decisionCode:'USER_REJECTED';rejectedAt:string}):AuthorizationRejection;
  export function createCallbackURL(response:Record<string,unknown>&{callback:string}):string;
  export function parseWalletDeepLink(url:string,platform:'android'|'ios',options:{now?:Date;registry:Record<string,ProductBinding>}):Readonly<{platform:string;request:AuthorizationRequest}>;
  export function signAuthorization(request:AuthorizationRequest,input:{accountSecret:string;account?:string;issuedAt:string}):AuthorizationResponse;
  export function encodeRequestDeepLink(request:AuthorizationRequest):string;
  export function parseAuthorizationCallbackURL(url:string,request:AuthorizationRequest,at?:Date):AuthorizationResponse|AuthorizationRejection;
  export type ProductSessionState={status:string;message:string;actions?:readonly string[];session?:{account:string;sessionBinding:string;scopes:readonly string[]}};
  export type WalletConnectionCoordinator={
    readonly current:ProductSessionState;
    beginYNX():Promise<{status:string;sessionState:ProductSessionState;url?:string}>;
    retryYNX():Promise<{status:string;sessionState:ProductSessionState;url?:string}>;
    restore(networkAvailable?:boolean):Promise<{status:string;sessionState:ProductSessionState;url?:string}>;
    handleReturn(url:string):Promise<{status:string;sessionState:ProductSessionState}>;
    setNetworkAvailable(available:boolean):{status:string;sessionState:ProductSessionState};
    disconnect():Promise<{status:string;sessionState:ProductSessionState}>;
  };
  export function createProductWalletConnection(config:unknown):WalletConnectionCoordinator;
}
