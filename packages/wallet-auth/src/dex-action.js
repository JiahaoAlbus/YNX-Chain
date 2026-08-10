import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";

const ACTIONS = new Set(["dex_swap_exact_input", "dex_swap_exact_output", "dex_liquidity_add", "dex_liquidity_remove"]);
const REQUEST_FIELDS = ["version","chainId","productClientId","bundleId","callback","sessionBinding","account","nonce","action","payload","quote","issuedAt","expiresAt"];
const QUOTE_FIELDS = ["poolBlockHeight","poolUpdatedAt","asset0","asset1","reserve0","reserve1","feeBps","expectedAmount"];
const RESPONSE_FIELDS = ["version","requestDigest","productClientId","bundleId","callback","sessionBinding","account","action","payloadHash","signedTransaction","canonicalPayloadHex","transactionHash","issuedAt","expiresAt"];
const ENVELOPE_FIELDS = ["version","chainId","type","signer","nonce","action","payload","payloadHash","fee","aiUnits","payUnits","publicKey","signature"];
const PAYLOAD_FIELDS = Object.freeze({
  dex_swap_exact_input:["poolId","assetIn","amountIn","minAmountOut","deadlineUnix"],
  dex_swap_exact_output:["poolId","assetOut","amountOut","maxAmountIn","deadlineUnix"],
  dex_liquidity_add:["poolId","amount0","amount1","minShares","deadlineUnix"],
  dex_liquidity_remove:["poolId","shares","minAmount0","minAmount1","deadlineUnix"],
});

export function createDexActionDeepLink(input, at = new Date()) {
  const request = parseDexActionRequest(input, at);
  return `ynxwallet://dex-action?request=${encodeBase64url(new TextEncoder().encode(canonicalJSON(request)))}`;
}

export function parseDexActionDeepLink(value, at = new Date()) {
  let url;
  try { url = new URL(value); } catch { fail("INVALID_DEEP_LINK", "DEX Wallet action link is invalid"); }
  const keys = [...url.searchParams.keys()];
  if (url.protocol !== "ynxwallet:" || url.hostname !== "dex-action" || url.pathname || url.hash || keys.length !== 1 || keys[0] !== "request") fail("INVALID_DEEP_LINK", "DEX Wallet action route or fields are invalid");
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal:true }).decode(decodeBase64url(url.searchParams.get("request") || "", "DEX Wallet action request")); } catch { fail("INVALID_DEEP_LINK", "DEX Wallet action encoding is invalid"); }
  return parseDexActionRequest(decoded, at);
}

export function parseDexActionRequest(input, at = new Date()) {
  const raw = typeof input === "string" ? json(input, "DEX Wallet action request") : input;
  exactFields(raw, REQUEST_FIELDS, "DEX Wallet action request");
  const action = enumeration(raw.action, "action", ACTIONS), payload = parsePayload(action, raw.payload), quote = parseQuote(raw.quote);
  const request = {
    version:exact(raw.version,"version","1"), chainId:integer(raw.chainId,"chainId",6423,6423),
    productClientId:exact(raw.productClientId,"productClientId","ynx-dex-web-v1"), bundleId:exact(raw.bundleId,"bundleId","com.ynxweb4.dex.web"),
    callback:exact(raw.callback,"callback","https://dex.ynxweb4.com/wallet-action/callback"), sessionBinding:digest(raw.sessionBinding,"sessionBinding"), account:account(raw.account),
    nonce:integer(raw.nonce,"nonce",1,Number.MAX_SAFE_INTEGER), action, payload, quote,
    issuedAt:time(raw.issuedAt,"issuedAt"), expiresAt:time(raw.expiresAt,"expiresAt"),
  };
  if (payload.poolId !== quotePoolID(payload)) fail("BINDING_MISMATCH", "DEX payload pool is invalid");
  if (payload.deadlineUnix * 1000 > Date.parse(request.expiresAt) + 60_000 || payload.deadlineUnix * 1000 <= Date.parse(request.issuedAt)) fail("INVALID_TIME", "DEX transaction deadline is outside the bounded Wallet review");
  if (!quoteMatchesAction(action, payload, quote)) fail("QUOTE_MISMATCH", "DEX quote assets do not match the exact action");
  const now=validDate(at).getTime(), issued=Date.parse(request.issuedAt), expires=Date.parse(request.expiresAt);
  if (expires <= issued || expires-issued > 300_000 || issued > now+30_000 || expires <= now) fail("EXPIRED", "DEX Wallet action lifetime is invalid");
  return deepFreeze(request);
}

