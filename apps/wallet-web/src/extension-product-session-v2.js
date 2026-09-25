import registry from "../vendor/product-session-registry-b754ffc42.json" with {type:"json"};
import {createProductSessionReturnURL,parseProductSessionWalletURL,parseProductSessionReturnURL,productSessionRequestDigest,signProductSessionApproval,walletIdentity} from "@ynx-chain/wallet-auth-card-provider-v2";

export const PRIVATE_METHOD="ynx_requestProductSessionV2";
export const PRIVATE_TIMEOUT_MS=120_000;
export const PRIVATE_REPLAY_KEY="ynx.wallet.private-product-session.v2.replay";
const MAX_URL=16_384;
const writes=new WeakMap();
function fail(code,message){throw Object.assign(new Error(message),{code})}

export function parsePrivateRequest(params,origin,now=new Date()){
  if(!Array.isArray(params)||params.length!==1||typeof params[0]!=="string"||params[0].length>MAX_URL)fail("PRIVATE_REQUEST_INVALID","Expected one official Product Session v2 Wallet URL.");
  const request=parseProductSessionWalletURL(registry,params[0],now);
  if(request.platform!=="web"||request.origin!==origin||!request.callback.startsWith(`${origin}/`))fail("PRIVATE_ORIGIN_MISMATCH","Product Session request does not belong to this page origin.");
  return request;
}

export function privateReplayKey(request,now=new Date()){return `${request.origin}:${productSessionRequestDigest(registry,request,now)}`}
export function privateProductName(request){return registry.products.find(product=>product.productId===request.productId)?.displayName||request.productId}

export function signPrivateReturn(request,secretHex,now=new Date()){
  const approval=signProductSessionApproval(registry,request,{accountSecret:secretHex,scopes:request.scopes,expiresAt:request.expiresAt},now);
  const returnUrl=createProductSessionReturnURL(registry,request,{result:"approved",approval},now);
  const parsed=parseProductSessionReturnURL(registry,request,returnUrl,now);
  if(parsed.status!=="ready"||parsed.approval.account!==walletIdentity(secretHex).account)fail("PRIVATE_RETURN_INVALID","Signed Product Session return failed verification.");
  return Object.freeze({version:2,returnUrl});
}

export function rejectPrivateReturn(request,now=new Date()){
  return Object.freeze({version:2,returnUrl:createProductSessionReturnURL(registry,request,{result:"rejected",reason:"user_rejected"},now)});
}

export async function consumePrivateReplay(storage,key,deadlineAt,now=Date.now()){
  if(!storage?.get||!storage?.set||typeof key!=="string"||!Number.isSafeInteger(deadlineAt)||deadlineAt<=now)fail("PRIVATE_REPLAY_UNAVAILABLE","Private request replay protection is unavailable.");
  const action=(writes.get(storage)||Promise.resolve()).then(async()=>{
    const record=await storage.get(PRIVATE_REPLAY_KEY),old=record?.[PRIVATE_REPLAY_KEY];
    if(old!==undefined&&!Array.isArray(old))fail("PRIVATE_REPLAY_UNAVAILABLE","Private replay ledger is invalid.");
    const active=(old||[]).filter(item=>item&&typeof item.key==="string"&&Number.isSafeInteger(item.deadlineAt)&&item.deadlineAt>now);
    if(active.some(item=>item.key===key))fail("PRIVATE_REQUEST_REPLAYED","This Product Session request was already presented.");
    if(active.length>=1024)fail("PRIVATE_REPLAY_CAPACITY","Private replay ledger is full.");
    await storage.set({[PRIVATE_REPLAY_KEY]:[...active,{key,deadlineAt}]});
  });
  writes.set(storage,action.catch(()=>{}));
  return action;
}
