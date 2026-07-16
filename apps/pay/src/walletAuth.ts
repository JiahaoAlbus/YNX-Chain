import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const PRODUCT_CLIENT_ID = "ynx-pay-v1";
export const BUNDLE_ID = "com.ynxweb4.pay";
export const CALLBACK = "ynxpay://wallet-auth/callback";
export const PAYMENT_CALLBACK = "ynxpay://payment-result";
export const SCOPES = Object.freeze(["account:read", "pay:case:create", "pay:settlement:submit"]);
const CHAIN_ID = "ynx_6423-1";
const DEVICE_ALGORITHM = "p256-sha256";
const REQUEST_DOMAIN = "YNX_WALLET_AUTH_REQUEST_V1";
const APPROVAL_DOMAIN = "YNX_WALLET_AUTH_APPROVAL_V1";
const GATEWAY_DOMAIN = "YNX_PRODUCT_SESSION_CHALLENGE_V1";
const PAYMENT_INTENT_DOMAIN = "YNX_PAY_SIGNED_INTENT_V1";
const PAYMENT_RESULT_DOMAIN = "YNX_PAY_WALLET_RESULT_V1";
const MAX_LIFETIME_MS = 5 * 60_000;

export type AuthorizationRequest = Readonly<{ version:"1"; nonce:string; chainId:"ynx_6423-1"; requestingProduct:"pay"; productClientId:"ynx-pay-v1"; bundleId:"com.ynxweb4.pay"; productDeviceAlgorithm:"p256-sha256"; productDeviceKey:string; callback:"ynxpay://wallet-auth/callback"; scopes:readonly string[]; purpose:string; issuedAt:string; expiresAt:string }>;
export type AuthorizationResponse = Readonly<{ version:"1"; requestDigest:string; nonce:string; chainId:"ynx_6423-1"; requestingProduct:"pay"; productClientId:"ynx-pay-v1"; bundleId:"com.ynxweb4.pay"; productDeviceAlgorithm:"p256-sha256"; productDeviceKey:string; callback:"ynxpay://wallet-auth/callback"; account:string; accountPublicKey:string; grantedScopes:readonly string[]; purpose:string; issuedAt:string; expiresAt:string; walletSignature:string }>;
export type GatewayChallenge = Readonly<{version:"1";challenge:string;requestDigest:string;productClientId:"ynx-pay-v1";bundleId:"com.ynxweb4.pay";productDeviceAlgorithm:"p256-sha256";productDeviceKey:string;account:string;scopes:readonly string[];issuedAt:string;expiresAt:string}>;
export type GatewayCompletion = Readonly<{challenge:GatewayChallenge;deviceSignature:string}>;
export type SignedPaymentIntent = Readonly<{version:"1";intentType:"pay.ynxt.transfer";requestId:string;chainId:"ynx_6423-1";productClientId:"ynx-pay-v1";bundleId:"com.ynxweb4.pay";sessionBinding:string;invoiceId:string;centralInvoiceId:string;merchantId:string;merchantName:string;payoutAddress:string;amount:number;asset:"YNXT";fee:1;total:number;quoteIssuedAt:string;quoteExpiresAt:string;invoiceSignature:string;callback:"ynxpay://payment-result"}>;
export type WalletPaymentResult = Readonly<{version:"1";intentDigest:string;requestId:string;invoiceId:string;chainId:"ynx_6423-1";account:string;accountPublicKey:string;transactionHash:string;issuedAt:string;walletSignature:string}>;

export class WalletProtocolError extends Error { constructor(readonly code:string,message:string){super(message);this.name="WalletProtocolError"} }

export function deviceSecret(bytes:Uint8Array):string {
  if(bytes.length!==32||!p256.utils.isValidSecretKey(bytes)) throw new WalletProtocolError("INVALID_DEVICE_SECRET","Product device secret is invalid");
  return encodeBase64url(bytes);
}

export function createAuthorizationRequest(secretText:string,random:Uint8Array,now=new Date()):AuthorizationRequest {
  const secret=decodeFixed(secretText,32,"product device secret");
  if(!p256.utils.isValidSecretKey(secret)||random.length<24) throw new WalletProtocolError("INVALID_DEVICE_SECRET","Product device material is invalid");
  const issuedAt=now.toISOString();
  return Object.freeze({version:"1",nonce:encodeBase64url(random.slice(0,24)),chainId:CHAIN_ID,requestingProduct:"pay",productClientId:PRODUCT_CLIENT_ID,bundleId:BUNDLE_ID,productDeviceAlgorithm:DEVICE_ALGORITHM,productDeviceKey:encodeBase64url(p256.getPublicKey(secret,true)),callback:CALLBACK,scopes:SCOPES,purpose:"Review YNXT payments and manage only this account's payment cases.",issuedAt,expiresAt:new Date(now.getTime()+MAX_LIFETIME_MS).toISOString()});
}

