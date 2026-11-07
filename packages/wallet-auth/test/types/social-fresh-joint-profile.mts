import type{FreshCapturedOriginalsDATA,JointProfilePlanDATA,SourceRoleSignatureFactsDATA}from'../../native/social-fresh-joint-profile-v1/contract.d.mts';
declare const c:FreshCapturedOriginalsDATA;declare const p:JointProfilePlanDATA;
// @ts-expect-error full u64 cannot become JS Number silently
const epoch:number=c.issuerEpoch;
// @ts-expect-error history envelope original is not scalar counter
const counter:number=c.historyEnvelopeOriginal;
// @ts-expect-error DATA preparation cannot grant Source
const source:true=p.SourceAdmission;
// @ts-expect-error original record role does not become WPR/N1
const role:SourceRoleSignatureFactsDATA['issuerRole']='AUTH-SOURCE-CURRENT';
// @ts-expect-error captured scope is readonly DATA
c.scope.source='foreign';void[epoch,counter,source,role];
