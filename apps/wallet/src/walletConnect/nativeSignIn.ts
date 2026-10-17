import {SigningKey,sha256,toUtf8Bytes} from "ethers";
import {createProductSessionReturnURL,evmAddressFromYNX,parseProductSessionReturnURL,parseProductSessionWalletURL,signProductSessionApproval,walletIdentity,type WalletConnectRequestReview} from "@ynx-chain/wallet-auth";
import {CENTRAL_BROWSER_RPC_METHOD,centralBrowserConsentSignBytes,parseCentralBrowserSignInApproval,parseCentralBrowserSignInChallenge} from "@ynx-chain/wallet-auth/central-browser-session-contract";
import {createCentralBrowserSessionRegistry} from "@ynx-chain/wallet-auth/central-browser-session-registry";
import {PRODUCT_SESSION_REGISTRY} from "../protocol/registry";
import type {MobileProductSessionRequest} from "../protocol/productSessionController";
const centralRegistry=createCentralBrowserSessionRegistry(PRODUCT_SESSION_REGISTRY);
export function isNativeSignIn(method:string){return ["ynx_requestProductSessionV2",CENTRAL_BROWSER_RPC_METHOD].includes(method);}
export function reviewNativeSignIn(review:WalletConnectRequestReview,at=new Date()){
  if(!Array.isArray(review.params)||review.params.length!==1)throw new Error("Native sign-in requires one exact request.");
  const origin=new URL(review.peer.metadata.url).origin;
  if(review.method===CENTRAL_BROWSER_RPC_METHOD){
    const challenge=parseCentralBrowserSignInChallenge(review.params[0],centralRegistry,{peerOrigin:origin,now:at.getTime()});
    return {kind:"central" as const,challenge,origin,presentation:{purpose:challenge.purpose,initiator:challenge.initiator,clients:challenge.clients,expiresAt:challenge.expiresAt}};
  }
  if(review.method!=="ynx_requestProductSessionV2"||typeof review.params[0]!=="string")throw new Error("Unsupported native sign-in request.");
  const request=parseProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,review.params[0],at) as unknown as MobileProductSessionRequest;
  if(request.origin!==origin)throw new Error("The exact product origin differs from the approved app.");
  return {kind:"product" as const,request,origin,presentation:{productId:request.productId,origin:request.origin,scopes:request.scopes,purpose:request.purpose,expiresAt:request.expiresAt}};
}
export function signNativeSignIn(review:WalletConnectRequestReview,secret:string,assertCurrent:()=>void,at=new Date()){
  assertCurrent();
  if(review.expiresAt<=at.toISOString())throw new Error("The reviewed sign-in request expired.");
  const parsed=reviewNativeSignIn(review,at),identity=walletIdentity(secret);
  if(evmAddressFromYNX(identity.account)!==review.account)throw new Error("The protected native key does not match the approved session account.");
  let result;
  if(parsed.kind==="central"){
    const signature=new SigningKey(`0x${secret}`).sign(sha256(toUtf8Bytes(centralBrowserConsentSignBytes(parsed.challenge,identity.account,identity.accountPublicKey))));
    result=parseCentralBrowserSignInApproval({challengeId:parsed.challenge.challengeId,...identity,walletSignature:signature.r.slice(2)+signature.s.slice(2)});
  }else{
    const approval=signProductSessionApproval(PRODUCT_SESSION_REGISTRY,parsed.request,{accountSecret:secret,scopes:parsed.request.scopes,expiresAt:parsed.request.expiresAt,...(parsed.request.serviceConsent?{approvedServiceConsent:parsed.request.serviceConsent}:{})},at);
    const returnUrl=createProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,parsed.request,{result:"approved",approval},at);
    const verified=parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,parsed.request,returnUrl,at);
    if(verified.status!=="ready"||!verified.approval||typeof verified.approval!=="object"||(verified.approval as {account?:unknown}).account!==identity.account)throw new Error("The signed native response did not preserve the reviewed account.");
    result={version:2,returnUrl};
  }
  assertCurrent();return result;
}
