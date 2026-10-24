import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {decodeIDEArtifactReleaseResultData as decode} from '../src/ide-artifact-release-result.js';
const te=new TextEncoder();
const b64=b=>Buffer.from(b).toString('base64url');
const fields=()=>({version:'YNX-IDE-ARTIFACT-RELEASE-RESULT/v1',purpose:'ARTIFACT-RELEASE',requestOriginal:'{"PUBLIC":"请求"}',manifestOriginal:'{"PUBLIC":"清单/😀"}',publisherOriginal:b64([1,2,3]),actualApprovalRef:'12345678-1234-4123-8123-123456789abc',publisherRegistrationRef:'PUBLIC-registration',publisherRevision:'18446744073709551615',publisherKeyVersion:'1',invocationOriginal:'{"PUBLIC":"清单/😀"}',signatureOriginal:b64([4,5,6])});
const wire=x=>te.encode(JSON.stringify(x));
const invalid=x=>assert.throws(()=>decode(x),{code:'IDE_ARTIFACT_RELEASE_RESULT_INVALID'});

test('PUBLIC formal eleven-string mapping preserves wire and independent byte copies; all authority false',()=>{
 const f=fields(),input=wire(f),expected=new Uint8Array(input),r=decode(input);
 for(const [k,v] of Object.entries(f))assert.equal(r[k],v);
 assert.equal(Object.isFrozen(r),true);assert.equal(r.dataOnly,true);
 for(const k of ['signatureVerified','trusted','authorized','nativeAdmission','registered','current','approvalCurrent','publicationAuthorized'])assert.equal(r[k],false);
 assert.equal('proofOriginal' in r,false);
 assert.deepEqual(r.resultOriginal,expected);
 assert.deepEqual(r.requestOriginalBytes,te.encode(f.requestOriginal));
 assert.deepEqual(r.manifestOriginalBytes,te.encode(f.manifestOriginal));
 assert.deepEqual(r.invocationOriginalBytes,te.encode(f.manifestOriginal));
 assert.deepEqual(r.publisherOriginalBytes,new Uint8Array([1,2,3]));
 assert.deepEqual(r.signatureOriginalBytes,new Uint8Array([4,5,6]));
 input.fill(0);
 for(const k of ['resultOriginal','requestOriginalBytes','manifestOriginalBytes','invocationOriginalBytes','publisherOriginalBytes','signatureOriginalBytes']){
  const a=r[k],before=new Uint8Array(a);assert.equal(Object.getPrototypeOf(a),Uint8Array.prototype);a.fill(255);assert.deepEqual(r[k],before);assert.notEqual(r[k].buffer,r[k].buffer);
 }
 assert.deepEqual(r.resultOriginal,expected);assert.throws(()=>{r.authorized=true;},TypeError);
 // PUBLIC opaque bytes are deliberately not valid N1/R13. Framing never grants mathematical validity.
 assert.equal(r.signatureVerified,false);
});

test('PUBLIC Foundation-compatible ordering, whitespace, Unicode escapes and opaque nested originals',()=>{
 const f=fields();f.publisherRegistrationRef='登记\u200b中\u0085间';
 const text=' \n{ '+Object.entries(f).reverse().map(([k,v])=>JSON.stringify(k)+' : '+JSON.stringify(v).replace('清','\\u6e05')).join(',\n')+' }\t';
 const original=te.encode(text),r=decode(original);assert.deepEqual(r.resultOriginal,original);assert.equal(r.publisherRegistrationRef,f.publisherRegistrationRef);assert.equal(r.manifestOriginal,f.manifestOriginal);
 const maximum={...f,requestOriginal:'x'.repeat(16384),manifestOriginal:'x'.repeat(16384),invocationOriginal:'x'.repeat(16384),publisherRegistrationRef:'x'.repeat(256),publisherOriginal:b64(new Uint8Array(8192)),signatureOriginal:b64(new Uint8Array(98304))};assert.equal(decode(wire(maximum)).publisherRevision,'18446744073709551615');
});

