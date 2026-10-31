import*as S from'../src/social-platform-policy-v3.js';
declare const p:S.SocialPlatformPolicyOriginalV3DATA,r:S.SocialPlatformReleaseOptInV4DATA,d:S.SocialPlatformRuntimeDelegationV4DATA,c:S.SocialPlatformCurrentOriginalV3DATA,e:S.SocialPlatformOriginalContextDATA,b:S.SocialPlatformBindingV1DATA,q:S.SocialPlatformQueryBindingV1DATA;
const bytes:Uint8Array=S.encodeSocialPlatformPolicyOriginalV3DATA(p);const again:S.SocialPlatformPolicyOriginalV3DATA=S.decodeSocialPlatformPolicyOriginalV3DATA(bytes);const noGrant:false=S.assertSocialPlatformRuntimeV4DATA(r,d,d,p,e,120n).RootAdmission;void[again,noGrant];
// @ts-expect-error Original u64 values cannot silently become unsafe Number.
const unsafeGeneration:number=b.policy_generation;
// @ts-expect-error Ordinary V4 does not authorize strong PolicyV3.
const strongPolicy:S.SocialPlatformPolicyOriginalV3DATA={...p,platform_profile:2,capabilities:65791};
// @ts-expect-error Legacy opt-in3 is not a new release4.
const legacyRelease:S.SocialPlatformReleaseOptInV4DATA={...r,version:3};
// @ts-expect-error Legacy credential delegation3 is not the new explicit4.
const legacyDelegate:S.SocialPlatformRuntimeDelegationV4DATA={...d,version:3};
const{key_epoch,...missingEpoch}=p;
// @ts-expect-error key epoch is required, never derived from storage generation.
S.encodeSocialPlatformPolicyOriginalV3DATA(missingEpoch);
// @ts-expect-error Independent original query never becomes NEW/READY/effect permission.
S.assertSocialPlatformReadOriginalQueryDATA(b,q,b,'READY',100n);
// @ts-expect-error Policy current data is never a verified Root grant.
const fakeGrant:true=S.assertSocialPlatformPolicyCurrentDATA(p,c,new Uint8Array(32),120n).RootAdmission;
void[unsafeGeneration,strongPolicy,legacyRelease,legacyDelegate,fakeGrant];
