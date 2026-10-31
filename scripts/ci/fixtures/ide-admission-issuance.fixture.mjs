// PUBLIC custody/ledger/approval fixture. Source and release dual-PQ math are
// REAL original SDK calls with temporary memory-only keys, never real Root.
import {createRequire} from 'node:module';import {pathToFileURL,fileURLToPath} from 'node:url';
const stage=process.env.AUTH_IDE_DEPLOYMENT_STAGE??fileURLToPath(new URL('../../../packages/wallet-auth',import.meta.url)),load=p=>import(pathToFileURL(stage+'/'+p)),require=createRequire(stage+'/package.json');
export const batch=await import(pathToFileURL(require.resolve('@ynx/batch-v01-candidate')));
export const open=await import(pathToFileURL(require.resolve('@ynx-chain/open-protocol/deployment-v2')));
export const {canonical,sha}=await load('native/original-auth-identity-source-verifier.mjs');
const {parsePQAccountAuthorization}=await load('src/pq-wallet-policy.js'),{ynxAddressFromEVM}=await load('src/crypto.js');
const source=await load('native/original-auth-identity-source-v2-verifier.mjs');
export const {OriginalIDEDeploymentV2Kernel:Kernel}=await load('native/original-ide-deployment-v2-kernel.mjs');
export const {acquireOriginalIDEDeploymentV2Signer:acquire}=await load('native/original-ide-deployment-v2.mjs');
export const {inspectOriginalIDEDeploymentV2ScopeDATA:inspect,IDE_DEPLOYMENT_V2_SIGNATURE_PURPOSE:SIGNATURE_PURPOSE}=await load('native/original-ide-deployment-v2-contract.mjs');
export const keys=Array.from({length:4},()=>batch.keyGen({provider:'portable'}));
export const destroy=()=>keys.forEach(k=>batch.destroyKey(k.privateKey));
export let clock=100000;export const setTime=n=>{clock=n;};
const network='aa'.repeat(32),owners=['0x'+'55'.repeat(20),'0x'+'66'.repeat(20),'0x'+'77'.repeat(20),'0x'+'11'.repeat(20)],purpose='ide-deployment-authority-v2';
const ref=(kind,id,rev='3',realm='PUBLIC-realm',tenant='PUBLIC-tenant')=>({realm,tenant,kind,id,rev});
const snapshots=Object.fromEntries(['root','profile','current','subject'].map((role,i)=>{const owner=owners[i],row={owner,executionHeight:'5',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:i<3?Buffer.from(keys[i].publicKey.pkA).toString('hex'):'3'.repeat(5184),pkB:i<3?Buffer.from(keys[i].publicKey.pkB).toString('hex'):'4'.repeat(128),revision:'1',registeredAt:'2',activeFrom:'3',ledgerNonce:'1'}],policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network,enableAt:'1',activeRevision:'1'};return[role,parsePQAccountAuthorization(row,{chainId:network,nativeChainId:'6423',owner})];}));
function member(index,metadataPurpose,message){let b;try{b=batch.batchSign(keys[index].privateKey,{chainId:Buffer.from(network,'hex'),owner:owners[index]??owners[3],purpose:metadataPurpose},[Buffer.from(message)]);return batch.encodeMember(batch.extract(b.batch,0));}finally{if(b)batch.discardBatch(b.batch);}}
const binding=i=>({networkId:network,owner:owners[i],keyVersion:'1',executionHeight:'5'});
function envelope(role,i,body,frame){const raw=canonical(body),msg=source.encodeOriginalAuthSourceStatementV2(role,frame,binding(i),raw);return source.canonicalOriginalAuthSourceEnvelopeV2(role,binding(i),raw,member(i,'AUTH-SOURCE-'+role.toUpperCase(),msg));}
let count=0;
export function fixture(){
 const requestId='PUBLIC-deployment-'+(++count),artifact=Uint8Array.of(65,66,67),artifactBind=open.bindDeploymentV2Bytes(artifact);
 const dto={realm:'PUBLIC-realm',tenant:'PUBLIC-tenant',project:ref('project','registered-project'),version:'2',artifact:{ref:ref('file','registered-artifact','5'),content:artifactBind,size:'3',mime:'application/octet-stream',objectKey:'registered-object-key'},env:'testnet',publisher:ref('publisher','registered-publisher','41'),publisherEpoch:'7',issuer:ref('issuer','registered-issuer','89','issuer-realm','issuer-tenant'),issuerEpoch:'11'};
 const made=open.createDeploymentManifestV2DATA(dto,artifact),payload=made.payloadOriginal;
 const pub={schema:'ynx-registered-deployment-role-original/v2',ref:dto.publisher,epoch:'7',keyRole:'deployment-release-v2',subjectOwner:owners[3],networkId:network,pkA:Buffer.from(keys[3].publicKey.pkA).toString('base64url'),pkB:Buffer.from(keys[3].publicKey.pkB).toString('base64url'),ledgerCurrentRef:'PUBLIC-ledger-publisher-current',status:'active',issuedAtMs:90000,expiresAtMs:120000};
 const iss={...pub,ref:dto.issuer,epoch:'11',keyRole:'deployment-issuer-v2',subjectOwner:'0x'+'88'.repeat(20),pkA:Buffer.alloc(2592,8).toString('base64url'),pkB:Buffer.alloc(64,9).toString('base64url'),ledgerCurrentRef:'PUBLIC-ledger-issuer-current'};
 const resourceRef=ref('resource','registered-resource','6'),account=ynxAddressFromEVM(owners[3]);
 const project={schema:'ynx-registered-deployment-project/v2',ref:dto.project,realm:dto.realm,tenant:dto.tenant,account,publisher:dto.publisher,issuer:dto.issuer,permissions:['deployment.sign-e11'],resourceRef,ledgerCurrentRef:'PUBLIC-ledger-project-current',status:'active',issuedAtMs:90000,expiresAtMs:120000};
 const resource={schema:'ynx-registered-deployment-resource/v2',ref:resourceRef,realm:dto.realm,tenant:dto.tenant,project:dto.project,objectKey:dto.artifact.objectKey,content:artifactBind,quotaBytes:'1000',ledgerCurrentRef:'PUBLIC-ledger-resource-current',status:'active',issuedAtMs:90000,expiresAtMs:120000};
 const approval={schema:'ynx-ide-deployment-approval/v2',purpose,requestId,sourceId:'PUBLIC-deployment-source',instanceId:requestId,generation:1,realm:dto.realm,tenant:dto.tenant,project:dto.project,publisher:dto.publisher,publisherEpoch:'7',issuer:dto.issuer,issuerEpoch:'11',resourceRef,payloadBinding:made.binding,artifactBinding:artifactBind,confirmationRef:'PUBLIC-visible-confirmation',revocationRef:'PUBLIC-current-revocation',decision:'approved',state:'approved-unconsumed',issuedAtMs:90000,expiresAtMs:110000};
 const scope={version:'ynx-ide-deployment-source/v2',requestId,payloadOriginal:Buffer.from(payload).toString('base64url'),payloadBinding:made.binding,publisherOriginal:canonical(pub),issuerOriginal:canonical(iss),projectOriginal:canonical(project),resourceOriginal:canonical(resource),approvalOriginal:canonical(approval)};
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-NOT-ROOT',networkId:network,rootOwner:owners[0]});
 const e={version:2,purpose,rootId:'PUBLIC-NOT-ROOT',rootOwner:owners[0],sourceId:'PUBLIC-deployment-source',service:purpose,productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'d'.repeat(64),profileOwner:owners[1],currentOwner:owners[2],endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'e'.repeat(64),currentStatePath:'/PUBLIC/deployment-current',operations:['deployment.sign-e11'],issuedAtMs:0,expiresAtMs:200000};
 const policy={rootDigest:sha(rootRaw),enrollmentDigest:'',endpoint:e.endpoint,spki:e.spki,signatureContract:{purpose,enrollmentFrame:'PUBLIC-DEPLOYMENT-ENROLLMENT',profileFrame:'PUBLIC-DEPLOYMENT-PROFILE',currentFrame:'PUBLIC-DEPLOYMENT-CURRENT'}};
 const enrollmentRaw=envelope('enrollment',0,e,policy.signatureContract.enrollmentFrame);policy.enrollmentDigest=sha(enrollmentRaw);
 const p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:sha(enrollmentRaw),instanceId:requestId,generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owners[3],selection:{association:{account,clientId:'PUBLIC-IDE-client',productId:'developer',platform:'macos',applicationId:e.applicationId,deviceId:'PUBLIC-device'},expectedRequest:{service:purpose,productId:'developer',platform:'macos',applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:e.operations,instanceId:requestId},originalHostStatePath:'/PUBLIC/deployment',originalHostTerminalDirectory:'/PUBLIC/deployment.private-terminal',ideDeploymentV2:scope},issuedAtMs:90000,expiresAtMs:120000};
 let profileRaw=envelope('profile',1,p,policy.signatureContract.profileFrame),currentRaw;
 const previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'5'},nonce=Buffer.alloc(32,2).toString('base64url');
 function refreshMath(){const c={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:sha(enrollmentRaw),profileDigest:sha(profileRaw),instanceId:p.instanceId,generation:1,subjectOwner:owners[3],subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonical(scope)),status:'active',nonce,issuedAtMs:99000,expiresAtMs:109000};currentRaw=envelope('current',2,c,policy.signatureContract.currentFrame);return source.verifyOriginalAuthSourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,snapshots,nonce,previous,clock);}
 let projection=refreshMath(),captured;
 const behavior={},counts={reserve:0,capture:0,sign:0,complete:0,close:0,fence:0};
 const rows=()=>Object.fromEntries(['publisherOriginal','issuerOriginal','projectOriginal','resourceOriginal','approvalOriginal'].map(k=>[k,scope[k]]));
 const adapter={
  async refreshSource(){behavior.refresh?.();const result={projection:structuredClone(projection),currentRaw,purpose,networkId:network,profileIssuedAtMs:p.issuedAtMs,profileExpiresAtMs:p.expiresAtMs};behavior.source?.(result);return result;},
  copyRegisteredOriginals(){const r=rows();behavior.rows?.(r);return r;},assertOriginalCurrent(){counts.fence++;behavior.fence?.();},
  reserveOriginal(){counts.reserve++;behavior.reserve?.();return{status:behavior.reserveStatus??0,reservationOriginal:'PUBLIC-original-reservation:'+requestId};},
  captureOriginalReleaseKey(raw){counts.capture++;captured=Uint8Array.from(raw);behavior.capture?.();return{status:behavior.captureStatus??0};},
  invokeOriginalE11(){counts.sign++;const bytes=member(3,'CLOUD-DEPLOYMENT-MANIFEST-V2',captured);behavior.signed?.(bytes);return{status:behavior.signStatus??0,memberOriginal:bytes};},
  completeOriginal(){counts.complete++;behavior.complete?.();return{status:behavior.completeStatus??0};},retire(){},join(){},close(){counts.close++;behavior.close?.();}
 };
 return{rootRaw,enrollmentRaw,e,envelope,binding,member,source,profileRaw,scope,p,policy,snapshots,pub,iss,project,resource,approval,dto,payload,artifact,counts,behavior,adapter,kernel:()=>new Kernel(adapter),sourceVerify:refreshMath,
  reissueSource(){profileRaw=envelope('profile',1,p,policy.signatureContract.profileFrame);projection=refreshMath();},change(which,fn){const key=which+'Original',v=JSON.parse(scope[key]);fn(v);scope[key]=canonical(v);},inspect(){return inspect(scope,p.selection.association,network,owners[3],p.sourceId,p.instanceId,p.generation,p.issuedAtMs,p.expiresAtMs,clock);}};
}
