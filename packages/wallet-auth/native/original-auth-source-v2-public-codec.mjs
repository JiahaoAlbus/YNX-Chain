// Extracted original Source V2 public codec. One E8 implementation; the Node
// mother re-export is applied only after its other owner's narrow CAS freeze.
// No Source capture, private key, signing, provider or new cryptography.
import {encodeFields} from '@ynx/batch-v01-candidate/browser';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {exactPQRecord} from '../src/pq-wallet-contract.js';
import {pqU64} from '../src/pq-public-bytes.js';
export const AUTH_SOURCE_DOMAIN_V2='YNX/AUTH/SOURCE-ORIGINAL/V2';
const purposes=Object.freeze({enrollment:'AUTH-SOURCE-ENROLLMENT',profile:'AUTH-SOURCE-PROFILE',current:'AUTH-SOURCE-CURRENT'});
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const sourceCanonicalV2=v=>{
 if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
 if(Number.isSafeInteger(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(sourceCanonicalV2).join(',')+']';
 if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+sourceCanonicalV2(v[k])).join(',')+'}';
 return fail('AUTH_IDENTITY_NATIVE_SOURCE_INVALID');
};
export const sourceSHA256V2=raw=>bytesToHex(sha256(typeof raw==='string'?utf8ToBytes(raw):raw));
const seal=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))seal(v);Object.freeze(x);}return x;};
export function parseOriginalSourceCanonicalV2(raw,cap=393216){
 if(typeof raw!=='string'||!raw.length||utf8ToBytes(raw).length>cap)fail('AUTH_SOURCE_V2_CAPACITY');
 let value;try{value=JSON.parse(raw);}catch{fail('AUTH_SOURCE_V2_CANONICAL');}
 if(sourceCanonicalV2(value)!==raw)fail('AUTH_SOURCE_V2_CANONICAL');return seal(value);
}
const parse=parseOriginalSourceCanonicalV2;
const exact=(v,fields)=>exactPQRecord(v,fields,'AUTH_SOURCE_V2_SCHEMA');
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x),owner=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/.test(x);
function decimal(v,nonzero=false){if(typeof v!=='string')fail('AUTH_SOURCE_V2_DECIMAL');let n;try{n=pqU64(v);}catch{fail('AUTH_SOURCE_V2_DECIMAL');}if(nonzero&&!n)fail('AUTH_SOURCE_V2_DECIMAL');return n;}
function context(v){exact(v,['networkId','owner','keyVersion','executionHeight']);if(!hex(v.networkId)||!owner(v.owner))fail('AUTH_SOURCE_V2_CONTEXT');decimal(v.keyVersion,true);decimal(v.executionHeight);return v;}
export function encodeOriginalAuthSourceStatementV2(role,frame,binding,bodyRaw){
 if(!Object.hasOwn(purposes,role)||typeof frame!=='string'||!frame.length||utf8ToBytes(frame).length>512||frame.includes('\0'))fail('AUTH_SOURCE_V2_FRAME');
 context(binding);parse(bodyRaw,65536);
 return new Uint8Array(encodeFields([AUTH_SOURCE_DOMAIN_V2,role,frame,binding.networkId,binding.owner,binding.keyVersion,binding.executionHeight,bodyRaw]));
}
