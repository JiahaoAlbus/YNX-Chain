import {WPR_NORMAL_INPUT_PROVENANCE,bindWalletProductNormalInputsPlanDATA,assertWalletProductNormalInputsPlanDATA,type WPRNormalInputProvenance,type WPRNormalPlan} from '../scripts/wallet-product-normal-inputs.mjs';const provenance:WPRNormalInputProvenance={version:WPR_NORMAL_INPUT_PROVENANCE,typedBuildOriginal:'original',independentOriginalPin:{path:'/independent',bytes:1,sha256:'digest'},runtimeLeafPins:[]};const base:WPRNormalPlan={commands:[],objectOutputs:[],output:'/image.node'};const p=bindWalletProductNormalInputsPlanDATA(base,{path:'/header.hpp',bytes:1,sha256:'headerDigest',inputDigest:'inputDigest'},provenance);const result=assertWalletProductNormalInputsPlanDATA(p);const noRoot:false=result.RootAdmission;void noRoot;
// @ts-expect-error no approval flag or runtime table setter
const invalid:WPRNormalInputProvenance={...provenance,approved:true};void invalid;
// @ts-expect-error normal build DATA cannot confer Source grant
const grant:true=result.SourceAdmission;
