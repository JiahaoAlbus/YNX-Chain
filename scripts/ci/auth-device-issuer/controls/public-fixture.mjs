import test,{mock} from 'node:test';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';
const root=process.env.AUTH_DEVICE_SCOPE_STAGE;
const load=rel=>import(pathToFileURL(root+'/'+rel));
const {inspectOriginalProductDeviceV4SourceScopeDATA:inspect}=await load('native/original-product-device-v4-source-contract.mjs');
const {canonicalJSON}=await load('src/canonical.js');
const {walletIdentityFromPublicKey,evmAddressFromYNX}=await load('src/crypto.js');
const {deriveProductSessionBindingV4Data}=await load('src/product-session-v2.js');
const {inspectProductSessionDeviceRegistrationOriginalV4Data:registration}=await load('src/product-session-device-registration-v4.js');
const {PRODUCT_SESSION_DEVICE_V4_EXPECTED_FIELDS}=await load('src/product-session-device-v4.js');
const {PQ_SUITE}=await load('src/pq-wallet-contract.js');
// Public generator point and inert public pair bytes only. No private key,
// signing, Source admission or key slot is used by this DATA regression.
const account=walletIdentityFromPublicKey('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),owner=evmAddressFromYNX(account),network='a'.repeat(64),issued=1000,end=21000;
function sample({pkA='11'.repeat(2592),pkB='22'.repeat(64)}={}){
 const binding={productId:'wallet',clientId:'wallet.macos',platform:'macos',applicationId:'com.ynx.wallet',bundleId:'com.ynx.wallet',packageId:null,origin:'https://wallet.ynxweb4.com',callback:'ynxwallet://callback'};
 const reg={version:'4',registrationId:'11111111-1111-4111-8111-111111111111',networkId:network,canonicalOwner:owner,...binding,deviceId:'PUBLIC-device-v4',generation:'1',revision:'1',pkA,pkB,registeredAt:new Date(0).toISOString(),expiresAt:new Date(30000).toISOString(),revokedAt:null};
 const registrationOriginal=canonicalJSON(reg),digest=registration(Buffer.from(registrationOriginal)).registrationDigest;
 const sessionCore={version:'4',chainId:'ynx_6423-1',...binding,account,deviceId:reg.deviceId,deviceAlgorithm:PQ_SUITE,deviceRegistrationId:reg.registrationId,deviceRegistrationRevision:reg.revision,deviceRegistrationDigest:digest,nonce:'n'.repeat(43),state:'s'.repeat(43),scopes:['read'],requestDigest:'b'.repeat(64),approvalDigest:'c'.repeat(64),issuedAt:new Date(0).toISOString(),expiresAt:new Date(30000).toISOString(),accountAuthorization:{policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',networkId:network,canonicalOwner:owner,revision:'1',registeredAt:'1',activeFrom:'2',pkA:'33'.repeat(2592),pkB:'44'.repeat(64)}};
 const session={...sessionCore,sessionBinding:deriveProductSessionBindingV4Data(sessionCore)};
 const expected={networkId:network,canonicalOwner:owner,account,sessionBinding:session.sessionBinding,...binding,deviceId:reg.deviceId,generation:'1',registrationId:reg.registrationId,revision:'1',registrationDigest:digest};
 return{version:'4',expected,context:{version:'4',algorithm:PQ_SUITE,securityLevel:'os-protected',networkId:network,account,deviceId:reg.deviceId,generation:'1',registrationId:reg.registrationId,revision:'1',registrationDigest:digest,scopes:['read'],purpose:'PRODUCT-SESSION-HTTP-PROOF'},registrationOriginal,sessionOriginal:canonicalJSON(session)};
}
const association=s=>Object.fromEntries(['account','clientId','productId','platform','applicationId','deviceId'].map(k=>[k,s.expected[k]]));
const check=(s,at=2000)=>inspect(s,association(s),network,owner,issued,end,at);
// Execute the ACTUAL full verifier entrypoints. Only the registered-PQ math
// and independently-observed snapshot boundary are explicit PUBLIC mocks.
// This proves dedicated dispatch/binding, NOT valid signatures or admission.
const policyModule=await load('src/pq-wallet-policy.js'),memberModule=await load('src/pq-registered-member.js');
mock.module(pathToFileURL(root+'/src/pq-wallet-policy.js'),{namedExports:{...policyModule,inspectPQAuthorizationView:s=>s.PUBLIC_VIEW,parsePQAccountAuthorization:s=>s,assertPQAuthorizationCurrent:(a,b)=>{if(canonicalJSON(a)!==canonicalJSON(b))throw Error('PUBLIC registration changed')}}});
mock.module(pathToFileURL(root+'/src/pq-registered-member.js'),{namedExports:{...memberModule,verifyPQRegisteredMemberData:()=>({memberCount:1,memberIndex:0})}});
const verifier=await load('native/original-auth-identity-source-v2-verifier.mjs'),{sha}=await load('native/original-auth-identity-source-verifier.mjs');
function full(){
 const scope=sample(),rootOwner='0x'+'11'.repeat(20),profileOwner='0x'+'22'.repeat(20),currentOwner='0x'+'33'.repeat(20),purpose='product-session-device-source-v4';
 const rootRaw=canonicalJSON({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-root',networkId:network,rootOwner});
 const wrap=(role,id,body)=>canonicalJSON({version:2,algorithmVersion:'YNX-BATCH/v0.1',role,networkId:network,owner:id,keyVersion:'1',executionHeight:'5',body:Buffer.from(canonicalJSON(body)).toString('base64url'),member:'AQ'});
 const e={version:2,purpose,rootId:'PUBLIC-root',rootOwner,sourceId:'PUBLIC-device-source',service:purpose,productId:'wallet',platform:'macos',applicationId:'com.ynx.wallet',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'d'.repeat(64),profileOwner,currentOwner,endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'e'.repeat(64),currentStatePath:'/PUBLIC/source-current',operations:['device.current','device.http-proof'],issuedAtMs:0,expiresAtMs:30000};
 const enrollmentRaw=wrap('enrollment',rootOwner,e),p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:sha(enrollmentRaw),instanceId:'PUBLIC-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owner,selection:{association:association(scope),expectedRequest:{service:purpose,productId:e.productId,platform:e.platform,applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:e.operations,instanceId:'PUBLIC-instance'},originalHostStatePath:'/PUBLIC/once',originalHostTerminalDirectory:'/PUBLIC/once.private-terminal',productSessionDeviceV4:scope},issuedAtMs:issued,expiresAtMs:end};
 const policy={rootDigest:sha(rootRaw),enrollmentDigest:sha(enrollmentRaw),endpoint:e.endpoint,spki:e.spki,signatureContract:{purpose,enrollmentFrame:'PUBLIC-device-enrollment',profileFrame:'PUBLIC-device-profile',currentFrame:'PUBLIC-device-current'},applicationId:e.applicationId,productId:e.productId};
 const registrations=Object.fromEntries([['root',rootOwner,'a'],['profile',profileOwner,'b'],['current',currentOwner,'c'],['subject',owner,'3']].map(([role,id,key])=>[role,{networkId:network,owner:id,executionHeight:'5',PUBLIC_VIEW:{pqSigningEnabled:true,authorizationStatus:'active',activeRecord:{revision:'1',registeredAt:'1',activeFrom:'2',pkA:key.repeat(5184),pkB:(role==='subject'?'4':key).repeat(128)}}}]));
 const c={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:sha(enrollmentRaw),profileDigest:'',instanceId:p.instanceId,generation:1,subjectOwner:owner,subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonicalJSON(scope)),status:'active',nonce:'n'.repeat(43),issuedAtMs:issued,expiresAtMs:end};
 const previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'5'};
 return {e,p,c,policy,registrations,rootRaw,enrollmentRaw,wrap,profile(){return wrap('profile',profileOwner,p);},verify(){const profileRaw=this.profile();c.profileDigest=sha(profileRaw);return verifier.verifyOriginalAuthSourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,wrap('current',currentOwner,c),policy,registrations,c.nonce,previous,2000);}};
}

export {full};
