import{collectSocialMatchedNormalCohortDATA}from'../../scripts/social-matched-normal-cohort.mjs';const p=collectSocialMatchedNormalCohortDATA();const d:true=p.dataOnly;const no:false=p.RootAdmission;const noImage:false=p.normalImageReady;void[d,no,noImage];
// @ts-expect-error no caller profile or provider
collectSocialMatchedNormalCohortDATA({});
