import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{encodeOpenEnvelope}from'../src/open-envelope.js';import{decodeFields}from'../src/framing.js';
const v=JSON.parse(fs.readFileSync(new URL('./fixtures/identity-challenge-v1.json',import.meta.url))).vectors[0],wire=Uint8Array.from(Buffer.from(v.wireHex,'hex')),fields=decodeFields(wire,11).slice(2),ctx={realm:v.input.realmHex,tenant:v.input.tenantHex,actor:null,actorEpoch:'0',traceId:'trace-open02',requestId:'req-open02'},domain='YNX-OPEN/IDENTITY-CHALLENGE/1';
test('T-OPEN-02 actual encodeOpenEnvelope maps the supported profile to the frozen challenge bytes',async()=>{const r=await encodeOpenEnvelope(ctx,domain,ctx.realm,fields);assert.equal(r.ok,true);assert.equal(Buffer.from(r.value).toString('hex'),v.wireHex)});
test('T-OPEN-02 actual entry refuses wrong realm, tenant, field order, count and unknown profiles',async()=>{
 for(const [c,d,r,f,code]of [[ctx,'YNX-OPEN/UNKNOWN/1',ctx.realm,fields,'UNSUPPORTED'],[ctx,domain,'00'.repeat(16),fields,'INVALID'],[{...ctx,tenant:'00'.repeat(16)},domain,ctx.realm,fields,'INVALID'],[ctx,domain,ctx.realm,fields.slice(1),'INVALID'],[ctx,domain,ctx.realm,[fields[1],fields[0],...fields.slice(2)],'INVALID']]){const out=await encodeOpenEnvelope(c,d,r,f);assert.deepEqual(out,{ok:false,code,requestId:ctx.requestId})}
});
test('T-OPEN-02 actual entry maps oversize and unsafe descriptors to explicit Call errors without reading getters',async()=>{
 const f=[...fields];f[0]=new Uint8Array(1048576);assert.deepEqual(await encodeOpenEnvelope(ctx,domain,ctx.realm,f),{ok:false,code:'BOUNDS',requestId:ctx.requestId});
 let called=0;const c={...ctx};Object.defineProperty(c,'tenant',{get(){called++;return ctx.tenant}});const r=await encodeOpenEnvelope(c,domain,ctx.realm,fields);assert.equal(r.ok,false);assert.equal(r.code,'INVALID');assert.equal(called,0);
 const malformed=await encodeOpenEnvelope(null,domain,ctx.realm,fields);assert.deepEqual(malformed,{ok:false,code:'INVALID',requestId:''});
});
test('T-OPEN-02 hostile thrown values cannot turn the Call result into a rejected Promise',async()=>{
 const hostile={get code(){throw 0}},c=new Proxy({}, {getOwnPropertyDescriptor(){throw hostile},ownKeys(){throw hostile}});
 assert.deepEqual(await encodeOpenEnvelope(c,domain,ctx.realm,fields),{ok:false,code:'INVALID',requestId:''});
});
