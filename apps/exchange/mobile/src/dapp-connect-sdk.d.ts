declare module '@ynx/dapp-connect-sdk' {
  export class DAppConnectError extends Error {code:string}
  export function classifyWalletError(error:unknown):DAppConnectError
  export function discoverEIP6963(scope:{addEventListener:Function;removeEventListener:Function;dispatchEvent:Function},options?:{timeoutMs?:number}):Promise<Array<{info?:{uuid?:string;rdns?:string};provider?:{request(args:{method:string;params?:unknown[]}):Promise<unknown>;isMetaMask?:boolean}}>>
  export class StandardWalletConnection {
    constructor(provider:{request(args:{method:string;params?:unknown[]}):Promise<unknown>})
    account:string|null
    chainId:string|null
    connect():Promise<{account:string;chainId:string;state:string}>
    ensureYNXTestnet(options:{addChain:unknown}):Promise<unknown>
  }
}
