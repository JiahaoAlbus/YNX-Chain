import { p256 } from "@noble/curves/nist.js";
import {
  encodeBase64url,
  encodeRequestDeepLink,
  parseAuthorizationRequest,
  parseCallbackURL,
  registryParserBinding,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
} from "@ynx-chain/wallet-auth";

export const MERCHANT_REGISTRY=Object.freeze({schemaVersion:2,productClientId:"ynx-merchant-console-v1",requestingProduct:"pay-merchant",bundleId:"com.ynxweb4.merchant-console",callbacks:Object.freeze(["https://pay.ynxweb4.com/merchant/wallet-auth/callback"]),scopes:Object.freeze(["account:read","merchant:session:create"]),maxScopes:2,productDeviceAlgorithms:Object.freeze(["p256-sha256"])});
const STORAGE="ynx-merchant-wallet-auth-v1";

export function beginWalletSignIn(merchantId,now=new Date()){
  if(!/^mrc_[A-Za-z0-9._:-]{3,127}$/.test(merchantId))throw new Error("A valid merchant ID is required");
  const secret=p256.utils.randomSecretKey();
  const request=parseAuthorizationRequest({version:"1",nonce:randomNonce(),chainId:"ynx_6423-1",requestingProduct:MERCHANT_REGISTRY.requestingProduct,productClientId:MERCHANT_REGISTRY.productClientId,bundleId:MERCHANT_REGISTRY.bundleId,productDeviceAlgorithm:"p256-sha256",productDeviceKey:encodeBase64url(p256.getPublicKey(secret,true)),callback:MERCHANT_REGISTRY.callbacks[0],scopes:[...MERCHANT_REGISTRY.scopes],purpose:"Sign in to the YNX Merchant Console for this merchant",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+5*60_000).toISOString()},{now,registry:registryParserBinding(MERCHANT_REGISTRY)});
  sessionStorage.setItem(STORAGE,JSON.stringify({merchantId,request,deviceSecret:encodeBase64url(secret)}));
  return encodeRequestDeepLink(request);
}

export async function finishWalletSignIn(callbackURL,gatewayBase,now=new Date()){
  const stored=JSON.parse(sessionStorage.getItem(STORAGE)||"null");
  if(!stored?.merchantId||!stored?.request||!stored?.deviceSecret)throw new Error("Wallet sign-in recovery state is missing or expired");
  const approval=verifyAuthorization(parseCallbackURL(callbackURL,MERCHANT_REGISTRY.callbacks[0]),{...stored.request,requestDigest:requestDigest(stored.request),now});
  const challenge=await gatewayRequest(gatewayBase,"/app/pay-merchant/session/challenges",{request:stored.request,approval});
  const completion=signGatewayChallenge(challenge,stored.deviceSecret);
  const session=await gatewayRequest(gatewayBase,"/app/pay-merchant/session/complete",{request:stored.request,approval,completion,merchantId:stored.merchantId});
  sessionStorage.removeItem(STORAGE);
  return session;
}

export function hasWalletCallback(url=location.href){try{return new URL(url).searchParams.has("response")}catch{return false}}
async function gatewayRequest(base,path,body){if(!base)throw new Error("YNX App Gateway URL is not configured");const response=await fetch(base.replace(/\/$/,"")+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const value=await response.json().catch(()=>({error:"Invalid Gateway response"}));if(!response.ok)throw new Error(value.error||`YNX Gateway returned ${response.status}`);return value}
function randomNonce(){return encodeBase64url(crypto.getRandomValues(new Uint8Array(24)))}
