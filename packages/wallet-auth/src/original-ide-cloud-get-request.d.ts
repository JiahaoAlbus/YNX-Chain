export interface OriginalIDECloudGETRequestDATA {
 readonly method:'GET';
 /** Final actual pathname, including /api/v1. Queries are currently unsupported. */
 readonly path:string;
 readonly url:string;
 /** Original deployment operation ID, not a new HTTP trace/nonce. */
 readonly operationRequestId:string;
}
export interface OriginalIDECloudGETExpectedDATA {readonly serviceOrigin:string;readonly operationRequestId:string;}
export interface OriginalIDECloudGETAbortContext {readonly signal:AbortSignal;}
export interface OriginalIDECloudGETInspectionDATA {
 readonly request:Readonly<OriginalIDECloudGETRequestDATA>;
 readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
declare const originalGETRequest:unique symbol;
export interface OriginalIDECloudGETRequestTicket {readonly [originalGETRequest]:never;}
export interface OriginalIDECloudGETRetainedDATA extends OriginalIDECloudGETInspectionDATA {
 readonly unknown:boolean;readonly causePresent:boolean;readonly cause:unknown;
 /** A returned/partial owner whose drain ABI was invalid. Retained verbatim. */
 readonly unclassifiedPartial:unknown;
 readonly finished:boolean;readonly finishKnown:boolean;readonly childClosed:boolean;
}
export interface OriginalIDECloudGETControllerStatusDATA {
 readonly retired:boolean;readonly sourceClosed:boolean;readonly cleanupDebt:boolean;
 readonly unclassifiedPartial:boolean;readonly firstCausePresent:boolean;readonly firstCause:unknown;
 readonly proofWire:'NOT_SUPPLIED';readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
/** Request/custody implementation only. This is not an admitted Cloud client. */
export interface OriginalIDECloudGETRequestController {
 prepareOriginalGETRequest(request:OriginalIDECloudGETRequestDATA,sameFrozenContext:OriginalIDECloudGETAbortContext):OriginalIDECloudGETRequestTicket;
 readOriginalRequestDATA(ticket:OriginalIDECloudGETRequestTicket):OriginalIDECloudGETRetainedDATA;
 recheckOriginalGETRequest(ticket:OriginalIDECloudGETRequestTicket):Promise<OriginalIDECloudGETRetainedDATA>;
 /** Actual Go known completion plus JS child drain; no caller completed/nonce input. */
 finishOriginalGETRequest(ticket:OriginalIDECloudGETRequestTicket):Promise<OriginalIDECloudGETRetainedDATA>;
 /** Same child debt only; permitted after cancel/retire, never re-finishes/signs. */
 drainOriginalGETRequest(ticket:OriginalIDECloudGETRequestTicket):Promise<OriginalIDECloudGETRetainedDATA>;
 /** Always throws IDE_CLOUD_GET_PROOF_WIRE_NOT_SUPPLIED until the owner supplies the real accepted wire. */
 getDeploymentRequestHeaders():never;
 getDeploymentRequestHeaders(request:OriginalIDECloudGETRequestDATA,sameOriginalContext?:OriginalIDECloudGETAbortContext):never;
 retire():undefined;join():Promise<void>;close():Promise<void>;drainOriginal():Promise<void>;
 status():OriginalIDECloudGETControllerStatusDATA;
}
/** Independent expectations are DATA comparisons, never Source/current grants. */
export declare function inspectOriginalIDECloudGETRequestDATA(input:OriginalIDECloudGETRequestDATA,expected:OriginalIDECloudGETExpectedDATA):OriginalIDECloudGETInspectionDATA;
/**
 * Draft fixed-Native ABI, not a public package export. The original selection
 * must be the SAME live opaque Native selection retained by the admitted IDE
 * parent. Ordinary project/selection DTOs are not acceptable authority. Native
 * must independently authenticate it. Root0 and missing producer fail closed.
 * A thrown error may own SAME Native partial; caller must adopt before inspect.
 */
export declare function acquireOriginalIDECloudGETRequestController(originalSelection:unknown):OriginalIDECloudGETRequestController;
