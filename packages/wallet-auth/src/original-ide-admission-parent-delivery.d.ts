import type {OriginalAuthIDENativeBinding,OriginalAuthIDEIdentityPeerBinding,OriginalIDEWalletIdentitySourceOwner,OriginalIDEProtectedKeyCallOwner,OriginalIDEPublicationArtifactRef,OriginalIDEProjectAuthorityRef,OriginalIDECurrentProjectData,OriginalIDECurrentPublisherData} from './auth-native-contract.js';
/** Private original backend only. Native returns the exact recognized owner.
 * A partial acquisition has descriptor -1 and is cleanup custody, not a guard.
 * The consumer retains it and selects its original close once. */
export interface OriginalIDEAdmissionParentDelivery {
  readonly descriptor: 4 | -1;
  assertCurrent(expectedRequest?: unknown): Promise<void>;
  close(): void | Promise<void>;
}
export declare function acquireOriginalIDEAdmissionParentDelivery(actualEntryURL: string): Promise<OriginalIDEAdmissionParentDelivery | null>;

/** Cleanup custody only; never grants authority to the parent or child. */
export interface OriginalIDEPrivateClientCleanup {
  retire(...cause: [] | [unknown]): void;
  join(): Promise<void>;
  close(): Promise<void>;
  status(): Readonly<{ready: boolean; retired: boolean; transportRetired: boolean; unknown: boolean; retained: number; firstCausePresent: boolean; cleanupFailurePresent: boolean; cleanupComplete: boolean}>;
}
export interface OriginalIDEPrivateServiceResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string,string>>;
  readonly body: string;
}
export interface OriginalIDEPrivateServiceChannel {
  readonly original: OriginalIDEPrivateClientCleanup & {
    dispatch(canonicalInput: string): Promise<OriginalIDEPrivateServiceResponse>;
    acknowledge(operation: string, phase: string, requestId: string, responseDigest: string): void;
    /** Once-only original Native terminal DATA. Never ACKs/adopts/clears UNKNOWN. */
    readTerminalCustody(operation: string, phase: string, requestId: string): Readonly<{
      proof: Readonly<{responseRaw:string;responseDigest:string;requestDigest:string;associationDigest:string;stateBeforeDigest:string;stateAfterDigest:string;stateFileDigest:string;enteredDigest:string;recordVersion:1|2|3;success:boolean}>;
      response: OriginalIDEPrivateServiceResponse;
    }>;
    selectCurrentOutcome(operation: string, phase: string, requestId: string): Readonly<{result: OriginalIDEPrivateServiceResponse | null; unknown: boolean; terminal: boolean}>;
  };
  readonly framer: {
    nextOutboundFrame(): Promise<string | null>;
    acceptInboundFrame(rawFrameWithoutLF: string): void;
    assertCurrent(): void;
    /** Stop and poison transport only. The caller drains entered work/diagnostics
     * before original.retire/join/close performs actual Native cleanup. */
    retireTransport(...cause: [] | [unknown]): void;
  };
}
/** Fixed same-copy R33 callee. No parent/provider/Socket injection or reacquire. */
export declare function acquireOriginalIDEPrivateServiceChannel(actualRunningEntryURL: string): Promise<OriginalIDEPrivateServiceChannel>;
/** Same selected partial custody after rejection, including false/undefined.
 * Null only if this SDK has no selection for the exact running entry. */
export declare function getOriginalIDEPrivateServiceChannelCleanup(actualRunningEntryURL: string): OriginalIDEPrivateClientCleanup | null;

/** Retained cold DATA only; cannot dispatch, acknowledge or recover authority. */
export interface OriginalIDEColdTerminalCustodyCleanup {
  retire(...cause: [] | [unknown]): void;
  join(): Promise<void>;
  close(): Promise<void>;
  status(): Readonly<{ready:boolean;retired:boolean;unknown:true;retained:number;firstCausePresent:boolean;cleanupFailurePresent:boolean;cleanupComplete:boolean}>;
}
export interface OriginalIDEColdTerminalCustody extends OriginalIDEColdTerminalCustodyCleanup {
  readTerminalCustody(canonicalOriginalRequestRaw:string): Readonly<{
    proof:Readonly<{responseRaw:string;responseDigest:string;requestDigest:string;associationDigest:string;stateBeforeDigest:string;stateAfterDigest:string;stateFileDigest:string;enteredDigest:string;recordVersion:1|2|3;success:boolean;dataOnly:true;effectRetryAuthorized:false;nativeAdmission:false}>;
    response:OriginalIDEPrivateServiceResponse;
  }>;
}
/** Same fixed running backend and Native Source; no caller-selected provider,
 * module, parent, association or grant. Failed acquisition is never retried. */
