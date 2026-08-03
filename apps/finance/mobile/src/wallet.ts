import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import {p256} from '@noble/curves/nist.js';
import {canonicalJSON,createGatewayChallenge,createProductSessionProof,encodeRequestDeepLink,httpBodyDigest,parseCallbackURL,requestDigest,signGatewayChallenge,verifyAuthorization,type AuthorizationRequest,type AuthorizationResponse,type CentralWalletSession} from '@ynx-chain/wallet-auth';

const KEY='ynx.finance.device.p256.v2',PENDING='ynx.finance.wallet.pending.v1';
const encodeBase64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=+$/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const decodeBase64url=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),character=>character.charCodeAt(0));

async function device(){
  let secret=await SecureStore.getItemAsync(KEY);
  if(secret){try{const bytes=decodeBase64url(secret);if(bytes.length===32&&p256.utils.isValidSecretKey(bytes))return {secret,key:encodeBase64url(p256.getPublicKey(bytes,true))}}catch{}}
  for(;;){const bytes=await Crypto.getRandomBytesAsync(32);if(p256.utils.isValidSecretKey(bytes)){secret=encodeBase64url(bytes);await SecureStore.setItemAsync(KEY,secret);break}}
  return {secret:secret!,key:encodeBase64url(p256.getPublicKey(decodeBase64url(secret!),true))};
}

export async function startWallet(){
  const d=await device(),now=new Date(),expires=new Date(now.getTime()+240_000);
  const request:AuthorizationRequest={version:'1',nonce:encodeBase64url(await Crypto.getRandomBytesAsync(24)),chainId:'ynx_6423-1',requestingProduct:'finance',productClientId:'ynx-finance-v1',bundleId:'com.ynxweb4.finance',productDeviceAlgorithm:'p256-sha256',productDeviceKey:d.key,callback:'ynxfinance://wallet-auth/callback',scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Read verified YNXT and Pay evidence and manage this device’s private Finance plan. Finance cannot sign or move assets.',issuedAt:now.toISOString(),expiresAt:expires.toISOString()};
  await SecureStore.setItemAsync(PENDING,JSON.stringify(request));
  await Linking.openURL(encodeRequestDeepLink(request));
}

export async function completeWallet(url:string):Promise<CentralWalletSession>{
  const request=JSON.parse((await SecureStore.getItemAsync(PENDING))||'null') as AuthorizationRequest|null;
  if(!request)throw new Error('Pending Wallet request missing after restart');
  const now=new Date(),approval=verifyAuthorization(parseCallbackURL(url,request.callback),{...request,requestDigest:requestDigest(request),now}) as AuthorizationResponse;
  const d=await device(),expiresAt=new Date(Math.min(Date.parse(approval.expiresAt),now.getTime()+120_000)).toISOString();
  const challenge=createGatewayChallenge(approval,{challenge:encodeBase64url(await Crypto.getRandomBytesAsync(24)),expiresAt},now),gatewayCompletion=signGatewayChallenge(challenge,d.secret);
  const gateway=(process.env.EXPO_PUBLIC_YNX_FINANCE_WALLET_GATEWAY_URL||'https://wallet-auth.ynxweb4.com').replace(/\/$/,'');
  const done=await fetch(gateway+'/v1/wallet/sessions/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:canonicalJSON({authorizationRequest:request,walletApproval:approval,gatewayCompletion})});
  if(!done.ok)throw new Error(`Central Gateway device proof rejected (${done.status}); no local session or fallback was created`);
  const envelope=await done.json(),session=envelope?.result as CentralWalletSession;
  if(!envelope?.ok||!session?.sessionBinding)throw new Error('Central Gateway returned no canonical Finance Product Session');
  await SecureStore.deleteItemAsync(PENDING);
  return session;
}

export async function gatewayProof(session:CentralWalletSession,scope:string){
  const body=canonicalJSON({requiredScopes:[scope]}),now=new Date(),expiresAt=new Date(Math.min(Date.parse(session.expiresAt),now.getTime()+30_000)).toISOString();
  if(Date.parse(expiresAt)<=now.getTime())throw new Error('Wallet session expired. Reauthorize in YNX Wallet.');
  const proof=createProductSessionProof(session,{method:'POST',path:'/v1/wallet/sessions/introspect',bodyDigest:httpBodyDigest(body),nonce:encodeBase64url(await Crypto.getRandomBytesAsync(24)),issuedAt:now.toISOString(),expiresAt},(await device()).secret);
  return encodeBase64url(new TextEncoder().encode(canonicalJSON(proof)));
}