export function authorizationDeepLink(request:AuthorizationRequest):string { return `ynxwallet://authorize?request=${encodeBase64url(utf8ToBytes(canonicalJSON(request)))}` }
export function requestDigest(request:AuthorizationRequest):string { return digest(REQUEST_DOMAIN,request) }

export function parseApprovalCallback(url:string,request:AuthorizationRequest,now=new Date()):AuthorizationResponse {
  const parsed=new URL(url);const expected=new URL(CALLBACK);const response=parsed.searchParams.get("response");parsed.search="";
  if(!response||parsed.toString()!==expected.toString())throw new WalletProtocolError("CALLBACK_MISMATCH","Wallet callback route was substituted");
  let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(response)))}catch{throw new WalletProtocolError("INVALID_CALLBACK","Wallet callback payload is invalid")}
  return verifyAuthorization(value,request,now);
}

export function verifyAuthorization(value:unknown,request:AuthorizationRequest,now=new Date()):AuthorizationResponse {
  exactFields(value,["version","requestDigest","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","account","accountPublicKey","grantedScopes","purpose","issuedAt","expiresAt","walletSignature"],"Wallet approval");
  const raw=value as Record<string,unknown>;
  const response=Object.freeze({...raw,grantedScopes:Object.freeze([...(raw.grantedScopes as string[])])}) as AuthorizationResponse;
  for(const key of ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"] as const)if(response[key]!==request[key])throw new WalletProtocolError("BINDING_MISMATCH",`Wallet approval ${key} does not match the request`);
  if(response.requestDigest!==requestDigest(request)||response.grantedScopes.join("\n")!==request.scopes.join("\n")||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(response.account)||!/^(02|03)[0-9a-f]{64}$/.test(response.accountPublicKey)||!/^[0-9a-f]{128}$/.test(response.walletSignature))throw new WalletProtocolError("BINDING_MISMATCH","Wallet approval proof or scopes are invalid");
  const issued=strictTime(response.issuedAt),expires=strictTime(response.expiresAt);
  if(expires<=now.getTime()||expires>Date.parse(request.expiresAt)||issued<Date.parse(request.issuedAt))throw new WalletProtocolError("EXPIRED","Wallet approval is expired or exceeds the request lifetime");
  const unsigned={version:response.version,requestDigest:response.requestDigest,nonce:response.nonce,chainId:response.chainId,requestingProduct:response.requestingProduct,productClientId:response.productClientId,bundleId:response.bundleId,productDeviceAlgorithm:response.productDeviceAlgorithm,productDeviceKey:response.productDeviceKey,callback:response.callback,account:response.account,accountPublicKey:response.accountPublicKey,grantedScopes:response.grantedScopes,purpose:response.purpose,issuedAt:response.issuedAt,expiresAt:response.expiresAt};
  const valid=secp256k1.verify(hexToBytes(response.walletSignature),sha256(utf8ToBytes(`${APPROVAL_DOMAIN}\n${canonicalJSON(unsigned)}`)),hexToBytes(response.accountPublicKey),{prehash:false,format:"compact",lowS:true});
  if(!valid||walletIdentity(response.accountPublicKey)!==response.account)throw new WalletProtocolError("INVALID_SIGNATURE","Wallet approval signature is invalid");
  return response;
}

export function createGatewayCompletion(approval:AuthorizationResponse,secretText:string,random:Uint8Array,now=new Date()):GatewayCompletion {
  const secret=decodeFixed(secretText,32,"product device secret");
  if(random.length<24||encodeBase64url(p256.getPublicKey(secret,true))!==approval.productDeviceKey)throw new WalletProtocolError("DEVICE_MISMATCH","Gateway challenge is bound to another product device");
  const expiresAt=new Date(Math.min(Date.parse(approval.expiresAt),now.getTime()+3*60_000)).toISOString();
  const challenge=Object.freeze({version:"1",challenge:encodeBase64url(random.slice(0,24)),requestDigest:approval.requestDigest,productClientId:PRODUCT_CLIENT_ID,bundleId:BUNDLE_ID,productDeviceAlgorithm:DEVICE_ALGORITHM,productDeviceKey:approval.productDeviceKey,account:approval.account,scopes:Object.freeze([...approval.grantedScopes]),issuedAt:now.toISOString(),expiresAt}) satisfies GatewayChallenge;
  const signature=p256.sign(utf8ToBytes(`${GATEWAY_DOMAIN}\n${canonicalJSON(challenge)}`),secret,{format:"der"});
  return Object.freeze({challenge,deviceSignature:encodeBase64url(signature)});
}

export function paymentIntent(input:Omit<SignedPaymentIntent,"version"|"intentType"|"chainId"|"productClientId"|"bundleId"|"callback">):SignedPaymentIntent {
  const intent=Object.freeze({version:"1",intentType:"pay.ynxt.transfer",chainId:CHAIN_ID,productClientId:PRODUCT_CLIENT_ID,bundleId:BUNDLE_ID,callback:PAYMENT_CALLBACK,...input}) as SignedPaymentIntent;
  if(intent.total!==intent.amount+intent.fee||intent.asset!=="YNXT"||intent.fee!==1||!walletNonce(intent.requestId)||!strictFutureQuote(intent.quoteIssuedAt,intent.quoteExpiresAt))throw new WalletProtocolError("INVALID_PAYMENT_INTENT","Payment intent quote is invalid");
  return intent;
}
export function paymentIntentDigest(intent:SignedPaymentIntent):string{return digest(PAYMENT_INTENT_DOMAIN,intent)}
export function paymentIntentDeepLink(intent:SignedPaymentIntent):string{return `ynxwallet://intent?request=${encodeBase64url(utf8ToBytes(canonicalJSON(intent)))}`}

export function parsePaymentResultCallback(url:string,intent:SignedPaymentIntent,account:string,now=new Date()):WalletPaymentResult {
  const parsed=new URL(url),expected=new URL(PAYMENT_CALLBACK),encoded=parsed.searchParams.get("response");parsed.search="";
  if(!encoded||parsed.toString()!==expected.toString())throw new WalletProtocolError("CALLBACK_MISMATCH","Payment callback route was substituted");
  let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(encoded)))}catch{throw new WalletProtocolError("INVALID_CALLBACK","Payment callback payload is invalid")}
  exactFields(value,["version","intentDigest","requestId","invoiceId","chainId","account","accountPublicKey","transactionHash","issuedAt","walletSignature"],"Wallet payment result");
  const result=value as WalletPaymentResult;
  if(result.version!=="1"||result.intentDigest!==paymentIntentDigest(intent)||result.requestId!==intent.requestId||result.invoiceId!==intent.invoiceId||result.chainId!==CHAIN_ID||result.account!==account||!/^(02|03)[0-9a-f]{64}$/.test(result.accountPublicKey)||!/^0x[0-9a-f]{64}$/.test(result.transactionHash)||!/^[0-9a-f]{128}$/.test(result.walletSignature)||walletIdentity(result.accountPublicKey)!==result.account)throw new WalletProtocolError("PAYMENT_BINDING_MISMATCH","Wallet payment result does not match the reviewed intent");
  const issued=strictTime(result.issuedAt);if(issued<Date.parse(intent.quoteIssuedAt)||issued>Date.parse(intent.quoteExpiresAt)||issued>now.getTime()+30_000)throw new WalletProtocolError("EXPIRED","Wallet payment result is outside the quote lifetime");
  const unsigned={version:result.version,intentDigest:result.intentDigest,requestId:result.requestId,invoiceId:result.invoiceId,chainId:result.chainId,account:result.account,accountPublicKey:result.accountPublicKey,transactionHash:result.transactionHash,issuedAt:result.issuedAt};
  const valid=secp256k1.verify(hexToBytes(result.walletSignature),sha256(utf8ToBytes(`${PAYMENT_RESULT_DOMAIN}\n${canonicalJSON(unsigned)}`)),hexToBytes(result.accountPublicKey),{prehash:false,format:"compact",lowS:true});
  if(!valid)throw new WalletProtocolError("INVALID_SIGNATURE","Wallet payment-result signature is invalid");
  return Object.freeze({...result});
}

