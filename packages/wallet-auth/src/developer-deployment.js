import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey, withSecretBytes } from "./crypto.js";

const REQUEST_FIELDS = ["version","chainId","productClientId","bundleId","callback","sessionBinding","account","nonce","action","payload","artifactDigest","simulation","issuedAt","expiresAt"];
const PAYLOAD_FIELDS = ["name","source","deployedBytecode","constructorArgs","idempotencyKey","requestHash"];
const SIMULATION_FIELDS = ["chainId","blockNumber","gasEstimate","gasPriceWei","maxFeeWei","compilerVersion","artifactDigest","source","asOf"];
const RESPONSE_FIELDS = ["version","requestDigest","productClientId","bundleId","callback","sessionBinding","account","action","artifactDigest","signedTransaction","canonicalPayloadHex","transactionHash","issuedAt","expiresAt"];
const ENVELOPE_FIELDS = ["version","chainId","type","signer","nonce","action","payload","payloadHash","fee","aiUnits","payUnits","publicKey","signature"];

export function createDeveloperDeploymentDeepLink(input, at = new Date()) {
  const request = parseDeveloperDeploymentRequest(input, at);
  return `ynxwallet://developer-deploy?request=${encodeBase64url(new TextEncoder().encode(canonicalJSON(request)))}`;
}

export function parseDeveloperDeploymentDeepLink(value, at = new Date()) {
  let url;
  try { url = new URL(value); } catch { fail("INVALID_DEEP_LINK", "Developer deployment link is invalid"); }
  const keys = [...url.searchParams.keys()];
  if (url.protocol !== "ynxwallet:" || url.hostname !== "developer-deploy" || url.pathname || url.hash || keys.length !== 1 || keys[0] !== "request") fail("INVALID_DEEP_LINK", "Developer deployment route or fields are invalid");
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(url.searchParams.get("request") || "", "Developer deployment request")); } catch { fail("INVALID_DEEP_LINK", "Developer deployment encoding is invalid"); }
  const request = parseDeveloperDeploymentRequest(decoded, at);
  if (createDeveloperDeploymentDeepLink(request, at) !== value) fail("INVALID_DEEP_LINK", "Developer deployment link is not canonical");
  return request;
}

export function parseDeveloperDeploymentRequest(input, at = new Date()) {
  const raw = typeof input === "string" ? json(input, "Developer deployment request") : input;
  exactFields(raw, REQUEST_FIELDS, "Developer deployment request");
  const payload = parsePayload(raw.payload), simulation = parseSimulation(raw.simulation);
  const request = {
    version: exact(raw.version, "version", "1"), chainId: integer(raw.chainId, "chainId", 6423, 6423),
    productClientId: exact(raw.productClientId, "productClientId", "ynx-developer-v1"), bundleId: exact(raw.bundleId, "bundleId", "com.ynxweb4.developer.testnetpreview"),
    callback: exact(raw.callback, "callback", "ynxdeveloper://deployment/callback"), sessionBinding: digest(raw.sessionBinding, "sessionBinding"), account: account(raw.account),
    nonce: integer(raw.nonce, "nonce", 1, Number.MAX_SAFE_INTEGER), action: exact(raw.action, "action", "ide_contract_deploy"), payload,
    artifactDigest: digest(raw.artifactDigest, "artifactDigest"), simulation, issuedAt: time(raw.issuedAt, "issuedAt"), expiresAt: time(raw.expiresAt, "expiresAt"),
  };
  if (request.payload.requestHash !== developerDeploymentRequestHash(request.payload)) fail("REQUEST_HASH_MISMATCH", "Developer deployment request hash is invalid");
  if (request.artifactDigest !== developerArtifactDigest(request.payload) || request.simulation.artifactDigest !== request.artifactDigest) fail("ARTIFACT_MISMATCH", "Developer artifact digest is invalid");
  if (request.simulation.chainId !== request.chainId) fail("WRONG_NETWORK", "Developer simulation uses another chain");
  const now = validDate(at).getTime(), issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > 300_000 || issued > now + 30_000 || expires <= now) fail("EXPIRED", "Developer deployment request lifetime is invalid");
  return deepFreeze(request);
}

