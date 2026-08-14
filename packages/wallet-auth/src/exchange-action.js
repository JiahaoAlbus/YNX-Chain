import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { walletIdentity, walletIdentityFromPublicKey, withSecretBytes } from "./crypto.js";

const REQUEST_FIELDS=["version","chainId","productClientId","bundleId","callback","sessionBinding","account","action","parameters","nonce","issuedAt","expiresAt"];
const RESPONSE_FIELDS=[...REQUEST_FIELDS,"requestDigest","accountPublicKey","walletSignature"];
const CALLBACKS=new Set(["https://exchange.ynxweb4.com/wallet-action/callback","ynxexchange://wallet-auth/callback"]);
const ACTIONS=new Set(["exchange.order.place","exchange.order.cancel","exchange.margin.transfer","exchange.perpetual.order.place","exchange.perpetual.order.cancel"]);
const PARAMETER_FIELDS=Object.freeze({
  "exchange.order.place":["market","side","type","priceMicro","amountMicro","idempotencyKey"],
  "exchange.order.cancel":["orderId","idempotencyKey"],
  "exchange.margin.transfer":["direction","amountMicro","idempotencyKey"],
  "exchange.perpetual.order.place":["market","side","type","timeInForce","priceMicro","amountMicro","leverage","reduceOnly","idempotencyKey"],
  "exchange.perpetual.order.cancel":["orderId","idempotencyKey"],
});

export function parseExchangeOrderActionRequest(input,at=new Date()){
  const value=typeof input==="string"?parseJSON(input):input;
  exactFields(value,REQUEST_FIELDS,"Exchange action request");
  const action=allowedText(value.action,ACTIONS,"action"),parameters=parseParameters(action,value.parameters);
  const request=Object.freeze({
    version:exactText(value.version,"1","version"),chainId:exactText(value.chainId,"ynx_6423-1","chainId"),
    productClientId:exactText(value.productClientId,"ynx-exchange-v1","productClientId"),bundleId:exactText(value.bundleId,"com.ynxweb4.exchange","bundleId"),
    callback:allowedText(value.callback,CALLBACKS,"callback"),sessionBinding:pattern(value.sessionBinding,/^[0-9a-f]{64}$/,"sessionBinding"),
    account:pattern(value.account,/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/,"account"),action,parameters,
    nonce:pattern(value.nonce,/^[A-Za-z0-9_-]{32,64}$/,"nonce"),issuedAt:time(value.issuedAt,"issuedAt"),expiresAt:time(value.expiresAt,"expiresAt")
  });
  const now=validDate(at).getTime(),issued=Date.parse(request.issuedAt),expires=Date.parse(request.expiresAt);
  if(issued>now+30_000||now>=expires||expires-issued>300_000)fail("INVALID_TIME","Exchange action request is not active for a bounded five-minute review");
  return request;
}

export function exchangeOrderActionRequestDigest(input){const request=parseExchangeOrderActionRequest(input,new Date(Date.parse(input.issuedAt)));return digestHex(request.action==="exchange.order.place"?"YNX_EXCHANGE_ORDER_ACTION_REQUEST_V1":"YNX_EXCHANGE_TRADING_ACTION_REQUEST_V1",request)}
export function exchangeOrderAuthorizationPayload(account,parameters){return exchangeActionAuthorizationPayload(account,"exchange.order.place",parameters)}
export function exchangeActionAuthorizationPayload(account,action,parameters){
  const p=parseParameters(action,parameters);
  switch(action){
    case "exchange.order.place":return `ynx-exchange-order-v1\n${account}\n${p.market}\n${p.side}\n${p.type}\n${p.priceMicro}\n${p.amountMicro}\n${p.idempotencyKey}`;
    case "exchange.order.cancel":return `ynx-exchange-cancel-v1\n${account}\n${p.orderId}\n${p.idempotencyKey}`;
    case "exchange.margin.transfer":return `ynx-exchange-margin-transfer-v1\n${account}\n${p.direction}\n${p.amountMicro}\n${p.idempotencyKey}`;
    case "exchange.perpetual.order.place":return `ynx-exchange-perpetual-order-v1\n${account}\n${p.market}\n${p.side}\n${p.type}\n${p.timeInForce}\n${p.priceMicro}\n${p.amountMicro}\n${p.leverage}\n${p.reduceOnly}\n${p.idempotencyKey}`;
    case "exchange.perpetual.order.cancel":return `ynx-exchange-perpetual-cancel-v1\n${account}\n${p.orderId}\n${p.idempotencyKey}`;
    default:fail("INVALID_FIELD","action is unsupported");
  }
}

export function signExchangeOrderAction(requestInput,input){
  const request=parseExchangeOrderActionRequest(requestInput,new Date(input.issuedAt));
  const identity=walletIdentity(input.accountSecret);
  if(identity.account!==request.account||input.account!==request.account)fail("ACCOUNT_MISMATCH","Selected Wallet account does not match the Exchange session");
  const payload=exchangeActionAuthorizationPayload(request.account,request.action,request.parameters),signature=withSecretBytes(input.accountSecret,secret=>secp256k1.sign(sha256(utf8ToBytes(payload)),secret,{prehash:false,format:"compact",lowS:true}));
  return Object.freeze({...request,requestDigest:exchangeOrderActionRequestDigest(request),accountPublicKey:identity.accountPublicKey,walletSignature:bytesToHex(signature)});
}

