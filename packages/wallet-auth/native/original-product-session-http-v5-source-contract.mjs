// V5 dedicated Source signed scope DATA; never V4 GET Source permission.
import{types}from'node:util';import{parseProductSession}from'../src/product-session-v2.js';
import{inspectOriginalProductDeviceV4SourceScopeDATA}from'./original-product-device-v4-source-contract.mjs';
export const PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE='product-session-device-http-binary-source-v5';
export const PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_OPERATIONS=Object.freeze(['device.current','device.http-proof-v5']);
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_HTTP_V5_SCOPE'),{code:'AUTH_SOURCE_V2_HTTP_V5_SCOPE'})};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail()}
export function inspectOriginalProductSessionHTTPProofV5SourceScopeDATA(scope,association,networkId,subjectOwner,issued,expires,at){
 exact(scope,['version','expected','context','registrationOriginal','sessionOriginal','targetURL','maxBodyBytes']);
 if(scope.version!=='5'||typeof scope.targetURL!=='string'||scope.targetURL.length>2048||!scope.targetURL.isWellFormed()||Buffer.byteLength(scope.targetURL)>2048)fail();let u;try{u=new URL(scope.targetURL)}catch{fail()}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||scope.targetURL.includes('?')||scope.targetURL.includes('#')||u.hostname.length>253||u.pathname!=='/api/v1/ide/deployments'||u.href!==scope.targetURL)fail();
 if(typeof scope.maxBodyBytes!=='string'||!/^[1-9][0-9]{0,7}$/.test(scope.maxBodyBytes)||BigInt(scope.maxBodyBytes)>68288512n)fail();
 const data=inspectOriginalProductDeviceV4SourceScopeDATA({version:'4',expected:scope.expected,context:scope.context,registrationOriginal:scope.registrationOriginal,sessionOriginal:scope.sessionOriginal},association,networkId,subjectOwner,issued,expires,at),session=parseProductSession(JSON.parse(scope.sessionOriginal)),identity=Object.freeze(Object.fromEntries(['sessionBinding','productId','clientId','applicationId','bundleId','packageId','origin','callback','account','canonicalOwner','deviceId','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest'].map(k=>[k,k==='canonicalOwner'?scope.expected.canonicalOwner:session[k]])));
 // Before current-envelope min: Native/current consumer additionally clamps
 // this ceiling to its actual current lease, never caller expiry/keys/identity.
 const normalScopeDATA=Object.freeze({version:'5',targetURL:scope.targetURL,networkId,pkA:data.devicePublic.pkA,pkB:data.devicePublic.pkB,identity,expiresAtMs:data.expiresAtMs,maxBodyBytes:scope.maxBodyBytes});
 return Object.freeze({...data,version:'5',targetURL:scope.targetURL,maxBodyBytes:scope.maxBodyBytes,normalScopeDATA,registered:false,current:false,SourceAdmission:false,NativeAdmission:false});
}
