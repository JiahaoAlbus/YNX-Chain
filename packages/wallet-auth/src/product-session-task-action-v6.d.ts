/** V6 AI native task DATA/math; never Source, once-store, signer or permission. */
export const PRODUCT_SESSION_TASK_RESPONSE_HEADER_V6:'x-ynx-product-session-response-proof-v6';
export const PRODUCT_SESSION_TASK_ACTION_HEADER_V6:'x-ynx-product-session-proof-v6';
export const PRODUCT_SESSION_TASK_ACTION_DOMAIN_V6:'YNX-PRODUCT-SESSION-AI-TASK-ACTION/v6';
export const PRODUCT_SESSION_TASK_ACTION_PURPOSE_V6:'PRODUCT-SESSION-AI-TASK-ACTION';
export const PRODUCT_SESSION_TASK_RESPONSE_DOMAIN_V6:'YNX-PRODUCT-SESSION-AI-TASK-ACTION-RESPONSE/v6';
export const PRODUCT_SESSION_TASK_RESPONSE_PURPOSE_V6:'PRODUCT-SESSION-AI-TASK-RESPONSE';
export const PRODUCT_SESSION_TASK_V6_LIMITS:Readonly<{body:1048576;message:16384;member:98304;header:196608;totalHeaders:262144}>;
export const PRODUCT_SESSION_TASK_REQUEST_FIELDS_V6:readonly string[];
export const PRODUCT_SESSION_TASK_RESPONSE_FIELDS_V6:readonly string[];
export type ProductSessionTaskActionV6='task.create'|'task.prepare'|'task.approve'|'task.cancel'|'task.dispatch'|'task.run-start'|'task.run-resume'|'task.list'|'task.read'|'task.step-result'|'task.run-read'|'task.reconcile'|'task.propose-tool-step'|'task.complete';
/** task.handoff actual body/implemented handler contract is not supplied; it remains unregistered here. */
export interface ProductSessionTaskCommonV6 {readonly version:'6';readonly sessionBinding:string;readonly productId:'ai';readonly clientId:'ynx-ai-v1';readonly applicationId:'com.ynxweb4.ai';readonly origin:string;readonly callback:'ynxai://wallet-auth/callback';readonly account:string;readonly canonicalOwner:string;readonly deviceId:string;readonly deviceRegistrationId:string;readonly deviceRegistrationRevision:string;readonly deviceRegistrationDigest:string;readonly method:'GET'|'POST';readonly path:string;readonly bodyDigest:string;readonly nonce:string;readonly issuedAt:string;readonly expiresAt:string;readonly audience:string;/** Real TaskRecord.Holder/session device string, not a new Ref or authority. */readonly holder:string;readonly operationId:string;readonly policyRevision:string;readonly bodyBytes:string;readonly contentType:'application/json'|null;}
export type ProductSessionTaskNativeIdentityV6=Readonly<{platform:'ios';bundleId:'com.ynxweb4.ai';packageId:null}|{platform:'android';bundleId:null;packageId:'com.ynxweb4.ai'}>;
export type ProductSessionTaskActionV6Unsigned=Readonly<ProductSessionTaskCommonV6&ProductSessionTaskNativeIdentityV6&(
 {action:'task.create';taskId:null;taskRevision:null;generation:null;stepId:null;runId:null;creationBinding:Readonly<{conversationId:string}>}|
 {action:'task.list';taskId:null;taskRevision:null;generation:null;stepId:null;runId:null;creationBinding:null}|
 {action:'task.prepare'|'task.cancel'|'task.read'|'task.propose-tool-step';taskId:string;taskRevision:string;generation:string;stepId:null;runId:null;creationBinding:null}|
 {action:'task.approve'|'task.dispatch'|'task.reconcile'|'task.step-result';taskId:string;taskRevision:string;generation:string;stepId:string;runId:null;creationBinding:null}|
 {action:'task.run-start'|'task.run-resume'|'task.run-read'|'task.complete';taskId:string;taskRevision:string;generation:string;stepId:null;runId:string;creationBinding:null})>;
