import type {PQTypedActionOriginalRead,PQTypedActionMemberData} from './typed-action-caller.mjs';
export type PQReviewedTypedTransportOriginal=PQTypedActionOriginalRead & Readonly<{memberHash:string;transportHash:string}>;
export type PQReviewedTypedTransportData=PQTypedActionMemberData & Readonly<{
 reviewExecutionHeight:string;transportHash:string;originalsCount:number;
 classicWitnessValidationRequired:boolean;permissionGranted:false;
 body:Uint8Array;member:Uint8Array;originals:readonly Uint8Array[];
}>;
/** Read-only composition of 371 + f160. No historical snapshot reconstruction,
 * live review registration, send, retry or consent. Bytes are detached copies. */
export function inspectPQReviewedTypedTransportOriginal(archivedReview:unknown,rawTransport:Uint8Array,original:PQReviewedTypedTransportOriginal):PQReviewedTypedTransportData;
