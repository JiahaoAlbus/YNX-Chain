import {encodeProductSessionManagementV4RequestDATA,decodeProductSessionManagementV4ResponseDATA,inspectProductSessionManagementV4ProofDATA,assertProductSessionManagementV4RecoveryDATA,type ProductSessionManagementV4RecoveryTarget,type ProductSessionManagementV4ResponseSelection} from '../src/product-session-management-v4.js';
import type {ProductSessionHTTPProofV4Expected} from '../src/product-session-proof-v4.js';
declare const registry:unknown,input:unknown,original:Uint8Array,proof:string,expected:ProductSessionHTTPProofV4Expected;
declare const target:ProductSessionManagementV4RecoveryTarget;
const d=encodeProductSessionManagementV4RequestDATA(registry,'recover',input,target);
const no:false=d.SourceAdmission;const method:'POST'=d.method;
const verified:true=inspectProductSessionManagementV4ProofDATA(registry,'active',original,proof,expected).signatureVerified;
const selection:ProductSessionManagementV4ResponseSelection={operation:'recover',operationId:'original-operation',requestBodyDigest:'aa',originalRequestBodyDigest:'bb'};
const noEffect:false=decodeProductSessionManagementV4ResponseDATA(original,selection).executionVerified;
const noRetry:false=assertProductSessionManagementV4RecoveryDATA(d,{operationId:'original-operation',originalBodyDigest:'aa',originalBodyOriginal:original}).retryAuthorized;
// @ts-expect-error finite operations only
encodeProductSessionManagementV4RequestDATA(registry,'disconnect',input);
// @ts-expect-error DATA is not Source admission
const grant:true=d.SourceAdmission;
// @ts-expect-error no network or issuer acquisition method
await d.submit();
void [no,method,verified,noEffect,noRetry,grant];

// @ts-expect-error recovery cannot silently derive a PAIR binding or omit its original completion target
encodeProductSessionManagementV4RequestDATA(registry,'recover',input);
