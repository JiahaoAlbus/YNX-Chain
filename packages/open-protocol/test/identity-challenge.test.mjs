import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{encodeIdentityChallengeV1DATA as encode,decodeIdentityChallengeV1DATA as decode,assertIdentityChallengeV1BindingDATA as bind}from'../src/identity-challenge.js';
import{encodeFields,decodeFields}from'../src/framing.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/identity-challenge-v1.json',import.meta.url)));
const bytes=s=>Uint8Array.from(Buffer.from(s,'hex')),hex=b=>Buffer.from(b).toString('hex');
function input(v){const n=v.networkBinding;return {realm:bytes(v.realmHex),networkBinding:n.kind==='offchain'?{kind:n.kind}:{kind:n.kind,genesis:bytes(n.genesisHex),nativeChainId:n.nativeChainId,networkId:bytes(n.networkIdHex)},tenant:bytes(v.tenantHex),agentId:bytes(v.agentIdHex),epoch:v.epoch,audience:bytes(v.audienceHex),channelBinding:bytes(v.channelBindingHex),nonce:bytes(v.nonceHex),issuedAt:v.issuedAt,expiresAt:v.expiresAt};}
const expected=c=>Object.fromEntries(['realm','networkBinding','tenant','agentId','epoch','audience','channelBinding'].map(k=>[k,c[k]]));
test('T-OPEN-02 newly specified offchain and chain challenge vectors encode identically in Go and TS codecs',()=>{
 for(const v of fixture.vectors){const c=input(v.input),wire=encode(c);assert.equal(hex(wire),v.wireHex);const d=decode(wire,expected(c));assert.equal(d.epoch,'9007199254740993');assert.equal(hex(encode(d)),v.wireHex);wire.fill(0);assert.equal(hex(d.realm),v.input.realmHex);}
});
test('T-OPEN-02 exact fixed domain, purpose, counts and no trailing bytes',()=>{
 const f=decodeFields(bytes(fixture.vectors[0].wireHex),11);for(const i of [0,6]){const a=f.map(x=>x.slice());a[i][0]^=1;assert.throws(()=>decode(encodeFields(a)))}
 assert.throws(()=>decode(encodeFields(f.slice(1))));assert.throws(()=>decode(Uint8Array.of(...bytes(fixture.vectors[0].wireHex),0)));assert.throws(()=>decode(bytes(fixture.vectors[0].wireHex).slice(0,-1)));
 const swapped=f.map(x=>x.slice());[swapped[0],swapped[1]]=[swapped[1],swapped[0]];assert.throws(()=>decode(encodeFields(swapped)));
});
test('T-OPEN-02 same-sized field substitution is refused against the selected expected binding',()=>{
 const c=input(fixture.vectors[0].input),f=[...decodeFields(encode(c),11)];[f[1],f[3]]=[f[3],f[1]];const changed=encodeFields(f);
 // A syntax-only decoder sees a different valid realm/tenant DATA record.
 assert.doesNotThrow(()=>decode(changed));assert.throws(()=>decode(changed,expected(c)));
 for(const key of ['realm','tenant','agentId','audience','channelBinding']){const d=decode(encode(c));d[key][0]^=1;assert.throws(()=>bind(d,expected(c)))}
 assert.throws(()=>bind(c,{...expected(c),epoch:'9007199254740994'}));
});
test('T-OPEN-02 fixed widths, exact records, canonical u64 and 60 second lifetime',()=>{
 const c=input(fixture.vectors[0].input);for(const [k,n]of [['realm',16],['tenant',16],['agentId',16],['audience',16],['nonce',32],['channelBinding',32]])assert.throws(()=>encode({...c,[k]:new Uint8Array(n-1)}));
 for(const epoch of ['01','-1','18446744073709551616',1])assert.throws(()=>encode({...c,epoch}));
 for(const expiresAt of [c.issuedAt,'1793438060001','1793437999999'])assert.throws(()=>encode({...c,expiresAt}));assert.throws(()=>encode({...c,extra:true}));
 let called=0;const getter={...c};Object.defineProperty(getter,'epoch',{get(){called++;return '1'}});assert.throws(()=>encode(getter));assert.equal(called,0);
});
test('T-OPEN-02 offchain is explicit and cannot be zero genesis or decorated by chain fields',()=>{
 const c=input(fixture.vectors[1].input);assert.throws(()=>encode({...c,networkBinding:{...c.networkBinding,genesis:new Uint8Array(32)}}));assert.throws(()=>encode({...c,networkBinding:{kind:'offchain',nativeChainId:'0'}}));
 const f=[...decodeFields(encode(c),11)];f[2]=encodeFields([new TextEncoder().encode('offchain'),new Uint8Array(32)]);assert.throws(()=>decode(encodeFields(f)));
});
test('T-OPEN-02 typed byte capture preserves fixed widths without invoking field iterators or buffer getters',()=>{
 let iter=0,getter=0;const c=input(fixture.vectors[0].input);c.realm[Symbol.iterator]=function*(){iter++;yield 9;};Object.defineProperty(c.realm,'buffer',{get(){getter++;throw Error('unexpected own buffer getter')}});const wire=encode(c);assert.equal(hex(wire),fixture.vectors[0].wireHex);assert.equal(iter,0);assert.equal(getter,0);
 const d=decode(wire);assert.equal(d.realm.length,16);
});
