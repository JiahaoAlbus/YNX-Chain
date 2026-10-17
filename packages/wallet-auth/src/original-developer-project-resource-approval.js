import {secp256k1} from '@noble/curves/secp256k1.js';
import {sha256} from '@noble/hashes/sha2.js';
import {hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {walletIdentityFromPublicKey} from './crypto.js';
const DOMAIN='YNX_DEVELOPER_PROJECT_RESOURCE_APPROVAL_V1';
const fail=()=>{throw new WalletAuthError('DEVELOPER_PROJECT_APPROVAL_INVALID','Original project approval is unavailable');};
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
function parse(raw,cap){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>cap)fail();
 let v;try{v=JSON.parse(raw);}catch{fail();}
 if(canonicalJSON(v)!==raw)fail();return v;
}
function utc(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))fail();const n=Date.parse(v);if(!Number.isSafeInteger(n)||new Date(n).toISOString()!==v)fail();return n;}
// Signature verifies an EXPLICIT NEW-purpose approval. It does not create
// approval, current identity, project membership or deployment permission.
function validateApproval(rawApproval,rawExpected,at){
 const proof=parse(rawApproval,8192),expected=parse(rawExpected,4096);
 exactFields(proof,['version','purpose','account','accountPublicKey','deviceId','sessionBinding','productClientId','bundleId','platform','origin','projectId','projectDigest','resourceOrigin','resourceId','action','requiredScope','bodyDigest','nonce','issuedAt','expiresAt','signature'],'NEW original project resource approval');
 exactFields(expected,['account','deviceId','sessionBinding','projectId','projectDigest','resourceOrigin','resourceId','action','bodyDigest'],'Actual original project request');
 if(!(at instanceof Date)||!Number.isFinite(at.getTime()))fail();
 if(proof.version!==1||proof.purpose!=='developer-project-resource/v1'||proof.productClientId!=='ynx-developer-v1'||proof.bundleId!=='com.ynxweb4.developer.testnetpreview'||proof.platform!=='macos'||proof.origin!=='app://macos/com.ynxweb4.developer.testnetpreview')fail();
 if(typeof proof.account!=='string'||!/^[\x21-\x7e]{1,512}$/.test(proof.account)||typeof proof.deviceId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(proof.deviceId)||!hex(proof.sessionBinding)||!hex(proof.projectDigest)||!hex(proof.bodyDigest)||typeof proof.projectId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(proof.projectId)||typeof proof.resourceId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(proof.resourceId)||typeof proof.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof.nonce))fail();
 // A separate action approval for each explicit request; no wildcard project,
 // cloud files.write implication, old developer:deploy permission or paid lane.
 if(![['https://web4.ynxweb4.com','file-content-save'],['http://127.0.0.1:18111','ai-generate']].some(([o,a])=>o===proof.resourceOrigin&&a===proof.action))fail();
 if(proof.requiredScope!==(proof.action==='file-content-save'?'developer:resource:cloud-file-content':'developer:resource:ai-generation'))fail();
 for(const k of Object.keys(expected))if(proof[k]!==expected[k])fail();
 const issued=utc(proof.issuedAt),expires=utc(proof.expiresAt),now=at.getTime();
 if(issued>now||expires<=now||expires<=issued||expires-issued>30000)fail();
 if(typeof proof.accountPublicKey!=='string'||!/^(02|03)[0-9a-f]{64}$/.test(proof.accountPublicKey)||typeof proof.signature!=='string'||!/^[0-9a-f]{128}$/.test(proof.signature))fail();
 return proof;
}
export function verifyOriginalDeveloperProjectResourceApproval(rawApproval,rawExpected,at){
 const proof=validateApproval(rawApproval,rawExpected,at);
 const {signature,...signed}=proof;let ok=false;
 try{ok=walletIdentityFromPublicKey(signed.accountPublicKey)===signed.account&&secp256k1.verify(hexToBytes(signature),sha256(utf8ToBytes(DOMAIN+'\n'+canonicalJSON(signed))),hexToBytes(signed.accountPublicKey),{prehash:false,format:'compact',lowS:true});}catch{}
 if(!ok)fail();
 return Object.freeze({...proof});
}
export const ORIGINAL_DEVELOPER_PROJECT_RESOURCE_APPROVAL_DOMAIN=DOMAIN;

// Review/preimage supplier for the NORMAL explicitly approved Wallet path.
// This API does not infer membership, current authority or user consent.
export function prepareOriginalDeveloperProjectResourceReview(rawUnsigned, rawExpected, at) {
 const unsigned=parse(rawUnsigned,8192);
 exactFields(unsigned,['version','purpose','account','accountPublicKey','deviceId','sessionBinding','productClientId','bundleId','platform','origin','projectId','projectDigest','resourceOrigin','resourceId','action','requiredScope','bodyDigest','nonce','issuedAt','expiresAt'],'NEW original unsigned project resource approval');
 const proof=validateApproval(canonicalJSON({...unsigned,signature:'0'.repeat(128)}),rawExpected,at);
 const {signature,...captured}=proof;
 const signBytes=DOMAIN+'\n'+canonicalJSON(captured);
 const digest=sha256(utf8ToBytes(signBytes));
 const digestHex=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
 return Object.freeze({unsigned:canonicalJSON(captured),expected:rawExpected,signBytes,digest:digestHex,account:captured.account,deviceId:captured.deviceId,sessionBinding:captured.sessionBinding,projectId:captured.projectId,resourceOrigin:captured.resourceOrigin,resourceId:captured.resourceId,action:captured.action,requiredScope:captured.requiredScope,expiresAt:captured.expiresAt});
}
// Signing primitive only. The actual Wallet caller must finish visible review
// and guard its own existing key-access/current lease before calling this API.
// A matching digest is an intent comparison, never proof of that approval.
export async function signReviewedOriginalDeveloperProjectResourceApproval(rawUnsigned,rawExpected,reviewedDigest,signDigest,now) {
 if(typeof signDigest!=='function'||typeof now!=='function')fail();
 const before=now();if(!(before instanceof Date)||!Number.isFinite(before.getTime()))fail();
 const beforeMs=before.getTime();
 const review=prepareOriginalDeveloperProjectResourceReview(rawUnsigned,rawExpected,new Date(beforeMs));
 if(review.digest!==reviewedDigest)fail();
 // Give the signer a fresh owned buffer; do not release or import a key here.
 const signature=await signDigest(hexToBytes(review.digest));
 if(typeof signature!=='string'||!/^[0-9a-f]{128}$/.test(signature))fail();
 const after=now();if(!(after instanceof Date)||!Number.isFinite(after.getTime())||after.getTime()<beforeMs)fail();
 const proof=canonicalJSON({...JSON.parse(review.unsigned),signature});
 const verified=verifyOriginalDeveloperProjectResourceApproval(proof,review.expected,new Date(after.getTime()));
 return Object.freeze({approval:proof,reviewDigest:review.digest,proof:verified});
}
