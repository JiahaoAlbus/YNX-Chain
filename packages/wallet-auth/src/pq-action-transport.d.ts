/** Portable byte-envelope DATA. No Member/Action/classic semantic validation. */
export const PQ_ACTION_TRANSPORT_MAX_BYTES:number;
export const PQ_ACTION_MEMBER_MAX_BYTES:number;
export const PQ_ACTION_ORIGINAL_MAX_BYTES:number;
export interface PQActionTransportInput {
  readonly member:Uint8Array;
  /** Exact classic raw transaction bytes, never parsed through JS Number. */
  readonly originals:readonly Uint8Array[];
}
export interface PQActionTransportData extends PQActionTransportInput {
  readonly version:1;
  readonly type:'pq_action';
  readonly dataOnly:true;
  readonly nativeAdmission:false;
  readonly memberValidationRequired:true;
  readonly classicWitnessValidationRequired:boolean;
}
/** Empty originals omit the fourth JSON field; snapshots of all inputs. */
export function encodePQActionTransportData(input:PQActionTransportInput):Uint8Array;
/** Rejects noncanonical outer JSON, duplicate/unknown fields, encodings and sizes.
 * Use the original Node/Native semantic validator before review/send. */
export function decodePQActionTransportData(raw:Uint8Array):Readonly<PQActionTransportData>;
