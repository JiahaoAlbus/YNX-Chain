import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { parseCentralWalletSession } from "./integration.js";

const FIELDS=["version","sessionBinding","productClientId","bundleId","productDeviceKey","method","path","bodyDigest","nonce","issuedAt","expiresAt","signature"];
const CREATE_FIELDS=["method","path","bodyDigest","nonce","issuedAt","expiresAt"];
const EXPECTED_FIELDS=["method","path","bodyDigest"];
const DOMAIN="YNX_PRODUCT_SESSION_HTTP_PROOF_V1";

export function createProductSessionProof(sessionInput,input,productDeviceSecret){
  const session=parseCentralWalletSession(sessionInput);exactFields(input,CREATE_FIELDS,"Product Session proof input");
  const secret=decodeBase64url(productDeviceSecret,"product device secret");
  if(secret.length!==32||encodeBase64url(p256.getPublicKey(secret,true))!==session.productDeviceKey)fail("DEVICE_MISMATCH","Product Session proof key does not match the session device");
  const unsigned=parseUnsigned({version:"1",sessionBinding:session.sessionBinding,productClientId:session.productClientId,bundleId:session.bundleId,productDeviceKey:session.productDeviceKey,method:input.method,path:input.path,bodyDigest:input.bodyDigest,nonce:input.nonce,issuedAt:input.issuedAt,expiresAt:input.expiresAt});
  const signature=encodeBase64url(p256.sign(utf8ToBytes(productSessionProofSignBytes(unsigned)),secret,{format:"der"}));
  return parseProductSessionProof({...unsigned,signature});
}
export function parseProductSessionProof(input){exactFields(input,FIELDS,"Product Session HTTP proof");const{signature,...unsigned}=input;const proof={...parseUnsigned(unsigned),signature:base64Signature(signature)};return Object.freeze(proof)}
export function productSessionProofSignBytes(input){return `${DOMAIN}\n${canonicalJSON(parseUnsigned(input))}`}
export function productSessionProofDigest(input){return digestHex("YNX_PRODUCT_SESSION_HTTP_PROOF_DIGEST_V1",parseProductSessionProof(input))}
export function httpBodyDigest(body){if(typeof body!=="string"&&!(body instanceof Uint8Array))fail("INVALID_BODY","HTTP proof body must be a string or bytes");return bytesToHex(sha256(typeof body==="string"?utf8ToBytes(body):body))}
export function verifyProductSessionProof(proofInput,sessionInput,expectedInput,at=new Date()){
  const proof=parseProductSessionProof(proofInput),session=parseCentralWalletSession(sessionInput);exactFields(expectedInput,EXPECTED_FIELDS,"Product Session HTTP context");
  const expected={method:method(expectedInput.method),path:path(expectedInput.path),bodyDigest:digest(expectedInput.bodyDigest,"bodyDigest")};
  for(const key of ["sessionBinding","productClientId","bundleId","productDeviceKey"])if(proof[key]!==session[key])fail("SESSION_BINDING_MISMATCH",`Product Session proof ${key} does not match the session`);
  for(const key of Object.keys(expected))if(proof[key]!==expected[key])fail("HTTP_BINDING_MISMATCH",`Product Session proof ${key} does not match the HTTP request`);
  const now=validDate(at).toISOString();if(proof.issuedAt<session.issuedAt)fail("INVALID_TIME","Product Session proof predates its session");if(proof.issuedAt>now)fail("ISSUED_IN_FUTURE","Product Session proof issue time is in the future");if(proof.expiresAt<=now||proof.expiresAt>session.expiresAt)fail("EXPIRED","Product Session proof is expired or exceeds its session");
  let valid=false;try{valid=p256.verify(decodeBase64url(proof.signature,"proof signature"),utf8ToBytes(productSessionProofSignBytes(unsigned(proof))),decodeBase64url(proof.productDeviceKey,"product device key"),{format:"der",lowS:false})}catch{valid=false}if(!valid)fail("INVALID_DEVICE_PROOF","Product Session HTTP proof signature is invalid");return proof;
}
function parseUnsigned(input){exactFields(input,FIELDS.filter(key=>key!=="signature"),"Unsigned Product Session HTTP proof");const value={version:pattern(input.version,"version",/^1$/),sessionBinding:digest(input.sessionBinding,"sessionBinding"),productClientId:pattern(input.productClientId,"productClientId",/^[a-z][a-z0-9._-]{2,63}$/),bundleId:pattern(input.bundleId,"bundleId",/^[A-Za-z][A-Za-z0-9.-]{2,127}$/),productDeviceKey:deviceKey(input.productDeviceKey),method:method(input.method),path:path(input.path),bodyDigest:digest(input.bodyDigest,"bodyDigest"),nonce:pattern(input.nonce,"nonce",/^[A-Za-z0-9_-]{32,64}$/),issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")};if(value.expiresAt<=value.issuedAt||Date.parse(value.expiresAt)-Date.parse(value.issuedAt)>60000)fail("INVALID_EXPIRY","Product Session proof lifetime must be positive and at most sixty seconds");return Object.freeze(value)}
function unsigned(value){const{signature:_signature,...result}=value;return result}
function deviceKey(value){const normalized=pattern(value,"productDeviceKey",/^[A-Za-z0-9_-]{44}$/);const bytes=decodeBase64url(normalized,"product device key");if(bytes.length!==33||encodeBase64url(bytes)!==normalized)fail("INVALID_DEVICE_KEY","Product device key is invalid");try{p256.Point.fromBytes(bytes)}catch{fail("INVALID_DEVICE_KEY","Product device key is not a P-256 point")}return normalized}
function base64Signature(value){const normalized=pattern(value,"signature",/^[A-Za-z0-9_-]{90,96}$/);const bytes=decodeBase64url(normalized,"signature");if(bytes.length<68||bytes.length>72||encodeBase64url(bytes)!==normalized)fail("INVALID_DEVICE_PROOF","Product Session proof signature is invalid");return normalized}
function method(value){return pattern(value,"method",/^(DELETE|GET|PATCH|POST|PUT)$/)}
function path(value){const result=pattern(value,"path",/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/);if(result.includes("//")||result.endsWith("/")||result.includes("?")||result.includes("#"))fail("INVALID_PATH","Product Session proof path must be canonical without query, fragment or percent encoding");return result}
function digest(value,label){return pattern(value,label,/^[0-9a-f]{64}$/)}
function pattern(value,label,regex){if(typeof value!=="string"||value.trim()!==value||!regex.test(value))fail("INVALID_FIELD",`${label} is invalid`);return value}
function time(value,label){const result=pattern(value,label,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);if(!Number.isFinite(Date.parse(result))||new Date(result).toISOString()!==result)fail("INVALID_TIME",`${label} is invalid`);return result}
function validDate(value){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Product Session proof verification time is invalid");return value}
function fail(code,message){throw new WalletAuthError(code,message)}