test('PUBLIC duplicate decoded keys, malformed UTF8/BOM, extra/missing and non-string fields reject',()=>{
 const f=fields(),s=JSON.stringify(f);
 for(const text of [s.replace('{','{"version":"x",'),s.replace('{','{"ver\\u0073ion":"x",'),s+'x',s.replace(/}$/,',}'),s.replace('"ARTIFACT-RELEASE"','true'),s.replace('"ARTIFACT-RELEASE"','{}'),s.replace('"ARTIFACT-RELEASE"','"\\ud800"')])invalid(te.encode(text));
 for(const k of Object.keys(f)){const g={...f};delete g[k];invalid(wire(g));invalid(wire({...f,[k]:null}));}
 invalid(wire({...f,proofOriginal:'forbidden'}));invalid(wire({...f,authorized:true}));invalid(new Uint8Array([0xc3,0x28]));invalid(new Uint8Array([0xef,0xbb,0xbf,...wire(f)]));invalid(new Uint8Array(262145));
});

test('PUBLIC producer scalar, canonical base64url and exact caps reject invalid boundaries',()=>{
 const f=fields();
 for(const [key,values] of Object.entries({version:['v2'],purpose:['IDENTITY'],invocationOriginal:['other'],actualApprovalRef:['12345678-1234-1123-8123-123456789abc','12345678-1234-4123-8123-123456789abC'],publisherRegistrationRef:[' x','x ','x y','x\u007f','\u00a0x','x\u3000','x'.repeat(257)],publisherRevision:['0','01','-1','18446744073709551616'],publisherKeyVersion:['0','1.0'],requestOriginal:['x'.repeat(16385)],manifestOriginal:['x'.repeat(16385)],publisherOriginal:['AQ==','AR','+w',b64(new Uint8Array(8193))],signatureOriginal:['BA==','BR',b64(new Uint8Array(98305))]}))for(const v of values)invalid(wire({...f,[key]:v}));
});

test('PUBLIC malicious views, shared/resizable/detached bytes and accessors reject without invocation',()=>{
 const input=wire(fields());let called=0;
 const object={get resultOriginal(){called++;return input;}};
 const proxy=new Proxy(input,{getPrototypeOf(){called++;throw Error('trap');},ownKeys(){called++;throw Error('trap');},get(){called++;throw Error('trap');}});
 for(const x of [object,proxy,Buffer.from(input),new DataView(input.buffer),new Uint16Array(3),class extends Uint8Array{} && new (class extends Uint8Array{})(input),JSON.stringify(fields()),null])invalid(x);
 if(typeof SharedArrayBuffer==='function')invalid(new Uint8Array(new SharedArrayBuffer(10)));
 invalid(new Uint8Array(new ArrayBuffer(10,{maxByteLength:20})));
 const transferred=new Uint8Array(input);structuredClone(transferred.buffer,{transfer:[transferred.buffer]});invalid(transferred);
 const custom=new Uint8Array(input);Object.defineProperty(custom,'extra',{get(){called++;return true;}});invalid(custom);
 assert.equal(called,0);assert.throws(()=>decode(input,input),{code:'IDE_ARTIFACT_RELEASE_RESULT_INVALID'});invalid();
});

test('PUBLIC new declaration retains readonly literal false and no proof alias (only new type contract)',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'publication-result-types-'));
 try{
  const entry=join(dir,'case.mts'),module=fileURLToPath(new URL('../src/ide-artifact-release-result.js',import.meta.url));
  await writeFile(entry,`import {decodeIDEArtifactReleaseResultData} from ${JSON.stringify(module)};\nconst r=decodeIDEArtifactReleaseResultData(new Uint8Array([1]));\nconst f:false=r.signatureVerified;const d:true=r.dataOnly;const ordinary:Uint8Array<ArrayBuffer>=r.resultOriginal;\n// @ts-expect-error no grant\nconst granted:true=r.authorized;\n// @ts-expect-error immutable DATA\nr.publicationAuthorized=true;\n// @ts-expect-error not identity proof\nr.proofOriginal;\n`);
  const program=ts.createProgram([entry],{strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:[],skipLibCheck:false});
  const errors=ts.getPreEmitDiagnostics(program);assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>dir,getNewLine:()=> '\n'}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
