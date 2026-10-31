export interface OpenCtxV1 {readonly realm:string;readonly tenant:string;readonly actor:string|null;readonly actorEpoch:string;readonly traceId:string;readonly requestId:string}
export type OpenEncodeResultV1={ok:true;value:Uint8Array}|{ok:false;code:'INVALID'|'BOUNDS'|'UNSUPPORTED';requestId:string};
/** Supports typed IDENTITY-CHALLENGE/1 and four typed identity role domains.
 * New realm/tenant IDs are
 * lower-case hex32 display strings mapping to raw16. fields has exactly nine
 * positional byte fields after the domain and realm for challenge, or eight
 * for role authorization. DATA binding, no grant. */
export declare function encodeOpenEnvelope(ctx:OpenCtxV1,domain:string,realm:string,fields:readonly Uint8Array[]):Promise<OpenEncodeResultV1>;
