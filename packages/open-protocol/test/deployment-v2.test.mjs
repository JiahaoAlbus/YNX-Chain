import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bindDeploymentV2Bytes,encodeDeploymentV2Bind,decodeDeploymentV2Bind,assertDeploymentV2BytesBinding} from '../src/deployment-v2.js';
import {encodeFields} from '../src/framing.js';
const actual=new TextEncoder().encode('PUBLIC deployment artifact\n');
const digest=(name,b)=>createHash(name).update(b).digest('hex');
test('one held actual-byte capture produces canonical dual Bind',()=>{
 const binding=bindDeploymentV2Bytes(actual);
 assert.deepEqual(binding,{bytes:String(actual.length),sha3_512:digest('sha3-512',actual),sha512:digest('sha512',actual)});
 assert.deepEqual(decodeDeploymentV2Bind(encodeDeploymentV2Bind(binding)),binding);
 assert.deepEqual(assertDeploymentV2BytesBinding(actual,binding),binding);
 assert.throws(()=>assertDeploymentV2BytesBinding(new Uint8Array([...actual,0]),binding));
 for(const change of [{bytes:'01'},{sha3_512:binding.sha3_512.toUpperCase()},{sha512:'00'.repeat(64)}])assert.throws(()=>assertDeploymentV2BytesBinding(actual,{...binding,...change}));
 assert.throws(()=>decodeDeploymentV2Bind(new Uint8Array([...encodeDeploymentV2Bind(binding),0])));
 assert.throws(()=>decodeDeploymentV2Bind(encodeFields([new Uint8Array(7),new Uint8Array(64),new Uint8Array(64)])));
});
test('captures intrinsic bytes without executing iterator, own buffer or getters',()=>{
 let invoked=0;const b=actual.slice();Object.defineProperty(b,'buffer',{get(){invoked++;throw Error('ownbuffer')}});b[Symbol.iterator]=()=>{invoked++;throw Error('iterator')};
 assert.deepEqual(bindDeploymentV2Bytes(b),bindDeploymentV2Bytes(actual));assert.equal(invoked,0);
 const wire=encodeDeploymentV2Bind(bindDeploymentV2Bytes(actual));wire[Symbol.iterator]=()=>{throw Error('iterator')};assert.equal(decodeDeploymentV2Bind(wire).bytes,String(actual.length));
 const shared=new Uint8Array(new SharedArrayBuffer(10));Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(10)});assert.throws(()=>bindDeploymentV2Bytes(shared));
 assert.throws(()=>bindDeploymentV2Bytes(new Proxy(actual,{})));
 const detached=new Uint8Array(5);structuredClone(detached,{transfer:[detached.buffer]});assert.throws(()=>bindDeploymentV2Bytes(detached));
 const binding=bindDeploymentV2Bytes(actual);const bad={...binding};Object.defineProperty(bad,'bytes',{get(){invoked++;return '25'}});assert.throws(()=>encodeDeploymentV2Bind(bad));assert.equal(invoked,0);
});
test('TS fixed actual-byte Bind vector is independent of caller content mutation',async()=>{
 const {readFile}=await import('node:fs/promises');const v=JSON.parse(await readFile(new URL('./fixtures/deployment-v2-bind.json',import.meta.url),'utf8'));
 const body=new Uint8Array(Buffer.from(v.actualHex,'hex'));assert.deepEqual(bindDeploymentV2Bytes(body),v.binding);
 assert.equal(Buffer.from(encodeDeploymentV2Bind(v.binding)).toString('hex'),v.wireHex);
 body.fill(0);assert.throws(()=>assertDeploymentV2BytesBinding(body,v.binding));
});

