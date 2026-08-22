/**
 * The accepted Wallet/Auth package root includes Node-only Gateway exports.
 * Expo therefore consumes these exact browser/native-safe v2 package modules
 * directly; these declarations add only their published runtime signatures.
 */
declare module '@ynx-chain/wallet-auth/src/canonical.js' {
  export function canonicalJSON(value:unknown):string;
}

declare module '@ynx-chain/wallet-auth/src/authorize-launcher.js' {
  export function launchCanonicalAuthorization(request:import('@ynx-chain/wallet-auth').AuthorizationRequest,options:{platform:'android'|'ios'|'macos'|'windows'|'web'|'extension';resolver?:((uri:string)=>boolean|Promise<boolean>);scope?:unknown;waitMs?:number}):Promise<import('@ynx-chain/wallet-auth').AuthorizationLaunchResult>;
}

declare module '@ynx-chain/wallet-auth/src/protocol.js' {
  export function parseAuthorizationRequest(input:string|unknown,options:{now?:Date;registry:Record<string,import('@ynx-chain/wallet-auth').ProductBinding>}):import('@ynx-chain/wallet-auth').AuthorizationRequest;
  export function parseAuthorizationCallbackURL(url:string,request:import('@ynx-chain/wallet-auth').AuthorizationRequest,at?:Date):import('@ynx-chain/wallet-auth').AuthorizationResponse|import('@ynx-chain/wallet-auth').AuthorizationRejection;
}

declare module '*standard-wallet-connect-state.js' {
  export const STANDARD_WALLET_CONNECT_STATUS:Readonly<{CONNECTED:'connected'}>;
  export const STANDARD_WALLET_RPC_PROBE:Readonly<{DEGRADED:'degraded'}>;
  export const STANDARD_WALLET_RPC_PROBE_TRANSPORT:'accepted-cors-safe';
  export type StandardWalletConnectState=Readonly<{status:string;providerKind:'metamask'|'ynx-wallet'|null;account:string|null;chainId:string|null;chooserOpen:boolean;pendingIntent:string|null;rpcProbe:string;authority:string}>;
  export function createStandardWalletConnectState():StandardWalletConnectState;
  export function reduceStandardWalletConnectState(current:StandardWalletConnectState,event:Record<string,unknown>):StandardWalletConnectState;
}
