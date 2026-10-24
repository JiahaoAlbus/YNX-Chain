import test from 'node:test';import assert from 'node:assert/strict';
import{keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey,encodeFields,VERSION,SUITE}from'@ynx/batch-v01-candidate';
import{canonical,sha}from'./native/original-auth-identity-source-verifier.mjs';
import{encodeOriginalDeveloperPrincipalDATA}from'./native/original-developer-principal-data.mjs';
import{encodeOriginalDeveloperCommandDATA,ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE}from'./native/original-ide-project-control-contract.mjs';
import{encodeOriginalProtectedPublisherPoPDATA as popMessage,encodeOriginalProtectedPublisherCustodianDATA as custodyMessage}from'./native/original-ide-protected-publisher-contract.mjs';
import{dispatchOriginalProtectedPublisherCurrent as run}from'./native/original-ide-protected-publisher-dispatch.mjs';
import{ynxAddressFromEVM}from'./src/crypto.js';
// Real dual-PQ member verification; Source/chain observations are explicitly
// PUBLIC seams, not real Root/current authority or a protected registration.
const keys=[keyGen({provider:'portable'}),keyGen({provider:'portable'}),keyGen({provider:'portable'})];test.after(()=>keys.forEach(k=>destroyKey(k.privateKey)));
function fixture(){
 const at=Date.now(),network='ab'.repeat(32),owner='0x'+'1'.repeat(40),custodian='0x'+'2'.repeat(40),account=ynxAddressFromEVM(owner),key=keys[0];
 const original=encodeFields(['YNX-IDE-ARTIFACT-PUBLISHER/v1',VERSION,SUITE,'ARTIFACT-RELEASE','ide-artifact-publisher',Buffer.from(network,'hex'),owner,account,'PUBLIC-project','PUBLIC-publisher','1',key.publicKey.pkA,key.publicKey.pkB]);
 const principal={account,deviceId:'PUBLIC-device',sessionRef:'PUBLIC-session',currentRef:'PUBLIC-current',accountGeneration:'9007199254740993',sessionGeneration:'18446744073709551615',expiresMS:String(at+60000)};
 const command={RequestID:'PUBLIC-request',Action:'project.publisher',ProjectID:'PUBLIC-project',TeamID:'',SubjectAccount:account,PublisherID:'PUBLIC-publisher',RuntimeOrigin:'',ExpectedRevision:'1',GrantExpiresMS:String(at+60000),Read:false,Publish:false,Runtime:false,Revoke:false,ExpiresMS:String(at+30000),PublicOriginalSHA256:sha(original)};
 const review={Account:account,ProjectID:command.ProjectID,PublisherID:command.PublisherID,KeyRole:'ide-artifact-publisher',PublicSHA256:sha(original),RegistrationRef:'PUBLIC-registration',ExpiresMS:String(at+60000)};
 const capture={version:'YNX-IDE-PROJECT-CONTROL-CAPTURE/v1',review:{reviewId:'PUBLIC-review',account,networkId:network,command,publisher:review},requestOriginal:'PUBLIC-Source-seam-not-a-real-request',principalOriginal:Buffer.from(encodeOriginalDeveloperPrincipalDATA(principal).principalOriginal).toString('base64url'),commandOriginal:Buffer.from(encodeOriginalDeveloperCommandDATA(command,at).commandOriginal).toString('base64url'),expiresAtMs:String(at+20000)};
 const head=sha(canonical(capture)),body={version:'YNX-IDE-PROTECTED-PUBLISHER-REGISTRATION/v1',registrationRef:review.RegistrationRef,principalSHA256:encodeOriginalDeveloperPrincipalDATA(principal).principalSHA256,commandSHA256:encodeOriginalDeveloperCommandDATA(command,at).commandSHA256,publicSHA256:sha(original),account,projectId:command.ProjectID,publisherId:command.PublisherID,keyRole:'ide-artifact-publisher',publisherKeyVersion:'1',callerIdentity:'PUBLIC-native',sourceCurrentRef:principal.currentRef,nonce:Buffer.alloc(32,8).toString('base64url'),issuedAtMs:at,expiresAtMs:at+20000,custodyCurrentRef:head};
 const binding={networkId:network,owner:custodian,keyVersion:'1',executionHeight:'9007199254740993',callerIdentity:body.callerIdentity,sourceCurrentRef:head};
 function sign(k,o,purpose,message){let b;try{b=batchSign(k.privateKey,{chainId:Buffer.from(network,'hex'),owner:o,purpose},[Buffer.from(message)]).batch;return encodeMember(extract(b,0)).toString('base64url')}finally{if(b)discardBatch(b)}}
 const b=canonical(body),pop=sign(key,owner,'IDE-PUBLISHER-REGISTRATION',popMessage(original,principal,command,b,at)),custody=sign(keys[1],custodian,'AUTH-PUBLISHER-REGISTRATION',custodyMessage(binding,original,principal,command,b,pop,at));
 const env={version:'YNX-AUTH-PROTECTED-PUBLISHER-REGISTRATION/v1',binding,publicOriginal:Buffer.from(original).toString('base64url'),registrationOriginal:b,popMemberOriginal:pop,custodianMemberOriginal:custody};
 const source={profileRaw:'PUBLIC-source-profile-not-admitted',rootRaw:canonical({networkId:network}),policy:{signatureContract:{purpose:ORIGINAL_PROJECT_CONTROL_SOURCE_PURPOSE}},node:{nativeChainId:'6423'}};
 const projection={selection:{projectControlCapture:capture,identityPeerBinding:{walletCodeIdentity:'PUBLIC-native'}},subjectOwner:custodian,subjectKeyVersion:'1',profileDigest:sha(source.profileRaw),generation:1,sourceId:'PUBLIC-source',instanceId:'PUBLIC-instance',sequence:1,floor:0,head,status:'active',timeFloor:at,expiresAtMs:at+20000,executionHeight:binding.executionHeight,dataOnly:true,nativeAdmission:false};
 const role=k=>({owner:custodian,executionHeight:binding.executionHeight,ledgerNonce:'1',algorithmVersion:VERSION,enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:VERSION,owner:custodian,pkA:k.publicKey.pkA.toString('hex'),pkB:k.publicKey.pkB.toString('hex'),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]});
 const input={operation:'ide-protected-publisher-current-native-node/v1',source,registrationOriginal:canonical(env),principal,command};
 projection.selection.projectPublisherRegistrationCapture={version:'YNX-IDE-PUBLISHER-REGISTRATION-CAPTURE/v1',requestId:command.RequestID,registrationRef:review.RegistrationRef,nonce:body.nonce,principalSHA256:body.principalSHA256,commandSHA256:body.commandSHA256,publicSHA256:body.publicSHA256};
 const state={sourceCalls:0,roleCalls:0};
 return{at,input,env,projection,capture,review,state,role,
  getSource:async()=>{state.sourceCalls++;return{projection:structuredClone(projection),currentRaw:'PUBLIC-SOURCE-SEAM'}},
  getRole:async()=>{state.roleCalls++;return role(keys[1])}};
}
test('new publisher current dispatcher binds same selected review, actual dual proofs, and both current observations',async()=>{
 const f=fixture(),r=await run(f.input,f.getSource,f.getRole);assert.equal(r.completed,true,r.failureCode);assert.deepEqual(f.state,{sourceCalls:2,roleCalls:2});
 assert.equal(r.registrationOriginal,f.input.registrationOriginal);assert.equal(r.projection.independentCustodianPairVerified,true);
 for(const k of ['authorized','registered','protectedCustodyAdmitted','nativeAdmission'])assert.equal(r[k],false);
});
test('new publisher current rejects absent/retired Source before role fetch and retains original failure',async()=>{
 for(const status of ['revoked','withdrawing']){const f=fixture();f.projection.status=status;const r=await run(f.input,f.getSource,f.getRole);assert.equal(r.completed,false);assert.equal(f.state.roleCalls,0);assert.equal(r.registrationOriginal,f.input.registrationOriginal)}
});
test('new publisher current detects same Source capture changing after actual proof verification',async()=>{
 const f=fixture(),r=await run(f.input,async()=>{const s=await f.getSource();if(f.state.sourceCalls===2)s.projection.head='ef'.repeat(32);return s},f.getRole);
 assert.equal(r.completed,false);assert.equal(r.failureCode,'IDE_PUBLISHER_CURRENT_SOURCE_CHANGED');assert.ok(r.projection);assert.ok(r.sourceAfter);
});
test('new publisher current rejects changed registered custodian after proof while retaining partial',async()=>{
 const f=fixture(),r=await run(f.input,f.getSource,async()=>{f.state.roleCalls++;return f.role(keys[f.state.roleCalls===1?1:2])});
 assert.equal(r.completed,false);assert.ok(r.projection);assert.equal(f.state.roleCalls,2);assert.notEqual(r.failureCode,'');
});
test('new publisher current binds exact review registration and original command, not matching public bytes alone',async()=>{
 const f=fixture();f.input.command={...f.input.command,PublisherID:'OTHER'};const r=await run(f.input,f.getSource,f.getRole);assert.equal(r.completed,false);assert.equal(f.state.roleCalls,0);
 const g=fixture();g.review.RegistrationRef='OTHER';g.projection.head=sha(canonical(g.capture));const other=await run(g.input,g.getSource,g.getRole);assert.equal(other.completed,false);assert.equal(other.projection,null);
});
test('new publisher current final callback expiry and clock rollback cannot return complete',async()=>{
 for(const advance of [60000,-1]){const f=fixture(),now=Date.now;let clock=f.at;Date.now=()=>clock;
  try{const r=await run(f.input,f.getSource,async()=>{const v=await f.getRole();if(f.state.roleCalls===2)clock=f.at+advance;return v});assert.equal(r.completed,false);assert.equal(r.failureCode,'IDE_PUBLISHER_CURRENT_POST_EXPIRED');assert.ok(r.projection)}finally{Date.now=now}
 }
});
test('new publisher current cannot derive expected nonce from proof or accept an absent registration capture',async()=>{
 const f=fixture();delete f.projection.selection.projectPublisherRegistrationCapture;
 let r=await run(f.input,f.getSource,f.getRole);assert.equal(r.completed,false);assert.equal(f.state.roleCalls,0);
 const g=fixture();g.projection.selection.projectPublisherRegistrationCapture.nonce=Buffer.alloc(32,9).toString('base64url');
 r=await run(g.input,g.getSource,g.getRole);assert.equal(r.completed,false);assert.equal(r.failureCode,'IDE_PUBLISHER_CURRENT_BINDING');assert.equal(r.projection,null);
});
