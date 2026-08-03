import {p256} from "@noble/curves/nist.js";
import {utf8ToBytes} from "@noble/hashes/utils.js";

export type GatewayChallenge={version:string;challenge:string;requestDigest:string;productClientId:string;bundleId:string;productDeviceAlgorithm:string;productDeviceKey:string;account:string;scopes:string[];issuedAt:string;expiresAt:string};
export type WalletResponse={callback:string;[key:string]:unknown};

const bytesToBase64Url=(bytes:Uint8Array)=>{
  let binary=""; for(const byte of bytes) binary+=String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
};
const base64UrlToBytes=(value:string)=>{
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4);
  const binary=globalThis.atob(normalized); return Uint8Array.from(binary,c=>c.charCodeAt(0));
};
export const canonicalJSON=(value:unknown):string=>{
  if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number") return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if(typeof value!=="object") throw new Error("Non-canonical protocol value");
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(",")}}`;
};
export const createDeviceIdentity=(secretBase64Url?:string)=>{
  const secret=secretBase64Url?base64UrlToBytes(secretBase64Url):p256.utils.randomSecretKey();
  return {secret:bytesToBase64Url(secret),publicKey:bytesToBase64Url(p256.getPublicKey(secret,true))};
};
export const walletDeepLink=(request:unknown)=>`ynxwallet://authorize?request=${bytesToBase64Url(utf8ToBytes(canonicalJSON(request)))}`;
export const parseWalletCallback=(url:string):WalletResponse=>{
  const parsed=new URL(url); const response=parsed.searchParams.get("response"); parsed.search="";
  if(parsed.protocol!=="ynxai:"||parsed.hostname!=="wallet-auth"||parsed.pathname!=="/callback"||!response) throw new Error("Wallet callback route was substituted");
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(response))) as WalletResponse;
};
export const signGatewayChallenge=(challenge:GatewayChallenge,secretBase64Url:string)=>{
  const secret=base64UrlToBytes(secretBase64Url);
  if(bytesToBase64Url(p256.getPublicKey(secret,true))!==challenge.productDeviceKey) throw new Error("Gateway challenge device binding mismatch");
  const signature=p256.sign(utf8ToBytes(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`),secret,{format:"der"});
  return {challenge,deviceSignature:bytesToBase64Url(signature)};
};
