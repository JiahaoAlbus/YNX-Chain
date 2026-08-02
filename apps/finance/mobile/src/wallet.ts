import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import {p256} from '@noble/curves/nist.js';
import {decodeBase64url,encodeBase64url,encodeRequestDeepLink,parseCallbackURL,requestDigest,signGatewayChallenge,verifyAuthorization,type AuthorizationRequest} from '@ynx-chain/wallet-auth';

const KEY='ynx.finance.device.p256.v2',PENDING='ynx.finance.wallet.pending.v1';

async function device(){
  let secret=await SecureStore.getItemAsync(KEY);
  if(!secret){secret=encodeBase64url(Crypto.getRandomBytes(32));await SecureStore.setItemAsync(KEY,secret)}
  return {secret:secret!,key:encodeBase64url(p256.getPublicKey(decodeBase64url(secret!,'product device secret'),true))};
}

export async function startWallet(){
  const d=await device(),now=new Date(),expires=new Date(now.getTime()+240_000);
  const request:AuthorizationRequest={version:'1',nonce:encodeBase64url(Crypto.getRandomBytes(32)),chainId:'ynx_6423-1',requestingProduct:'finance',productClientId:'ynx-finance-v1',bundleId:'com.ynxweb4.finance',productDeviceAlgorithm:'p256-sha256',productDeviceKey:d.key,callback:'ynxfinance://wallet-auth/callback',scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Read verified YNXT and Pay evidence and manage this device’s private Finance plan. Finance cannot sign or move assets.',issuedAt:now.toISOString(),expiresAt:expires.toISOString()};
  await SecureStore.setItemAsync(PENDING,JSON.stringify(request));
  await Linking.openURL(encodeRequestDeepLink(request));
}

export async function completeWallet(url:string,gatewayBase:string){
  const request=JSON.parse((await SecureStore.getItemAsync(PENDING))||'null') as AuthorizationRequest|null;
  if(!request)throw new Error('Pending Wallet request missing after restart');
  const approval=verifyAuthorization(parseCallbackURL(url,request.callback),{...request,requestDigest:requestDigest(request),now:new Date()});
  const response=await fetch(gatewayBase.replace(/\/$/,'')+'/wallet-auth/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorizationRequest:request,walletApproval:approval})});
  if(!response.ok)throw new Error(`Central Gateway unavailable (${response.status}); no local session created and no fake session created`);
  const challenge=await response.json(),d=await device(),gatewayCompletion=signGatewayChallenge(challenge,d.secret);
  const done=await fetch(gatewayBase.replace(/\/$/,'')+'/wallet-auth/sessions/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorizationRequest:request,walletApproval:approval,gatewayCompletion})});
  if(!done.ok)throw new Error(`Central Gateway device proof rejected (${done.status})`);
  await SecureStore.deleteItemAsync(PENDING);
  return done.json();
}
