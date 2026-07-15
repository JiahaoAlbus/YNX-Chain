export type ProductBinding = Readonly<{requestingProduct:string; bundleId:string; callbacks:readonly string[]; scopes:readonly string[]; maxScopes?:number}>;
export type AuthorizationRequest = Readonly<{version:"1";nonce:string;chainId:"ynx_6423-1";requestingProduct:string;productClientId:string;bundleId:string;productDeviceKey:string;callback:string;scopes:readonly string[];purpose:string;issuedAt:string;expiresAt:string}>;
export declare const WALLET_AUTH_VERSION:"1";
export declare const YNX_NATIVE_CHAIN_ID:"ynx_6423-1";
export declare const YNX_EVM_CHAIN_ID:6423;
export declare class WalletAuthError extends Error { readonly code:string }
export declare function canonicalJSON(value:unknown):string;
export declare function parseAuthorizationRequest(input:string|unknown, options:{now?:Date;registry:Record<string,ProductBinding>}):AuthorizationRequest;
export declare function requestDigest(request:AuthorizationRequest):string;
export declare function walletIdentity(secretHex:string):Readonly<{account:string;accountPublicKey:string}>;
export declare function signAuthorization(request:AuthorizationRequest,input:{accountSecret:string;account?:string;issuedAt:string}):Readonly<Record<string,unknown>>;
export declare function verifyAuthorization(response:unknown,expected:AuthorizationRequest&{requestDigest:string;now:Date}):unknown;
export declare function encodeRequestDeepLink(request:AuthorizationRequest):string;
export declare function parseWalletDeepLink(url:string,platform:"android"|"ios",options:{now?:Date;registry:Record<string,ProductBinding>}):Readonly<{platform:string;request:AuthorizationRequest}>;
export declare function createCallbackURL(response:Record<string,unknown>&{callback:string}):string;
export declare function parseCallbackURL(url:string,expectedCallback:string):unknown;
export declare class OneTimeNonceStore { constructor(records?:readonly [string,string][]); consume(request:AuthorizationRequest,at?:Date):void; snapshot():readonly [string,string][] }
export declare function createGatewayChallenge(approval:any,input:{challenge:string;expiresAt:string}):any;
export declare function signGatewayChallenge(challenge:any,productDeviceSecret:string):any;
export declare function verifyGatewayCompletion(completion:any,expected:any,at?:Date):any;
