declare module '@ynx-chain/sdk' {
  export type EndpointAuthorityPin={manifestVersion:string;payloadSha256:string;readonly [key:string]:unknown};
  export type EndpointAuthority={manifestVersion:string;issuedAt:string;expiresAt:string;rpc:string;evmRpc:string;faucet:string;walletGateway:string;endpointStates:{walletGateway:{status:string};products:{finance:{status:string}}};readonly [key:string]:unknown};
  export const bundledEndpointAuthority:EndpointAuthority;
  export function canonicalEndpointAuthorityPayload(manifest:unknown):string;
  export function validateEndpointAuthority(manifest:unknown,options:{trustedPin:EndpointAuthorityPin;nowMs:number;source:'bundled';digestSHA256?:(payload:string)=>Promise<string>}):Promise<EndpointAuthority>;
  export function selectAuthorityEndpoint(authority:EndpointAuthority,key:'rpc'|'evmRpc'|'faucet',options:{nowMs:number}):string;
  export type EndpointAuthorityV2Consumer={consumerId:string;origin:string;clientVersion:string};
  export type EndpointAuthorityV2Storage={read():Promise<unknown>;compareAndSwap(previous:unknown,next:unknown):Promise<boolean>};
  export function createEndpointAuthorityClient(options:{trustRoot:unknown;consumer:EndpointAuthorityV2Consumer;storage:EndpointAuthorityV2Storage;clock:()=>number}):{accept(input:unknown,options:{source:'bundled'|'remote'}):Promise<unknown>;financeProductSession():Promise<unknown>;invalidate():void};
}
