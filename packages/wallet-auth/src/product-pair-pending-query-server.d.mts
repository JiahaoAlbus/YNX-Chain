import type {Buffer} from 'node:buffer';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {OriginalProductPairSessionV4PartialOwner} from './product-pair-session-v4-source.js';
import type {PendingPairOriginalQueryProjectionDATA} from './product-pair-pending-original-query-data.mjs';
import type {PendingOriginalQueryE13Expected,PendingOriginalQueryE13DATA} from './product-pair-pending-original-query-e13.js';
declare const originalPendingQueryServerOwner:unique symbol;
export interface OriginalPendingPairQueryServerOwnerV1 extends OriginalProductPairSessionV4PartialOwner {
 readonly[originalPendingQueryServerOwner]:never;
 query(queryOriginal:Buffer,memberOriginal:Buffer,signal?:AbortSignal):Promise<Readonly<PendingPairOriginalQueryProjectionDATA>>;
 drainPartial():Promise<void>;
 status():Readonly<{retired:boolean;closed:boolean;pending:number;childDebt:number;sourceJoined:boolean;sourceCloseSelected:boolean;firstCausePresent:boolean;firstCause:unknown}>;
}
export const PENDING_ORIGINAL_QUERY_SERVER_PATH:'/v4/product-pairs/original-query';
export const PENDING_ORIGINAL_QUERY_REQUIRED_MAX_HEADER_BYTES:147456;
/** First adopt non-null owner before error inspection. Only error:null success. */
export function acquireOriginalPendingPairQueryServerV1():Promise<Readonly<{owner:OriginalPendingPairQueryServerOwnerV1|OriginalProductPairSessionV4PartialOwner|null;error:unknown}>>;
export function assertOriginalPendingPairQueryServerOwnerV1(owner:unknown):OriginalPendingPairQueryServerOwnerV1;
export function createOriginalPendingPairQueryHTTPHandler(owner:OriginalPendingPairQueryServerOwnerV1):(request:IncomingMessage,response:ServerResponse)=>Promise<boolean>;
/** Pure original SDK math adapter; independent expected provenance still required. */
export function inspectOriginalPendingPairQueryN1WithRegisteredSourceDATA(input:Readonly<{queryOriginal:Buffer;registrationOriginal:Buffer;memberOriginal:Buffer;expected:PendingOriginalQueryE13Expected}&({stage:'stage'}|{stage:'full';originalPairPost:Buffer})>):Readonly<PendingOriginalQueryE13DATA&{signatureVerified:true;memberCount:1;memberIndex:0}>;
