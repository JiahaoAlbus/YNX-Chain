import{encodeSocialOrdinaryCheckpointBodyV2DATA,encodeSocialOrdinaryTerminalBodyV2DATA,inspectSocialOrdinaryCheckpointBodyV2DATA,type SocialOrdinaryCheckpointBodyV2DATA,type SocialOrdinaryTerminalBodyV2DATA,type SocialOrdinaryLocalSignedOptInV1DATA}from'../src/social-local-signed-v2.js';
declare const cp:SocialOrdinaryCheckpointBodyV2DATA;declare const terminal:SocialOrdinaryTerminalBodyV2DATA;
encodeSocialOrdinaryCheckpointBodyV2DATA(cp);encodeSocialOrdinaryTerminalBodyV2DATA(terminal);
// @ts-expect-error actual u64 fields remain canonical decimal strings
const wrong:SocialOrdinaryCheckpointBodyV2DATA={...cp,localOrdinal:10n};
// @ts-expect-error strong committed is never ordinary terminal success
const strong:SocialOrdinaryTerminalBodyV2DATA={...terminal,state:'committed'};
// @ts-expect-error no implicit strong profile in ordinary body2
const profile:SocialOrdinaryCheckpointBodyV2DATA={...cp,platformProfile:2};
declare const opt:SocialOrdinaryLocalSignedOptInV1DATA;
// @ts-expect-error independent install grant does not carry per-refresh policy hash
const old:SocialOrdinaryLocalSignedOptInV1DATA={...opt,policy_original_digest:new Uint8Array(32)};
void [wrong,strong,profile,old,inspectSocialOrdinaryCheckpointBodyV2DATA];