export function dexActionRequestDigest(requestInput) {
  const at = new Date(Date.parse(requestInput.issuedAt));
  const request = parseDexActionRequest(requestInput, at);
  return bytesToHex(sha256(utf8ToBytes(`YNX_DEX_ACTION_REQUEST_V1\n${canonicalJSON(request)}`)));
}

export function signDexAction(requestInput, input, at = new Date()) {
  const request = parseDexActionRequest(requestInput, at), identity = walletIdentity(input.accountSecret);
  if (identity.account !== request.account || (input.account && input.account !== request.account)) fail("ACCOUNT_MISMATCH", "DEX account does not match the signing key");
  const payloadJSON=JSON.stringify(request.payload), payloadHash=bytesToHex(sha256(utf8ToBytes(payloadJSON)));
  const unsigned={version:1,chainId:6423,type:"application_action",signer:evmAddressFromYNX(request.account),nonce:request.nonce,action:request.action,payload:request.payload,payloadHash,fee:1,aiUnits:0,payUnits:0,publicKey:identity.accountPublicKey};
  const signature=secp256k1.sign(sha256(utf8ToBytes(JSON.stringify({domain:"YNX_APPLICATION_ACTION_V1",...unsigned}))),hexToBytes(input.accountSecret),{prehash:false,format:"der",lowS:true});
  const signedTransaction=Object.freeze({...unsigned,signature:bytesToHex(signature)}),canonicalPayload=JSON.stringify(signedTransaction);
  const response={version:"1",requestDigest:dexActionRequestDigest(request),productClientId:request.productClientId,bundleId:request.bundleId,callback:request.callback,sessionBinding:request.sessionBinding,account:request.account,action:request.action,payloadHash,signedTransaction,canonicalPayloadHex:`0x${bytesToHex(utf8ToBytes(canonicalPayload))}`,transactionHash:`0x${bytesToHex(sha256(utf8ToBytes(canonicalPayload)))}`,issuedAt:validDate(at).toISOString(),expiresAt:new Date(Math.min(Date.parse(request.expiresAt),at.getTime()+120_000)).toISOString()};
  return parseDexActionResponse(response,request,at);
}