export function developerDeploymentRequestHash(payload) {
  const parsed = parsePayloadWithoutHash(payload);
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify({ domain:"YNX_IDE_REQUEST_V1", action:"ide_contract_deploy", value:parsed }))));
}

export function developerArtifactDigest(payload) {
  const parsed = parsePayloadWithoutHash(payload);
  return bytesToHex(sha256(utf8ToBytes(`YNX_DEVELOPER_ARTIFACT_V1\n${canonicalJSON(parsed)}`)));
}

export function signDeveloperDeployment(requestInput, input, at = new Date()) {
  const request = parseDeveloperDeploymentRequest(requestInput, at), identity = walletIdentity(input.accountSecret);
  if (identity.account !== request.account || (input.account && input.account !== request.account)) fail("ACCOUNT_MISMATCH", "Developer deployment account does not match the signing key");
  const payloadJSON = JSON.stringify(request.payload), payloadHash = bytesToHex(sha256(utf8ToBytes(payloadJSON)));
  const unsigned = { version:1, chainId:6423, type:"application_action", signer:evmAddressFromYNX(request.account), nonce:request.nonce, action:"ide_contract_deploy", payload:request.payload, payloadHash, fee:1, aiUnits:0, payUnits:0, publicKey:identity.accountPublicKey };
  const signDocument = { domain:"YNX_APPLICATION_ACTION_V1", ...unsigned };
  const signature = withSecretBytes(input.accountSecret, secret => secp256k1.sign(sha256(utf8ToBytes(JSON.stringify(signDocument))), secret, { prehash:false, format:"der", lowS:true }));
  const signedTransaction = Object.freeze({ ...unsigned, signature:bytesToHex(signature) });
  const canonicalPayload = JSON.stringify(signedTransaction), issuedAt = validDate(at).toISOString(), expiresAt = new Date(Math.min(Date.parse(request.expiresAt), at.getTime() + 120_000)).toISOString();
  const response = { version:"1", requestDigest:developerDeploymentDigest(request), productClientId:request.productClientId, bundleId:request.bundleId, callback:request.callback, sessionBinding:request.sessionBinding, account:request.account, action:request.action, artifactDigest:request.artifactDigest, signedTransaction, canonicalPayloadHex:`0x${bytesToHex(utf8ToBytes(canonicalPayload))}`, transactionHash:`0x${bytesToHex(sha256(utf8ToBytes(canonicalPayload)))}`, issuedAt, expiresAt };
  return parseDeveloperDeploymentResponse(response, request, at);
}

