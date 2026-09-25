declare module "@ynx/dapp-connect-sdk" {
  export class StandardWalletConnection {
    constructor(provider:unknown,options?:Readonly<{chain?:unknown}>);
    connect():Promise<Readonly<{account:string;chainId:string;state:"STANDARD_CONNECTED"}>>;
    ensureYNXTestnet(options?:Readonly<{addChain?:unknown}>):Promise<Readonly<{chainId:string;switched:boolean}>>;
  }
  export function enhanceWithProductSession(input:Readonly<{standardConnection:Readonly<{account:string}>;complete:()=>Promise<unknown>}>):Promise<Readonly<{state:"PRODUCT_SESSION_READY";session:unknown}>|Readonly<{state:"PRIVATE_SERVICE_DEGRADED";code?:string;requestId?:string;traceId?:string;errorId?:string}>>;
}
