import test from 'node:test';
import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {OriginalSourceIssuanceV2Kernel} from '../src/original-auth-source-issuance-v2.js';
import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2 as message,canonicalOriginalAuthSourceEnvelopeV2 as envelope,inspectOriginalIDEContractRelayIssuanceBodyDATA as inspect} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {parsePQAccountAuthorization} from '../src/pq-wallet-policy.js';
import {acquireOriginalIDEContractRelayIssuanceSource} from '../src/original-ide-relay-issuance.js';
// Ephemeral PUBLIC mathematical test keys. Never a real Root, source row,
// protected approval, privileged receiver, registration, directory or network.
const keys=Array.from({length:4},()=>keyGen({provider:'portable'}));
test.after(()=>keys.forEach(k=>destroyKey(k.privateKey)));
const ids=keys.map((_,i)=>'0x'+String(i+1).repeat(40)),networkId='ab'.repeat(32),height='9007199254740993';
const purpose='ide-contract-relay-v1',operations=['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
function sign(i,role,bytes){let b;try{b=batchSign(keys[i].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:ids[i],purpose:'AUTH-SOURCE-'+role.toUpperCase()},[Buffer.from(bytes)]).batch;return encodeMember(extract(b,0));}finally{if(b)discardBatch(b);}}
function fixture(role='profile'){
 const contract={purpose,enrollmentFrame:'PUBLIC-issuer',profileFrame:'PUBLIC-profile',currentFrame:'PUBLIC-current'};
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-root',networkId,rootOwner:ids[0]});
 const policy={rootDigest:sha(rootRaw),enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'de'.repeat(32),signatureContract:contract};
 const e={version:2,purpose,rootId:'PUBLIC-root',rootOwner:ids[0],sourceId:'PUBLIC-source',service:purpose,productId:'developer',platform:'macos',applicationId:'com.ynxweb4.developer.testnetpreview',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'ca'.repeat(32),profileOwner:ids[1],currentOwner:ids[2],endpoint:policy.endpoint,spki:policy.spki,currentStatePath:'/PUBLIC/current',operations,issuedAtMs:0,expiresAtMs:10000};
 const bindingFor=i=>({networkId,owner:ids[i],keyVersion:'1',executionHeight:height});
 const signed=(r,i,body)=>{const b=bindingFor(i),raw=canonical(body);return envelope(r,b,raw,sign(i,r,message(r,contract[r+'Frame'],b,raw)));};
 const enrollmentRaw=signed('enrollment',0,e);policy.enrollmentDigest=sha(enrollmentRaw);
 const association={account:'PUBLIC-account',clientId:'PUBLIC-client',productId:'developer',platform:'macos',applicationId:e.applicationId,deviceId:'PUBLIC-device'};
 const p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:ids[3],issuedAtMs:0,expiresAtMs:10000,selection:{association,expectedRequest:{service:purpose,productId:'developer',platform:'macos',applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations,instanceId:'PUBLIC-instance'},originalHostStatePath:'/PUBLIC/host',originalHostTerminalDirectory:'/PUBLIC/host.private-terminal',contractRelay:{kind:purpose,projectId:'PUBLIC-project',projectGeneration:1,callerIdentity:'PUBLIC-node',origin:'https://developer.ynxweb4.com',expiresMS:500,chainId:'eip155:6423',methods:operations,relayURL:'wss://relay.walletconnect.org'},projectCurrent:{projectId:'PUBLIC-project',projectGeneration:1,account:association.account,sessionId:'PUBLIC-session',callerIdentity:'PUBLIC-node',expiresMS:700},identityPeerBinding:{walletCodeIdentity:'PUBLIC-wallet',ideCodeIdentity:'PUBLIC-ide',nodeCodeIdentity:'PUBLIC-node',nodeSHA256:'11'.repeat(32),entrySHA256:'22'.repeat(32),provenanceSHA256:'33'.repeat(32)},contractRelayRuntimeSHA256:'44'.repeat(32),projectLaunch:{projectId:'PUBLIC-project',projectGeneration:1,localProjectId:'PUBLIC-local',workspace:{path:'/PUBLIC/workspace',device:'1',inode:'2'},profile:{path:'/PUBLIC/profile',device:'1',inode:'3'},node:{pid:'10',parent:'9',uid:'501',gid:'20',startSeconds:'100',startMicros:'0'}}}};
 const views=Object.fromEntries(['root','profile','current','subject'].map((r,i)=>{const raw={owner:ids[i],executionHeight:height,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:ids[i],pkA:keys[i].publicKey.pkA.toString('hex'),pkB:keys[i].publicKey.pkB.toString('hex'),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};return[r,parsePQAccountAuthorization(raw,{chainId:networkId,nativeChainId:'6423',owner:ids[i]})];}));
 const f={time:100,signs:0,writes:0,records:new Map(),e,p,policy,views};
 const binding=bindingFor(role==='enrollment'?0:1),plan={role,rootRaw,enrollmentRaw,bodyRaw:canonical(role==='profile'?p:e),policy,binding,approvalDigest:'',journalPath:'/PUBLIC/issuer'};
 let approvalRaw;
 f.refresh=()=>{plan.bodyRaw=canonical(role==='profile'?p:e);approvalRaw=canonical({version:'YNX-ORIGINAL-SOURCE-ISSUANCE-APPROVAL/v1',role,purpose:'AUTH-SOURCE-'+role.toUpperCase(),owner:binding.owner,networkId,keyVersion:'1',bodySHA256:sha(plan.bodyRaw),messageSHA256:sha(message(role,contract[role+'Frame'],binding,plan.bodyRaw)),decision:'approved',issuedAtMs:0,expiresAtMs:10000});plan.approvalDigest=sha(approvalRaw);};f.refresh();
 const approval={readOriginal(){return approvalRaw;},close(){}};
 const signer={assertCurrent(){f.currentEffect?.();},signSelected(m){f.signs++;return sign(role==='enrollment'?0:1,role,m);},close(){}};
 const io={openV2(){return{};},ready(){},list(){return[...f.records.keys()];},write(_,n,r){f.writes++;f.records.set(n,r);f.writeEffect?.();},read(_,n){return f.records.get(n);},close(){}};
 f.plan=plan;f.inspect=()=>inspect(role,rootRaw,enrollmentRaw,plan.bodyRaw,policy,views,f.time);
 f.open=async()=>{f.kernel=new OriginalSourceIssuanceV2Kernel(plan,approval,signer,io,async()=>views,()=>f.time);await f.kernel.initialize();};return f;
}
test('dedicated relay enrollment and profile use the existing normal issuer/math/once body',async()=>{
 for(const role of ['enrollment','profile']){const f=fixture(role);assert.equal(f.inspect().authorized,false);await f.open();const raw=await f.kernel.issueSelected();f.kernel.assertOriginalCompletion(raw);assert.equal(JSON.parse(raw).role,role);assert.equal(f.signs,1);assert.equal(f.writes,2);await assert.rejects(f.kernel.issueSelected());assert.equal(f.signs,1);f.kernel.close();}
});
test('relay project lease expiration during final foreign current refuses before signature',async()=>{
 const f=fixture();await f.open();f.currentEffect=()=>{f.time=500;};await assert.rejects(f.kernel.issueSelected(),/EXPIRED|CURRENT/);assert.equal(f.signs,0);assert.equal(f.writes,0);f.kernel.close();
});
test('intent write followed by clock advance retains UNKNOWN without signing or retry',async()=>{
 const f=fixture();await f.open();f.writeEffect=()=>{f.time=500;};await assert.rejects(f.kernel.issueSelected(),/CURRENT|EXPIRED/);assert.equal(f.signs,0);assert.equal(f.records.size,1);assert.equal(f.kernel.status().unknown,true);await assert.rejects(f.kernel.issueSelected());f.kernel.close();
});
test('wrong purpose, borrowed RECEIVE operations, changed peer and launch refuse before writes',async()=>{
 for(const mutate of [f=>{f.policy.signatureContract.purpose='AUTH-IDENTITY-RECEIVE';},f=>{f.p.selection.expectedRequest.operations=['beginYNX','handleReturn','restore','disconnect'];},f=>{f.p.selection.identityPeerBinding.nodeCodeIdentity='PUBLIC-other';},f=>{f.p.selection.projectLaunch.projectGeneration=2;},f=>{f.p.selection.contractRelay.methods=['personal_sign'];}]){const f=fixture();mutate(f);f.refresh();await assert.rejects(f.open());assert.equal(f.signs,0);assert.equal(f.writes,0);f.kernel.close();}
});
test('normal zero-input entry refuses absent independent originals and all caller injections',async()=>{
 await assert.rejects(acquireOriginalIDEContractRelayIssuanceSource(),{code:'IDE_RELAY_ISSUANCE_ORIGINAL_NOT_SUPPLIED'});
 for(const input of [undefined,null,{}, {approved:true},'/PUBLIC/profile'])await assert.rejects(acquireOriginalIDEContractRelayIssuanceSource(input),{code:'IDE_RELAY_ISSUANCE_ZERO_INPUT'});
});