export declare function acquireOriginalIDEColdTerminalCustody(actualRunningEntryURL:string):Promise<OriginalIDEColdTerminalCustody>;
export declare function getOriginalIDEColdTerminalCustodyCleanup(actualRunningEntryURL:string):OriginalIDEColdTerminalCustodyCleanup|null;

/** Same original Native callback table, synchronously discovered through the
 * fixed loader. Null means unavailable; neither shape nor discovery grants
 * qualification. Native/getter failures retain the original thrown cause. */
export declare function acquireOriginalIDENativeAuthBinding(actualEntryURL:string):OriginalAuthIDENativeBinding|null;

/** Discover the original fixed Native table without constructing a peer or
 * qualifying Source. Original IDE private closure calls its factory only after
 * begin() retained the exact Native request owner; retain partial before checks. */
export declare function acquireOriginalIDEIdentityPeerBinding(actualEntryURL:string):OriginalAuthIDEIdentityPeerBinding|null;

/** Wallet main only, fixed original Native module. Retain the returned cleanup
 * partial before calling readiness/current; no descriptor/provider arguments. */
export declare function acquireOriginalIDEWalletIdentitySource():OriginalIDEWalletIdentitySourceOwner|null;
/** Native tag/inventory/env/thread recognition only, not Source or UI approval. */
export declare function isOriginalIDEWalletIdentitySource(value:unknown):value is OriginalIDEWalletIdentitySourceOwner;

/** Captures only original immutable DATA through the fixed Native module.
 * Native validates canonical bytes, ordinary/nonshared/nondetached Uint8Array,
 * size/hash and same-env tag. Null means the original callee is unavailable. */
export declare function captureOriginalIDEPublicationArtifact(canonicalManifest:string,artifact:Uint8Array):OriginalIDEPublicationArtifactRef|null;
/** Returns the exact captured canonical manifest; never raw artifact bytes.
 * Missing callee, closed/forged/cross-env references and Native failures throw. */
export declare function readOriginalIDEPublicationArtifactManifest(originalArtifact:OriginalIDEPublicationArtifactRef):string;
/** Original close only. No implicit cleanup/retry or Native status promotion. */
export declare function closeOriginalIDEPublicationArtifact(originalArtifact:OriginalIDEPublicationArtifactRef):true;
/** Same original protected-key-call owner, including cleanup partials, before
 * any readiness/current/proof/invoke. The constructor captures its own Native
 * artifact custody; caller still closes its original DATA reference.
 * Null means unavailable, never successful completion or approval. */
export declare function acquireOriginalIDEProtectedPublicationKeyCall(actualEntryURL:string,canonicalManifest:string,originalArtifact:OriginalIDEPublicationArtifactRef):OriginalIDEProtectedKeyCallOwner|null;

/** Fixed original Native factory; no caller Source/provider/serverURL options.
 * Retain the same returned partial for cleanup before attempting any read.
 * Null means the original implementation is unavailable, never an admission. */
export declare function acquireOriginalIDEProjectAuthority():OriginalIDEProjectAuthorityRef|null;
/** Exact original frozen Native record, without new authorization flags. */
export declare function readOriginalIDECurrentProject(originalAuthority:OriginalIDEProjectAuthorityRef,projectID:string):OriginalIDECurrentProjectData;
/** Native argument order is owner, projectID, publisherID. Public-original
 * bytes are an independent ordinary copy, not a publisher/key authority. */
export declare function readOriginalIDECurrentPublisher(originalAuthority:OriginalIDEProjectAuthorityRef,projectID:string,publisherID:string):OriginalIDECurrentPublisherData;
/** Undefined only after the actual original cleanup; original failures,
 * including UNKNOWN and falsy throws, are propagated without retry. */
export declare function closeOriginalIDEProjectAuthority(originalAuthority:OriginalIDEProjectAuthorityRef):undefined;
