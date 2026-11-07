import {materializeOriginalWalletProductPublicDATA,selectReviewedWalletProductMaterialization,type WPRMaterializationDATA,type RequiredWPRIssuerPublicOriginalOutcomeV1} from '../src/original-wallet-product-materializer-data.js';
declare const data:WPRMaterializationDATA;
const m=materializeOriginalWalletProductPublicDATA(data);
const noRoot:false=m.RootAdmission;
// @ts-expect-error frozen output never becomes a Root grant
m.RootAdmission=true;
// @ts-expect-error build metadata cannot supply runtime rows
selectReviewedWalletProductMaterialization(data);
// @ts-expect-error uid uses the actual WPR3 u32 number contract
const uid:WPRMaterializationDATA['build']['uid']='501';
// @ts-expect-error caller cannot delete one independent registered role
const roles:WPRMaterializationDATA['registrations']['fresh']={root:{},profile:{},current:{}};
// @ts-expect-error Native loan error presence is explicit, not error truthiness
const invalid:RequiredWPRIssuerPublicOriginalOutcomeV1={owner:null,error:false};
// @ts-expect-error public original set requires a separate fresh current
const originals:WPRMaterializationDATA['originals']={root:'',enrollment:'',profile:'',acquisitionHead:''};
void noRoot;
