import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJSON, exactFields } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { FINANCE_EVM_ORIGIN, FINANCE_EVM_CALLBACK, FINANCE_EVM_CHAIN_ID, FINANCE_EVM_MAX_LIFETIME_MS, FINANCE_EVM_PROOF_MAX_LIFETIME_MS, fail, literal, pattern, evmAccount, evmAccountType, token, digest, subjectId, time, authorityTime, activeWindow, deviceKey, deviceSignature, normalizeDeviceSignature, signDevice, verifyDevice, walletSignature, verifyWalletSignature, rawTarget } from "./finance-evm-common.js";

export const FINANCE_EVM_SUBJECT_SCOPE = "finance.evm.private.read";
export const FINANCE_EVM_SUBJECT_REVOKE_TARGET = "/api/evm-subject/revoke";
const CHALLENGE = ["version","productId","subjectNamespace","origin","callback","chainId","account","accountType","scope","deviceId","deviceAlgorithm","deviceKey","nonce","state","requestId","issuedAt","expiresAt"];
const SESSION = ["version","sessionId","challengeDigest","subjectId","nativeAccount","productId","subjectNamespace","origin","chainId","account","accountType","scope","deviceId","deviceAlgorithm","deviceKey","issuedAt","expiresAt"];
const HTTP = ["version","sessionId","challengeDigest","subjectId","account","origin","scope","method","target","bodyDigest","nonce","issuedAt","expiresAt"];
const PROOF = [...HTTP,"deviceSignature"];
const hash = value => bytesToHex(sha256(utf8ToBytes(value)));
const same = (a,b,code) => { if (canonicalJSON(a) !== canonicalJSON(b)) fail(code,"Proof differs from server authority"); };

