declare module '@ynx/dapp-connect-sdk' {
  export class DAppConnectError extends Error { code:string }
  export function classifyWalletError(error:unknown):DAppConnectError
  export class StandardWalletConnection {
    constructor(provider:{request(args:{method:string;params?:unknown[]}):Promise<unknown>})
    account:string|null
    chainId:string|null
    connect():Promise<{account:string;chainId:string;state:string}>
    ensureYNXTestnet(options:{addChain:unknown}):Promise<unknown>
  }
}
