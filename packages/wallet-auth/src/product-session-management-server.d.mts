import type{Buffer}from'node:buffer';import type{IncomingMessage,ServerResponse}from'node:http';import type{OriginalProductPairSessionV4PartialOwner}from'./product-pair-session-v4-source.js';
declare const originalManagementServerOwner:unique symbol;
export type OriginalManagementOperationV4='active'|'recover'|'revoke'|'cancel';
export interface OriginalProductSessionManagementServerOwnerV4 extends OriginalProductPairSessionV4PartialOwner {
 readonly[originalManagementServerOwner]:never;
 accepts(operation:OriginalManagementOperationV4):boolean;
 execute(operation:OriginalManagementOperationV4,bodyOriginal:Buffer,proofHeader:string,signal?:AbortSignal):Promise<Buffer>;
 drainPartial():Promise<void>;status():Readonly<{retired:boolean;closed:boolean;pending:number;childDebt:number;firstCausePresent:boolean;firstCause:unknown}>;
}
export const ORIGINAL_MANAGEMENT_V4_REQUIRED_MAX_HEADER_BYTES:262144;
export const ORIGINAL_MANAGEMENT_V4_ROUTES:Readonly<{active:'/v4/product-sessions/active';recover:'/v4/product-sessions/recover';revoke:'/v4/product-sessions/revoke';cancel:'/v4/product-session-challenges/cancel'}>;
export function acquireOriginalRegisteredManagementServerV4():Promise<Readonly<{owner:OriginalProductSessionManagementServerOwnerV4|OriginalProductPairSessionV4PartialOwner|null;error:unknown}>>;
export function acquireOriginalCompletionQueryServerV4():Promise<Readonly<{owner:OriginalProductSessionManagementServerOwnerV4|OriginalProductPairSessionV4PartialOwner|null;error:unknown}>>;
export function assertOriginalProductSessionManagementServerV4(owner:unknown):OriginalProductSessionManagementServerOwnerV4;
export function createOriginalManagementV4HTTPHandler(owner:OriginalProductSessionManagementServerOwnerV4):(request:IncomingMessage,response:ServerResponse)=>Promise<boolean>;
