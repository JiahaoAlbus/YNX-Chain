import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{encodeShopOrderReadInputDATA,decodeShopOrderReadInputDATA,bindShopOrderReadInputDATA,shopOrderReadToolDescriptorDATA,shopOrderReadInputSchemaDATA}from'../src/shop-order-read.js';
const te=new TextEncoder(),dto={orderId:'PUBLIC-order',fields:['currency','status','totalYNXT'],snapshot:'12'.repeat(64)};
const hash=(algo,b)=>createHash(algo).update(b).digest('hex');
test('exact P07 selection schema/tool descriptor bytes, original input hash and canonical producer',async()=>{
 const schema=await readFile(new URL('../schema/shop-order-read-input.schema.json',import.meta.url));assert.deepEqual(Buffer.from(shopOrderReadInputSchemaDATA()),schema);const tool=shopOrderReadToolDescriptorDATA();assert.deepEqual(tool,{id:'shop.order.read',version:'1',operation:'shop.order.read',purpose:'read-selected-shop-order',risk:'read',schema:{bytes:String(schema.length),sha3_512:hash('sha3-512',schema),sha512:hash('sha512',schema)}});
 const input=encodeShopOrderReadInputDATA(dto);assert.deepEqual(decodeShopOrderReadInputDATA(input),dto);
 const reordered=te.encode(JSON.stringify({snapshot:dto.snapshot,fields:dto.fields,orderId:dto.orderId},null,2));assert.deepEqual(decodeShopOrderReadInputDATA(reordered),dto);assert.notDeepEqual(bindShopOrderReadInputDATA(input),bindShopOrderReadInputDATA(reordered));
});
test('strict duplicate/trailing/unknown JSON and allowlist denial',()=>{
 const raw=new TextDecoder().decode(encodeShopOrderReadInputDATA(dto));
 for(const s of [raw.replace('"orderId":','"orderId":"other","orderId":'),raw.slice(0,-1)+',"approved":true}',raw.slice(0,-1)+',"grant":{}}',raw+' {}',raw.replace('["currency","status","totalYNXT"]','["status","currency"]'),raw.replace('"currency"','"address"'),raw.replace('PUBLIC-order','\\ud800'),raw.slice(0,-1)+',}',raw.replace('"currency","status","totalYNXT"','"currency","currency"')])assert.throws(()=>decodeShopOrderReadInputDATA(te.encode(s)));
 assert.throws(()=>encodeShopOrderReadInputDATA({...dto,approved:true}));assert.throws(()=>encodeShopOrderReadInputDATA({...dto,fields:['*']}));
});
test('input bytes and DTO capture bypass no user iterator/buffer/getter/Proxy',()=>{
 let calls=0;const input=encodeShopOrderReadInputDATA(dto);Object.defineProperty(input,'buffer',{get(){calls++;throw Error('buffer')}});input[Symbol.iterator]=()=>{calls++;throw Error('iter')};assert.deepEqual(decodeShopOrderReadInputDATA(input),dto);assert.equal(calls,0);
 const d={...dto};Object.defineProperty(d,'orderId',{get(){calls++;throw Error('getter')}});assert.throws(()=>encodeShopOrderReadInputDATA(d));assert.equal(calls,0);
 assert.throws(()=>decodeShopOrderReadInputDATA(new Proxy(input,{})));const sab=new Uint8Array(new SharedArrayBuffer(20));Object.defineProperty(sab,'buffer',{value:new ArrayBuffer(20)});assert.throws(()=>decodeShopOrderReadInputDATA(sab));
});
test('shared Go/TS input vectors preserve unicode and exact pre-sign serialization',async()=>{
 const v=JSON.parse(await readFile(new URL('./fixtures/shop-order-read-input.json',import.meta.url),'utf8'));
 assert.deepEqual(shopOrderReadToolDescriptorDATA(),v.tool);
 for(const row of v.vectors){const raw=encodeShopOrderReadInputDATA(row.input);assert.equal(Buffer.from(raw).toString('hex'),row.originalHex);assert.deepEqual(bindShopOrderReadInputDATA(raw),row.binding);assert.deepEqual(decodeShopOrderReadInputDATA(raw),row.input)}
 const detached=encodeShopOrderReadInputDATA(dto);structuredClone(detached,{transfer:[detached.buffer]});assert.throws(()=>decodeShopOrderReadInputDATA(detached));
 assert.throws(()=>decodeShopOrderReadInputDATA(new Uint8Array(32769)));assert.throws(()=>decodeShopOrderReadInputDATA(new Uint8Array([0xc0,0x80])));
});

