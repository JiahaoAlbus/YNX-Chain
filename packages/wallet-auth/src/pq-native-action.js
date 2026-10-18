// Exact public signing DATA codec. No quote, code identity, policy, signature,
// permission, balance or execution is authenticated by parsing this object.
import {Buffer} from 'node:buffer';
import {types} from 'node:util';
import {encodeFields,u32} from '@ynx/batch-v01-candidate';
import {pqU64,pqCanonicalAddress,pqHex} from './pq-wallet-authorization.js';
import {exactPQRecord,pqError} from './pq-wallet-contract.js';
export const PQ_NATIVE_ACTION_DOMAIN='YNX-NATIVE-ACTION/v1';
export const PQ_NATIVE_ACTION_MAX_BYTES=8192;
export const PQ_NATIVE_ACTION_MAX_PAYLOAD_BYTES=4096;
const MAX=(1n<<63n)-1n;
const bad=()=>{throw pqError('PQ_NATIVE_ACTION_INVALID');};
// Go unicode.IsSpace (White_Space), deliberately not JS trim / FEFF.
const space=/[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const edge=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
function string(value){if(typeof value!=='string'||!value.isWellFormed())bad();return value;}
function text(v,min,max){string(v);const n=Buffer.byteLength(v);if(n<min||n>max||edge.test(v)||/[\u0000-\u001f\u007f-\u009f]/u.test(v))bad();return v;}
function hex(v,n){string(v);if(v.length!==n||!/^[0-9a-f]+$/.test(v))bad();return v;}
function uint(v,positive=false,max=MAX){const n=pqU64(v);if(n>max||positive&&n===0n)bad();return n.toString();}
const addr=v=>{string(v);return pqCanonicalAddress(v);};
const custom=v=>{string(v);if(!/^[a-z][a-z0-9-]{2,31}$/.test(v))bad();return v;};
const asset=v=>v==='YNXT'?v:custom(v);
const pool=v=>{string(v);if(!/^dex_[a-z0-9][a-z0-9_-]{2,59}$/.test(v))bad();return v;};
const resource=v=>{text(v,1,128);if(space.test(v))bad();return v;};
function expiry(v){
 string(v);const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.([0-9]{1,9}))?Z$/.exec(v);if(!m||m[7]?.endsWith('0'))bad();
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(y<1||mo<1||mo>12||d<1||d>days[mo-1]||h>23||mi>59||s>59||y===1&&mo===1&&d===1&&h===0&&mi===0&&s===0&&!m[7])bad();return v;
}
const decimal=v=>{if(!Number.isInteger(v)||v<0||v>18)bad();return v;};
const bps=v=>{if(!Number.isInteger(v)||v<1||v>1000)bad();return v;};
const name=v=>{if(!['SampleEVMWriteCounter','SampleYNXTCompatibleERC20'].includes(v))bad();return v;};
const target=v=>{addr(v);if(v==='0x'+'0'.repeat(40))bad();return v;};
const zero=v=>{if(pqU64(v)!==0n)bad();return '0';};
const args=v=>{
 if(!Array.isArray(v)||types.isProxy(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length!==1)bad();
 const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==2||!ds[0]||!Object.hasOwn(ds[0],'value'))bad();return Object.freeze([uint(ds[0].value,false,(1n<<64n)-1n)]);
};
const definitions={
 stake:[['amount','p']],
 resource_delegation_create:[['provider','a'],['beneficiary','r'],['amountYNXT','p'],['policyHash','h'],['idempotencyKey','i'],['requestHash','h']],
 resource_rental_create:[['address','a'],['provider','r'],['bandwidth','n'],['compute','n'],['aiCredits','n'],['trustCredits','n'],['quoteID','id'],['quoteExpiresAt','e'],['policyHash','h'],['maxPriceYNXT','p'],['idempotencyKey','i'],['requestHash','h']],
 dex_asset_create:[['assetID','c'],['symbol','s'],['name','t'],['decimals','d'],['maxSupply','n'],['initialSupply','p']],
 dex_asset_mint:[['assetID','c'],['amount','p']],dex_asset_transfer:[['assetID','c'],['recipient','a'],['amount','p']],
 dex_pool_create:[['poolID','o'],['asset0','q'],['asset1','q'],['feeBps','b']],
 dex_liquidity_add:[['poolID','o'],['amount0','p'],['amount1','p'],['minShares','p'],['deadlineUnix','p']],
 dex_liquidity_remove:[['poolID','o'],['shares','p'],['minAmount0','n'],['minAmount1','n'],['deadlineUnix','p']],
 dex_swap_exact_input:[['poolID','o'],['assetIn','q'],['amountIn','p'],['minAmountOut','p'],['deadlineUnix','p']],
 dex_swap_exact_output:[['poolID','o'],['assetOut','q'],['amountOut','p'],['maxAmountIn','p'],['deadlineUnix','p']],
 contract_deploy:[['name','cn'],['sourceHash','h'],['deployedBytecodeHash','h'],['compilerConfigHash','h'],['constructorArgs','args'],['value','z']],
 contract_execute:[['name','cn'],['target','target'],['sourceHash','h'],['deployedBytecodeHash','h'],['compilerConfigHash','h'],['expectedStorageCommitment','h'],['calldata','data'],['value','z']],
 stake_delegate:[['validator','v'],['amountYNXT','p']],stake_unbond:[['delegationID','id'],['amountYNXT','p']],stake_withdraw:[['unbondingID','id']],
};
function definition(kind){if(typeof kind!=='string'||!Object.hasOwn(definitions,kind))bad();return definitions[kind];}
function normalizePayload(kind,input){
 const def=definition(kind);if(types.isProxy(input))bad();exactPQRecord(input,def.map(([k])=>k));const out={};
 for(const [key,type]of def){const v=input[key];out[key]=type==='p'?uint(v,true):type==='n'?uint(v):type==='z'?zero(v):type==='a'?addr(v):type==='h'?hex(v,64):type==='id'?hex(v,24):type==='r'?resource(v):type==='i'?text(v,3,128):type==='e'?expiry(v):type==='c'?custom(v):type==='q'?asset(v):type==='o'?pool(v):type==='d'?decimal(v):type==='b'?bps(v):type==='cn'?name(v):type==='target'?target(v):type==='args'?args(v):type==='v'?text(v,1,128):type==='t'?text(v,1,80):type==='s'?(()=>{string(v);if(!/^[A-Z][A-Z0-9]{1,11}$/.test(v))bad();return v;})():string(v);}
 if(kind==='resource_rental_create'&&['bandwidth','compute','aiCredits','trustCredits'].every(k=>out[k]==='0'))bad();
 if(kind==='dex_asset_create'&&BigInt(out.maxSupply)<BigInt(out.initialSupply))bad();
 if(kind==='dex_pool_create'&&out.asset0>=out.asset1)bad();
 if(kind==='contract_execute'){
 const data=out.calldata;if(out.name==='SampleEVMWriteCounter'?!/^0x7cf5dab0[0-9a-f]{64}$/.test(data):!/^0xa9059cbb0{24}[0-9a-f]{104}$/.test(data))bad();
 }
 return Object.freeze(out);
}
function pair(v){const n=BigInt(v);return [u32(Number(n>>32n)),u32(Number(n&0xffffffffn))];}
function payloadBytes(kind,p){const f=[];for(const [k,t]of definition(kind)){if(['p','n','z'].includes(t))f.push(...pair(p[k]));else if(['d','b'].includes(t))f.push(u32(p[k]));else if(t==='args')f.push(u32(1),...pair(p[k][0]));else f.push(Buffer.from(p[k]));}const wire=encodeFields(f);if(wire.length>4096)bad();return wire;}
export function encodePQNativeActionPayload(kind,payload){return new Uint8Array(payloadBytes(kind,normalizePayload(kind,payload)));}
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype),bufferGetter=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get,lengthGetter=Object.getOwnPropertyDescriptor(typedArrayPrototype,'length').get,offsetGetter=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
function bytes(value,max){
 if(!types.isUint8Array(value)||types.isProxy(value))bad();
 const buffer=bufferGetter.call(value),length=lengthGetter.call(value),offset=offsetGetter.call(value);
 if(buffer instanceof SharedArrayBuffer||buffer.resizable||buffer.detached||!length||length>max)bad();
 const descriptors=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!/^\d+$/.test(k)||!Object.hasOwn(descriptors[k],'value')))bad();
 return Buffer.from(new Uint8Array(buffer,offset,length));
}
function fields(wire,count,max){const b=bytes(wire,max);if(b.length<4||b.readUInt32BE(0)!==count)bad();let at=4;const out=[];for(let i=0;i<count;i++){if(at+4>b.length)bad();const n=b.readUInt32BE(at);at+=4;if(n>b.length-at)bad();out.push(b.subarray(at,at+n));at+=n;}if(at!==b.length)bad();return out;}
const read32=f=>{if(!f||f.length!==4)bad();return f.readUInt32BE(0);};
const readText=f=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(f);}catch{bad();}};
export function decodePQNativeActionPayload(kind,wire){
 const def=definition(kind),count=def.reduce((n,[,t])=>n+(['p','n','z'].includes(t)?2:t==='args'?3:1),0),f=fields(wire,count,4096);let i=0;const input={},read64=()=>((BigInt(read32(f[i++]))<<32n)|BigInt(read32(f[i++]))).toString();
 for(const [k,t]of def){if(['p','n','z'].includes(t))input[k]=read64();else if(['d','b'].includes(t))input[k]=read32(f[i++]);else if(t==='args'){if(read32(f[i++])!==1)bad();input[k]=[read64()];}else input[k]=readText(f[i++]);}
 const normalized=normalizePayload(kind,input);if(!Buffer.from(payloadBytes(kind,normalized)).equals(bytes(wire,4096)))bad();return normalized;
}
export function normalizePQNativeAction(input){
 if(types.isProxy(input))bad();exactPQRecord(input,['chainId','nativeChainId','owner','nonce','fee','kind','payload']);
 const out={chainId:pqHex(input.chainId,32).toString('hex'),nativeChainId:uint(input.nativeChainId,true),owner:addr(input.owner),nonce:uint(input.nonce,true,(1n<<64n)-1n),fee:uint(input.fee),kind:input.kind,payload:normalizePayload(input.kind,input.payload)};
 if(out.kind==='resource_delegation_create'&&out.payload.provider!==out.owner||out.kind==='resource_rental_create'&&out.payload.address!==out.owner)bad();
 const required=out.kind==='contract_deploy'?'10':out.kind==='contract_execute'?'2':out.kind.startsWith('stake_')?'1':null;if(required!==null&&out.fee!==required)bad();
 return Object.freeze(out);
}
export function encodePQNativeAction(input){const p=normalizePQNativeAction(input),wire=encodeFields([PQ_NATIVE_ACTION_DOMAIN,u32(1),Buffer.from(p.chainId,'hex'),...pair(p.nativeChainId),p.owner,...pair(p.nonce),...pair(p.fee),p.kind,payloadBytes(p.kind,p.payload)]);if(wire.length>8192)bad();return new Uint8Array(wire);}
export function decodePQNativeAction(wire){const f=fields(wire,12,8192);if(readText(f[0])!==PQ_NATIVE_ACTION_DOMAIN||read32(f[1])!==1||f[2].length!==32)bad();const read64=i=>((BigInt(read32(f[i]))<<32n)|BigInt(read32(f[i+1]))).toString(),kind=readText(f[10]);const out=normalizePQNativeAction({chainId:f[2].toString('hex'),nativeChainId:read64(3),owner:readText(f[5]),nonce:read64(6),fee:read64(8),kind,payload:decodePQNativeActionPayload(kind,f[11])});if(!Buffer.from(encodePQNativeAction(out)).equals(bytes(wire,8192)))bad();return out;}