export function parseDeveloperDeploymentResponse(input, expectedRequest, at = new Date()) {
  const raw = typeof input === "string" ? json(input, "Developer deployment response") : input;
  exactFields(raw, RESPONSE_FIELDS, "Developer deployment response");
  const request = parseDeveloperDeploymentRequest(expectedRequest, at), signed = parseEnvelope(raw.signedTransaction);
  const response = { version:exact(raw.version,"version","1"), requestDigest:digest(raw.requestDigest,"requestDigest"), productClientId:exact(raw.productClientId,"productClientId",request.productClientId), bundleId:exact(raw.bundleId,"bundleId",request.bundleId), callback:exact(raw.callback,"callback",request.callback), sessionBinding:exact(raw.sessionBinding,"sessionBinding",request.sessionBinding), account:exact(raw.account,"account",request.account), action:exact(raw.action,"action",request.action), artifactDigest:exact(raw.artifactDigest,"artifactDigest",request.artifactDigest), signedTransaction:signed, canonicalPayloadHex:data(raw.canonicalPayloadHex,"canonicalPayloadHex"), transactionHash:hash(raw.transactionHash,"transactionHash"), issuedAt:time(raw.issuedAt,"issuedAt"), expiresAt:time(raw.expiresAt,"expiresAt") };
  if (response.requestDigest !== developerDeploymentDigest(request)) fail("BINDING_MISMATCH", "Developer deployment response does not match its request");
  const canonicalPayload = JSON.stringify(signed), expectedHex = `0x${bytesToHex(utf8ToBytes(canonicalPayload))}`;
  if (response.canonicalPayloadHex !== expectedHex || response.transactionHash !== `0x${bytesToHex(sha256(utf8ToBytes(canonicalPayload)))}`) fail("TRANSACTION_MISMATCH", "Developer signed transaction encoding or hash is invalid");
  if (signed.signer !== evmAddressFromYNX(request.account) || signed.nonce !== request.nonce || signed.payload.requestHash !== request.payload.requestHash || signed.payloadHash !== bytesToHex(sha256(utf8ToBytes(JSON.stringify(request.payload))))) fail("BINDING_MISMATCH", "Developer signed transaction was widened");
  const { signature, ...unsigned } = signed, signDocument = { domain:"YNX_APPLICATION_ACTION_V1", ...unsigned };
  let verified = false;
  try { verified = evmAddressFromYNX(walletIdentityFromPublicKey(signed.publicKey)) === signed.signer && secp256k1.verify(hexToBytes(signature), sha256(utf8ToBytes(JSON.stringify(signDocument))), hexToBytes(signed.publicKey), { prehash:false, format:"der", lowS:true }); } catch { verified = false; }
  if (!verified) fail("INVALID_SIGNATURE", "Developer deployment signature is invalid");
  if (response.issuedAt < request.issuedAt || response.issuedAt > validDate(at).toISOString() || response.expiresAt <= response.issuedAt || response.expiresAt > request.expiresAt) fail("INVALID_TIME", "Developer deployment response lifetime is invalid");
  return deepFreeze(response);
}

export function createDeveloperDeploymentCallback(response, expectedRequest, at = new Date()) {
  const parsed = parseDeveloperDeploymentResponse(response, expectedRequest, at);
  return `${parsed.callback}?response=${encodeBase64url(new TextEncoder().encode(canonicalJSON(parsed)))}`;
}

export function developerDeploymentDigest(request) { return bytesToHex(sha256(utf8ToBytes(`YNX_DEVELOPER_DEPLOYMENT_REQUEST_V1\n${canonicalJSON(request)}`))); }

