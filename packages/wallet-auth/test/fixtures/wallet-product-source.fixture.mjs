// PUBLIC DATA/math fixture. No real Root, account, key or Source is installed.
import {canonical,sha} from '../../native/original-auth-identity-source-verifier.mjs';
import {WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE as purpose,WALLET_NATIVE_PRODUCT_SELECTION_KEY as field,WALLET_NATIVE_PRODUCT_OPERATIONS as operations} from '../../native/original-wallet-product-source-contract.mjs';
export {canonical,sha,purpose,field};
export function productZeroInput(){return {operation:'auth-source-v2-native-node/v1',node:{origin:'https://public.invalid',spki:'c'.repeat(64),nativeChainId:'6423'},rootRaw:'{}',enrollmentRaw:'{}',profileRaw:'{}',headRaw:'{}',policy:{rootDigest:'0'.repeat(64),enrollmentDigest:'0'.repeat(64),endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'b'.repeat(64),applicationId:'com.ynx.wallet.PUBLIC',productId:'wallet',platform:'macos',signatureContract:{purpose,enrollmentFrame:'PUBLIC-PRODUCT-E',profileFrame:'PUBLIC-PRODUCT-P',currentFrame:'PUBLIC-PRODUCT-C'}},previous:{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'}}}
export async function createWalletProductSourceFixture(){
 const {createScopeFixtureContext}=await import('./source-v2-public.fixture.mjs');const ctx=createScopeFixtureContext();
 try{
 const {owners,network}=ctx,at=Date.now(),account=owners[3];
 const scope={version:1,networkId:network,account,protectedResourceRef:'PUBLIC-Product-resource',operations:[...operations],products:[{productId:'cloud.ide-usage',sourceOrder:'PUBLIC-original-order'}]};
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-NOT-ROOT',networkId:network,rootOwner:owners[0]});
 const e={version:2,purpose,rootId:'PUBLIC-NOT-ROOT',rootOwner:owners[0],sourceId:'PUBLIC-PRODUCT-dispatch',service:purpose,productId:'wallet',platform:'macos',applicationId:'com.ynx.wallet.PUBLIC',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'a'.repeat(64),profileOwner:owners[1],currentOwner:owners[2],endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'b'.repeat(64),currentStatePath:'/PUBLIC/WPC.current',operations:[...operations],issuedAtMs:at-2000,expiresAtMs:at+120000};
 const policy={rootDigest:sha(rootRaw),enrollmentDigest:'',endpoint:e.endpoint,spki:e.spki,applicationId:e.applicationId,productId:'wallet',platform:'macos',signatureContract:{purpose,enrollmentFrame:'PUBLIC-PRODUCT-E',profileFrame:'PUBLIC-PRODUCT-P',currentFrame:'PUBLIC-PRODUCT-C'}};
 const enrollmentRaw=ctx.sign('enrollment',0,e,policy.signatureContract.enrollmentFrame);policy.enrollmentDigest=sha(enrollmentRaw);
 const p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-PRODUCT-dispatch-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:account,selection:{association:{account,clientId:'PUBLIC-wallet-client',productId:'wallet',platform:e.platform,applicationId:e.applicationId,deviceId:'PUBLIC-device'},expectedRequest:{service:purpose,productId:'wallet',platform:e.platform,applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:[...operations],instanceId:'PUBLIC-PRODUCT-dispatch-instance'},originalHostStatePath:'/PUBLIC/WPC.host',originalHostTerminalDirectory:'/PUBLIC/WPC.host.private-terminal',[field]:scope},issuedAtMs:at-1000,expiresAtMs:at+90000};
 const profileRaw=ctx.sign('profile',1,p,policy.signatureContract.profileFrame);
 function current(nonce,edit){const c={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,profileDigest:sha(profileRaw),instanceId:p.instanceId,generation:1,subjectOwner:account,subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonical(scope)),status:'active',nonce,issuedAtMs:Date.now()-100,expiresAtMs:Date.now()+20000};edit?.(c);return ctx.sign('current',2,c,policy.signatureContract.currentFrame);}
 const input={...productZeroInput(),rootRaw,enrollmentRaw,profileRaw,headRaw:current(Buffer.alloc(32,7).toString('base64url')),policy};
 const rawRegistrations=Object.fromEntries(Object.values(ctx.registrations).map(v=>[v.owner,JSON.parse(canonical(v))]));
 return {ctx,at,owners,network,e,input,current,rawRegistrations,p,scope,canonical,sha,close(){ctx.close()}};
 }catch(cause){ctx.close();throw cause;}
}
