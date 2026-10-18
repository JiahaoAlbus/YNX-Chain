// Private original Auth/Identity Native-source verification implementation.
// This file issues NOTHING. Release admission of a real enrollment is separate.
import {createHash,createPublicKey,verify,randomBytes,X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {pathToFileURL} from 'node:url';
// No purpose/frame is minted here. All four strings must come from the SAME
// independently reviewed immutable release row; there is no default domain.
export function originalSignatureContract(policy){
 const c=policy?.signatureContract;exact(c,['purpose','enrollmentFrame','profileFrame','currentFrame']);
 if(Object.values(c).some(x=>typeof x!=='string'||x.length<1||Buffer.byteLength(x)>512||x.includes('\0'))||new Set([c.enrollmentFrame,c.profileFrame,c.currentFrame]).size!==3)bad('AUTH_IDENTITY_ORIGINAL_SIGNATURE_CONTRACT_NOT_SUPPLIED');
 return c;
}
const ops=['beginYNX','handleReturn','restore','disconnect'];
const bad=(code='AUTH_IDENTITY_NATIVE_SOURCE_INVALID')=>{throw Object.assign(new Error(code),{code});};
export const canonical=v=>{
 if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
 if(Number.isSafeInteger(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return bad();
};
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const token=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(x);
function exact(x,fields){if(!x||Object.getPrototypeOf(x)!==Object.prototype||Object.keys(x).sort().join('|')!==[...fields].sort().join('|'))bad();}
function parse(raw,maximum=32768){if(typeof raw!=='string'||Buffer.byteLength(raw)>maximum)bad();let value;try{value=JSON.parse(raw);}catch{bad();}if(canonical(value)!==raw)bad();return value;}
function key(pem){if(typeof pem!=='string'||pem.includes('PRIVATE KEY')||pem.length>4096)bad();const result=createPublicKey(pem);if(result.asymmetricKeyType!=='ed25519')bad();return result;}
function envelope(raw,domain,publicKey){
 const value=parse(raw);exact(value,['body','signature']);if(typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))bad();
 const sig=Buffer.from(value.signature,'base64url');if(sig.length!==64||sig.toString('base64url')!==value.signature||!verify(null,Buffer.from(domain+canonical(value.body)),publicKey,sig))bad('AUTH_IDENTITY_NATIVE_SOURCE_SIGNATURE_INVALID');return value.body;
}
function window(body,now,limit){if(!integer(now)||!integer(body.issuedAtMs)||!integer(body.expiresAtMs)||body.expiresAtMs<=body.issuedAtMs||body.expiresAtMs-body.issuedAtMs>limit||now<body.issuedAtMs||now>=body.expiresAtMs)bad('AUTH_IDENTITY_NATIVE_SOURCE_EXPIRED');}
export function verifySourceEnrollment(rootRaw,enrollmentRaw,policy,now){
 // This low-level verifier returns verified mathematics, not Native admission.
 // Native supplies policy from its compiled release table, never caller/ENV.
 exact(policy,['rootDigest','enrollmentDigest','endpoint','spki','signatureContract']);const contract=originalSignatureContract(policy);
 if(!hex(policy.rootDigest)||!hex(policy.enrollmentDigest)||!hex(policy.spki)||sha(rootRaw)!==policy.rootDigest||sha(enrollmentRaw)!==policy.enrollmentDigest||policy.endpoint!=='https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current')bad('AUTH_IDENTITY_NATIVE_ENROLLMENT_NOT_ADMITTED');
 const root=parse(rootRaw,8192);exact(root,['version','purpose','rootId','keyId','publicKey']);
 if(root.version!==1||root.purpose!==contract.purpose||!token(root.rootId)||!token(root.keyId))bad();
 const rootKey=key(root.publicKey),body=envelope(enrollmentRaw,contract.enrollmentFrame,rootKey);
 exact(body,['version','purpose','rootId','rootKeyId','sourceId','service','productId','platform','applicationId','gatewayOrigin','registryDigest','profileKeyId','profilePublicKey','currentKeyId','currentPublicKey','endpoint','spki','currentStatePath','operations','issuedAtMs','expiresAtMs']);
 if(body.version!==1||body.purpose!==contract.purpose||body.rootId!==root.rootId||body.rootKeyId!==root.keyId||!token(body.sourceId)||!token(body.profileKeyId)||!token(body.currentKeyId)||body.profileKeyId===body.currentKeyId||body.service!=='wallet-product-session-v2'||body.productId!=='developer'||body.platform!=='macos'||body.applicationId!=='com.ynxweb4.developer.testnetpreview'||body.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||!hex(body.registryDigest)||body.endpoint!==policy.endpoint||body.spki!==policy.spki||canonical(body.operations)!==canonical(ops))bad();
 if(typeof body.currentStatePath!=='string'||!body.currentStatePath.startsWith('/')||body.currentStatePath.split('/').some(part=>part==='.'||part==='..')||body.currentStatePath.includes('\0'))bad();
 const profileKey=key(body.profilePublicKey),currentKey=key(body.currentPublicKey);
 const pub=k=>k.export({format:'der',type:'spki'}).toString('base64url');
 if(new Set([pub(rootKey),pub(profileKey),pub(currentKey)]).size!==3)bad('AUTH_IDENTITY_NATIVE_SOURCE_KEYS_NOT_DISTINCT');
 window(body,now,86400000);return {body,profileKey,currentKey};
}
export function verifySourceProfile(rootRaw,enrollmentRaw,profileRaw,policy,now){
 const enrollment=verifySourceEnrollment(rootRaw,enrollmentRaw,policy,now),contract=originalSignatureContract(policy),profile=envelope(profileRaw,contract.profileFrame,enrollment.profileKey);
 exact(profile,['version','purpose','sourceId','enrollmentDigest','instanceId','generation','minimumSequence','minimumFloor','selection','issuedAtMs','expiresAtMs']);
 if(profile.version!==1||profile.purpose!==contract.purpose||profile.sourceId!==enrollment.body.sourceId||profile.enrollmentDigest!==policy.enrollmentDigest||!token(profile.instanceId)||!integer(profile.generation)||profile.generation<1||!integer(profile.minimumSequence)||profile.minimumSequence<1||!integer(profile.minimumFloor)||profile.minimumFloor>profile.minimumSequence)bad();
 const selection=profile.selection;
 if(!selection||typeof selection!=='object'||Array.isArray(selection))bad();
 const association=selection.association;exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(Object.values(association).some(x=>typeof x!=='string'||!x||x.length>512)||association.productId!==enrollment.body.productId||association.platform!==enrollment.body.platform||association.applicationId!==enrollment.body.applicationId)bad();
 const request=selection.expectedRequest;
 if(!request||request.service!==enrollment.body.service||request.productId!==enrollment.body.productId||request.platform!==enrollment.body.platform||request.applicationId!==enrollment.body.applicationId||request.gatewayOrigin!==enrollment.body.gatewayOrigin||request.registryDigest!==enrollment.body.registryDigest||canonical(request.operations)!==canonical(ops)||request.instanceId!==profile.instanceId)bad('AUTH_IDENTITY_NATIVE_SOURCE_BINDING_MISMATCH');
 if(typeof selection.originalHostStatePath!=='string'||!selection.originalHostStatePath.startsWith('/')||selection.originalHostStatePath.split('/').some(x=>x==='.'||x==='..')||selection.originalHostTerminalDirectory!==selection.originalHostStatePath+'.private-terminal')bad();
 window(profile,now,86400000);if(profile.issuedAtMs<enrollment.body.issuedAtMs||profile.expiresAtMs>enrollment.body.expiresAtMs)bad();return {enrollment,profile};
}
function verifyCurrentStatement(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,expectedNonce,previous,now,historical){
 const {enrollment,profile}=verifySourceProfile(rootRaw,enrollmentRaw,profileRaw,policy,now);
 exact(previous,['sequence','floor','head','timeFloor']);
 if(!integer(previous.sequence)||!integer(previous.floor)||!integer(previous.timeFloor)||!(previous.head===''||hex(previous.head))||now<previous.timeFloor)bad('AUTH_IDENTITY_NATIVE_SOURCE_ROLLBACK');
 const contract=originalSignatureContract(policy),current=envelope(currentRaw,contract.currentFrame,enrollment.currentKey);
 exact(current,['version','purpose','sourceId','enrollmentDigest','profileDigest','instanceId','generation','sequence','floor','head','status','nonce','issuedAtMs','expiresAtMs']);
 if(current.version!==1||current.purpose!==contract.purpose||current.sourceId!==profile.sourceId||current.enrollmentDigest!==policy.enrollmentDigest||current.profileDigest!==sha(profileRaw)||current.instanceId!==profile.instanceId||current.generation!==profile.generation||!integer(current.sequence)||current.sequence<Math.max(profile.minimumSequence,previous.sequence)||!integer(current.floor)||current.floor<Math.max(profile.minimumFloor,previous.floor)||current.floor>current.sequence||!hex(current.head)||current.nonce!==expectedNonce||typeof expectedNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)||!['active','revoked','retired'].includes(current.status))bad('AUTH_IDENTITY_NATIVE_SOURCE_CURRENT_INVALID');
 if(current.sequence===previous.sequence&&previous.head&&current.head!==previous.head)bad('AUTH_IDENTITY_NATIVE_SOURCE_EQUIVOCATION');
 window(current,now,30000);if(current.expiresAtMs>Math.min(profile.expiresAtMs,enrollment.body.expiresAtMs))bad();
 if(!historical&&current.status!=='active')bad('AUTH_IDENTITY_NATIVE_SOURCE_REVOKED');
 return {selection:profile.selection,generation:profile.generation,sequence:current.sequence,floor:current.floor,head:current.head,status:current.status,timeFloor:now,expiresAtMs:Math.min(profile.expiresAtMs,current.expiresAtMs,enrollment.body.expiresAtMs),profileDigest:sha(profileRaw),sourceId:profile.sourceId,instanceId:profile.instanceId};
}
export function verifySourceCurrent(...args){return verifyCurrentStatement(...args,false);}
// Original signed journal transition mathematics only; NEVER current admission.
export function verifySourceTransitionOriginal(...args){return verifyCurrentStatement(...args,true);}
function fetchSourceCurrentBounded(endpoint,spki,profileDigest,nonce,capacity,timeoutMs){
 if(endpoint!=='https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current'||!hex(spki)||!hex(profileDigest)||!/^[A-Za-z0-9_-]{43}$/.test(nonce))bad();
 const url=new URL(endpoint);url.searchParams.set('profile',profileDigest);url.searchParams.set('nonce',nonce);
 return new Promise((resolve,reject)=>{
  const coded=code=>Object.assign(new Error(code),{code});
  let bytes=0;const chunks=[];let settled=false;
  const finish=(error,raw)=>{if(settled)return;settled=true;error?reject(error):resolve(raw);};
  const req=httpsRequest(url,{method:'GET',timeout:timeoutMs,agent:false,headers:{accept:'application/json','cache-control':'no-store'},checkServerIdentity(host,cert){const error=checkServerIdentity(host,cert);if(error)return error;try{if(sha(new X509Certificate(cert.raw).publicKey.export({type:'spki',format:'der'}))!==spki)return new Error('AUTH_IDENTITY_SOURCE_TLS_PIN_MISMATCH');}catch{return new Error('AUTH_IDENTITY_SOURCE_TLS_PIN_MISMATCH');}}},res=>{
   res.on('error',()=>finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_UNAVAILABLE')));
   if(res.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(String(res.headers['content-type']??''))){finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_UNAVAILABLE'));res.destroy();return;}
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>capacity){finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_CAPACITY'));res.destroy();}else chunks.push(chunk);});
   res.on('end',()=>{try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));parse(raw,capacity);finish(null,raw);}catch{finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_INVALID'));}});
   res.on('aborted',()=>finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_UNAVAILABLE')));
   res.on('close',()=>{if(!res.complete)finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_UNAVAILABLE'));});
  });const timeout=()=>{finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_TIMEOUT'));req.destroy();};const timer=setTimeout(timeout,timeoutMs);req.on('close',()=>clearTimeout(timer));req.on('timeout',timeout);req.on('error',()=>finish(coded('AUTH_IDENTITY_SOURCE_CURRENT_UNAVAILABLE')));req.end();
 });
}
export function fetchSourceCurrent(endpoint,spki,profileDigest,nonce){return fetchSourceCurrentBounded(endpoint,spki,profileDigest,nonce,8192,5000);}
// Same transport/endpoint/TLS identity, different fixed envelope cap for N1 PQ.
// Neither capacity nor timeout is accepted from stdin/renderer/caller policy.
export function fetchSourceCurrentV2(endpoint,spki,profileDigest,nonce){return fetchSourceCurrentBounded(endpoint,spki,profileDigest,nonce,393216,2000);}
async function run(){
 let size=0;const chunks=[];for await(const chunk of process.stdin){size+=chunk.length;if(size>2097152)bad();chunks.push(chunk);}
 const input=parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),2097152);
 // SAME original bounded driver/process. No second CLI, Source owner or
 // renderer-selected module. Native retains expected + trusted node binding;
 // this branch returns cryptographic DATA only, never an admission/grant.
 if(input?.operation==='auth-identity-proof-native-node/v1'){
  const {dispatchOriginalIDEAuthProof}=await import('./original-ide-auth-proof-dispatch.mjs');
  process.stdout.write(canonical(await dispatchOriginalIDEAuthProof(input))+'\n');return;
 }
 if(input?.operation==='auth-source-v2-native-node/v1'){
  const {dispatchOriginalSourceV2}=await import('./original-auth-source-v2-dispatch.mjs');
  process.stdout.write(canonical(await dispatchOriginalSourceV2(input))+'\n');return;
 }
 // Keep the original legacy operation's input bound and exact fields.
 if(size>131072)bad();
 exact(input,['rootRaw','enrollmentRaw','profileRaw','headRaw','policy','previous']);
 const before=Date.now(),profile=verifySourceProfile(input.rootRaw,input.enrollmentRaw,input.profileRaw,input.policy,before);
 // The original signed acquisition head is an authenticated floor only, never
 // treated as latest/current. A NEW nonce-bound network head is mandatory.
 const baseline=envelope(input.headRaw,originalSignatureContract(input.policy).currentFrame,profile.enrollment.currentKey);
 const baselineProjection=verifySourceCurrent(input.rootRaw,input.enrollmentRaw,input.profileRaw,input.headRaw,input.policy,baseline.nonce,{sequence:0,floor:0,head:'',timeFloor:0},baseline.issuedAtMs);
 if(input.previous.sequence===baselineProjection.sequence&&input.previous.head&&input.previous.head!==baselineProjection.head)bad('AUTH_IDENTITY_NATIVE_SOURCE_EQUIVOCATION');
 const previous={...input.previous,sequence:Math.max(input.previous.sequence,baselineProjection.sequence),floor:Math.max(input.previous.floor,baselineProjection.floor),head:baselineProjection.sequence>input.previous.sequence?baselineProjection.head:input.previous.head};
 const nonce=randomBytes(32).toString('base64url'),currentRaw=await fetchSourceCurrent(input.policy.endpoint,input.policy.spki,sha(input.profileRaw),nonce);
 const projection=verifySourceCurrent(input.rootRaw,input.enrollmentRaw,input.profileRaw,currentRaw,input.policy,nonce,previous,Date.now());
 if(Date.now()>=projection.expiresAtMs||profile.profile.instanceId!==projection.instanceId)bad('AUTH_IDENTITY_NATIVE_SOURCE_EXPIRED');
 // Public verified originals/projection only. No signing/key or grant output.
 process.stdout.write(canonical({projection,currentRaw})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){run().catch(error=>{process.stderr.write(String(error?.code??'AUTH_IDENTITY_SOURCE_VERIFICATION_FAILED')+'\n');process.exitCode=1;});}

