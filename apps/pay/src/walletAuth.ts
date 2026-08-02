import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  canonicalJSON as canonical,
  encodeRequestDeepLink,
  parseAuthorizationRequest,
  parseCallbackURL,
  registryParserBinding,
  requestDigest as canonicalRequestDigest,
  signGatewayChallenge,
  verifyAuthorization as canonicalVerifyAuthorization,
} from "@ynx-chain/wallet-auth";
import type { AuthorizationRequest as CanonicalAuthorizationRequest, AuthorizationResponse as CanonicalAuthorizationResponse, GatewayChallenge as CanonicalGatewayChallenge, GatewayCompletion as CanonicalGatewayCompletion } from "@ynx-chain/wallet-auth";

export const PRODUCT_CLIENT_ID="ynx-pay-v1",BUNDLE_ID="com.ynxweb4.pay",CALLBACK="ynxpay://wallet-auth/callback",PAYMENT_CALLBACK="ynxpay://payment-result";
export const SCOPES=Object.freeze(["account:read","pay:case:create","pay:route:select","pay:settlement:submit","pay:sponsorship:request"]);
const CHAIN_ID="ynx_6423-1",PAYMENT_INTENT_DOMAIN="YNX_PAY_SIGNED_INTENT_V1",PAYMENT_RESULT_DOMAIN="YNX_PAY_WALLET_RESULT_V1",MAX_LIFETIME_MS=5*60_000;
const REGISTRY=Object.freeze({schemaVersion:2 as const,productClientId:PRODUCT_CLIENT_ID,requestingProduct:"pay",bundleId:BUNDLE_ID,callbacks:Object.freeze([CALLBACK]),scopes:SCOPES,maxScopes:5,productDeviceAlgorithms:Object.freeze(["p256-sha256" as const])});

export type AuthorizationRequest=CanonicalAuthorizationRequest;
export type AuthorizationResponse=CanonicalAuthorizationResponse;
export type GatewayChallenge=CanonicalGatewayChallenge;
export type GatewayCompletion=CanonicalGatewayCompletion;
export type SignedPaymentIntent=Readonly<{version:"1";intentType:"pay.ynxt.transfer";requestId:string;chainId:"ynx_6423-1";productClientId:"ynx-pay-v1";bundleId:"com.ynxweb4.pay";sessionBinding:string;invoiceId:string;centralInvoiceId:string;merchantId:string;merchantName:string;payoutAddress:string;amount:number;asset:"YNXT";fee:1;total:number;quoteIssuedAt:string;quoteExpiresAt:string;invoiceSignature:string;callback:"ynxpay://payment-result"}>;
export type WalletPaymentResult=Readonly<{version:"1";intentDigest:string;requestId:string;invoiceId:string;chainId:"ynx_6423-1";account:string;accountPublicKey:string;transactionHash:string;issuedAt:string;walletSignature:string}>;

export class WalletProtocolError extends Error{constructor(readonly code:string,message:string){super(message);this.name="WalletProtocolError"}}

export function deviceSecret(bytes:Uint8Array):string{if(bytes.length!==32||!p256.utils.isValidSecretKey(bytes))throw new WalletProtocolError("INVALID_DEVICE_SECRET","Product device secret is invalid");return encodeBase64url(bytes)}
export function createAuthorizationRequest(secretText:string,random:Uint8Array,now=new Date()):AuthorizationRequest{
  const secret=decodeBase64url(secretText,"product device secret");
  if(secret.length!==32||!p256.utils.isValidSecretKey(secret)||random.length<24)throw new WalletProtocolError("INVALID_DEVICE_SECRET","Product device material is invalid");
  return parseAuthorizationRequest({version:"1",nonce:encodeBase64url(random.slice(0,24)),chainId:CHAIN_ID,requestingProduct:"pay",productClientId:PRODUCT_CLIENT_ID,bundleId:BUNDLE_ID,productDeviceAlgorithm:"p256-sha256",productDeviceKey:encodeBase64url(p256.getPublicKey(secret,true)),callback:CALLBACK,scopes:[...SCOPES],purpose:"Review YNXT payments and manage only this account's payment cases.",issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+MAX_LIFETIME_MS).toISOString()},{now,registry:registryParserBinding(REGISTRY)});
}
export function authorizationDeepLink(request:AuthorizationRequest):string{return encodeRequestDeepLink(request)}
export function requestDigest(request:AuthorizationRequest):string{return canonicalRequestDigest(request)}
export function parseApprovalCallback(url:string,request:AuthorizationRequest,now=new Date()):AuthorizationResponse{return verifyAuthorization(parseCallbackURL(url,CALLBACK),request,now)}
export function verifyAuthorization(value:unknown,request:AuthorizationRequest,now=new Date()):AuthorizationResponse{return canonicalVerifyAuthorization(value,{...request,requestDigest:canonicalRequestDigest(request),now})}
export function createGatewayCompletion(challenge:GatewayChallenge,secretText:string):GatewayCompletion{return signGatewayChallenge(challenge,secretText)}

