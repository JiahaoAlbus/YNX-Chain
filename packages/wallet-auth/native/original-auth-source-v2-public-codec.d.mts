export const AUTH_SOURCE_DOMAIN_V2:'YNX/AUTH/SOURCE-ORIGINAL/V2';
export type SourceCanonicalJSON=null|boolean|number|string|readonly SourceCanonicalJSON[]|{readonly[key:string]:SourceCanonicalJSON};
export function sourceCanonicalV2(value:SourceCanonicalJSON):string;
export function sourceSHA256V2(raw:string|Uint8Array):string;
export function parseOriginalSourceCanonicalV2(raw:string,cap?:number):SourceCanonicalJSON;
export function encodeOriginalAuthSourceStatementV2(role:'enrollment'|'profile'|'current',frame:string,binding:Readonly<{networkId:string;owner:string;keyVersion:string;executionHeight:string}>,bodyRaw:string):Uint8Array;
