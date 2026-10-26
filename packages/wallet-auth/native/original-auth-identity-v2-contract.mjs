// Canonical Auth v2 REQUEST DATA, not a Root, trusted registration, signature
// verifier, native grant, signing owner or replacement account/session system.
// Crypto is the sole shared @ynx/batch consumer; product authority is still the
// original admitted Native Source. Never accept a chain proof as a role grant.
import {encodeFields} from '@ynx/batch-v01-candidate';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {exactPQRecord,pqDecodeBase64url} from '../src/pq-wallet-contract.js';
import {pqU64} from '../src/pq-wallet-authorization.js';
export const AUTH_IDENTITY_V2='YNX-AUTH-IDENTITY/v2';
export const AUTH_IDENTITY_REQUEST_DOMAIN='YNX/AUTH/IDENTITY-REQUEST/V2';
export const AUTH_IDENTITY_ALGORITHM='YNX-BATCH/v0.1';
export const AUTH_IDENTITY_PURPOSES=Object.freeze({
 receive:'AUTH-IDENTITY-RECEIVE',recover:'AUTH-IDENTITY-RECOVER',
 keyCall:'AUTH-PROTECTED-KEY-CALL',login:'AUTH-LOGIN',
});
const fields=['version','algorithmVersion','networkId','owner','keyVersion',
 'executionHeight','principalId','productId','applicationId','deviceId',
 'requestId','purpose','requestDigest','credentialDigest','nonce','issuedAtMs','expiresAtMs'];
const deny=code=>{throw Object.assign(new Error(code),{code});};
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const text=(x,max)=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=max&&/^[\x21-\x7e]+$/.test(x);
function decimal(value,positive=false){
 if(typeof value!=='string')deny('AUTH_IDENTITY_V2_DECIMAL');
 let n;try{n=pqU64(value);}catch{deny('AUTH_IDENTITY_V2_DECIMAL');}
 if(positive&&n===0n)deny('AUTH_IDENTITY_V2_DECIMAL');return n;
}
function checked(value){
 exactPQRecord(value,fields,'AUTH_IDENTITY_V2_SCHEMA');
 if(value.version!==AUTH_IDENTITY_V2||value.algorithmVersion!==AUTH_IDENTITY_ALGORITHM||
  !hex(value.networkId)||!/^0x[0-9a-f]{40}$/.test(value.owner)||
  !text(value.principalId,512)||value.productId!=='developer'||
  !text(value.applicationId,512)||!text(value.deviceId,512)||!text(value.requestId,128)||
  !Object.values(AUTH_IDENTITY_PURPOSES).includes(value.purpose)||
  !hex(value.requestDigest)||!hex(value.credentialDigest))deny('AUTH_IDENTITY_V2_BINDING');
 decimal(value.keyVersion,true);decimal(value.executionHeight);
 let nonce;try{nonce=pqDecodeBase64url(value.nonce,{exact:32,max:32});}catch{deny('AUTH_IDENTITY_V2_NONCE');}
 if(nonce.every(x=>x===0))deny('AUTH_IDENTITY_V2_NONCE');
 const issued=decimal(value.issuedAtMs),expires=decimal(value.expiresAtMs);
 if(issued>BigInt(Number.MAX_SAFE_INTEGER)||expires>BigInt(Number.MAX_SAFE_INTEGER)||expires<=issued||expires-issued>30000n)deny('AUTH_IDENTITY_V2_WINDOW');
 return Object.freeze(Object.fromEntries(fields.map(k=>[k,value[k]])));
}
export function parseOriginalAuthIdentityRequest(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)deny('AUTH_IDENTITY_V2_CAPACITY');
 let body;try{body=JSON.parse(raw);}catch{deny('AUTH_IDENTITY_V2_CANONICAL');}
 body=checked(body);if(canonical(body)!==raw)deny('AUTH_IDENTITY_V2_CANONICAL');return body;
}
export function canonicalOriginalAuthIdentityRequest(value){return canonical(checked(value));}
export function encodeOriginalAuthIdentityRequest(value){
 // E is the original shared batch codec, not a parallel framing algorithm.
 // N=1 member message must equal these EXACT bytes. Auth Purpose in the
 // certificate must separately equal body.purpose; TX-BATCH is never accepted.
 const body=checked(value);return new Uint8Array(encodeFields([AUTH_IDENTITY_REQUEST_DOMAIN,canonical(body)]));
}
export function inspectOriginalAuthIdentityRequest(raw,expectedRaw,purpose,atMs){
 const body=parseOriginalAuthIdentityRequest(raw),expected=parseOriginalAuthIdentityRequest(expectedRaw);
 if(!Object.values(AUTH_IDENTITY_PURPOSES).includes(purpose)||body.purpose!==purpose||expected.purpose!==purpose)deny('AUTH_IDENTITY_V2_PURPOSE');
 if(raw!==expectedRaw)deny('AUTH_IDENTITY_V2_REQUEST_MISMATCH');
 const at=decimal(atMs);
 if(at<decimal(body.issuedAtMs)||at>=decimal(body.expiresAtMs))deny('AUTH_IDENTITY_V2_EXPIRED');
 return Object.freeze({body,requestOriginalDigest:sha(raw),dataOnly:true,authorized:false});
}
export function inspectOriginalAuthIdentityContinuity(originalRaw,recoveredRaw){
 const original=parseOriginalAuthIdentityRequest(originalRaw),recovered=parseOriginalAuthIdentityRequest(recoveredRaw);
 if(recovered.purpose!==AUTH_IDENTITY_PURPOSES.recover)deny('AUTH_IDENTITY_V2_PURPOSE');
 // The real current registered full pair and keyVersion must ALSO match in
 // the sole SDK recovery consumer. This is original identity matching only:
 // it never rebuilds accounts, remaps ownership, edits roles or clears history.
 for(const k of ['networkId','owner','principalId','productId','applicationId','deviceId'])
  if(original[k]!==recovered[k])deny('AUTH_IDENTITY_V2_IDENTITY_CHANGED');
 return Object.freeze({principalId:original.principalId,owner:original.owner,dataOnly:true,authorized:false});
}