export function parseFinanceEvmSubjectChallenge(input) {
  exactFields(input, CHALLENGE, "Finance EVM subject challenge");
  const v = Object.freeze({
    version:literal(input.version,"1"),productId:literal(input.productId,"finance"),subjectNamespace:literal(input.subjectNamespace,"evm"),
    origin:literal(input.origin,FINANCE_EVM_ORIGIN),callback:literal(input.callback,FINANCE_EVM_CALLBACK),
    chainId:literal(input.chainId,FINANCE_EVM_CHAIN_ID),account:evmAccount(input.account),accountType:evmAccountType(input.accountType),
    scope:literal(input.scope,FINANCE_EVM_SUBJECT_SCOPE),deviceId:pattern(input.deviceId,"deviceId",/^[A-Za-z0-9._:-]{8,128}$/),
    deviceAlgorithm:literal(input.deviceAlgorithm,"p256-sha256"),deviceKey:deviceKey(input.deviceKey),
    nonce:token(input.nonce,"nonce"),state:token(input.state,"state"),requestId:pattern(input.requestId,"requestId",/^[A-Za-z0-9._~-]{16,128}$/),
    issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")
  });
  if (Date.parse(v.expiresAt) <= Date.parse(v.issuedAt) || Date.parse(v.expiresAt)-Date.parse(v.issuedAt)>FINANCE_EVM_MAX_LIFETIME_MS) fail("INVALID_EXPIRY","Challenge lifetime invalid");
  return v;
}
export function financeEvmSubjectMessage(input) { return "YNX_FINANCE_EVM_SUBJECT_LOGIN_V1\n"+canonicalJSON(parseFinanceEvmSubjectChallenge(input)); }
export function financeEvmSubjectSigningRequest(input) {
  const challenge=parseFinanceEvmSubjectChallenge(input), message=financeEvmSubjectMessage(challenge);
  return Object.freeze({method:"personal_sign",params:Object.freeze(["0x"+bytesToHex(utf8ToBytes(message)),challenge.account]),message});
}
export function financeEvmSubjectDeviceMessage(input) { return "YNX_FINANCE_EVM_SUBJECT_DEVICE_V1\n"+canonicalJSON(parseFinanceEvmSubjectChallenge(input)); }
export function createFinanceEvmSubjectLoginProof(challengeInput,signature,secret) {
  const challenge=parseFinanceEvmSubjectChallenge(challengeInput);
  return parseFinanceEvmSubjectLoginProof({challenge,message:financeEvmSubjectMessage(challenge),walletSignature:signature,deviceSignature:signDevice(financeEvmSubjectDeviceMessage(challenge),secret,challenge.deviceKey)});
}
export async function createFinanceEvmSubjectLoginProofWith(challengeInput,signature,signer) {
  const challenge=parseFinanceEvmSubjectChallenge(challengeInput);
  if(typeof signer!=="function") fail("INVALID_DEVICE","Device signer required");
  const message=financeEvmSubjectDeviceMessage(challenge);
  const deviceSignature=normalizeDeviceSignature(await signer(Object.freeze({purpose:"finance-evm-subject-login",algorithm:"p256-sha256",deviceKey:challenge.deviceKey,payload:encodeBase64url(utf8ToBytes(message))})));
  verifyDevice(deviceSignature,message,challenge.deviceKey);
  return parseFinanceEvmSubjectLoginProof({challenge,message:financeEvmSubjectMessage(challenge),walletSignature:signature,deviceSignature});
}
export function parseFinanceEvmSubjectLoginProof(input) {
  exactFields(input,["challenge","message","walletSignature","deviceSignature"],"Finance EVM subject login proof");
  const challenge=parseFinanceEvmSubjectChallenge(input.challenge), message=financeEvmSubjectMessage(challenge);
  if(input.message!==message) fail("MESSAGE_MISMATCH","Wallet message changed");
  return Object.freeze({challenge,message,walletSignature:walletSignature(input.walletSignature,challenge.accountType),deviceSignature:deviceSignature(input.deviceSignature)});
}
export async function verifyFinanceEvmSubjectLoginProof(input,expectedChallenge,at,verifyContractSignature) {
  const proof=parseFinanceEvmSubjectLoginProof(input), expected=parseFinanceEvmSubjectChallenge(expectedChallenge);
  same(proof.challenge,expected,"CHALLENGE_MISMATCH");
  activeWindow(expected.issuedAt,expected.expiresAt,FINANCE_EVM_MAX_LIFETIME_MS,at);
  await verifyWalletSignature(proof.message,proof.walletSignature,expected.account,expected.accountType,verifyContractSignature);
  verifyDevice(proof.deviceSignature,financeEvmSubjectDeviceMessage(expected),expected.deviceKey);
  return Object.freeze({account:expected.account,accountType:expected.accountType,challengeDigest:hash(proof.message)});
}
export function parseFinanceEvmSubjectSession(input) {
  exactFields(input,SESSION,"Finance EVM subject session");
  const v=Object.freeze({version:literal(input.version,"1"),sessionId:token(input.sessionId,"sessionId"),challengeDigest:digest(input.challengeDigest),
    subjectId:subjectId(input.subjectId),nativeAccount:literal(input.nativeAccount,null),productId:literal(input.productId,"finance"),
    subjectNamespace:literal(input.subjectNamespace,"evm"),origin:literal(input.origin,FINANCE_EVM_ORIGIN),chainId:literal(input.chainId,FINANCE_EVM_CHAIN_ID),
    account:evmAccount(input.account),accountType:evmAccountType(input.accountType),scope:literal(input.scope,FINANCE_EVM_SUBJECT_SCOPE),
    deviceId:pattern(input.deviceId,"deviceId",/^[A-Za-z0-9._:-]{8,128}$/),deviceAlgorithm:literal(input.deviceAlgorithm,"p256-sha256"),
    deviceKey:deviceKey(input.deviceKey),issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")});
  if(Date.parse(v.expiresAt)<=Date.parse(v.issuedAt)||Date.parse(v.expiresAt)-Date.parse(v.issuedAt)>FINANCE_EVM_MAX_LIFETIME_MS) fail("INVALID_EXPIRY","Session lifetime invalid");
  return v;
}
// commit MUST atomically consume the challenge and persist the unique (chainId, account) subject and session.
export async function issueFinanceEvmSubjectSession(proofInput,expectedChallenge,issue,commit,at,verifyContractSignature) {
  if(typeof commit!=="function") fail("AUTHORITY_STORE_REQUIRED","Atomic subject issuance required");
  exactFields(issue,["sessionId","subjectId","expiresAt"],"Finance EVM subject issue");
  const verified=await verifyFinanceEvmSubjectLoginProof(proofInput,expectedChallenge,at,verifyContractSignature);
  const challenge=parseFinanceEvmSubjectChallenge(expectedChallenge), now=authorityTime(at);
  const session=parseFinanceEvmSubjectSession({version:"1",sessionId:issue.sessionId,challengeDigest:verified.challengeDigest,subjectId:issue.subjectId,
    nativeAccount:null,productId:"finance",subjectNamespace:"evm",origin:challenge.origin,chainId:challenge.chainId,account:challenge.account,
    accountType:challenge.accountType,scope:challenge.scope,deviceId:challenge.deviceId,deviceAlgorithm:challenge.deviceAlgorithm,
    deviceKey:challenge.deviceKey,issuedAt:new Date(now).toISOString(),expiresAt:issue.expiresAt});
  if(Date.parse(session.expiresAt)>Date.parse(challenge.expiresAt)) fail("INVALID_EXPIRY","Session extends challenge");
  if(await commit(Object.freeze({challengeDigest:verified.challengeDigest,nonce:challenge.nonce,requestId:challenge.requestId,state:challenge.state,session}))!==true) fail("REPLAY_OR_STORE_FAILURE","Challenge consumed or session store failed");
  return session;
}
function parseUnsignedHttp(input) {
  exactFields(input,HTTP,"Finance EVM HTTP proof");
  const v=Object.freeze({version:literal(input.version,"1"),sessionId:token(input.sessionId,"sessionId"),challengeDigest:digest(input.challengeDigest),
    subjectId:subjectId(input.subjectId),account:evmAccount(input.account),origin:literal(input.origin,FINANCE_EVM_ORIGIN),
    scope:literal(input.scope,FINANCE_EVM_SUBJECT_SCOPE),method:pattern(input.method,"method",/^(GET|POST)$/),target:rawTarget(input.target),
    bodyDigest:digest(input.bodyDigest),nonce:token(input.nonce,"nonce"),issuedAt:time(input.issuedAt,"issuedAt"),expiresAt:time(input.expiresAt,"expiresAt")});
  if(Date.parse(v.expiresAt)<=Date.parse(v.issuedAt)||Date.parse(v.expiresAt)-Date.parse(v.issuedAt)>FINANCE_EVM_PROOF_MAX_LIFETIME_MS) fail("INVALID_EXPIRY","HTTP proof lifetime invalid");
  return v;
}
export function financeEvmSubjectHttpMessage(input) { return "YNX_FINANCE_EVM_SUBJECT_HTTP_PROOF_V1\n"+canonicalJSON(parseUnsignedHttp(input)); }
export function parseFinanceEvmSubjectHttpProof(input) {
  exactFields(input,PROOF,"Finance EVM HTTP signed proof");
  const {deviceSignature:signed,...unsigned}=input;
  return Object.freeze({...parseUnsignedHttp(unsigned),deviceSignature:deviceSignature(signed)});
}
export function createFinanceEvmSubjectHttpProof(sessionInput,request,secret) {
  const session=parseFinanceEvmSubjectSession(sessionInput);
  exactFields(request,["method","target","bodyDigest","nonce","issuedAt","expiresAt"],"Finance EVM HTTP request");
  const unsigned=parseUnsignedHttp({version:"1",sessionId:session.sessionId,challengeDigest:session.challengeDigest,subjectId:session.subjectId,
    account:session.account,origin:session.origin,scope:session.scope,...request});
  return parseFinanceEvmSubjectHttpProof({...unsigned,deviceSignature:signDevice(financeEvmSubjectHttpMessage(unsigned),secret,session.deviceKey)});
}
export async function createFinanceEvmSubjectHttpProofWith(sessionInput,request,signer) {
  const session=parseFinanceEvmSubjectSession(sessionInput);
  exactFields(request,["method","target","bodyDigest","nonce","issuedAt","expiresAt"],"Finance EVM HTTP request");
  if(typeof signer!=="function") fail("INVALID_DEVICE","Device signer required");
  const unsigned=parseUnsignedHttp({version:"1",sessionId:session.sessionId,challengeDigest:session.challengeDigest,subjectId:session.subjectId,
    account:session.account,origin:session.origin,scope:session.scope,...request});
  const message=financeEvmSubjectHttpMessage(unsigned);
  const signature=normalizeDeviceSignature(await signer(Object.freeze({purpose:"finance-evm-subject-http",algorithm:"p256-sha256",deviceKey:session.deviceKey,payload:encodeBase64url(utf8ToBytes(message))})));
  verifyDevice(signature,message,session.deviceKey);
  return parseFinanceEvmSubjectHttpProof({...unsigned,deviceSignature:signature});
}
export function createFinanceEvmSubjectRevokeProof(session,request,secret) {
  exactFields(request,["bodyDigest","nonce","issuedAt","expiresAt"],"Finance EVM revoke request");
  return createFinanceEvmSubjectHttpProof(session,{...request,method:"POST",target:FINANCE_EVM_SUBJECT_REVOKE_TARGET},secret);
}
export async function createFinanceEvmSubjectRevokeProofWith(session,request,signer) {
  exactFields(request,["bodyDigest","nonce","issuedAt","expiresAt"],"Finance EVM revoke request");
  return createFinanceEvmSubjectHttpProofWith(session,{...request,method:"POST",target:FINANCE_EVM_SUBJECT_REVOKE_TARGET},signer);
}
function verifyHttp(proof,session,request,at) {
  if(request.origin!==session.origin||proof.origin!==session.origin) fail("ORIGIN_MISMATCH","Origin changed");
  for(const field of ["sessionId","challengeDigest","subjectId","account","scope"]) if(proof[field]!==session[field]) fail("SESSION_BINDING_MISMATCH","Session proof changed");
  for(const field of ["method","target","bodyDigest"]) if(proof[field]!==request[field]) fail("HTTP_BINDING_MISMATCH","Request changed");
  activeWindow(proof.issuedAt,proof.expiresAt,FINANCE_EVM_PROOF_MAX_LIFETIME_MS,at);
  const now=authorityTime(at);
  if(Date.parse(session.expiresAt)<=now||Date.parse(proof.issuedAt)<Date.parse(session.issuedAt)||Date.parse(proof.expiresAt)>Date.parse(session.expiresAt)) fail("SESSION_EXPIRED","Session is inactive");
  const {deviceSignature:signed,...unsigned}=proof;
  verifyDevice(signed,financeEvmSubjectHttpMessage(unsigned),session.deviceKey);
}
// consumeActiveProof MUST transactionally recheck session revocation, subject/account binding and nonce uniqueness.
// A false result denies access; the caller must return no private data.
export async function verifyAndConsumeFinanceEvmSubjectRead(proofInput,loadSession,request,consumeActiveProof,at) {
  if(typeof loadSession!=="function"||typeof consumeActiveProof!=="function") fail("AUTHORITY_STORE_REQUIRED","Authoritative active session transaction required");
  exactFields(request,["origin","method","target","bodyDigest","requiredScope","allowedTargets"],"Finance EVM read context");
  const proof=parseFinanceEvmSubjectHttpProof(proofInput),stored=await loadSession(proof.sessionId);
  if(stored==null) fail("SESSION_NOT_FOUND","Session absent");
  const session=parseFinanceEvmSubjectSession(stored);
  if(request.method!=="GET"||proof.method!=="GET"||request.requiredScope!==FINANCE_EVM_SUBJECT_SCOPE) fail("SCOPE_DENIED","Private read scope only");
  const path=rawTarget(request.target).split("?")[0];
  if(!Array.isArray(request.allowedTargets)||request.allowedTargets.length===0||request.allowedTargets.length>32||
    request.allowedTargets.some(v=>typeof v!=="string"||v.includes("?")||rawTarget(v)!==v)||!request.allowedTargets.includes(path)) fail("ROUTE_DENIED","Target not server allowlisted");
  verifyHttp(proof,session,request,at);
  if(await consumeActiveProof(Object.freeze({sessionId:session.sessionId,subjectId:session.subjectId,chainId:session.chainId,account:session.account,challengeDigest:session.challengeDigest,nonce:proof.nonce,expiresAt:proof.expiresAt,asOf:new Date(authorityTime(at)).toISOString()}))!==true) fail("REPLAY_OR_REVOKED","Proof replayed or session revoked");
  return Object.freeze({authorized:true,subjectNamespace:"evm",subjectId:session.subjectId,nativeAccount:null,account:session.account,scope:session.scope,sessionId:session.sessionId});
}
// revokeAndConsume MUST transactionally consume the nonce and mark the stored session revoked.
export async function verifyAndConsumeFinanceEvmSubjectRevoke(proofInput,loadSession,request,revokeAndConsume,at) {
  if(typeof loadSession!=="function"||typeof revokeAndConsume!=="function") fail("AUTHORITY_STORE_REQUIRED","Authoritative revocation transaction required");
  exactFields(request,["origin","method","target","bodyDigest"],"Finance EVM revoke context");
  const proof=parseFinanceEvmSubjectHttpProof(proofInput),stored=await loadSession(proof.sessionId);
  if(stored==null) fail("SESSION_NOT_FOUND","Session absent");
  const session=parseFinanceEvmSubjectSession(stored);
  if(request.method!=="POST"||proof.method!=="POST"||request.target!==FINANCE_EVM_SUBJECT_REVOKE_TARGET) fail("REVOKE_ROUTE_MISMATCH","Revoke route changed");
  verifyHttp(proof,session,request,at);
  if(await revokeAndConsume(Object.freeze({sessionId:session.sessionId,subjectId:session.subjectId,account:session.account,nonce:proof.nonce,asOf:new Date(authorityTime(at)).toISOString()}))!==true) fail("REPLAY_OR_REVOKED","Session already revoked or nonce consumed");
  return Object.freeze({revoked:true,sessionId:session.sessionId,subjectId:session.subjectId});
}
