// Private Main-owned JSI intrinsic contract; these TS interfaces are not brands.
import type{F24,D32,NativeResponseDATA,NativeHttpStatusDATA}from'./original-device-v4-registration-native-data.mjs';
declare const opaque:unique symbol;
export interface OriginalAbort{readonly[opaque]:'MainRequestWeakHostRef'}
export interface OriginalOperation{readOriginalMember():ArrayBuffer;assertCurrent():void;retire():void;join():D32|Promise<D32>;close():D32|Promise<D32>;readOriginalStatus():unknown}
export interface OriginalSource{readOriginalReview():ArrayBuffer;produceRegistrationProof(ctx:OriginalAbort):Promise<OriginalOperation>;produceChallengeProof(ctx:OriginalAbort):Promise<OriginalOperation>;assertCurrent():void;retire():void;join():D32|Promise<D32>;close():D32|Promise<D32>}
export interface OriginalHttp{readOriginalResponseDATA():NativeResponseDATA;readOriginalStatusDATA():NativeHttpStatusDATA;close():D32}
export interface IndependentIdentityDATA{readonly originalCreationIntent:string;readonly heldStableIdentity:string;readonly deviceGeneration:string;readonly originalOperation:string;readonly account:string;readonly network:ArrayBuffer;readonly canonicalOwner:string;readonly pkA:ArrayBuffer;readonly pkB:ArrayBuffer;readonly notBeforeMs:string;readonly expiresAtMs:string}
export interface FixedNativeHost{
 acquireOriginalProductSessionDeviceV4PendingSource():Promise<OriginalSource>|OriginalSource;
 captureOriginalDeviceV4AbortContext():OriginalAbort;
 assertOriginalDeviceV4AbortCurrent(ctx:OriginalAbort):void;
 closeOriginalDeviceV4AbortContext(ctx:OriginalAbort):D32;
 readOriginalDeviceV4IndependentDATA():IndependentIdentityDATA;
 readOriginalDeviceV4UserApprovalDATA(source:OriginalSource):Readonly<{approvalOriginal:string;policyOriginal:string}>;
 submitOriginalDeviceV4Pair(source:OriginalSource,ctx:OriginalAbort,bodyOriginal:string):Promise<OriginalHttp>;
 submitOriginalDeviceV4Completion(source:OriginalSource,ctx:OriginalAbort,bodyOriginal:string):Promise<OriginalHttp>;
 readOriginalDeviceV4PairResponseDATA():NativeResponseDATA;
 isOriginalSource(ref:unknown):boolean;isOriginalOperation(ref:unknown):boolean;isOriginalHttp(ref:unknown):boolean;isOriginalAbort(ref:unknown):boolean;
}
export interface PrivateRegistrationClient{
 readOriginalRegistrationReviewDATA():unknown;readOriginalCompletionReviewDATA():unknown;
 prepareOriginalPairSubmission():Promise<object>;prepareOriginalCompletionSubmission():Promise<object>;
 readOriginalPairRequestDATA(ref:object):unknown;readOriginalCompletionRequestDATA(ref:object):unknown;
 submitPreparedPair(ref:object):Promise<unknown>;submitPreparedCompletion(ref:object):Promise<unknown>;
 readStatusDATA():unknown;readOriginalTransportStatusDATA():unknown;close():Promise<void>;
}
export default function originalAndroidDeviceV4RegistrationPrivateFactory(host:FixedNativeHost):()=>Promise<PrivateRegistrationClient>;
