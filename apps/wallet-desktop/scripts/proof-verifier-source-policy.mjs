// Source-version fence only, NOT signature/asset/profile qualification. The
// existing fixed independent receipt reader must still validate every byte.
// Old frozen candidates keep their own source bytes and historical profiles.
export function assertSelectedProofVerifierForSDK(sdkVersion,receipt){
 if(sdkVersion==='1.3.0-pq.3.32-auth.46'&&receipt?.sourceCommit!=='4afc29656ee0f60c6eda9ae62387e6797552aa3e')throw Error('WALLET_SDK46_4AFC_SIGNED_VERIFIER_REQUIRED');
}
