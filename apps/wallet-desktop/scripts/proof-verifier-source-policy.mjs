// Source-version fence only, NOT signature/asset/profile qualification. The
// existing fixed independent receipt reader must still validate every byte.
// Old frozen candidates keep their own source bytes and historical profiles.
export function assertSelectedProofVerifierForSDK(sdkVersion,receipt){
 if(['1.3.0-pq.3.32-auth.46','1.3.0-pq.3.32-auth.49'].includes(sdkVersion)&&receipt?.sourceCommit!=='4afc29656ee0f60c6eda9ae62387e6797552aa3e')throw Error(`WALLET_SDK${sdkVersion.split('.').at(-1)}_4AFC_SIGNED_VERIFIER_REQUIRED`);
}