export function parseDexActionResponse(input, expectedRequest, at = new Date()) {
  const raw=typeof input === "string" ? json(input,"DEX Wallet action response") : input;
  exactFields(raw,RESPONSE_FIELDS,"DEX Wallet action response");
  const request=parseDexActionRequest(expectedRequest,at), signed=parseEnvelope(raw.signedTransaction,request.action);
  const response={version:exact(raw.version,"version","1"),requestDigest:digest(raw.requestDigest,"requestDigest"),productClientId:exact(raw.productClientId,"productClientId",request.productClientId),bundleId:exact(raw.bundleId,"bundleId",request.bundleId),callback:exact(raw.callback,"callback",request.callback),sessionBinding:exact(raw.sessionBinding,"sessionBinding",request.sessionBinding),account:exact(raw.account,"account",request.account),action:exact(raw.action,"action",request.action),payloadHash:digest(raw.payloadHash,"payloadHash"),signedTransaction:signed,canonicalPayloadHex:data(raw.canonicalPayloadHex,"canonicalPayloadHex"),transactionHash:hash(raw.transactionHash,"transactionHash"),issuedAt:time(raw.issuedAt,"issuedAt"),expiresAt:time(raw.expiresAt,"expiresAt")};
  if (response.requestDigest !== dexActionRequestDigest(request)) fail("BINDING_MISMATCH", "DEX Wallet response does not match its request");
  const payloadJSON=JSON.stringify(request.payload), expectedPayloadHash=bytesToHex(sha256(utf8ToBytes(payloadJSON))), canonicalPayload=JSON.stringify(signed);
  if (response.payloadHash!==expectedPayloadHash || signed.payloadHash!==expectedPayloadHash || canonicalJSON(signed.payload)!==canonicalJSON(request.payload)) fail("BINDING_MISMATCH", "DEX signed payload was widened or replaced");
  if (response.canonicalPayloadHex!==`0x${bytesToHex(utf8ToBytes(canonicalPayload))}` || response.transactionHash!==`0x${bytesToHex(sha256(utf8ToBytes(canonicalPayload)))}`) fail("TRANSACTION_MISMATCH", "DEX signed transaction encoding or hash is invalid");
  if (signed.signer!==evmAddressFromYNX(request.account) || signed.nonce!==request.nonce || signed.action!==request.action) fail("BINDING_MISMATCH", "DEX signed transaction identity, nonce or action changed");
  const {signature,...unsigned}=signed;
  let verified=false;
  try { verified=evmAddressFromYNX(walletIdentityFromPublicKey(signed.publicKey))===signed.signer && secp256k1.verify(hexToBytes(signature),sha256(utf8ToBytes(JSON.stringify({domain:"YNX_APPLICATION_ACTION_V1",...unsigned}))),hexToBytes(signed.publicKey),{prehash:false,format:"der",lowS:true}); } catch { verified=false; }
  if (!verified) fail("INVALID_SIGNATURE", "DEX transaction signature is invalid");
  if (response.issuedAt<request.issuedAt || response.issuedAt>validDate(at).toISOString() || response.expiresAt<=response.issuedAt || response.expiresAt>request.expiresAt) fail("INVALID_TIME", "DEX Wallet response lifetime is invalid");
  return deepFreeze(response);
}

export function createDexActionCallback(response, expectedRequest, at = new Date()) {
  const parsed=parseDexActionResponse(response,expectedRequest,at);
  return `${parsed.callback}?response=${encodeBase64url(new TextEncoder().encode(canonicalJSON(parsed)))}`;
}