import {createDeploymentManifestV2DATA,decodeDeploymentManifestV2DATA,assertDeploymentArtifactV2DATA,DEPLOYMENT_MANIFEST_V2_DOMAIN} from '../src/deployment-v2.js';
import {decodeFields} from '../src/framing.js';
const R=(kind,id,realm='PUBLIC realm',tenant='租户-A',rev='7')=>({realm,tenant,kind,id,rev});
function selected(){const content=bindDeploymentV2Bytes(actual);return {realm:'PUBLIC realm',tenant:'租户-A',project:R('project','project/original'),version:'9',artifact:{ref:R('file','artifact/original'),content,size:content.bytes,mime:'application/octet-stream',objectKey:'project/original/artifact.bin'},env:'staging',publisher:R('publisher','publisher/original'),publisherEpoch:'3',issuer:R('issuer','auth/original','authority realm','authority tenant','29'),issuerEpoch:'11'}}
const copy=v=>structuredClone(v);
const frameChange=(wire,i,value)=>{const f=[...decodeFields(wire,11)];f[i]=value;return encodeFields(f)};
const text=v=>new TextEncoder().encode(v);
test('normal V2 constructor, decoder, selected full Bind and actual artifact consumer',()=>{
 const dto=selected(),built=createDeploymentManifestV2DATA(dto,actual);
 assert.deepEqual(decodeDeploymentManifestV2DATA(built.payloadOriginal,built.binding),dto);
 assert.deepEqual(assertDeploymentArtifactV2DATA(built.payloadOriginal,actual),dto.artifact.content);
 assert.deepEqual(built.binding,bindDeploymentV2Bytes(built.payloadOriginal));
 assert.equal(decodeFields(built.payloadOriginal,11).length,11);
 assert.equal(decodeDeploymentManifestV2DATA(built.payloadOriginal).publisherEpoch,'3'); // not Ref.rev=7
 assert.equal(decodeDeploymentManifestV2DATA(built.payloadOriginal).issuer.tenant,'authority tenant');
 assert.equal('current' in built,false);assert.equal('signature' in built,false);
 assert.throws(()=>createDeploymentManifestV2DATA(dto,new Uint8Array([...actual,0])));
 const changed=frameChange(built.payloadOriginal,6,text('preview'));
 assert.equal(decodeDeploymentManifestV2DATA(changed).env,'preview'); // decode is not a trusted selection
 assert.throws(()=>decodeDeploymentManifestV2DATA(changed,built.binding));
});
test('rejects exact-key, scope, width, limit and old six-field confusion',()=>{
 const dto=selected();
 const changes=[d=>d.realm='other',d=>d.project.tenant='other',d=>d.artifact.ref.realm='other',d=>d.publisher.tenant='other',d=>d.version='09',d=>d.publisherEpoch='18446744073709551616',d=>d.issuerEpoch=1,d=>delete d.issuer,d=>d.generation='1',d=>d.binding=d.artifact.content,d=>d.artifact.size='0',d=>d.artifact.size=d.artifact.content.bytes='67108865',d=>d.artifact.content.sha512='00'.repeat(64),d=>d.artifact.objectKey='https://example.invalid/x',d=>d.artifact.objectKey='//example/x',d=>d.artifact.mime='text/☃',d=>d.env=' staging',d=>d.project.id='\ud800',d=>d.tenant='é'.repeat(129),d=>d.artifact.ref.extra=true];
 for(const mutate of changes){const d=copy(dto);mutate(d);assert.throws(()=>createDeploymentManifestV2DATA(d,actual));}
 const w=createDeploymentManifestV2DATA(dto,actual).payloadOriginal;
 for(const bad of [new Uint8Array([...w,0]),frameChange(w,0,text('YNX-IDE-ARTIFACT-RELEASE-RESULT/v1')),frameChange(w,4,new Uint8Array(7)),frameChange(w,1,new Uint8Array([0xc0,0x80])),new Uint8Array(16385),text(JSON.stringify({projectId:'p',version:'9',contentDigest:'00'.repeat(32),publishPurpose:'deploy',targetEnvironment:'staging',byteSize:actual.length})),encodeFields(Array.from({length:6},()=>text('old')))])assert.throws(()=>decodeDeploymentManifestV2DATA(bad));
 const f=[...decodeFields(w,11)];[f[3],f[7]]=[f[7],f[3]];const swapped=encodeFields(f); // same-shape refs need independently selected binding
 assert.throws(()=>decodeDeploymentManifestV2DATA(swapped,bindDeploymentV2Bytes(w)));
});
test('V2 DTO and nested capture refuse Proxy/getters without execution; wire copies intrinsic bytes',()=>{
 let invoked=0;const d=selected();Object.defineProperty(d.artifact,'content',{get(){invoked++;throw Error('getter')}});assert.throws(()=>createDeploymentManifestV2DATA(d,actual));assert.equal(invoked,0);
 const proxy=selected();proxy.issuer=new Proxy(proxy.issuer,{getPrototypeOf(){invoked++;return Object.prototype}});assert.throws(()=>createDeploymentManifestV2DATA(proxy,actual));assert.equal(invoked,0);
 const w=createDeploymentManifestV2DATA(selected(),actual).payloadOriginal;Object.defineProperty(w,'buffer',{get(){invoked++;throw Error('buffer')}});w[Symbol.iterator]=()=>{invoked++;throw Error('iterator')};assert.equal(decodeDeploymentManifestV2DATA(w).version,'9');assert.equal(invoked,0);
 const shared=new Uint8Array(new SharedArrayBuffer(w.length));Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(w.length)});assert.throws(()=>decodeDeploymentManifestV2DATA(shared));
});
test('V2 fixed cross-language vector exactly pins new profile bytes',async()=>{
 const {readFile}=await import('node:fs/promises');const v=JSON.parse(await readFile(new URL('./fixtures/deployment-v2-manifest.json',import.meta.url),'utf8'));
 const body=new Uint8Array(Buffer.from(v.actualHex,'hex')),built=createDeploymentManifestV2DATA(v.manifest,body);
 assert.equal(v.domain,DEPLOYMENT_MANIFEST_V2_DOMAIN);assert.equal(Buffer.from(built.payloadOriginal).toString('hex'),v.payloadHex);assert.deepEqual(built.binding,v.binding);
 assert.deepEqual(decodeDeploymentManifestV2DATA(built.payloadOriginal,v.binding),v.manifest);
});
