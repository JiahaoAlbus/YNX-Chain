import type {OriginalAuthSourceV2Enrollment,OriginalAuthSourceV2ProfileData} from '../../native/original-auth-identity-source-v2-verifier.mjs';
const services:OriginalAuthSourceV2Enrollment['service'][]=['wallet-product-session-v2','ide-contract-relay-v1','ide-project-authority-v1'];
const operations:OriginalAuthSourceV2Enrollment['operations']=['CurrentProject','CurrentPublisher','RecheckProject'];
// @ts-expect-error arbitrary services are not declared by the original verifier
const foreign:OriginalAuthSourceV2Enrollment['service']='caller-project-authority';
// @ts-expect-error mixed operation domains do not form any original exact tuple
const mixed:OriginalAuthSourceV2Enrollment['operations']=['CurrentProject','disconnect','RecheckProject'];
declare const verified:OriginalAuthSourceV2ProfileData;
const notAdmission:false=verified.nativeAdmission;
// @ts-expect-error verified Source DATA does not produce a JS currentPublisher factory
verified.copyOriginalIDECurrentPublisher('publisher','project');
void services;void operations;void foreign;void mixed;void notAdmission;