export function paymentIntent(input:Omit<SignedPaymentIntent,"version"|"intentType"|"chainId"|"productClientId"|"bundleId"|"callback">):SignedPaymentIntent{
  const intent=Object.freeze({version:"1",intentType:"pay.ynxt.transfer",chainId:CHAIN_ID,productClientId:PRODUCT_CLIENT_ID,bundleId:BUNDLE_ID,callback:PAYMENT_CALLBACK,...input}) as SignedPaymentIntent;
  if(intent.total!==intent.amount+intent.fee||intent.asset!=="YNXT"||intent.fee!==1||!walletNonce(intent.requestId)||!strictFutureQuote(intent.quoteIssuedAt,intent.quoteExpiresAt))throw new WalletProtocolError("INVALID_PAYMENT_INTENT","Payment intent quote is invalid");
  return intent;
}
export function paymentIntentDigest(intent:SignedPaymentIntent):string{return digest(PAYMENT_INTENT_DOMAIN,intent)}
export function paymentIntentDeepLink(intent:SignedPaymentIntent):string{return `ynxwallet://intent?request=${encodeBase64url(utf8ToBytes(canonical(intent)))}`}
export function parsePaymentResultCallback(url:string,intent:SignedPaymentIntent,account:string,now=new Date()):WalletPaymentResult{
  const parsed=new URL(url),expected=new URL(PAYMENT_CALLBACK),encoded=parsed.searchParams.get("response");parsed.search="";
  if(!encoded||parsed.toString()!==expected.toString())throw new WalletProtocolError("CALLBACK_MISMATCH","Wallet payment callback route was substituted");
  let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(encoded,"payment callback")))}catch{throw new WalletProtocolError("INVALID_CALLBACK","Wallet payment callback payload is invalid")}
  exactFields(value,["version","intentDigest","requestId","invoiceId","chainId","account","accountPublicKey","transactionHash","issuedAt","walletSignature"]);
  const result=value as WalletPaymentResult;
  if(result.version!=="1"||result.intentDigest!==paymentIntentDigest(intent)||result.requestId!==intent.requestId||result.invoiceId!==intent.invoiceId||result.chainId!==CHAIN_ID||result.account!==account||!/^(02|03)[0-9a-f]{64}$/.test(result.accountPublicKey)||!/^0x[0-9a-f]{64}$/.test(result.transactionHash)||!/^[0-9a-f]{128}$/.test(result.walletSignature)||walletIdentity(result.accountPublicKey)!==result.account)throw new WalletProtocolError("PAYMENT_BINDING_MISMATCH","Wallet payment result does not match the reviewed intent");
  const issued=strictTime(result.issuedAt);if(issued<Date.parse(intent.quoteIssuedAt)||issued>Date.parse(intent.quoteExpiresAt)||issued>now.getTime()+30_000)throw new WalletProtocolError("EXPIRED","Wallet payment result is outside the quote lifetime");
  const unsigned={version:result.version,intentDigest:result.intentDigest,requestId:result.requestId,invoiceId:result.invoiceId,chainId:result.chainId,account:result.account,accountPublicKey:result.accountPublicKey,transactionHash:result.transactionHash,issuedAt:result.issuedAt};
  if(!secp256k1.verify(hexToBytes(result.walletSignature),sha256(utf8ToBytes(`${PAYMENT_RESULT_DOMAIN}\n${canonical(unsigned)}`)),hexToBytes(result.accountPublicKey),{prehash:false,format:"compact",lowS:true}))throw new WalletProtocolError("INVALID_SIGNATURE","Wallet payment-result signature is invalid");
  return Object.freeze({...result});
}
export function canonicalJSON(value:unknown):string{return canonical(value)}
function digest(domain:string,value:unknown):string{return bytesToHex(sha256(utf8ToBytes(`${domain}\n${canonical(value)}`)))}
function strictTime(value:string):number{if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||new Date(value).toISOString()!==value)throw new WalletProtocolError("INVALID_TIME","Protocol timestamp is invalid");return Date.parse(value)}
function strictFutureQuote(issued:string,expires:string):boolean{try{const a=strictTime(issued),b=strictTime(expires);return b>a&&b-a<=MAX_LIFETIME_MS}catch{return false}}
function walletNonce(value:string):boolean{return /^[A-Za-z0-9_-]{32,64}$/.test(value)}
function exactFields(value:unknown,fields:string[]):asserts value is Record<string,unknown>{if(!isObject(value)||Object.keys(value).sort().join("\n")!==[...fields].sort().join("\n"))throw new WalletProtocolError("UNKNOWN_OR_MISSING_FIELD","Payment result fields do not match the protocol schema")}
function isObject(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
function encodeBase64url(bytes:Uint8Array):string{return base64Encode(bytes).replace(/=+$/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function decodeBase64url(value:string,label:string):Uint8Array{if(!/^[A-Za-z0-9_-]+$/.test(value))throw new WalletProtocolError("INVALID_ENCODING",`${label} is invalid`);const bytes=base64Decode(value.replace(/-/g,"+").replace(/_/g,"/"));if(encodeBase64url(bytes)!==value)throw new WalletProtocolError("INVALID_ENCODING",`${label} is not canonical`);return bytes}
function base64Encode(bytes:Uint8Array){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let out="";for(let i=0;i<bytes.length;i+=3){const x=bytes[i]??0,y=bytes[i+1]??0,z=bytes[i+2]??0,n=(x<<16)|(y<<8)|z;out+=a.charAt((n>>>18)&63)+a.charAt((n>>>12)&63)+(i+1<bytes.length?a.charAt((n>>>6)&63):"=")+(i+2<bytes.length?a.charAt(n&63):"=")}return out}
function base64Decode(value:string){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",clean=value+"=".repeat((4-value.length%4)%4),out:number[]=[];for(let i=0;i<clean.length;i+=4){const c=[...clean.slice(i,i+4)].map(v=>v==="="?0:a.indexOf(v));if(c.some(v=>v<0))throw new WalletProtocolError("INVALID_ENCODING","Base64url is invalid");const n=((c[0]??0)<<18)|((c[1]??0)<<12)|((c[2]??0)<<6)|(c[3]??0);out.push((n>>>16)&255);if(clean.charAt(i+2)!=="=")out.push((n>>>8)&255);if(clean.charAt(i+3)!=="=")out.push(n&255)}return new Uint8Array(out)}
const BECH32="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function walletIdentity(publicKeyHex:string):string{const point=secp256k1.Point.fromBytes(hexToBytes(publicKeyHex));const payload=keccak_256(point.toBytes(false).slice(1)).slice(-20),data=convertBits(payload),values=[...hrpExpand("ynx"),...data,0,0,0,0,0,0],checksum=polymod(values)^1,tail=Array.from({length:6},(_,i)=>(checksum>>>(5*(5-i)))&31);return `ynx1${[...data,...tail].map(v=>BECH32[v]).join("")}`}
function convertBits(data:Uint8Array){let acc=0,bits=0;const out:number[]=[];for(const value of data){acc=((acc<<8)|value)&4095;bits+=8;while(bits>=5){bits-=5;out.push((acc>>bits)&31)}}if(bits>0)out.push((acc<<(5-bits))&31);return out}
function hrpExpand(hrp:string){return [...hrp].map(c=>c.charCodeAt(0)>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
function polymod(values:number[]){const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let checksum=1;for(const value of values){const top=checksum>>>25;checksum=(((checksum&0x1ffffff)<<5)^value)>>>0;generators.forEach((g,i)=>{if((top>>>i)&1)checksum=(checksum^g)>>>0})}return checksum>>>0}
