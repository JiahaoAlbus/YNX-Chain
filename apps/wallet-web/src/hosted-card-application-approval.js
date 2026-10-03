import registry from "../vendor/product-session-registry-123016847.json" with {type:"json"};
import {parseCardApplicationApprovalWalletURL,parseCardApplicationApprovalRequest,cardApplicationApprovalRequestDigest,createCardApplicationApprovalReturnURL,parseCardApplicationApprovalReturnURL,createSignedCardApplicationApproval,walletIdentity,CARD_PROVIDER_DETAILS_FIELDS} from "@ynx-chain/wallet-auth";
import {toEVMAddress} from "./wallet-address.js";
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function parseHostedCardRequest(params,origin,account,at=new Date()){
  if(!Array.isArray(params)||params.length!==1||typeof params[0]!=="string"||new TextEncoder().encode(params[0]).length>24000)fail("HOSTED_CARD_REQUEST_INVALID");
  const request=parseCardApplicationApprovalWalletURL(registry,params[0],at);
  if(origin!=="https://card.ynxweb4.com"||request.platform!=="web"||request.origin!==origin||request.callback!=="https://card.ynxweb4.com/wallet-auth/callback")fail("HOSTED_CARD_ORIGIN_MISMATCH");
  if(toEVMAddress(request.account)!==account)fail("HOSTED_CARD_ACCOUNT_MISMATCH");
  return request;
}
export function hostedCardReviewText(request){
  const fields=request.version==="2"?CARD_PROVIDER_DETAILS_FIELDS:["nickname","useCase","limitWei","riskAccepted","termsVersion"];
  return [request.version==="2"?"TEST provider Card application — no live funds":"Testnet Card application",request.origin,`Account: ${request.account}`,`Purpose: ${request.challenge.purpose}`,`Expires: ${request.expiresAt}`,"This approves only this exact application. It does not fund, submit, activate a Card, or grant a Product Session.",...fields.map(field=>`${field}: ${JSON.stringify(request.details[field])}`),`Challenge: ${request.challenge.id}`,`Request: ${request.requestId}`,`State: ${request.state}`,...(request.version==="2"?[`Request binding hash: ${request.challenge.requestBindingHash}`]:[])].join("\n");
}
// Dependencies are the actual Hosted vault/review/replay authority; this helper
// never holds a device key, performs backend writes or navigates a callback.
export async function approveHostedCardApplication({params,origin,vault,store,review,assertLive,assertAccount,unlock,now=()=>new Date()}){
  const originalRecord=JSON.stringify(vault),account=vault?.account;
  const assertCurrent=async()=>{assertLive();await assertAccount();assertLive();if(JSON.stringify(vault)!==originalRecord)fail("HOSTED_ACCOUNT_CHANGED");};
  await assertCurrent();
  const request=parseHostedCardRequest(params,origin,account,now());
  const check=async()=>{await assertCurrent();parseCardApplicationApprovalRequest(registry,request,now());};
  await store.consumeReplay(`card-application:${origin}:${cardApplicationApprovalRequestDigest(request)}`,Date.parse(request.expiresAt));
  await check();
  const choice=await review(request,hostedCardReviewText(request));
  await check();
  let decision;
  if(choice?.approved===false)decision={status:"rejected",reason:"USER_REJECTED"};
  else{
    if(choice?.approved!==true||typeof choice.password!=="string")fail("HOSTED_CARD_REVIEW_REQUIRED");
    const unlocked=await unlock(vault,choice.password);
    await check();
    if(unlocked.account!==account||toEVMAddress(walletIdentity(unlocked.secretHex).account)!==account)fail("HOSTED_ACCOUNT_CHANGED");
    const approval=createSignedCardApplicationApproval({accountSecret:unlocked.secretHex,challenge:request.challenge,details:request.details},now());
    await check();
    decision={status:"approved",approval};
  }
  const returnUrl=createCardApplicationApprovalReturnURL(registry,request,decision,now());
  const verified=parseCardApplicationApprovalReturnURL(registry,returnUrl,request,now());
  if(verified.status!==decision.status)fail("HOSTED_CARD_RETURN_INVALID");
  await check();
  return Object.freeze({kind:"card-application-approval",version:request.version,returnUrl});
}
