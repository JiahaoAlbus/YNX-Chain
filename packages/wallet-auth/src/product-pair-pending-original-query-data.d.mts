import type {Buffer} from 'node:buffer';
/** Sole fixed pending-pair query DATA contract. Not a session HTTP21 proof,
 * Root/Source factory, signer, authenticated route or permission to retry. */
export const PENDING_ORIGINAL_QUERY_CONTRACT:Readonly<{version:'1';method:'POST';path:'/v4/product-pairs/original-query';domain:'YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1';purpose:'product-device-pending-original-query-v1';digestDomain:'issuer_v4_operations.input_sha256:SHA256(original PAIR POST UTF8 bytes)';operationMapping:'pendingId === original PAIR POST operationId';sessionBinding:false;readOnly:true}>;
export interface PendingPairOriginalQuery {readonly version:'1';readonly operationId:string;readonly originalRequestBodyDigest:string}
export interface DecodedPendingPairOriginalQueryDATA extends PendingPairOriginalQuery {readonly queryBodyDigest:string;readonly dataOnly:true;readonly authorized:false}
/** Original namespace-scoped SQLite row selected independently AFTER genuine
 * typed proof/current/actor qualification. This public type is not that proof. */
export interface PendingPairSelectedOperationRowDATA {readonly operation_id:string;readonly actor_digest:string;readonly kind:'PAIR';readonly input_sha256:string;readonly input_original:string;readonly phase:'ENTERED'|'COMMITTED';readonly result_original:string|null}
export interface PendingPairOriginalQueryProjectionDATA extends PendingPairOriginalQuery {readonly queryBodyDigest:string;readonly state:'NOT_FOUND'|'UNKNOWN'|'OBSERVED';readonly original:string|null;readonly dataOnly:true;readonly authorized:false;readonly sourceAdmission:false;readonly nativeAdmission:false;readonly registered:false;readonly connected:false;readonly newSession:false;readonly retryAuthorized:false}
/** Buffer only, matching the original producer's strict capture contract. */
export function decodePendingPairOriginalQueryDATA(queryOriginal:Buffer):Readonly<DecodedPendingPairOriginalQueryDATA>;
export function projectPendingPairOriginalQueryDATA(queryOriginal:Buffer,originalPairPost:Buffer,expectedActor:string,selectedRow:PendingPairSelectedOperationRowDATA|null):Readonly<PendingPairOriginalQueryProjectionDATA>;
/** Structural DATA method implemented on the existing original store. No new
 * database/store constructor. NOT_FOUND does not prove the effect absent. */
export interface PendingPairOriginalQueryStoreDATA {readPendingPairOriginalQueryDATA(input:Readonly<{queryOriginal:Buffer;originalPairPost:Buffer;actor:string}>):Readonly<PendingPairOriginalQueryProjectionDATA>}