export function canonicalJSON(value:unknown):string {
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"){if(!Number.isSafeInteger(value))throw new WalletProtocolError("INVALID_NUMBER","Protocol numbers must be safe integers");return JSON.stringify(value)}
  if(Array.isArray(value))return `[${value.map(canonicalJSON).join(",")}]`;
  if(!isObject(value))throw new WalletProtocolError("INVALID_SHAPE","Protocol value is not canonical JSON");
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}

function digest(domain:string,value:unknown):string{return bytesToHex(sha256(utf8ToBytes(`${domain}\n${canonicalJSON(value)}`)))}
function strictTime(value:string):number{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||new Date(value).toISOString()!==value)throw new WalletProtocolError("INVALID_TIME","Protocol timestamp is invalid");return Date.parse(value)}
function strictFutureQuote(issued:string,expires:string):boolean{try{const a=strictTime(issued),b=strictTime(expires);return b>a&&b-a<=MAX_LIFETIME_MS}catch{return false}}
function walletNonce(value:string):boolean{return /^[A-Za-z0-9_-]{32,64}$/.test(value)}
function exactFields(value:unknown,fields:string[],label:string):asserts value is Record<string,unknown>{if(!isObject(value)||Object.keys(value).sort().join("\n")!==[...fields].sort().join("\n"))throw new WalletProtocolError("UNKNOWN_OR_MISSING_FIELD",`${label} fields do not match the protocol schema`)}
function isObject(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
function encodeBase64url(bytes:Uint8Array):string{return BufferLike.toBase64(bytes).replace(/=+$/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function decodeBase64url(value:string):Uint8Array{if(!/^[A-Za-z0-9_-]+$/.test(value))throw new WalletProtocolError("INVALID_ENCODING","Base64url value is invalid");const bytes=BufferLike.fromBase64(value.replace(/-/g,"+").replace(/_/g,"/"));if(encodeBase64url(bytes)!==value)throw new WalletProtocolError("INVALID_ENCODING","Base64url value is not canonical");return bytes}
function decodeFixed(value:string,length:number,label:string):Uint8Array{const bytes=decodeBase64url(value);if(bytes.length!==length)throw new WalletProtocolError("INVALID_KEY",`${label} has the wrong length`);return bytes}

const BufferLike={toBase64(bytes:Uint8Array){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let text="";for(let i=0;i<bytes.length;i+=3){const a=bytes[i]??0,b=bytes[i+1]??0,c=bytes[i+2]??0,n=(a<<16)|(b<<8)|c;text+=alphabet.charAt((n>>>18)&63)+alphabet.charAt((n>>>12)&63)+(i+1<bytes.length?alphabet.charAt((n>>>6)&63):"=")+(i+2<bytes.length?alphabet.charAt(n&63):"=")}return text},fromBase64(value:string){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";const clean=value+"=".repeat((4-value.length%4)%4);const out:number[]=[];for(let i=0;i<clean.length;i+=4){const first=clean.charAt(i),second=clean.charAt(i+1),third=clean.charAt(i+2),fourth=clean.charAt(i+3);const a=alphabet.indexOf(first),b=alphabet.indexOf(second),c=third==="="?0:alphabet.indexOf(third),d=fourth==="="?0:alphabet.indexOf(fourth);if(a<0||b<0||c<0||d<0)throw new WalletProtocolError("INVALID_ENCODING","Base64url value is invalid");const n=(a<<18)|(b<<12)|(c<<6)|d;out.push((n>>>16)&255);if(third!=="=")out.push((n>>>8)&255);if(fourth!=="=")out.push(n&255)}return new Uint8Array(out)}};

const BECH32="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function walletIdentity(publicKeyHex:string):string{const point=secp256k1.Point.fromBytes(hexToBytes(publicKeyHex));const payload=keccak_256(point.toBytes(false).slice(1)).slice(-20);const data=convertBits(payload);const values=[...hrpExpand("ynx"),...data,0,0,0,0,0,0];const checksum=polymod(values)^1;const tail=Array.from({length:6},(_,i)=>(checksum>>>(5*(5-i)))&31);return `ynx1${[...data,...tail].map(v=>BECH32[v]).join("")}`}
function convertBits(data:Uint8Array){let acc=0,bits=0;const out:number[]=[];for(const value of data){acc=((acc<<8)|value)&4095;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31)}}if(bits>0)out.push((acc<<(5-bits))&31);return out}
function hrpExpand(hrp:string){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
function polymod(values:number[]){const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let checksum=1;for(const value of values){const top=checksum>>>25;checksum=(((checksum&0x1ffffff)<<5)^value)>>>0;generators.forEach((g,i)=>{if((top>>>i)&1)checksum=(checksum^g)>>>0})}return checksum>>>0}
