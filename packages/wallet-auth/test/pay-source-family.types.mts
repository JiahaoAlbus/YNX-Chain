import{inspectOriginalPayCloudBillMappingV1DATA,type OriginalPayCloudBillMappingV1,type OriginalPayCloudBillSourceV2Policy}from'@ynx-chain/wallet-auth/pay-native-cloud-bill-source-data';
import{inspectOriginalPayCloudBillSourceIssuanceBodyDATA}from'@ynx-chain/wallet-auth/auth-source-verification';
declare const mapping:OriginalPayCloudBillMappingV1;declare const policy:OriginalPayCloudBillSourceV2Policy;
const result=inspectOriginalPayCloudBillMappingV1DATA(mapping,'a'.repeat(64),'0x'+'1'.repeat(40),200000,100000);
const noSubmit:false=result.submitAuthority;const noAnchor:false=result.proofAnchorTrusted;
// @ts-expect-error parsed mapping cannot approve
const approved:true=result.approval;
// @ts-expect-error platform is mandatory and never defaults to GOOS/macOS
const missing:OriginalPayCloudBillSourceV2Policy={rootDigest:'',enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'',signatureContract:policy.signatureContract,applicationId:'',productId:''};
// @ts-expect-error old scope is not this Source purpose
const legacy:OriginalPayCloudBillSourceV2Policy={...policy,signatureContract:{...policy.signatureContract,purpose:'AUTH-IDENTITY-RECEIVE'}};
void [noSubmit,noAnchor,approved,missing,legacy,inspectOriginalPayCloudBillSourceIssuanceBodyDATA];
