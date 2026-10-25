import {parseProductSession,deriveProductSessionBindingV4Data,createProductSessionProofV2With,type ProductSessionV4,type ProductSessionV2} from '../../src/index.js';
declare const session:ProductSessionV4;declare const legacy:ProductSessionV2;
const {sessionBinding,...core}=session;const digest:string=deriveProductSessionBindingV4Data(core),r=parseProductSession(session);void[digest,sessionBinding,legacy];
if(r.version==='4'){const algorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512'=r.deviceAlgorithm;void algorithm;
// @ts-expect-error A v4 session has no compressed classic device key.
r.deviceKey;}
// @ts-expect-error Never route a v4 session to the v2 P256 signer path.
createProductSessionProofV2With(session,{method:'GET',path:'/api/status',bodyDigest:'',nonce:'',issuedAt:'',expiresAt:''},()=> '');
// @ts-expect-error v4 full tuple is required, a v2 session is not a v4 digest input.
deriveProductSessionBindingV4Data(legacy);