export type ProductSessionTaskResponseV6Unsigned=Readonly<{version:'6';/** SHA256 of request signed-message E5 bytes; excludes member/header. */requestDigest:string;operationId:string;requestNonce:string;networkId:string;canonicalOwner:string;/** Independent Auth server certificate owner, never inferred from user/device pair. */responseIssuer:string;sessionBinding:string;policyRevision:string;status:number;bodyDigest:string;bodyBytes:string;issuedAt:string;expiresAt:string}&({state:'COMMITTED'|'ACCEPTED'|'OBSERVED';requestRef:string}|{state:'DENIED'|'UNKNOWN';requestRef:string|null})>;
export interface ProductSessionTaskBodyV6DATA {readonly bodyDigest:string;readonly bodyBytes:string;readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly effect?:boolean;readonly originalQuery?:boolean;}
export interface ProductSessionTaskMathV6DATA {readonly version:'6';readonly direction:'request'|'response';readonly purpose:string;readonly signer:string;readonly signatureVerified:true;readonly memberCount:1;readonly memberIndex:0;readonly dataOnly:true;readonly trusted:false;readonly authorized:false;readonly registered:false;readonly current:false;readonly nativeAdmission:false;readonly operationVerified:false;readonly replayAuthorized:false;}
export interface ProductSessionTaskExpectedV6<T> {readonly networkId:string;readonly unsigned:T;readonly pkA:string;readonly pkB:string;}
export function parseProductSessionTaskActionV6Unsigned(input:unknown):ProductSessionTaskActionV6Unsigned;
export function encodeProductSessionTaskActionV6Message(input:ProductSessionTaskActionV6Unsigned,networkId:string):Uint8Array;
export function createProductSessionTaskActionBodyV6DATA(actualBytes:Uint8Array):ProductSessionTaskBodyV6DATA;
export function assertProductSessionTaskActionBodyV6DATA(actualBytes:Uint8Array,unsigned:ProductSessionTaskActionV6Unsigned):ProductSessionTaskBodyV6DATA;
export function parseProductSessionTaskResponseV6Unsigned(input:unknown):ProductSessionTaskResponseV6Unsigned;
export function encodeProductSessionTaskResponseV6Message(input:ProductSessionTaskResponseV6Unsigned,networkId:string):Uint8Array;
export function assertProductSessionTaskResponseBindingV6DATA(response:ProductSessionTaskResponseV6Unsigned,expected:Readonly<{networkId:string;request:ProductSessionTaskActionV6Unsigned;requestRef:string|null;status:number;bodyOriginal:Uint8Array}>):Readonly<{stateDeclaration:'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED'|'UNKNOWN';requestRef:string|null;operationId:string;requestNonce:string;requestDigest:string;dataOnly:true;sourceVerified:false;operationVerified:false;current:false;nativeAdmission:false;replayAuthorized:false}>;
export function inspectProductSessionTaskActionV6Data(memberOriginal:Uint8Array,expected:ProductSessionTaskExpectedV6<ProductSessionTaskActionV6Unsigned>):ProductSessionTaskMathV6DATA;
export function inspectProductSessionTaskResponseV6Data(memberOriginal:Uint8Array,expected:ProductSessionTaskExpectedV6<ProductSessionTaskResponseV6Unsigned>):ProductSessionTaskMathV6DATA;
export function encodeProductSessionTaskActionHeaderV6(unsigned:ProductSessionTaskActionV6Unsigned,memberOriginal:Uint8Array):string;
export function decodeProductSessionTaskActionHeaderV6(header:string):Readonly<ProductSessionTaskActionV6Unsigned&{member:string}>;
export function encodeProductSessionTaskResponseHeaderV6(unsigned:ProductSessionTaskResponseV6Unsigned,memberOriginal:Uint8Array):string;
export function decodeProductSessionTaskResponseHeaderV6(header:string):Readonly<ProductSessionTaskResponseV6Unsigned&{member:string}>;
export function inspectProductSessionTaskActionHeaderV6Data(header:string,expected:ProductSessionTaskExpectedV6<ProductSessionTaskActionV6Unsigned>):ProductSessionTaskMathV6DATA;
export function inspectProductSessionTaskResponseHeaderV6Data(header:string,expected:ProductSessionTaskExpectedV6<ProductSessionTaskResponseV6Unsigned>):ProductSessionTaskMathV6DATA;

/** Narrow semantic DATA; bytes/shape never establish provenance or grant authority. */
export function inspectProductSessionTaskOutcomeV6DATA(input:Readonly<{action:ProductSessionTaskActionV6;businessAction:string|null;state:'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED'|'UNKNOWN';completionScope:'PRODUCT_LOCAL_COMMIT_ONLY'|'TASK_APPROVAL_COMMIT_ONLY'|'READ_ONLY_OBSERVATION'|null;businessReceiptOriginal:Uint8Array|null}>):Readonly<{stateDeclaration:'COMMITTED'|'ACCEPTED'|'OBSERVED'|'DENIED'|'UNKNOWN';businessAction:string|null;completionScope:'PRODUCT_LOCAL_COMMIT_ONLY'|'TASK_APPROVAL_COMMIT_ONLY'|'READ_ONLY_OBSERVATION'|null;businessReceiptPresent:boolean;dataOnly:true;receiptProvenanceVerified:false;durabilityVerified:false;operationVerified:false;toolAuthorized:false;modelAuthorized:false;fundsAuthorized:false;replayAuthorized:false}>;

export const PRODUCT_SESSION_TASK_LOCAL_BUSINESS_ACTIONS_V6:Readonly<{'task.create':'create-task';'task.prepare':'prepare-task';'task.propose-tool-step':'propose-tool-step';'task.cancel':'cancel-task';'task.complete':'complete-task'}>;
