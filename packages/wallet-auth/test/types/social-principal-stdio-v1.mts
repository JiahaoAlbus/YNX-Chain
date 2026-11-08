import{encodeSocialPrincipalRequestFrame as encode,nextSocialPrincipalSequence as next,decodeSocialPrincipalBindingOriginal,decodeSocialPrincipalQualifiedOriginal,type SocialSignedProfileOriginalUTF8,type SocialSourceRegistrationOriginalUTF8,type SocialPrincipalResponseDATA}from'../../native/social-principal-stdio-v1/codec.mjs';
encode({version:1,sequence:next('9007199254740993'),command:'current',requestOriginal:'',replayKey:'',proofExpiresMS:0});
// @ts-expect-error no Number sequence can round u64
next(9007199254740993);
// @ts-expect-error finite command no arbitrary HTTP
encode({version:1,sequence:'1',command:'POST',requestOriginal:'',replayKey:'',proofExpiresMS:0});
// @ts-expect-error read is payload-free
encode({version:1,sequence:'1',command:'read',requestOriginal:'caller',replayKey:'',proofExpiresMS:0});
const binding=decodeSocialPrincipalBindingOriginal('original');const profile:SocialSignedProfileOriginalUTF8=binding.profileOriginal;
// @ts-expect-error original profile cannot replace registration raw
const registration:SocialSourceRegistrationOriginalUTF8=profile;
// @ts-expect-error binding8 not principal9
const principal:ReturnType<typeof decodeSocialPrincipalQualifiedOriginal>=binding;
// @ts-expect-error RootAdmission data cannot be promoted
const admitted:true=binding.RootAdmission;
// @ts-expect-error error string loses presence/raw code and is not wire v1
const bad:SocialPrincipalResponseDATA={version:1,sequence:'0',original:null,errorPresent:true,error:'0',physicalDone:false};
void[registration,principal,admitted,bad];
