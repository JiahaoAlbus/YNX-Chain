import { p256 } from "@noble/curves/nist.js";
import {
  encodeBase64url,
  encodeRequestDeepLink,
  canonicalJSON,
  createGatewayChallenge,
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
  const challenge=createGatewayChallenge(approval,{challenge:randomNonce(),expiresAt:new Date(Math.min(Date.parse(approval.expiresAt),now.getTime()+30_000)).toISOString()},now);
  const completion=signGatewayChallenge(challenge,stored.deviceSecret);
  const completed=await gatewayRequest(gatewayBase,"/v1/wallet/sessions/complete",{authorizationRequest:stored.request,walletApproval:approval,gatewayCompletion:completion});
  const productSession=completed.result;
  if(!completed.ok||!productSession)throw new Error("YNX Wallet did not return a canonical Merchant Product Session");
  const introspectionBody=canonicalJSON({requiredScopes:["merchant:session:create"]});
  const issuedAt=new Date();
  const proof=await merchantProductProof(productSession,stored.deviceSecret,introspectionBody,issuedAt);
  const session=await gatewayRequest(gatewayBase,"/app/pay-merchant/v1/merchant/sessions",{merchantId:stored.merchantId},{"X-YNX-Product-Session-Proof":encodeBase64url(new TextEncoder().encode(canonicalJSON(proof)))});
  sessionStorage.removeItem(STORAGE);
  return session;
}

export function hasWalletCallback(url=location.href){try{return new URL(url).searchParams.has("response")}catch{return false}}
async function gatewayRequest(base,path,body,headers={}){if(!base)throw new Error("YNX App Gateway URL is not configured");const response=await fetch(base.replace(/\/$/,"")+path,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:canonicalJSON(body)});const value=await response.json().catch(()=>({error:"Invalid Gateway response"}));if(!response.ok)throw new Error(value.error?.message||value.error||`YNX Gateway returned ${response.status}`);return value}
async function merchantProductProof(session,deviceSecret,introspectionBody,issuedAt){
  if(session.requestingProduct!==MERCHANT_REGISTRY.requestingProduct||session.productClientId!==MERCHANT_REGISTRY.productClientId||session.bundleId!==MERCHANT_REGISTRY.bundleId||session.productDeviceKey!==encodeBase64url(p256.getPublicKey(decodeSecret(deviceSecret),true))||session.scopes.join("\n")!==MERCHANT_REGISTRY.scopes.join("\n"))throw new Error("YNX Wallet returned a cross-product Merchant session");
  const unsigned={version:"1",sessionBinding:session.sessionBinding,productClientId:session.productClientId,bundleId:session.bundleId,productDeviceKey:session.productDeviceKey,method:"POST",path:"/v1/wallet/sessions/introspect",bodyDigest:bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(introspectionBody)))),nonce:randomNonce(),issuedAt:issuedAt.toISOString(),expiresAt:new Date(Math.min(Date.parse(session.expiresAt),issuedAt.getTime()+30_000)).toISOString()};
  const signature=encodeBase64url(p256.sign(new TextEncoder().encode(`YNX_PRODUCT_SESSION_HTTP_PROOF_V1\n${canonicalJSON(unsigned)}`),decodeSecret(deviceSecret),{format:"der"}));
  return {...unsigned,signature};
}
function decodeSecret(value){const bytes=Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),character=>character.charCodeAt(0));if(bytes.length!==32||encodeBase64url(bytes)!==value)throw new Error("Merchant product device secret is invalid");return bytes}
function bytesToHex(bytes){return [...bytes].map(value=>value.toString(16).padStart(2,"0")).join("")}
function randomNonce(){return encodeBase64url(crypto.getRandomValues(new Uint8Array(24)))}
