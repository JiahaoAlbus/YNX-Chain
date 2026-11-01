import {commissionStableReviewedPairCurrentSDK} from '../scripts/pair-current-commissioning/commission-sdk.mjs';
import {postprocessStableReviewedPairCurrentSource} from '../scripts/pair-current-commissioning/postprocess-reviewed-source.mjs';
const r=commissionStableReviewedPairCurrentSDK();const root:false=r.RootAdmission;const native:false=r.NativeAdmission;const finite:false=r.finiteCheckpointCompiled;
// @ts-expect-error no approval/provider constructor
commissionStableReviewedPairCurrentSDK({approved:true});
// @ts-expect-error old RootV2 receipt is not accepted as stable Root-current receipt
postprocessStableReviewedPairCurrentSource({status:'SOURCE_CANDIDATE_ONLY_NOT_RELEASED',cas:[]});
// @ts-expect-error review output is never an admitted Native image
const approved:true=r.NativeAdmission;