import{encodeShopOrderReadBindingDATA,decodeShopOrderReadBindingDATA,encodeShopOrderReadProofDATA,decodeShopOrderReadProofDATA}from'../src/shop-order-read.js';
import{encodeFields,decodeFields}from'../src/framing.js';
const ref=(kind,id)=>({realm:'PUBLIC-realm',tenant:'PUBLIC-tenant',kind,id,rev:'1'});
const target={service:'shop',tenant:'PUBLIC-tenant',origin:'https://shop.example.invalid',path:'/api/tools/shop.order.read',region:'PUBLIC-region',operation:'shop.order.read'};
const expected={target,orderKind:'order'};
function bindingFixture(){const input=encodeShopOrderReadInputDATA(dto),r=ref('order',dto.orderId);const binding={realm:'PUBLIC-realm',tenant:'PUBLIC-tenant',account:'PUBLIC-account',audience:'shop',grantId:'11'.repeat(16),grantRevision:'1',task:ref('task','PUBLIC-task'),generation:'2',stepId:'PUBLIC-step',holder:ref('agent','PUBLIC-agent'),holderEpoch:'3',sessionId:'PUBLIC-session',sessionEpoch:'4',channelBinding:'PUBLIC-original-channel',tool:shopOrderReadToolDescriptorDATA(),input:bindShopOrderReadInputDATA(input),fields:dto.fields,target,resources:[r],sources:[{ref:{...r},fields:dto.fields,label:'TENANT',binding:{bytes:'0',sha3_512:hash('sha3-512',new Uint8Array()),sha512:hash('sha512',new Uint8Array())}}],egressActual:null};return{binding,input}}
test('normal selected Binding E21 and opaque Proof E3 consumption stays DATA only',()=>{
 const {binding,input}=bindingFixture(),wire=encodeShopOrderReadBindingDATA(binding,input,expected),out=decodeShopOrderReadBindingDATA(wire,input,expected);assert.deepEqual(out,binding);assert.equal(decodeFields(wire,21).length,21);assert.equal('verified' in out,false);
 const raw={purpose:'PUBLIC-OPAQUE-PROOF',payload:new Uint8Array([0,1,255]),wire:new Uint8Array([254,0,42])},proof=encodeShopOrderReadProofDATA(raw,raw.purpose),decoded=decodeShopOrderReadProofDATA(proof,raw.purpose);assert.deepEqual(decoded,raw);raw.payload.fill(5);assert.equal(decoded.payload[0],0);assert.throws(()=>decodeShopOrderReadProofDATA(proof,'OTHER-PURPOSE'));assert.throws(()=>encodeShopOrderReadProofDATA({approved:true},'PUBLIC-OPAQUE-PROOF'));assert.throws(()=>encodeShopOrderReadProofDATA({...raw,wire:{}},raw.purpose));
});
test('Binding rejects target/schema/revision/input/source/field scope changes without inventing authority',()=>{
 const {binding,input}=bindingFixture();const mutations=[b=>b.tenant='other',b=>b.holder.kind='human',b=>b.task.tenant='other',b=>b.tool.version='2',b=>b.tool.schema.bytes='1',b=>b.target.path='/api/tools/other',b=>b.target.tenant='other',b=>b.fields=['status'],b=>b.sources[0].ref.rev='2',b=>b.sources[0].fields=['status'],b=>b.resources[0].id='another-order',b=>b.input.sha512='00'.repeat(64),b=>b.generation='02',b=>b.sessionEpoch='18446744073709551616',b=>b.egressActual=b.input,b=>b.approved=true];
 for(const mutate of mutations){const b=structuredClone(binding);mutate(b);assert.throws(()=>encodeShopOrderReadBindingDATA(b,input,expected));}
 const wire=encodeShopOrderReadBindingDATA(binding,input,expected);assert.throws(()=>decodeShopOrderReadBindingDATA(new Uint8Array([...wire,0]),input,expected));assert.throws(()=>decodeShopOrderReadBindingDATA(wire,new Uint8Array([...input,32]),expected));assert.throws(()=>decodeShopOrderReadBindingDATA(wire,input,{target:{...target,origin:'https://other.invalid'},orderKind:'order'}));
 const f=[...decodeFields(wire,21)];f[20]=encodeFields([new Uint8Array([1])]);assert.throws(()=>decodeShopOrderReadBindingDATA(encodeFields(f),input,expected));
});
test('nested proof and binding capture does not invoke attacker hooks',()=>{
 let n=0;const {binding,input}=bindingFixture();Object.defineProperty(binding.sources[0],'binding',{get(){n++;throw Error('getter')}});assert.throws(()=>encodeShopOrderReadBindingDATA(binding,input,expected));assert.equal(n,0);
 const p={purpose:'PUBLIC',payload:new Uint8Array([1]),wire:new Uint8Array([2])};Object.defineProperty(p.payload,'buffer',{get(){n++;throw Error('ownbuffer')}});p.payload[Symbol.iterator]=()=>{n++;throw Error('iter')};assert.equal(decodeShopOrderReadProofDATA(encodeShopOrderReadProofDATA(p,'PUBLIC'),'PUBLIC').payload[0],1);assert.equal(n,0);
 const s=new Uint8Array(new SharedArrayBuffer(1));Object.defineProperty(s,'buffer',{value:new ArrayBuffer(1)});assert.throws(()=>encodeShopOrderReadProofDATA({...p,wire:s},'PUBLIC'));
});
