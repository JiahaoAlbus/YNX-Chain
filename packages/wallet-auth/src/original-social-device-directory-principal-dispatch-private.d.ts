/** Private Source/registered transport operations only; no IPC endpoint. */
export interface SocialDeviceDirectoryV4ExpectedDATA {
 readonly networkId:string;readonly canonicalOwner:string;readonly account:string;readonly sessionBinding:string;
 readonly productId:'social';readonly clientId:string;readonly platform:string;readonly applicationId:string;
 readonly bundleId:string|null;readonly packageId:string|null;readonly origin:string;readonly callback:string;
 readonly deviceId:string;readonly generation:string;readonly registrationId:string;readonly revision:string;readonly registrationDigest:string;
}
export interface SocialDeviceDirectoryAcceptedRequestV4DATA {
 readonly requestId:string;readonly method:'GET';readonly path:'/v4/devices/directory'|'/m1qa/v4/devices/directory';readonly body:'';readonly proofHeader:string;readonly expected:SocialDeviceDirectoryV4ExpectedDATA;
}
declare const originalRootResponse:unique symbol;
/** Borrowed SAME-process original result. Not a Node opaque credential projected
 * to Go and not a new Root response serialization/authorization format. */
export interface OriginalSocialDirectoryRootResponse {readonly [originalRootResponse]:never;}
export interface OriginalSocialDirectoryResponseLoan {
 current():Promise<void>;
 copyOriginal():Promise<Readonly<{original:Uint8Array|null;errorPresent:boolean;error?:unknown}>>;
 copyRequestOriginal():Promise<Readonly<{original:Uint8Array|null;errorPresent:boolean;error?:unknown}>>;
}
export interface OriginalSocialDirectoryPrincipalDispatchV4 {
 run():Promise<OriginalSocialDirectoryRootResponse>;
 readOriginalRootResponse():Promise<OriginalSocialDirectoryRootResponse>;
 borrowOriginalResponseLoan():OriginalSocialDirectoryResponseLoan;
 retire():void;join():Promise<void>;close():Promise<Readonly<{physicalDone:true;firstCausePresent:boolean;firstCause?:unknown}>>;
 statusDATA():Readonly<{retired:boolean;entered:boolean;settled:boolean;closed:boolean;cleanupUnknown:boolean;activeLoans:number;originalResponseRetained:boolean;firstCausePresent:boolean;firstCause:unknown;RootAdmission:false;SourceAdmission:false;remoteReceiptProved:false}>;
}
/** Actual Host is recognized through its original private class fields/Source
 * factory inventory. A passed object is never structurally granted authority. */
export declare function openOriginalSocialDeviceDirectoryPrincipalDispatchV4(actualHost:unknown,sameAcceptedRequest:SocialDeviceDirectoryAcceptedRequestV4DATA,operation:'currentExistingSocialDeviceDirectoryPrincipalV4'|'recheckExistingSocialDeviceDirectoryPrincipalV4'):OriginalSocialDirectoryPrincipalDispatchV4;
