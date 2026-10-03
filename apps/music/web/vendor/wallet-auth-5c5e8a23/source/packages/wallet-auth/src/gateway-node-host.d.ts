export declare const CANONICAL_GATEWAY_PROOF_HEADER:"x-ynx-product-session-proof";
export declare const CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION:1;
export declare const CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION:1;

export type CanonicalGatewayBuildIdentity=Readonly<{
  buildTime:string;
  release:string;
  sourceCommit:string;
}>;

export type CanonicalGatewayObservabilityEvent=Readonly<{
  at:string;
  durationMs:number;
  errorCode:string|null;
  errorId:string|null;
  method:"GET"|"POST"|"OTHER";
  ok:boolean;
  release:string;
  remoteDeployed:boolean;
  requestId:string;
  route:string;
  schemaVersion:1;
  service:"ynx-wallet-gatewayd";
  sourceCommit:string|null;
  stateDigest:string;
  status:number;
  traceId:string;
}>;

export type CanonicalGatewayNodeHostOptions=Readonly<{
  statePath:string;
  now:()=>Date;
  emitEvent?:(event:CanonicalGatewayObservabilityEvent)=>void;
}>;

export type CanonicalGatewayNodeHostDeployment=Readonly<{
  remoteDeployed:boolean;
  build?:CanonicalGatewayBuildIdentity;
}>;

export declare class CanonicalWalletGatewayNodeHost{
  constructor(registry:unknown,options:CanonicalGatewayNodeHostOptions,deployment?:CanonicalGatewayNodeHostDeployment);
  handler():(request:any,response:any)=>Promise<void>;
  snapshot():Readonly<Record<string,unknown>>;
}

export declare function encodeGatewayProofHeader(proof:unknown):string;
export declare function decodeGatewayProofHeader(value:unknown):Readonly<Record<string,unknown>>|null;
