export {openOriginalAITaskActionClientV6} from './original-ai-task-action-v6-client.js';
import type {OriginalAITaskActionV6Context,OriginalAITaskActionV6Intent} from './original-ai-task-action-v6-client.js';
/** Fixed Native supplier imports only; no constructor/provider/JSON setter. */
export function isOriginalAITaskActionV6Peer(value:unknown):boolean;
export function readOriginalAITaskActionV6ForNative(peer:unknown):Readonly<Omit<OriginalAITaskActionV6Intent,'abortContext'>>;
export function assertOriginalAITaskActionV6Context(peer:unknown,sameContext:OriginalAITaskActionV6Context):void;
export function assertOriginalAITaskActionV6Current(peer:unknown):void;
export function recheckOriginalAITaskActionV6(peer:unknown):Promise<void>;
/** Proposed Auth private adapter shape; no factory/bridge qualification implied. */
export interface OriginalAITaskV6SourceCurrentOriginalsDATA {readonly rootOriginal:Uint8Array;readonly enrollmentOriginal:Uint8Array;readonly profileOriginal:Uint8Array;readonly currentOriginal:Uint8Array}
export interface OriginalAITaskV6HeldDrainPrivate {retire():void;join():void|Promise<void>;close():void|Promise<void>}
export interface OriginalAITaskV6HeldReviewPrivate extends OriginalAITaskV6HeldDrainPrivate {readOriginalUnsigned():string;readOriginalSourceCurrentOriginals():OriginalAITaskV6SourceCurrentOriginalsDATA;assertCurrent():void}
export interface OriginalAITaskV6ProofPrivate extends OriginalAITaskV6HeldDrainPrivate {readOriginalUnsigned():string;readOriginalMember():Uint8Array;assertCurrent():void}
/** errorPresent=true is failure even when error is false/null/undefined. */
export interface OriginalAITaskV6NativeOutcomePrivate<T> {readonly owner:T|null;readonly errorPresent:boolean;readonly error?:unknown}
export interface OriginalAITaskV6ReviewPortPrivate {prepareOriginalAITaskActionV6Review(peer:unknown,sameContext:OriginalAITaskActionV6Context):Promise<OriginalAITaskV6NativeOutcomePrivate<OriginalAITaskV6HeldReviewPrivate>>;/** Same held review; approval independently captured/verified inside Source. */produceOriginalAITaskActionV6(peer:unknown,sameContext:OriginalAITaskActionV6Context,sameReview:OriginalAITaskV6HeldReviewPrivate):Promise<OriginalAITaskV6NativeOutcomePrivate<OriginalAITaskV6ProofPrivate>>}

/** Proposed qualified Source outcome/read port; not caller-provided evidence. */
export interface OriginalAITaskV6HeldOutcomePrivate extends OriginalAITaskV6HeldDrainPrivate {readOriginalOutcomeDATA():Readonly<{state:'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED'|'UNKNOWN';action:string;businessAction:string|null;completionScope:'PRODUCT_LOCAL_COMMIT_ONLY'|'TASK_APPROVAL_COMMIT_ONLY'|'READ_ONLY_OBSERVATION'|null;requestRef:string|null}>;readOriginalBusinessReceipt():Uint8Array|null;assertCurrent():void}
export function readOriginalAITaskActionV6OutcomeForNative(peer:unknown,sameContext:OriginalAITaskActionV6Context):Readonly<{operationId:string;nonce:string|null;unsignedOriginal:string|null;bodyOriginal:Uint8Array;memberOriginal:Uint8Array|null;responseOriginal:unknown}>;
export interface OriginalAITaskV6OutcomePortPrivate {assertOriginalAITaskActionV6OutcomeCurrent(peer:unknown,sameContext:OriginalAITaskActionV6Context):void|Promise<void>;acquireOriginalAITaskActionV6Outcome(peer:unknown,sameContext:OriginalAITaskActionV6Context,originalResponseDATA:unknown):Promise<OriginalAITaskV6NativeOutcomePrivate<OriginalAITaskV6HeldOutcomePrivate>>;assertOriginalAITaskActionV6LookupCurrent(originalOperationId:string,sameContext:OriginalAITaskActionV6Context):void|Promise<void>}

/** Actual formal lookup acquisition is an explicit owned outcome, never a bare owner. */
export interface OriginalAITaskV6HeldLookupPrivate extends OriginalAITaskV6HeldDrainPrivate {readOriginalOperationId():string;readOriginalEvidence():Uint8Array}
export interface OriginalAITaskV6LookupPortPrivate {assertOriginalAITaskActionV6LookupCurrent(originalOperationId:string,sameContext:OriginalAITaskActionV6Context):void|Promise<void>;lookupOriginalAITaskActionV6(originalOperationId:string,sameContext:OriginalAITaskActionV6Context):Promise<OriginalAITaskV6NativeOutcomePrivate<OriginalAITaskV6HeldLookupPrivate>>}
