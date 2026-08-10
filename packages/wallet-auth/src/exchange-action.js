import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";

const REQUEST_FIELDS=["version","chainId","productClientId","bundleId","callback","sessionBinding","account","action","parameters","nonce","issuedAt","expiresAt"];
const PARAMETER_FIELDS=["market","side","type","priceMicro","amountMicro","idempotencyKey"];
const RESPONSE_FIELDS=[...REQUEST_FIELDS,"requestDigest","accountPublicKey","walletSignature"];
const CALLBACKS=new Set(["https://exchange.ynxweb4.com/wallet-action/callback","ynxexchange://wallet-auth/callback"]);

export function parseExchangeOrderActionRequest(input,at=new Date()){
  const value=typeof input==="string"?parseJSON(input):input;
  exactFields(value,REQUEST_FIELDS,"Exchange order action request");
  exactFields(value.parameters,PARAMETER_FIELDS,"Exchange order parameters");
  const request=Object.freeze({
    version:exactText(value.version,"1","version"),chainId:exactText(value.chainId,"ynx_6423-1","chainId"),
    productClientId:exactText(value.productClientId,"ynx-exchange-v1","productClientId"),bundleId:exactText(value.bundleId,"com.ynxweb4.exchange","bundleId"),
    callback:allowedText(value.callback,CALLBACKS,"callback"),sessionBinding:pattern(value.sessionBinding,/^[0-9a-f]{64}$/,"sessionBinding"),
    account:pattern(value.account,/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/,"account"),action:exactText(value.action,"exchange.order.place","action"),
    parameters:Object.freeze({market:exactText(value.parameters.market,"YNXT-YUSD_TEST","market"),side:oneOf(value.parameters.side,["buy","sell"],"side"),type:exactText(value.parameters.type,"limit","type"),priceMicro:positive(value.parameters.priceMicro,"priceMicro"),amountMicro:positive(value.parameters.amountMicro,"amountMicro"),idempotencyKey:pattern(value.parameters.idempotencyKey,/^[A-Za-z0-9._:-]{8,128}$/,"idempotencyKey")}),
    nonce:pattern(value.nonce,/^[A-Za-z0-9_-]{32,64}$/,"nonce"),issuedAt:time(value.issuedAt,"issuedAt"),expiresAt:time(value.expiresAt,"expiresAt")
  });
  const now=validDate(at).getTime(),issued=Date.parse(request.issuedAt),expires=Date.parse(request.expiresAt);
  if(issued>now+30_000||now>=expires||expires-issued>300_000)fail("INVALID_TIME","Exchange order request is not active for a bounded five-minute review");
  return request;
}

export function exchangeOrderActionRequestDigest(input){return digestHex("YNX_EXCHANGE_ORDER_ACTION_REQUEST_V1",parseExchangeOrderActionRequest(input,new Date(Date.parse(input.issuedAt))))}
export function exchangeOrderAuthorizationPayload(account,parameters){const p=parseParameters(parameters);return `ynx-exchange-order-v1\n${account}\n${p.market}\n${p.side}\n${p.type}\n${p.priceMicro}\n${p.amountMicro}\n${p.idempotencyKey}`}

export function signExchangeOrderAction(requestInput,input){
  const request=parseExchangeOrderActionRequest(requestInput,new Date(input.issuedAt));
  const identity=walletIdentity(input.accountSecret);
  if(identity.account!==request.account||input.account!==request.account)fail("ACCOUNT_MISMATCH","Selected Wallet account does not match the Exchange session");
  const signature=secp256k1.sign(sha256(utf8ToBytes(exchangeOrderAuthorizationPayload(request.account,request.parameters))),hexToBytes(input.accountSecret),{prehash:false,format:"compact",lowS:true});
  return Object.freeze({...request,requestDigest:exchangeOrderActionRequestDigest(request),accountPublicKey:identity.accountPublicKey,walletSignature:bytesToHex(signature)});
}

