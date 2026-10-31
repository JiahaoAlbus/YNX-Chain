// Deployment V2 DATA primitives. No publisher verification, Source or effects.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {encodeFields,decodeFields} from './framing.js';
const MAX=1048576,U64=0xffffffffffffffffn,te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const ta=Object.getPrototypeOf(Uint8Array.prototype),lengthGet=Object.getOwnPropertyDescriptor(ta,'byteLength').get,bufferGet=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set;
function fail(message,code='INVALID'){throw Object.assign(new Error(message),{code})}
function bytes(value,max=MAX){let n,buffer;try{n=lengthGet.call(value);buffer=bufferGet.call(value)}catch{fail('actual Uint8Array required')}if(!(value instanceof Uint8Array)||types.isProxy(value)||typeof SharedArrayBuffer!=='undefined'&&buffer instanceof SharedArrayBuffer)fail('shared/proxy bytes forbidden');if(n>max)fail('byte budget','BOUNDS');const out=new Uint8Array(n);try{set.call(out,value)}catch{fail('detached input')}return out}
function record(value,keys){if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('plain DATA record required');const ds=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail('exact DATA keys required');return Object.fromEntries(keys.map(k=>[k,ds[k].value]))}
function uint(value){if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>U64)fail('canonical U64');const out=new Uint8Array(8);new DataView(out.buffer).setBigUint64(0,BigInt(value),false);return out}
function readUint(b){if(b.length!==8)fail('U64 width');return new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(0,false).toString()}
function hex(value){if(typeof value!=='string'||!/^[a-f0-9]{128}$/.test(value))fail('lower hex512 required');return new Uint8Array(Buffer.from(value,'hex'))}
const readHex=b=>{if(b.length!==64)fail('digest width');return Buffer.from(b).toString('hex')};
/** Computes length and both hashes from one immutable capture, never authority. */
export function bindDeploymentV2Bytes(actual){const body=bytes(actual,64*1024*1024);return Object.freeze({bytes:String(body.length),sha3_512:createHash('sha3-512').update(body).digest('hex'),sha512:createHash('sha512').update(body).digest('hex')})}
export function encodeDeploymentV2Bind(input){const b=record(input,['bytes','sha3_512','sha512']);return encodeFields([uint(b.bytes),hex(b.sha3_512),hex(b.sha512)])}
export function decodeDeploymentV2Bind(wire){const f=decodeFields(bytes(wire),3);return Object.freeze({bytes:readUint(f[0]),sha3_512:readHex(f[1]),sha512:readHex(f[2])})}
export function assertDeploymentV2BytesBinding(actual,expected){const got=bindDeploymentV2Bytes(actual),a=encodeDeploymentV2Bind(got),b=encodeDeploymentV2Bind(expected);if(a.length!==b.length||a.some((v,i)=>v!==b[i]))fail('actual bytes mismatch');return got}

