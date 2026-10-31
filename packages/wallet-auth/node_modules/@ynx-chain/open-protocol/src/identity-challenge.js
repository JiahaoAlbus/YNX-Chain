// New OPEN v1 typed challenge schema. Encoding/decoding is DATA only.
// Auth owns authoritative time, once-only challenge state, current identity
// and verification of the actual transport channel binding.
import {encodeFields,decodeFields} from './framing.js';
export const IDENTITY_CHALLENGE_DOMAIN='YNX-OPEN/IDENTITY-CHALLENGE/1';
export const IDENTITY_AUTH_PURPOSE='YNX-OPEN/IDENTITY-AUTH/1';
const ascii=s=>new TextEncoder().encode(s);
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const fail=why=>{throw Object.assign(new Error(why),{code:'INVALID'});};
const ta=Object.getPrototypeOf(Uint8Array.prototype),len=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(ta,'buffer').get;
const originalSet=Uint8Array.prototype.set;
function bytes(value,n){let l,b;try{l=len.call(value);b=buffer.call(value);}catch{fail('bytes required');}if(!(value instanceof Uint8Array)||l!==n||typeof SharedArrayBuffer!=='undefined'&&b instanceof SharedArrayBuffer)fail('fixed bytes required');const out=new Uint8Array(n);try{originalSet.call(out,value);}catch{fail('detached bytes');}return out;}
function record(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail('plain record required');const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail('exact data fields required');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function u64(s){if(typeof s!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(s))fail('canonical uint64 required');const n=BigInt(s);if(n>0xffffffffffffffffn)fail('uint64 overflow');const out=new Uint8Array(8);new DataView(out.buffer).setBigUint64(0,n,false);return out;}
function readU64(b){bytes(b,8);return new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(0,false).toString();}
function netEncode(value){if(Object.getOwnPropertyDescriptor(value??{},'kind')?.value==='offchain'){record(value,['kind']);return encodeFields([ascii('offchain')]);}const n=record(value,['kind','genesis','nativeChainId','networkId']);if(n.kind!=='ynx-chain')fail('network tag');const genesis=bytes(n.genesis,32);if(genesis.every(v=>v===0))fail('zero genesis is not an offchain binding');return encodeFields([ascii('ynx-chain'),genesis,u64(n.nativeChainId),bytes(n.networkId,32)]);}
function netDecode(wire){if(wire.length<4)fail('network frame');const count=new DataView(wire.buffer,wire.byteOffset,wire.byteLength).getUint32(0,false);if(count===1){const f=decodeFields(wire,1);if(!same(f[0],ascii('offchain')))fail('network tag');return Object.freeze({kind:'offchain'});}const f=decodeFields(wire,4);if(!same(f[0],ascii('ynx-chain')))fail('network tag');const genesis=bytes(f[1],32);if(genesis.every(v=>v===0))fail('zero genesis');return Object.freeze({kind:'ynx-chain',genesis,nativeChainId:readU64(f[2]),networkId:bytes(f[3],32)});}
const KEYS=['realm','networkBinding','tenant','agentId','epoch','audience','channelBinding','nonce','issuedAt','expiresAt'];
export function encodeIdentityChallengeV1DATA(input){
 const c=record(input,KEYS),issued=u64(c.issuedAt),expires=u64(c.expiresAt),delta=BigInt(c.expiresAt)-BigInt(c.issuedAt);
 if(delta<=0n||delta>60000n)fail('challenge lifetime');
 return encodeFields([ascii(IDENTITY_CHALLENGE_DOMAIN),bytes(c.realm,16),netEncode(c.networkBinding),bytes(c.tenant,16),encodeFields([bytes(c.agentId,16),u64(c.epoch)]),bytes(c.audience,16),ascii(IDENTITY_AUTH_PURPOSE),bytes(c.channelBinding,32),bytes(c.nonce,32),issued,expires]);
}
export function assertIdentityChallengeV1BindingDATA(challenge,input){
 const e=record(input,['realm','networkBinding','tenant','agentId','epoch','audience','channelBinding']);
 for(const [key,n] of [['realm',16],['tenant',16],['agentId',16],['audience',16],['channelBinding',32]])if(!same(bytes(challenge[key],n),bytes(e[key],n)))fail('challenge binding mismatch');
 if(!same(u64(challenge.epoch),u64(e.epoch))||!same(netEncode(challenge.networkBinding),netEncode(e.networkBinding)))fail('challenge binding mismatch');
}
export function decodeIdentityChallengeV1DATA(wire,expected){
 const f=decodeFields(wire,11);if(!same(f[0],ascii(IDENTITY_CHALLENGE_DOMAIN))||!same(f[6],ascii(IDENTITY_AUTH_PURPOSE)))fail('challenge domain or purpose');
 const subject=decodeFields(f[4],2),c={realm:bytes(f[1],16),networkBinding:netDecode(f[2]),tenant:bytes(f[3],16),agentId:bytes(subject[0],16),epoch:readU64(subject[1]),audience:bytes(f[5],16),channelBinding:bytes(f[7],32),nonce:bytes(f[8],32),issuedAt:readU64(f[9]),expiresAt:readU64(f[10])};
 // Run the exact encoder constraints and require byte identity; never accept a
 // second representation of the same logical challenge.
 if(!same(encodeIdentityChallengeV1DATA(c),wire))fail('noncanonical challenge');if(expected!==undefined)assertIdentityChallengeV1BindingDATA(c,expected);return Object.freeze(c);
}