export function verifyExchangeOrderActionResponse(input,expectedInput,at=new Date()){
  exactFields(input,RESPONSE_FIELDS,"Exchange order action response");
  const expected=parseExchangeOrderActionRequest(expectedInput,at),responseRequest=parseExchangeOrderActionRequest(Object.fromEntries(REQUEST_FIELDS.map(key=>[key,input[key]])),at);
  if(canonicalJSON(responseRequest)!==canonicalJSON(expected)||input.requestDigest!==exchangeOrderActionRequestDigest(expected))fail("BINDING_MISMATCH","Wallet order response does not match the reviewed request");
  const publicKey=pattern(input.accountPublicKey,/^(02|03)[0-9a-f]{64}$/,"accountPublicKey"),signature=pattern(input.walletSignature,/^[0-9a-f]{128}$/,"walletSignature");
  let verified=false;try{verified=walletIdentityFromPublicKey(publicKey)===expected.account&&secp256k1.verify(hexToBytes(signature),sha256(utf8ToBytes(exchangeOrderAuthorizationPayload(expected.account,expected.parameters))),hexToBytes(publicKey),{prehash:false,format:"compact",lowS:true})}catch{verified=false}
  if(!verified)fail("INVALID_SIGNATURE","Wallet order signature is invalid");
  return Object.freeze({...responseRequest,requestDigest:input.requestDigest,accountPublicKey:publicKey,walletSignature:signature});
}

export function encodeExchangeOrderActionDeepLink(request){return `ynxwallet://action?request=${encodeBase64url(new TextEncoder().encode(canonicalJSON(parseExchangeOrderActionRequest(request,new Date(Date.parse(request.issuedAt))))))}`}
export function parseExchangeOrderActionDeepLink(url,at=new Date()){
  let parsed;try{parsed=new URL(url)}catch{fail("INVALID_DEEP_LINK","Exchange Wallet action link is invalid")}
  if(parsed.protocol!=="ynxwallet:"||parsed.hostname!=="action"||parsed.pathname!==""||parsed.hash||[...parsed.searchParams.keys()].join(",")!=="request")fail("INVALID_DEEP_LINK","Exchange Wallet action route or fields are invalid");
  let value;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(parsed.searchParams.get("request")??"","Exchange Wallet action request")))}catch{fail("INVALID_DEEP_LINK","Exchange Wallet action encoding is invalid")}
  return parseExchangeOrderActionRequest(value,at);
}

function parseParameters(value){exactFields(value,PARAMETER_FIELDS,"Exchange order parameters");return {market:exactText(value.market,"YNXT-YUSD_TEST","market"),side:oneOf(value.side,["buy","sell"],"side"),type:exactText(value.type,"limit","type"),priceMicro:positive(value.priceMicro,"priceMicro"),amountMicro:positive(value.amountMicro,"amountMicro"),idempotencyKey:pattern(value.idempotencyKey,/^[A-Za-z0-9._:-]{8,128}$/,"idempotencyKey")}}
function parseJSON(value){try{return JSON.parse(value)}catch{fail("INVALID_JSON","Exchange order request is not valid JSON")}}
function exactText(value,expected,label){if(value!==expected)fail("INVALID_FIELD",`${label} is unsupported`);return value}
function allowedText(value,allowed,label){if(!allowed.has(value))fail("INVALID_FIELD",`${label} is unsupported`);return value}
function oneOf(value,allowed,label){if(!allowed.includes(value))fail("INVALID_FIELD",`${label} is unsupported`);return value}
function pattern(value,regex,label){if(typeof value!=="string"||!regex.test(value))fail("INVALID_FIELD",`${label} is invalid`);return value}
function positive(value,label){if(!Number.isSafeInteger(value)||value<=0)fail("INVALID_NUMBER",`${label} must be a positive safe integer`);return value}
function time(value,label){const result=pattern(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,label);if(new Date(result).toISOString()!==result)fail("INVALID_TIME",`${label} is invalid`);return result}
function validDate(value){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Verification time is invalid");return value}
function fail(code,message){throw new WalletAuthError(code,message)}
