export declare const OPEN_CONTROL_MAX_BYTES:1048576;
export declare const OPEN_CONTROL_MAX_FIELDS:1024;
/** Existing E framing only. Fields are positional bytes, not named objects.
 * Repeated values may be valid; domain/schema-specific field rules are separate. */
export declare function encodeFields(fields:readonly Uint8Array[]):Uint8Array;
export declare function decodeFields(input:Uint8Array,expectedCount:number):readonly Uint8Array[];
