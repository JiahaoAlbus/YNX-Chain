// Controlled software approval for UI regression only. Joint HTTP authority is
// separately verified with the real Go consumer; this is not public acceptance.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
export async function createBrowserIdentityFixture(registry){
 const base=new URL('./',import.meta.resolve('@ynx-chain/wallet-auth'));
 const load=name=>import(new URL(name,base));
 const {CentralBrowserSessionAuthority,centralBrowserConsentSignBytes}=await load('central-browser-session.js');
 const {CentralBrowserSessionStore}=await load('central-browser-session-store.js');
 const {createCentralBrowserSessionRegistry}=await load('central-browser-session-registry.js');
 const {walletIdentity}=await load('crypto.js');
 const sdkBase=new URL('../',base);
 const {secp256k1}=await import(new URL('node_modules/@noble/curves/secp256k1.js',sdkBase));
 const {sha256}=await import(new URL('node_modules/@noble/hashes/sha2.js',sdkBase));
 const {hexToBytes,bytesToHex,utf8ToBytes}=await import(new URL('node_modules/@noble/hashes/utils.js',sdkBase));
 const directory=await mkdtemp(join(tmpdir(),'ynx-shop-ui-browser-')),token=()=>randomBytes(32).toString('base64url');
 const roster=createCentralBrowserSessionRegistry(registry,{ecosystem:true}),client=roster.find(c=>c.productId==='shop');
 const authority=new CentralBrowserSessionAuthority(roster,new CentralBrowserSessionStore(join(directory,'browser')),{now:Date.now,tokenFactory:token});
 const verifier=token(),state=token(),binding=token(),initiator={clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state,codeChallenge:Buffer.from(sha256(utf8ToBytes(verifier))).toString('base64url'),codeChallengeMethod:'S256'};
 const {challenge}=authority.challenge(initiator,binding),secret='1'.padStart(64,'0'),identity=walletIdentity(secret);
 const approval={challengeId:challenge.challengeId,...identity,walletSignature:bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge,identity.account,identity.accountPublicKey))),hexToBytes(secret),{prehash:false,format:'compact',lowS:true}))};
 const session=authority.complete(approval,binding),redirect=new URL(authority.authorize(initiator,session.sessionToken).redirectUri);
 const grant=authority.redeem({clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state,code:redirect.searchParams.get('code'),codeVerifier:verifier}),csrf=token();
 return {csrf,read(){const fresh=authority.introspect(grant.grantToken,client.clientId);return{signedIn:true,account:fresh.identity.account,subject:fresh.identity.subject,generation:fresh.identity.generation,expiresAt:fresh.expiresAt,csrfToken:csrf,privateWorkspaceAuthorized:false}},close:()=>rm(directory,{recursive:true,force:true})};
}
