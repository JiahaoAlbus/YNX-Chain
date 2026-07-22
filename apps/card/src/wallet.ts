import { p256 } from "@noble/curves/nist.js";
import * as WalletAuth from "@ynx-chain/wallet-auth";
import {
  encodeRequestDeepLink,
  parseAuthorizationRequest,
  parseCallbackURL,
  requestDigest,
  signGatewayChallenge,
  verifyAuthorization,
  type AuthorizationRequest,
  type AuthorizationResponse,
  type GatewayChallenge,
} from "@ynx-chain/wallet-auth";

const encodeBase64url=(WalletAuth as unknown as {encodeBase64url:(value:Uint8Array)=>string}).encodeBase64url;

export const PRODUCT_ID="ynx-card";
export const CLIENT_ID="ynx-card-v1";
export const BUNDLE_ID="com.ynxweb4.card";
export const CALLBACK="ynxcard://wallet-auth/callback";
export const SCOPES=Object.freeze(["account:read","card:application:write","card:controls:write","card:dispute:write"] as const);

export type PendingAuthorization=Readonly<{request:AuthorizationRequest;deviceSecret:string}>;
export type CardSession=Readonly<{token:string;sessionBinding:string;requestDigest:string;account:string;productClientId:"ynx-card-v1";bundleId:"com.ynxweb4.card";scopes:readonly string[];issuedAt:string;expiresAt:string;deviceId:string}>;

const registry={
  [CLIENT_ID]:{requestingProduct:PRODUCT_ID,bundleId:BUNDLE_ID,callbacks:[CALLBACK],scopes:[...SCOPES],maxScopes:SCOPES.length},
};

export async function createAuthorization(now=new Date(),random?:Readonly<{secret:Uint8Array;nonce:Uint8Array}>):Promise<PendingAuthorization>{
  const generated=random??await productRandom();
  const secret=generated.secret;
  const nonce=encodeBase64url(generated.nonce);
  const publicKey=encodeBase64url(p256.getPublicKey(secret,true));
  const request=parseAuthorizationRequest({
    version:"1",nonce,chainId:"ynx_6423-1",requestingProduct:PRODUCT_ID,productClientId:CLIENT_ID,bundleId:BUNDLE_ID,
    productDeviceAlgorithm:"p256-sha256",productDeviceKey:publicKey,callback:CALLBACK,scopes:[...SCOPES],
    purpose:"Check card eligibility and manage this account's sandbox card controls and disputes.",
    issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+5*60_000).toISOString(),
  },{now,registry});
  return Object.freeze({request,deviceSecret:encodeBase64url(secret)});
}

async function productRandom():Promise<Readonly<{secret:Uint8Array;nonce:Uint8Array}>>{const crypto=await import("expo-crypto");return{secret:await crypto.getRandomBytesAsync(32),nonce:await crypto.getRandomBytesAsync(32)}}

export function walletDeepLink(pending:PendingAuthorization):string{return encodeRequestDeepLink(pending.request)}

export function verifiedApproval(callbackURL:string,pending:PendingAuthorization,now=new Date()):AuthorizationResponse{
  const raw=parseCallbackURL(callbackURL,CALLBACK);
  return verifyAuthorization(raw,{...pending.request,requestDigest:requestDigest(pending.request),now});
}

export async function completeCentralSession(gatewayURL:string,pending:PendingAuthorization,approval:AuthorizationResponse):Promise<CardSession>{
  const base=requiredGateway(gatewayURL);
  const challenge=await json(`${base}/app/card/session/challenges`,{method:"POST",body:{authorizationRequest:pending.request,walletApproval:approval}}) as {challenge:GatewayChallenge};
  const completion=signGatewayChallenge(challenge.challenge,pending.deviceSecret);
  const value=await json(`${base}/app/card/session/complete`,{method:"POST",body:{authorizationRequest:pending.request,walletApproval:approval,gatewayCompletion:completion}});
  return parseSession(value);
}

function parseSession(value:unknown):CardSession{
  if(!object(value)||value.productClientId!==CLIENT_ID||value.bundleId!==BUNDLE_ID||typeof value.token!=="string"||typeof value.sessionBinding!=="string"||typeof value.requestDigest!=="string"||typeof value.account!=="string"||!Array.isArray(value.scopes)||value.scopes.join("\n")!==SCOPES.join("\n")||typeof value.issuedAt!=="string"||typeof value.expiresAt!=="string"||typeof value.deviceId!=="string"||Date.parse(value.expiresAt)<=Date.now())throw new Error("Central Wallet session binding is invalid");
  return Object.freeze(value as CardSession);
}
function requiredGateway(value:string):string{const raw=value.trim().replace(/\/$/,"");let parsed:URL;try{parsed=new URL(raw)}catch{throw new Error("YNX Card Gateway is not configured")};if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=="/"||parsed.search||parsed.hash)throw new Error("YNX Card Gateway URL is invalid");if(parsed.protocol==="http:"&&!(["127.0.0.1","localhost","10.0.2.2"].includes(parsed.hostname)))throw new Error("YNX Card Gateway requires HTTPS");return raw}
async function json(url:string,input:{method:string;body:unknown}):Promise<unknown>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);try{const response=await fetch(url,{method:input.method,headers:{"Content-Type":"application/json","X-YNX-Client":CLIENT_ID},body:JSON.stringify(input.body),signal:controller.signal});const value=await response.json().catch(()=>({error:"Invalid Gateway response"}));if(!response.ok)throw new Error(object(value)&&typeof value.error==="string"?value.error:`Gateway returned ${response.status}`);return value}finally{clearTimeout(timer)}}
function object(value:unknown):value is Record<string,any>{return typeof value==="object"&&value!==null&&!Array.isArray(value)}