export function verifyExchangeOrderActionResponse(input,expectedInput,at=new Date()){
  exactFields(input,RESPONSE_FIELDS,"Exchange action response");
  const expected=parseExchangeOrderActionRequest(expectedInput,at),responseRequest=parseExchangeOrderActionRequest(Object.fromEntries(REQUEST_FIELDS.map(key=>[key,input[key]])),at);
  if(canonicalJSON(responseRequest)!==canonicalJSON(expected)||input.requestDigest!==exchangeOrderActionRequestDigest(expected))fail("BINDING_MISMATCH","Wallet action response does not match the reviewed request");
  const publicKey=pattern(input.accountPublicKey,/^(02|03)[0-9a-f]{64}$/,"accountPublicKey"),signature=pattern(input.walletSignature,/^[0-9a-f]{128}$/,"walletSignature");
  let verified=false;try{verified=walletIdentityFromPublicKey(publicKey)===expected.account&&secp256k1.verify(hexToBytes(signature),sha256(utf8ToBytes(exchangeActionAuthorizationPayload(expected.account,expected.action,expected.parameters))),hexToBytes(publicKey),{prehash:false,format:"compact",lowS:true})}catch{verified=false}
  if(!verified)fail("INVALID_SIGNATURE","Wallet Exchange action signature is invalid");
  return Object.freeze({...responseRequest,requestDigest:input.requestDigest,accountPublicKey:publicKey,walletSignature:signature});
}

export function encodeExchangeOrderActionDeepLink(request){return `ynxwallet://action?request=${encodeBase64url(new TextEncoder().encode(canonicalJSON(parseExchangeOrderActionRequest(request,new Date(Date.parse(request.issuedAt))))))}`}
export function parseExchangeOrderActionDeepLink(url,at=new Date()){
  let parsed;try{parsed=new URL(url)}catch{fail("INVALID_DEEP_LINK","Exchange Wallet action link is invalid")}
  if(parsed.protocol!=="ynxwallet:"||parsed.hostname!=="action"||parsed.pathname!==""||parsed.hash||[...parsed.searchParams.keys()].join(",")!=="request")fail("INVALID_DEEP_LINK","Exchange Wallet action route or fields are invalid");
  let value;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decodeBase64url(parsed.searchParams.get("request")??"","Exchange Wallet action request")))}catch{fail("INVALID_DEEP_LINK","Exchange Wallet action encoding is invalid")}
  const request=parseExchangeOrderActionRequest(value,at);if(encodeExchangeOrderActionDeepLink(request)!==url)fail("INVALID_DEEP_LINK","Exchange Wallet action link is not canonical");return request;
}

function parseParameters(action,value){
  const fields=PARAMETER_FIELDS[action];if(!fields)fail("INVALID_FIELD","action is unsupported");exactFields(value,fields,"Exchange action parameters");
  const key=pattern(value.idempotencyKey,/^[A-Za-z0-9._:-]{8,128}$/,"idempotencyKey");
  if(action==="exchange.order.place")return Object.freeze({market:exactText(value.market,"YNXT-YUSD_TEST","market"),side:oneOf(value.side,["buy","sell"],"side"),type:exactText(value.type,"limit","type"),priceMicro:positive(value.priceMicro,"priceMicro"),amountMicro:positive(value.amountMicro,"amountMicro"),idempotencyKey:key});
  if(action==="exchange.order.cancel"||action==="exchange.perpetual.order.cancel")return Object.freeze({orderId:pattern(value.orderId,/^[A-Za-z0-9._:-]{8,128}$/,"orderId"),idempotencyKey:key});
  if(action==="exchange.margin.transfer")return Object.freeze({direction:oneOf(value.direction,["deposit","withdraw"],"direction"),amountMicro:positive(value.amountMicro,"amountMicro"),idempotencyKey:key});
  if(action==="exchange.perpetual.order.place")return Object.freeze({market:exactText(value.market,"YNXT-YUSD_TEST-PERP","market"),side:oneOf(value.side,["buy","sell"],"side"),type:exactText(value.type,"limit","type"),timeInForce:oneOf(value.timeInForce,["gtc","ioc","fok"],"timeInForce"),priceMicro:positive(value.priceMicro,"priceMicro"),amountMicro:positive(value.amountMicro,"amountMicro"),leverage:bounded(value.leverage,1,100,"leverage"),reduceOnly:boolean(value.reduceOnly,"reduceOnly"),idempotencyKey:key});
  fail("INVALID_FIELD","action is unsupported");
}
function parseJSON(value){try{return JSON.parse(value)}catch{fail("INVALID_JSON","Exchange action request is not valid JSON")}}
function exactText(value,expected,label){if(value!==expected)fail("INVALID_FIELD",`${label} is unsupported`);return value}
function allowedText(value,allowed,label){if(!allowed.has(value))fail("INVALID_FIELD",`${label} is unsupported`);return value}
function oneOf(value,allowed,label){if(!allowed.includes(value))fail("INVALID_FIELD",`${label} is unsupported`);return value}
function pattern(value,regex,label){if(typeof value!=="string"||!regex.test(value))fail("INVALID_FIELD",`${label} is invalid`);return value}
function positive(value,label){return bounded(value,1,Number.MAX_SAFE_INTEGER,label)}
function bounded(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)fail("INVALID_NUMBER",`${label} is outside the supported integer range`);return value}
function boolean(value,label){if(typeof value!=="boolean")fail("INVALID_FIELD",`${label} is invalid`);return value}
function time(value,label){const result=pattern(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,label);if(new Date(result).toISOString()!==result)fail("INVALID_TIME",`${label} is invalid`);return result}
function validDate(value){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Verification time is invalid");return value}
function fail(code,message){throw new WalletAuthError(code,message)}
