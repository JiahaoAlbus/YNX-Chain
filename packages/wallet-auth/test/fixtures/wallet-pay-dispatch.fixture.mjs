// PUBLIC DATA/math fixture. No real Root, account, key or Source is installed.
import {canonical,sha} from '../../native/original-auth-identity-source-verifier.mjs';
import {WALLET_NATIVE_PAY_CLIENT_SOURCE_PURPOSE as purpose,WALLET_NATIVE_PAY_CLIENT_SELECTION_KEY as field,WALLET_NATIVE_PAY_CLIENT_OPERATIONS as operations} from '../../native/original-wallet-pay-client-source-contract.mjs';
export {canonical,sha,purpose,field};
export function rootZeroInput(){return {operation:'auth-source-v2-native-node/v1',node:{origin:'https://public.invalid',spki:'c'.repeat(64),nativeChainId:'6423'},rootRaw:'{}',enrollmentRaw:'{}',profileRaw:'{}',headRaw:'{}',policy:{rootDigest:'0'.repeat(64),enrollmentDigest:'0'.repeat(64),endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'b'.repeat(64),applicationId:'com.ynx.wallet.PUBLIC',productId:'wallet',platform:'macos',signatureContract:{purpose,enrollmentFrame:'PUBLIC-WPC-E',profileFrame:'PUBLIC-WPC-P',currentFrame:'PUBLIC-WPC-C'}},previous:{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'}}}
export async function createWalletPayDispatchFixture(){
 const {createScopeFixtureContext}=await import('./source-v2-public.fixture.mjs');const ctx=createScopeFixtureContext();
 try{
 const {owners,network}=ctx,at=Date.now(),account=owners[3];
 const binding={networkId:network,account,hash:'0x'+'1'.repeat(64),memberHash:'0x'+'2'.repeat(64),operationId:'PUBLIC-WPC-original-once',target:{version:1,service:'pay',kind:'invoice_terms',intentId:'npi_'+'a'.repeat(48),merchant:account,invoiceId:'public-invoice',requestPath:'/v5/pay/invoice-intents/npi_'+'a'.repeat(48)+'/merchant-member'}};
 const scope={version:1,protectedResourceRef:'PUBLIC-WPC-protected-ref',bindings:[{binding,operations:['post_terms','get_intent'],untilMs:at+60000}]};
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-NOT-ROOT',networkId:network,rootOwner:owners[0]});
 const e={version:2,purpose,rootId:'PUBLIC-NOT-ROOT',rootOwner:owners[0],sourceId:'PUBLIC-WPC-dispatch',service:purpose,productId:'wallet',platform:'macos',applicationId:'com.ynx.wallet.PUBLIC',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'a'.repeat(64),profileOwner:owners[1],currentOwner:owners[2],endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'b'.repeat(64),currentStatePath:'/PUBLIC/WPC.current',operations:[...operations],issuedAtMs:at-2000,expiresAtMs:at+120000};
 const policy={rootDigest:sha(rootRaw),enrollmentDigest:'',endpoint:e.endpoint,spki:e.spki,applicationId:e.applicationId,productId:'wallet',platform:'macos',signatureContract:{purpose,enrollmentFrame:'PUBLIC-WPC-E',profileFrame:'PUBLIC-WPC-P',currentFrame:'PUBLIC-WPC-C'}};
 const enrollmentRaw=ctx.sign('enrollment',0,e,policy.signatureContract.enrollmentFrame);policy.enrollmentDigest=sha(enrollmentRaw);
 const p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-WPC-dispatch-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:account,selection:{association:{account,clientId:'PUBLIC-wallet-client',productId:'wallet',platform:e.platform,applicationId:e.applicationId,deviceId:'PUBLIC-device'},expectedRequest:{service:purpose,productId:'wallet',platform:e.platform,applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:[...operations],instanceId:'PUBLIC-WPC-dispatch-instance'},originalHostStatePath:'/PUBLIC/WPC.host',originalHostTerminalDirectory:'/PUBLIC/WPC.host.private-terminal',[field]:scope},issuedAtMs:at-1000,expiresAtMs:at+90000};
 const profileRaw=ctx.sign('profile',1,p,policy.signatureContract.profileFrame);
 function current(nonce,edit){const c={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,profileDigest:sha(profileRaw),instanceId:p.instanceId,generation:1,subjectOwner:account,subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonical(scope)),status:'active',nonce,issuedAtMs:Date.now()-100,expiresAtMs:Math.min(Date.now()+20000,at+60000)};edit?.(c);return ctx.sign('current',2,c,policy.signatureContract.currentFrame);}
 const input={...rootZeroInput(),rootRaw,enrollmentRaw,profileRaw,headRaw:current(Buffer.alloc(32,7).toString('base64url')),policy};
 const rawRegistrations=Object.fromEntries(Object.values(ctx.registrations).map(v=>[v.owner,JSON.parse(canonical(v))]));
 return {input,current,rawRegistrations,p,scope,canonical,sha,close(){ctx.close()}};
 }catch(cause){ctx.close();throw cause;}
}
