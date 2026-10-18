import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {normalizePQNativeAction,encodePQNativeAction,decodePQNativeAction,encodePQNativeActionPayload,decodePQNativeActionPayload} from '../src/pq-native-action.js';
const fixtures=JSON.parse(readFileSync(new URL('../testdata/pq-native-action-vectors.json',import.meta.url)));
test('all frozen Go action/contract/staking public vectors match exact bytes, SHA and full-width typed roundtrip',()=>{for(const v of fixtures.vectors){const wire=Buffer.from(encodePQNativeAction(v.input));assert.equal(wire.length,v.bytes,v.kind);assert.equal(createHash('sha256').update(wire).digest('hex'),v.sha256,v.kind);if(v.wireHex)assert.equal(wire.toString('hex'),v.wireHex);const normalized=normalizePQNativeAction(v.input),decoded=decodePQNativeAction(wire);assert.deepEqual(decoded,normalized);assert(Object.isFrozen(decoded));assert(Object.isFrozen(decoded.payload));const payload=encodePQNativeActionPayload(v.input.kind,v.input.payload);assert.deepEqual(decodePQNativeActionPayload(v.input.kind,payload),normalized.payload);if(v.payloadHex)assert.equal(Buffer.from(payload).toString('hex'),v.payloadHex);wire.fill(0);assert.deepEqual(decoded,normalized);}});
import {encodeFields,u32} from '@ynx/batch-v01-candidate';
const base=()=>structuredClone(fixtures.vectors[0].input);
function parts(w){const b=Buffer.from(w);let at=4;return Array.from({length:b.readUInt32BE(0)},()=>{const n=b.readUInt32BE(at);at+=4;const p=b.subarray(at,at+n);at+=n;return Buffer.from(p);});}
test('full U64 words, integer width, framing, exact ownership and fees cannot silently change',()=>{
 const input=base(),wire=Buffer.from(encodePQNativeAction(input));assert.equal(decodePQNativeAction(wire).nonce,'18446744073709551615');
 for(const patch of [{nonce:0n},{nonce:18446744073709551616n},{fee:1n<<63n},{nativeChainId:0n},{nativeChainId:1n<<63n},{nonce:1},{fee:'01'},{kind:'Stake'},{owner:input.owner.toUpperCase()},{chainId:'ab'.repeat(31)},{payload:{amount:0n}},{payload:{amount:1n<<63n}},{payload:{amount:1,extra:true}}])assert.throws(()=>encodePQNativeAction({...input,...patch}));
 for(const i of [1,3,4,6,7,8,9])for(const width of [0,1,3,5,8]){const f=parts(wire);f[i]=Buffer.alloc(width);assert.throws(()=>decodePQNativeAction(encodeFields(f)));}
 for(const invalid of [wire.subarray(0,3),wire.subarray(0,-1),Buffer.concat([wire,Buffer.of(0)]),Buffer.alloc(8193)])assert.throws(()=>decodePQNativeAction(invalid));
 let called=false;assert.throws(()=>normalizePQNativeAction({...input,get payload(){called=true;return {amount:'1'};}}));assert.equal(called,false);
 assert.throws(()=>normalizePQNativeAction(new Proxy(input,{})));assert.throws(()=>normalizePQNativeAction({...input,payload:new Proxy({amount:'1'},{})}));
 for(const v of fixtures.vectors.filter(v=>v.input.kind.startsWith('stake_')||v.input.kind.startsWith('contract_')))assert.throws(()=>encodePQNativeAction({...v.input,fee:'7'}));
 for(const v of fixtures.vectors.filter(v=>v.input.kind.startsWith('resource_')))assert.throws(()=>encodePQNativeAction({...v.input,owner:'0x'+'99'.repeat(20)}));
 for(const kind of ['stake_delegate','stake_unbond','stake_withdraw']){const v=fixtures.vectors.find(v=>v.kind===kind);const p=Buffer.from(encodePQNativeActionPayload(kind,v.input.payload));for(const invalid of [p.subarray(0,-1),Buffer.concat([p,Buffer.of(0)]),encodeFields([...parts(p),Buffer.of(1)])])assert.throws(()=>decodePQNativeActionPayload(kind,invalid));}
});
test('Go Unicode spaces/controls, opaque validators, UTF8 and RFC3339Nano semantics remain exact',()=>{
 const kind='stake_delegate',p=v=>({validator:v,amountYNXT:'1'});
 for(const s of ['v','验证者_0','x y','\ufeffv','v\ufeff','界'.repeat(42)+'ab'])assert.equal(decodePQNativeActionPayload(kind,encodePQNativeActionPayload(kind,p(s))).validator,s);
 for(const s of [' v','v ','v\u0085','\u0085v','v\u00a0','v\n','v\u007f','v\ud800','界'.repeat(43)])assert.throws(()=>encodePQNativeActionPayload(kind,p(s)));
 assert.throws(()=>decodePQNativeActionPayload(kind,encodeFields([Buffer.of(0xff),u32(0),u32(1)])));
 const rental=fixtures.vectors.find(v=>v.kind==='resource_rental_create').input.payload;
 for(const date of ['2000-02-29T23:59:59.000000001Z','9999-12-31T23:59:59.999999999Z','0001-01-01T00:00:00.000000001Z'])assert.equal(decodePQNativeActionPayload('resource_rental_create',encodePQNativeActionPayload('resource_rental_create',{...rental,quoteExpiresAt:date})).quoteExpiresAt,date);
 for(const date of ['1900-02-29T00:00:00Z','2000-02-30T00:00:00Z','0000-01-01T00:00:00Z','0001-01-01T00:00:00Z','2030-01-02T03:04:05.10Z','2030-01-02T03:04:05.1234567890Z','2030-01-02T03:04:05+00:00','2030-01-02T03:04:60Z'])assert.throws(()=>encodePQNativeActionPayload('resource_rental_create',{...rental,quoteExpiresAt:date}));
 for(const provider of ['x y','x\u0085y','x\u00a0y'])assert.throws(()=>encodePQNativeActionPayload('resource_rental_create',{...rental,provider}));
 assert.equal(decodePQNativeActionPayload('resource_rental_create',encodePQNativeActionPayload('resource_rental_create',{...rental,provider:'x\ufeffy'})).provider,'x\ufeffy');
});
test('full constructor U64 survives; contract identity, exact calldata, ordinary bounded bytes enforced',()=>{
 const v=fixtures.vectors.find(v=>v.kind==='contract_deploy').input;
 for(const n of [0n,1n,1n<<53n,1n<<63n,(1n<<64n)-1n]){const out=decodePQNativeAction(encodePQNativeAction({...v,payload:{...v.payload,constructorArgs:[n]}}));assert.equal(out.payload.constructorArgs[0],n.toString());assert(Object.isFrozen(out.payload.constructorArgs));}
 let called=false;const array=[];Object.defineProperty(array,'0',{get(){called=true;return 1n;}});assert.throws(()=>encodePQNativeAction({...v,payload:{...v.payload,constructorArgs:array}}));assert.equal(called,false);
 for(const args of [[],['1','2'],[1],['18446744073709551616']])assert.throws(()=>encodePQNativeAction({...v,payload:{...v.payload,constructorArgs:args}}));
 for(const patch of [{value:'1'},{sourceHash:'AB'.repeat(32)},{name:'other'}])assert.throws(()=>encodePQNativeAction({...v,payload:{...v.payload,...patch}}));
 const execution=fixtures.vectors.find(v=>v.kind==='contract_execute').input;
 for(const patch of [{target:'0x'+'0'.repeat(40)},{calldata:execution.payload.calldata+'00'},{calldata:execution.payload.calldata.toUpperCase()}])assert.throws(()=>encodePQNativeAction({...execution,payload:{...execution.payload,...patch}}));
 const wire=encodePQNativeAction(base());const accessor=new Uint8Array(wire);let accessed=false;Object.defineProperty(accessor,'buffer',{get(){accessed=true;return wire.buffer;}});assert.throws(()=>decodePQNativeAction(accessor));assert.equal(accessed,false);const shared=new Uint8Array(new SharedArrayBuffer(wire.length));shared.set(wire);assert.throws(()=>decodePQNativeAction(shared));
 const resizable=new Uint8Array(new ArrayBuffer(wire.length,{maxByteLength:wire.length+1}));resizable.set(wire);assert.throws(()=>decodePQNativeAction(resizable));
 const detached=new Uint8Array(wire);structuredClone(detached.buffer,{transfer:[detached.buffer]});assert.throws(()=>decodePQNativeAction(detached));
});
