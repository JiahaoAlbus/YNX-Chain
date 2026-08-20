declare module '@ynx-chain/wallet-auth' {
  export const PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN:'https://wallet-auth.ynxweb4.com';
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
