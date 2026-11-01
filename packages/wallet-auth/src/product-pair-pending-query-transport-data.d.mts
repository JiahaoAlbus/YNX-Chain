/** Transport syntax/time/origin DATA only. Actual typed E13 proof order,
 * registration/Source/current windows and route qualification belong to Core/Auth. */
export const PENDING_QUERY_TRANSPORT_RULES:Readonly<{noncePattern:'^[A-Za-z0-9_-]{32,64}$';timePattern:string;maxWindowMs:30000;normalServiceOrigin:'https://wallet-auth.ynxweb4.com';serviceOriginDistinctFromProductOrigin:true}>;
export interface PendingPairQueryTransport {readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;readonly serviceOrigin:string}
export interface PendingPairQueryTransportDATA extends PendingPairQueryTransport {readonly dataOnly:true;readonly authorized:false;readonly sourceAdmission:false;readonly sessionGranted:false}
export function inspectPendingPairQueryTransportDATA(value:unknown,independentlyExpectedServiceOrigin:string,explicitAuthorityTimeMs:number):Readonly<PendingPairQueryTransportDATA>;
