/** Original fixed implementing image; not a caller-supplied provider. */
export function loadOriginalAuthIdentityNativeImage(): unknown;
export function acquireOriginalProductSessionDeviceV4SourceStage(): unknown;
export interface OriginalDeviceProvisioningOutcomeDATA {
 readonly operation:string;
 readonly state:'UNKNOWN'|'PENDING_REGISTRATION'|'REGISTERED_LOCAL_ASSOCIATION';
 readonly association:string;
 readonly firstCause:string;
 /** Actual Core rc/cleanup/output state, never translated to approved=true. */
 readonly result:number;
 readonly cleanup:number;
 readonly outputState:number;
 readonly reportedLengthsExact:readonly[string,string,string,string];
 readonly recoveredOriginal:boolean;
}
/** Only the exact Native-tagged child may perform these methods. A structural
 * TS value/JSON never qualifies as approval. The native factory revalidates
 * Main's private map in its release-selected original module. */
export interface OriginalDeviceProvisioningHeld {
 assertCurrent():void;
 recheck():Promise<void>;
 prepare():OriginalDeviceProvisioningOutcomeDATA;
 readPublicPairDATA():Readonly<{pkA:Uint8Array;pkB:Uint8Array}>;
 complete():OriginalDeviceProvisioningOutcomeDATA;
 readOriginalOutcomeDATA():OriginalDeviceProvisioningOutcomeDATA;
 retire():void;
 join():void;
 close():void;
}
export interface OriginalDeviceProvisioningSource {
 readIntentOriginalDATA():Uint8Array;
 assertCurrent():void;
 captureOriginalCreationApproval(originalMainPeer:object):OriginalDeviceProvisioningHeld;
 retire():void;
 join():void;
 close():void;
 readOriginalStatus():Readonly<{failed:boolean;retired:boolean;closed:boolean;firstCause:string}>;
}
/** Zero input. On failure retain error.partial before interpreting the error;
 * drain any actual child before parent. No signing or activation is implied. */
export function acquireOriginalProductSessionDeviceV4ProvisioningSourceStage():OriginalDeviceProvisioningSource;