function parsePayload(action,input){const fields=PAYLOAD_FIELDS[action];exactFields(input,fields,"DEX action payload");const poolId=pool(input.poolId,"poolId"),deadlineUnix=integer(input.deadlineUnix,"deadlineUnix",1,Number.MAX_SAFE_INTEGER);switch(action){case "dex_swap_exact_input":return Object.freeze({poolId,assetIn:asset(input.assetIn,"assetIn"),amountIn:positive(input.amountIn,"amountIn"),minAmountOut:positive(input.minAmountOut,"minAmountOut"),deadlineUnix});case "dex_swap_exact_output":return Object.freeze({poolId,assetOut:asset(input.assetOut,"assetOut"),amountOut:positive(input.amountOut,"amountOut"),maxAmountIn:positive(input.maxAmountIn,"maxAmountIn"),deadlineUnix});case "dex_liquidity_add":return Object.freeze({poolId,amount0:positive(input.amount0,"amount0"),amount1:positive(input.amount1,"amount1"),minShares:positive(input.minShares,"minShares"),deadlineUnix});case "dex_liquidity_remove":return Object.freeze({poolId,shares:positive(input.shares,"shares"),minAmount0:positive(input.minAmount0,"minAmount0"),minAmount1:positive(input.minAmount1,"minAmount1"),deadlineUnix});default:fail("INVALID_FIELD","action is unsupported")}}
function parseQuote(input){exactFields(input,QUOTE_FIELDS,"DEX quote");return Object.freeze({poolBlockHeight:positive(input.poolBlockHeight,"poolBlockHeight"),poolUpdatedAt:time(input.poolUpdatedAt,"poolUpdatedAt"),asset0:asset(input.asset0,"asset0"),asset1:asset(input.asset1,"asset1"),reserve0:positive(input.reserve0,"reserve0"),reserve1:positive(input.reserve1,"reserve1"),feeBps:integer(input.feeBps,"feeBps",1,1000),expectedAmount:positive(input.expectedAmount,"expectedAmount")})}
function parseEnvelope(input,action){exactFields(input,ENVELOPE_FIELDS,"DEX signed transaction");return Object.freeze({version:integer(input.version,"version",1,1),chainId:integer(input.chainId,"chainId",6423,6423),type:exact(input.type,"type","application_action"),signer:pattern(input.signer,"signer",/^0x[0-9a-f]{40}$/),nonce:positive(input.nonce,"nonce"),action:exact(input.action,"action",action),payload:parsePayload(action,input.payload),payloadHash:digest(input.payloadHash,"payloadHash"),fee:integer(input.fee,"fee",1,1),aiUnits:integer(input.aiUnits,"aiUnits",0,0),payUnits:integer(input.payUnits,"payUnits",0,0),publicKey:pattern(input.publicKey,"publicKey",/^(02|03)[0-9a-f]{64}$/),signature:pattern(input.signature,"signature",/^[0-9a-f]{136,144}$/)})}
function quoteMatchesAction(action,payload,quote){if(quote.asset0===quote.asset1)return false;if(action==="dex_swap_exact_input")return payload.assetIn===quote.asset0||payload.assetIn===quote.asset1;if(action==="dex_swap_exact_output")return payload.assetOut===quote.asset0||payload.assetOut===quote.asset1;return true}
function quotePoolID(payload){return payload.poolId}
function json(value,label){try{return JSON.parse(value)}catch{fail("INVALID_JSON",`${label} is not valid JSON`)}}
function exact(value,label,expected){if(value!==expected)fail("INVALID_FIELD",`${label} is invalid`);return value}
function enumeration(value,label,allowed){if(typeof value!=="string"||!allowed.has(value))fail("INVALID_FIELD",`${label} is unsupported`);return value}
function pattern(value,label,regex){if(typeof value!=="string"||!regex.test(value))fail("INVALID_FIELD",`${label} is invalid`);return value}
function integer(value,label,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail("INVALID_FIELD",`${label} is invalid`);return value}
function positive(value,label){return integer(value,label,1,Number.MAX_SAFE_INTEGER)}
function digest(value,label){return pattern(value,label,/^[0-9a-f]{64}$/)}
function hash(value,label){return pattern(value,label,/^0x[0-9a-f]{64}$/)}
function data(value,label){const result=pattern(value,label,/^0x[0-9a-f]+$/);if(result.length%2)fail("INVALID_FIELD",`${label} must contain whole bytes`);return result}
function account(value){return pattern(value,"account",/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/)}
function pool(value,label){return pattern(value,label,/^dex_[a-z0-9][a-z0-9_-]{2,59}$/)}
function asset(value,label){return pattern(value,label,/^(YNXT|[a-z][a-z0-9-]{2,31})$/)}
function time(value,label){const result=pattern(value,label,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);if(new Date(result).toISOString()!==result)fail("INVALID_TIME",`${label} is invalid`);return result}
function validDate(value){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Verification time is invalid");return value}
function deepFreeze(value){const result={...value};if(value.payload)result.payload=Object.freeze({...value.payload});if(value.quote)result.quote=Object.freeze({...value.quote});if(value.signedTransaction)result.signedTransaction=Object.freeze({...value.signedTransaction,payload:Object.freeze({...value.signedTransaction.payload})});return Object.freeze(result)}
function fail(code,message){throw new WalletAuthError(code,message)}
