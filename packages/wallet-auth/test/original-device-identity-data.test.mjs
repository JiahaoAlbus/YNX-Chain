import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{createOriginalDeviceIdentityDATA as create,inspectOriginalDeviceIdentityDATA as inspect,createOriginalDeviceCreateIntentDATA as creation}from'../src/original-device-create-intent.js';
const vectors=JSON.parse(fs.readFileSync(new URL('../integration/DEVICE_CREATE_INTENT_V1_VECTORS.json',import.meta.url))).vectors,omit=['generation','operationId','nonce','issuedAt','expiresAt'],appKeys=['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback'],input=v=>Object.fromEntries(Object.entries(v.input).filter(([k])=>!omit.includes(k))),app=v=>Object.fromEntries(appKeys.map(k=>[k,v.input[k]])),te=new TextEncoder();
test('cold identity retains original preimage and dual binding, with no creation window',()=>{
 for(const v of vectors){const q=create(input(v)),r=inspect(te.encode(q.stableDeviceIdentity),app(v));assert.equal(q.stableDeviceIdentity,v.stableDeviceIdentity);assert.deepEqual(q.stableIdentityBinding,v.stableIdentityBinding);assert.deepEqual(r,q);assert.equal(q.currentVerified,false);for(const k of ['approvedTerms','nativeIntentDATA','issuedAt','expiresAt','operationId','generation','nonce'])assert(!Object.hasOwn(q,k));}
});
test('shared stable preimage preserves existing creation vectors after helper extraction',()=>{
 for(const v of vectors){const r=creation(v.input);assert.equal(r.approvedTerms,v.approvedTerms);assert.equal(r.stableDeviceIdentity,v.stableDeviceIdentity);assert.deepEqual(r.stableIdentityBinding,v.stableIdentityBinding);}
});
test('fixed platform application tuple and independent identity are cross checked',()=>{
 const v=vectors[0],q=create(input(v));for(const k of appKeys){const changed={...app(v),[k]:String(app(v)[k])+'-changed'};assert.throws(()=>inspect(te.encode(q.stableDeviceIdentity),changed),k);assert.throws(()=>create({...input(v),[k]:changed[k]}),k);}
 for(const [k,value]of [['networkId','bad'],['canonicalOwner','0x'+'33'.repeat(20)],['account','ynx-fake'],['deviceId','short']])assert.throws(()=>create({...input(v),[k]:value}));
});
test('query DATA rejects creation fields, approval flags and application overrides in original bytes',()=>{
 const v=vectors[0],q=create(input(v));for(const k of [...omit,'approved','SourceAdmission','nativeIntentDATA'])assert.throws(()=>create({...input(v),[k]:true}));
 assert.throws(()=>inspect(te.encode(JSON.stringify({...q.identity,platform:v.input.platform})),app(v)));assert.throws(()=>inspect(te.encode(v.approvedTerms),app(v)));assert.throws(()=>inspect(te.encode(q.stableDeviceIdentity),{...app(v),approved:true}));
 for(const k of ['userApproved','SourceAdmission','NativeAdmission','currentVerified'])assert.equal(q[k],false);
});
test('original identity parser requires canonical original bytes and actual private byte input',()=>{
 const v=vectors[0],q=create(input(v)),b=te.encode(q.stableDeviceIdentity);assert.throws(()=>inspect(q.stableDeviceIdentity,app(v)));assert.throws(()=>inspect(te.encode(' '+q.stableDeviceIdentity),app(v)));assert.throws(()=>inspect(te.encode(q.stableDeviceIdentity.replace('{','{"version":"1",')),app(v)));assert.throws(()=>inspect(new Proxy(b,{}),app(v)));assert.throws(()=>inspect(new Uint8Array(new SharedArrayBuffer(4)),app(v)));
 const getter={...input(v)};Object.defineProperty(getter,'deviceId',{get(){throw Error('GETTER_EXECUTED')},enumerable:true});assert.throws(()=>create(getter),e=>e.message!=='GETTER_EXECUTED');
});
