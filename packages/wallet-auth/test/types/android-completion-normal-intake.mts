import type{OriginalProductPairPendingCompletionReaderV4,OriginalPendingCompletionProfileCandidateDATA}from'../../src/product-pair-session-v4-source.js';
import{acquireOriginalProductPairPendingCompletionReaderV4}from'../../src/product-pair-session-v4-source.js';import type{Buffer}from'node:buffer';
declare const owner:OriginalProductPairPendingCompletionReaderV4;declare const raw:Buffer;
const request={profileBodyOriginal:'original-constraint',queryOriginal:raw,originalPairPost:raw,completionOperationId:'independent-id'};const result=await owner.readOriginalCompletionCandidateDATA(request);if(!result.errorPresent){const c:OriginalPendingCompletionProfileCandidateDATA=result.candidate;const noGrant:false=c.SourceAdmission;const nextPlan:true=c.newIssuancePlanRequired;void noGrant;void nextPlan;}
// @ts-expect-error old three-field consumer must supply the distinct completion constraint
await owner.readOriginalCompletionCandidateDATA({profileBodyOriginal:'',queryOriginal:raw,originalPairPost:raw});
// @ts-expect-error normal acquisition is zero input, no provider or Root boolean
await acquireOriginalProductPairPendingCompletionReaderV4({Root:true});
