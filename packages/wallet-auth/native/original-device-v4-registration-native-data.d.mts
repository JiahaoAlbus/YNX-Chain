// Private Native ABI DATA; class and authority remain Native-owned.
export type F24=Readonly<{present:0|1;code:number;origin:number;platform_code:string}>;
export type D32=Readonly<{failure:F24;unknown:0|1;physical_done:0|1}>;
export type NativeResponseDATA=Readonly<{responsePresent:boolean;bytes:ArrayBuffer|null;httpStatus:number;failure:F24}>;
export type NativeHttpStatusDATA=Readonly<{version:1;size:56;selected:0|1;http_entered:0|1|2;response_present:0|1;http_status:number;recovered_original:0|1;durable_response:0|1;first_failure:F24}>;
export declare function inspectNativeFailureDATA(v:unknown):F24;
export declare function inspectNativeDrainDATA(v:unknown):D32;
export declare function inspectNativeResponseDATA(v:unknown):NativeResponseDATA;
export declare function inspectNativeHttpStatusDATA(v:unknown):NativeHttpStatusDATA;
