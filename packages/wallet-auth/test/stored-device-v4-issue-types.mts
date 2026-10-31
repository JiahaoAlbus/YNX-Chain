import{inspectStoredProductSessionV4IssueOriginalDATA}from'../src/product-session-pq-v4-codec.js';
import type{StoredProductSessionV4IssueOriginalInputDATA,StoredProductSessionV4IssueOriginalDATA}from'../src/product-session-pq-v4-codec.js';
declare const registry:unknown,input:StoredProductSessionV4IssueOriginalInputDATA;
const d:Readonly<StoredProductSessionV4IssueOriginalDATA>=inspectStoredProductSessionV4IssueOriginalDATA(registry,input),mathematical:true=d.signatureVerified,count:2=d.accountApprovalsVerified,none:false=d.SourceAdmission,alsoNone:false=d.RootAdmission,time:'original-signatures-and-store-commits-only'=d.timeBasis;void[mathematical,count,none,alsoNone,time];
// @ts-expect-error Store raw originals are canonical UTF8 strings, not alternate Uint8Array schema.
inspectStoredProductSessionV4IssueOriginalDATA(registry,{...input,pairInputOriginal:new Uint8Array([1])});
// @ts-expect-error No observation/provider/current/time callback enters historical verification.
inspectStoredProductSessionV4IssueOriginalDATA(registry,{...input,provider:()=>true});
// @ts-expect-error Commit time is actual safe integer milliseconds, not decimal string.
inspectStoredProductSessionV4IssueOriginalDATA(registry,{...input,completeCommittedAtMs:'1'});
// @ts-expect-error Both original store commit timestamps are mandatory.
inspectStoredProductSessionV4IssueOriginalDATA(registry,{pairInputOriginal:'',completeInputOriginal:'',sessionOriginal:'',challengeOriginal:''});
// @ts-expect-error Historical math is not a current Native/Source/account grant.
const native:true=d.NativeAdmission;void native;
