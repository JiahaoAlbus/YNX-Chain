/** Exact v2 package modules used by the browser build. The package root exports
 * Node-only Gateway code, so its browser-safe source modules are consumed directly. */
declare module '@ynx-chain/wallet-auth/src/canonical.js' { export function canonicalJSON(value:unknown):string; }
declare module '@ynx-chain/wallet-auth/src/authorize-launcher.js' {
  export function launchWebAuthorization(request:import('@ynx-chain/wallet-auth').AuthorizationRequest,options?:{scope?:unknown;waitMs?:number}):Promise<import('@ynx-chain/wallet-auth').AuthorizationLaunchResult>;
}
declare module '@ynx-chain/wallet-auth/src/protocol.js' {
  export function parseAuthorizationRequest(input:string|unknown,options:{now?:Date;registry:Record<string,import('@ynx-chain/wallet-auth').ProductBinding>}):import('@ynx-chain/wallet-auth').AuthorizationRequest;
}
declare module '@ynx-chain/wallet-auth/src/deep-link.js' { export function parseAuthorizationCallbackURL(url:string,request:import('@ynx-chain/wallet-auth').AuthorizationRequest,at?:Date):import('@ynx-chain/wallet-auth').AuthorizationResponse|import('@ynx-chain/wallet-auth').AuthorizationRejection; }
declare module '@ynx-chain/wallet-auth/src/crypto.js' { export function evmAddressFromYNX(account:string):string; }