function parsePayload(input) { exactFields(input, PAYLOAD_FIELDS, "Developer deployment payload"); const base=parsePayloadWithoutHash(input); return Object.freeze({ ...base, requestHash:digest(input.requestHash,"requestHash") }); }
function parsePayloadWithoutHash(input) { const value={ name:pattern(input?.name,"name",/^[A-Za-z][A-Za-z0-9_]{2,63}$/), source:text(input?.source,"source",1,4096), deployedBytecode:pattern(input?.deployedBytecode,"deployedBytecode",/^0x[0-9a-f]{2,12288}$/), constructorArgs:list(input?.constructorArgs,"constructorArgs",0,16,item=>text(item,"constructorArg",0,256)), idempotencyKey:pattern(input?.idempotencyKey,"idempotencyKey",/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/) }; if(value.deployedBytecode.length%2)fail("INVALID_FIELD","deployedBytecode must contain whole bytes"); return Object.freeze(value); }
function parseSimulation(input) { exactFields(input,SIMULATION_FIELDS,"Developer simulation"); return Object.freeze({chainId:integer(input.chainId,"chainId",6423,6423),blockNumber:integer(input.blockNumber,"blockNumber",1,Number.MAX_SAFE_INTEGER),gasEstimate:decimal(input.gasEstimate,"gasEstimate"),gasPriceWei:decimal(input.gasPriceWei,"gasPriceWei"),maxFeeWei:decimal(input.maxFeeWei,"maxFeeWei"),compilerVersion:text(input.compilerVersion,"compilerVersion",1,128),artifactDigest:digest(input.artifactDigest,"artifactDigest"),source:https(input.source,"source"),asOf:time(input.asOf,"asOf")}); }
function parseEnvelope(input) { exactFields(input,ENVELOPE_FIELDS,"Developer signed transaction"); const value={version:integer(input.version,"version",1,1),chainId:integer(input.chainId,"chainId",6423,6423),type:exact(input.type,"type","application_action"),signer:pattern(input.signer,"signer",/^0x[0-9a-f]{40}$/),nonce:integer(input.nonce,"nonce",1,Number.MAX_SAFE_INTEGER),action:exact(input.action,"action","ide_contract_deploy"),payload:parsePayload(input.payload),payloadHash:digest(input.payloadHash,"payloadHash"),fee:integer(input.fee,"fee",1,1),aiUnits:integer(input.aiUnits,"aiUnits",0,0),payUnits:integer(input.payUnits,"payUnits",0,0),publicKey:pattern(input.publicKey,"publicKey",/^(02|03)[0-9a-f]{64}$/),signature:pattern(input.signature,"signature",/^[0-9a-f]{136,144}$/)}; return Object.freeze(value); }
function json(value,label){try{return JSON.parse(value)}catch{fail("INVALID_JSON",`${label} is not valid JSON`)}}
function exact(value,label,expected){if(value!==expected)fail("INVALID_FIELD",`${label} is invalid`);return value}
function text(value,label,min,max){if(typeof value!=="string"||value.length<min||value.length>max||value.trim()!==value)fail("INVALID_FIELD",`${label} is invalid`);return value}
function pattern(value,label,regex){const result=text(value,label,1,16384);if(!regex.test(result))fail("INVALID_FIELD",`${label} is invalid`);return result}
function integer(value,label,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail("INVALID_FIELD",`${label} is invalid`);return value}
function digest(value,label){return pattern(value,label,/^[0-9a-f]{64}$/)}
function hash(value,label){return pattern(value,label,/^0x[0-9a-f]{64}$/)}
function data(value,label){const result=pattern(value,label,/^0x[0-9a-f]+$/);if(result.length%2)fail("INVALID_FIELD",`${label} must contain whole bytes`);return result}
function decimal(value,label){return pattern(value,label,/^(0|[1-9][0-9]{0,77})$/)}
function account(value){return pattern(value,"account",/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/)}
function time(value,label){const result=pattern(value,label,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);if(new Date(result).toISOString()!==result)fail("INVALID_TIME",`${label} is invalid`);return result}
function https(value,label){const result=text(value,label,1,512);let url;try{url=new URL(result)}catch{fail("INVALID_URL",`${label} is invalid`)}if(url.protocol!=="https:"||url.username||url.password||url.hash||url.toString()!==result)fail("INVALID_URL",`${label} is invalid`);return result}
function list(value,label,min,max,parser){if(!Array.isArray(value)||value.length<min||value.length>max)fail("INVALID_FIELD",`${label} is invalid`);return Object.freeze(value.map(parser))}
function validDate(value){if(!(value instanceof Date)||!Number.isFinite(value.getTime()))fail("INVALID_TIME","Verification time is invalid");return value}
function deepFreeze(value){const result={...value};if(value.payload)result.payload=Object.freeze({...value.payload,constructorArgs:Object.freeze([...value.payload.constructorArgs])});if(value.simulation)result.simulation=Object.freeze(value.simulation);if(value.signedTransaction)result.signedTransaction=Object.freeze({...value.signedTransaction,payload:Object.freeze({...value.signedTransaction.payload,constructorArgs:Object.freeze([...value.signedTransaction.payload.constructorArgs])})});return Object.freeze(result)}
function fail(code,message){throw new WalletAuthError(code,message)}
