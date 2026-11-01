// PUBLIC only: ephemeral fixture keys, no production Root or private custody.
import {createScopeFixtureContext} from './source-v2-public.fixture.mjs';
import {canonical,sha} from '../../native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2,canonicalOriginalAuthSourceEnvelopeV2} from '../../native/original-auth-identity-source-v2-verifier.mjs';
export function createPublisherFixture(){
 const ctx=createScopeFixtureContext(),at=Date.now(),purpose='network-resource-current-publisher-source-v1',sourceId='PUBLIC-issuer-source',instanceId='PUBLIC-issuer-instance',owner=ctx.owners[2],operations=['resource.current.publish'];
 const registrations={...ctx.registrations,subject:ctx.registrations.current},association={account:owner,clientId:'PUBLIC-client',productId:'network',platform:'macos',applicationId:'com.ynxweb4.network',deviceId:'PUBLIC-device'};
 const descriptor={version:'1',networkId:ctx.network,sourceId:'PUBLIC-resource-source',instanceId:'PUBLIC-resource-instance',resourceKey:'PUBLIC-resource',publisherOwner:owner,resourceCurrentFrame:'PUBLIC-RESOURCE-CURRENT',originalLocator:{protectedResourceRef:'PUBLIC-resource',leaf:'source.current.original'}};
 const scope={version:1,networkId:ctx.network,subjectOwner:owner,sourceId,instanceId,operation:operations[0],descriptor};
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-NOT-ROOT',networkId:ctx.network,rootOwner:ctx.owners[0]});
 const e={version:2,purpose,rootId:'PUBLIC-NOT-ROOT',rootOwner:ctx.owners[0],sourceId,service:purpose,productId:'network',platform:association.platform,applicationId:association.applicationId,gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'c'.repeat(64),profileOwner:ctx.owners[1],currentOwner:owner,endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'d'.repeat(64),currentStatePath:'/PUBLIC/publisher.current',operations,issuedAtMs:at-1000,expiresAtMs:at+90000};
 const policy={rootDigest:sha(rootRaw),enrollmentDigest:'',endpoint:e.endpoint,spki:e.spki,productId:e.productId,applicationId:e.applicationId,platform:e.platform,signatureContract:{purpose,enrollmentFrame:'PUBLIC-PUBLISHER-ENROLLMENT',profileFrame:'PUBLIC-PUBLISHER-PROFILE',currentFrame:'PUBLIC-PUBLISHER-CURRENT'}};
 const sign=(role,index,body,height=registrations.root.executionHeight)=>{const bodyRaw=canonical(body),binding={networkId:ctx.network,owner:ctx.owners[index],keyVersion:'1',executionHeight:height};return canonicalOriginalAuthSourceEnvelopeV2(role,binding,bodyRaw,ctx.signMember(role,index,encodeOriginalAuthSourceStatementV2(role,policy.signatureContract[role+'Frame'],binding,bodyRaw)));};
 const enrollmentRaw=sign('enrollment',0,e);policy.enrollmentDigest=sha(enrollmentRaw);
 const p={version:2,purpose,sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId,generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owner,selection:{association,expectedRequest:{service:purpose,productId:e.productId,platform:e.platform,applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations,instanceId},originalHostStatePath:'/PUBLIC/publisher.host',originalHostTerminalDirectory:'/PUBLIC/publisher.host.private-terminal',networkResourceCurrentPublisherV1:scope},issuedAtMs:at-500,expiresAtMs:at+25000};
 const profileRaw=sign('profile',1,p),expectedNonce=Buffer.alloc(32,9).toString('base64url'),previous={sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'};
 const currentBody={version:2,purpose,sourceId,enrollmentDigest:policy.enrollmentDigest,profileDigest:sha(profileRaw),instanceId,generation:1,subjectOwner:owner,subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonical(scope)),status:'active',nonce:expectedNonce,issuedAtMs:at-100,expiresAtMs:at+20000};
 const currentRaw=sign('current',2,currentBody);
 const inputs={rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,expectedNonce,previous};
 return {ctx,at,scope,descriptor,association,rootRaw,enrollmentRaw,profileRaw,currentRaw,policy,registrations,p,e,sign,inputs,currentBody,close:()=>ctx.close()};
}
