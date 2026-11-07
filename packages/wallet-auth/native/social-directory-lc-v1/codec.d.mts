/** Node reference DATA only. No Native/Root/channel/credential brand. */
export declare const SOCIAL_DIRECTORY_LC_REQUEST_MAX_BYTES:393216;
export declare const SOCIAL_DIRECTORY_LC_RESPONSE_MAX_BYTES:524288;
export declare const SOCIAL_DIRECTORY_LC_MAX_FRAME_BYTES:81;
export interface OriginalBytesBindingDATA{readonly requestOriginalSHA256:string;readonly rootResponseOriginalSHA256:string;}
export type ClosedAckErrorDATA={readonly errorPresent:false;readonly errorKind:'none';readonly errorCode:0}|{readonly errorPresent:true;readonly errorKind:'code';readonly errorCode:number}|{readonly errorPresent:true;readonly errorKind:'retained';readonly errorCode:0};
export type ClosedAckDATA=OriginalBytesBindingDATA&ClosedAckErrorDATA&{readonly closed:boolean};
export declare function bindSocialDirectoryOriginalBytesDATA(requestOriginal:Uint8Array,rootResponseOriginal:Uint8Array,independentQualifiedRequestOriginalSHA256:string):Readonly<OriginalBytesBindingDATA>;
export declare function encodeSocialDirectoryReadReleaseDATA(binding:OriginalBytesBindingDATA):Uint8Array;
export declare function encodeSocialDirectoryClosedAckDATA(binding:OriginalBytesBindingDATA,ack:ClosedAckErrorDATA&{readonly closed:boolean}):Uint8Array;
export declare function decodeSocialDirectoryReadReleaseDATA(raw:Uint8Array,independentBinding:OriginalBytesBindingDATA):Readonly<OriginalBytesBindingDATA>;
export declare function decodeSocialDirectoryClosedAckDATA(raw:Uint8Array,independentBinding:OriginalBytesBindingDATA):Readonly<ClosedAckDATA>;
export declare function createSocialDirectoryReadReleaseLedgerDATA(requestRaw:Uint8Array,responseRaw:Uint8Array,independentQualifiedRequestOriginalSHA256:string):Readonly<{bindingDATA():Readonly<OriginalBytesBindingDATA>;readReleaseFrameDATA():Uint8Array;acceptClosedAckDATA(raw:Uint8Array):Readonly<ClosedAckDATA>;retainUnknownDATA(cause:unknown):void;retireDATA():void;observeEOF_DATA():void;observeTransportDrainedDATA():void;readOriginalAckDATA():Uint8Array|null;statusDATA():Readonly<{releaseObserved:boolean;ackObserved:boolean;loanClosedObserved:boolean;transportDrainedObserved:boolean;retired:boolean;unknown:boolean;firstCausePresent:boolean;firstCause:unknown;physicalCompletionDATA:boolean;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;businessSuccess:false}>}>;
export declare function createSocialDirectoryControlFrameReaderDATA():Readonly<{push(raw:Uint8Array):Readonly<{frames:readonly Uint8Array[];errorPresent:boolean;error?:unknown}>;finish():Readonly<{errorPresent:boolean;error?:unknown}>}>;