export const DEPLOYMENT_MANIFEST_V2_DOMAIN='YNX-CLOUD-DEPLOYMENT-MANIFEST/v2';
export const DEPLOYMENT_MANIFEST_V2_MAX_BYTES=16384;
export const DEPLOYMENT_ARTIFACT_V2_MAX_BYTES=67108864;
const DTO=['realm','tenant','project','version','artifact','env','publisher','publisherEpoch','issuer','issuerEpoch'];
function text(value){if(typeof value!=='string'||value.length===0||value.length>256)fail('nonempty bounded UTF8');for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const lo=value.charCodeAt(++i);if(!(lo>=0xdc00&&lo<=0xdfff))fail('unpaired surrogate')}else if(c>=0xdc00&&c<=0xdfff)fail('unpaired surrogate')}const b=te.encode(value);if(b.length>256)fail('UTF8 bounds','BOUNDS');return b}
function readText(b){try{const s=td.decode(b);text(s);return s}catch{fail('invalid bounded UTF8')}}
function ref(value){const r=record(value,['realm','tenant','kind','id','rev']);return {value:Object.freeze(r),wire:encodeFields([text(r.realm),text(r.tenant),text(r.kind),text(r.id),uint(r.rev)])}}
function readRef(wire){const f=decodeFields(wire,5);return Object.freeze({realm:readText(f[0]),tenant:readText(f[1]),kind:readText(f[2]),id:readText(f[3]),rev:readUint(f[4])})}
function environment(v){const b=text(v);if(v.trim()!==v||/[\u0000-\u001f\u007f-\u009f]/u.test(v))fail('explicit environment required');return b}
function mime(v){const b=text(v);if(!/^[\x20-\x7e]+$/.test(v))fail('bounded ASCII mime required');return b}
function objectKey(v){const b=text(v);if(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(v)||v.startsWith('//')||/[\u0000-\u001f\u007f-\u009f]/u.test(v))fail('opaque nonURL objectKey required');return b}
function file(value){const a=record(value,['ref','content','size','mime','objectKey']),r=ref(a.ref),content=encodeDeploymentV2Bind(a.content),size=uint(a.size);if(a.size!==decodeDeploymentV2Bind(content).bytes||BigInt(a.size)>BigInt(DEPLOYMENT_ARTIFACT_V2_MAX_BYTES))fail('artifact size/content bounds');return {ref:r.value,wire:encodeFields([r.wire,content,size,mime(a.mime),objectKey(a.objectKey)])}}
function readFile(wire){const f=decodeFields(wire,5);return Object.freeze({ref:readRef(f[0]),content:decodeDeploymentV2Bind(f[1]),size:readUint(f[2]),mime:readText(f[3]),objectKey:readText(f[4])})}
function payload(value){const m=record(value,DTO),p=ref(m.project),a=file(m.artifact),pub=ref(m.publisher),iss=ref(m.issuer);for(const r of [p.value,a.ref,pub.value])if(r.realm!==m.realm||r.tenant!==m.tenant)fail('manifest scope mismatch');const wire=encodeFields([te.encode(DEPLOYMENT_MANIFEST_V2_DOMAIN),text(m.realm),text(m.tenant),p.wire,uint(m.version),a.wire,environment(m.env),pub.wire,uint(m.publisherEpoch),iss.wire,uint(m.issuerEpoch)]);if(wire.length>DEPLOYMENT_MANIFEST_V2_MAX_BYTES)fail('manifest byte limit','BOUNDS');return wire}
/** Construct from the selected explicit DTO AND actual held artifact bytes. */
export function createDeploymentManifestV2DATA(input,actualArtifact){const original=payload(input),m=decodeDeploymentManifestV2DATA(original);assertDeploymentV2BytesBinding(actualArtifact,m.artifact.content);return Object.freeze({payloadOriginal:original,binding:bindDeploymentV2Bytes(original)})}
/** DATA only; optional expected binding must come from an independent selection. */
export function decodeDeploymentManifestV2DATA(input,expectedFullBinding){const wire=bytes(input,DEPLOYMENT_MANIFEST_V2_MAX_BYTES),f=decodeFields(wire,11);if(readText(f[0])!==DEPLOYMENT_MANIFEST_V2_DOMAIN)fail('V2 deployment domain');const m=Object.freeze({realm:readText(f[1]),tenant:readText(f[2]),project:readRef(f[3]),version:readUint(f[4]),artifact:readFile(f[5]),env:readText(f[6]),publisher:readRef(f[7]),publisherEpoch:readUint(f[8]),issuer:readRef(f[9]),issuerEpoch:readUint(f[10])});const encoded=payload(m);if(encoded.length!==wire.length||encoded.some((v,i)=>v!==wire[i]))fail('noncanonical manifest');if(expectedFullBinding!==undefined)assertDeploymentV2BytesBinding(wire,expectedFullBinding);return m}
export function assertDeploymentArtifactV2DATA(payloadOriginal,actualArtifact){const m=decodeDeploymentManifestV2DATA(payloadOriginal);return assertDeploymentV2BytesBinding(actualArtifact,m.artifact.content)}
