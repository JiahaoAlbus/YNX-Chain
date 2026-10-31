// Private normal owner contract for sole SDK intake; not public Root/Source DTO.
declare const originalRuntimeImageOwnerBrand: unique symbol;
export interface OriginalRuntimeImageObservationDATA {
 readonly original: null | {readonly currentRaw:string; readonly projection:Readonly<Record<string,unknown>>};
 readonly dataOnly:true; readonly SourceAdmission:false; readonly NativeAdmission:false;
}
export interface OriginalRuntimeImageAdmissionStatusDATA {
 readonly retired:boolean; readonly pending:number; readonly firstCausePresent:boolean;
 readonly firstCause:unknown; readonly expiresAtMs:number;
 readonly closeSelected:boolean; readonly closeComplete:boolean;
 readonly closeCausePresent:boolean; readonly closeCause:unknown;
 readonly dataOnly:true; readonly SourceAdmission:false; readonly NativeAdmission:false;
}
export interface OriginalRuntimeImageAdmissionOwnerV1 {
 readonly [originalRuntimeImageOwnerBrand]: never;
 recheck():Promise<void>;
 assertPreLoadCurrent():void;
 retire():void;
 join():Promise<void>;
 close():Promise<void>;
 statusDATA():OriginalRuntimeImageAdmissionStatusDATA;
 readOriginalObservationDATA():OriginalRuntimeImageObservationDATA;
}
export interface OriginalRuntimeImageAdmissionResultV1 {
 readonly owner:OriginalRuntimeImageAdmissionOwnerV1|null;
 readonly error:Error|null;
}
export declare function acquireOriginalAuthRuntimeImageAdmissionV1():Promise<OriginalRuntimeImageAdmissionResultV1>;
export declare function assertOriginalAuthRuntimeImageAdmissionOwnerV1(owner:unknown):OriginalRuntimeImageAdmissionOwnerV1;
export declare function assertOriginalAuthRuntimeImagePreLoadCurrentV1():void;
