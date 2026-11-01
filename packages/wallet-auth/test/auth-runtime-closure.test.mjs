// Synthetic package files only. The generator must never execute these modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {generateAuthRuntimeClosure as generate,validateAuthRuntimeClosure as validate,AUTH_RUNTIME_MANIFEST_PATH} from '../scripts/auth-runtime-closure.mjs';
function fixture(){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ynx-public-runtime-closure-'));
 const put=(name,body)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),body);};
 for(const name of ['native/original-ide-auth-proof-dispatch.mjs','native/original-auth-identity-v2-contract.mjs','src/pq-wallet-policy.js','src/pq-wallet-authorization.js'])put(name,'export const PUBLIC_DATA_ONLY=true;');
 put('package.json',JSON.stringify({name:'public-runtime-fixture',type:'module',imports:{'#local':'./src/transitive.js'}}));
 put('native/original-auth-identity-source-verifier.mjs',"import '../src/transitive.js'; if(false) import('../src/late.js'); throw Error('PUBLIC_TARGET_MUST_NOT_EXECUTE');");
 put('src/auth-identity-verification.js',"import 'public-conditional'; import '#local'; export {x} from './transitive.js';");
 put('src/transitive.js','export const x=1;');put('src/late.js','export const x=2;');put('native/future-fixed-resource.json','{"PUBLIC":true}');
 put('node_modules/public-conditional/package.json',JSON.stringify({name:'public-conditional',type:'module',exports:{node:{import:'./node-import.js',require:'./require.cjs'},browser:'./browser.js',default:'./default.js'}}));
 put('node_modules/public-conditional/node-import.js',"import 'public-deep'; import {readFileSync} from 'node:fs'; export const version=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')); throw Error('PUBLIC_PACKAGE_MUST_NOT_EXECUTE');");
 for(const f of ['require.cjs','browser.js','default.js'])put('node_modules/public-conditional/'+f,'throw Error("PUBLIC_WRONG_CONDITION");');
 put('node_modules/public-deep/package.json','{"name":"public-deep","type":"module","exports":"./index.js"}');
 put('node_modules/public-deep/index.js','export const deep=1;');put('node_modules/public-deep/resource.bin','PUBLIC original resource');
 return {root,put,close:()=>rmSync(root,{recursive:true,force:true})};
}
function withFixture(fn){const f=fixture();try{fn(f);}finally{f.close();}}
test('deterministic exact manifest covers graph, conditional Node import and complete dependency resources without executing targets',()=>withFixture(({root,put})=>{
 const a=generate(root),b=generate(root);assert.deepEqual(a.manifest,b.manifest);
 assert.deepEqual(Object.keys(a.manifest).sort(),['files','version']);assert.equal(a.manifest.version,'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1');
 assert(a.manifest.files.length>=7);assert.equal(a.report.entries.length,2);assert.equal(a.report.nativeAdmission,false);
 assert(a.report.edges.some(e=>e.specifier==='public-conditional'&&e.resolved==='node_modules/public-conditional/node-import.js'));
 assert(a.report.edges.some(e=>e.kind==='dynamic-import'&&e.resolved==='src/late.js'));
 for(const path of ['package.json','node_modules/public-conditional/package.json','node_modules/public-deep/package.json','node_modules/public-deep/resource.bin','native/future-fixed-resource.json'])assert(a.manifest.files.some(row=>row.path===path));
 assert(Object.isFrozen(a.manifest));assert(Object.isFrozen(a.manifest.files));assert(Object.isFrozen(a.manifest.files[0]));
 const canonical=JSON.stringify(a.manifest);assert.deepEqual(validate(root,canonical).manifest,a.manifest);
 put(AUTH_RUNTIME_MANIFEST_PATH,canonical);assert.deepEqual(generate(root).manifest,a.manifest); // no recursive self row
}));
test('transitive bytes/resources/package resolution controls tamper or closure omission all fail',()=>withFixture(({root,put})=>{
 const original=generate(root).manifest;
 for(const target of ['src/transitive.js','node_modules/public-deep/index.js','node_modules/public-deep/resource.bin','node_modules/public-conditional/package.json','package.json']){
  const old=readFileSync(join(root,target),'utf8');put(target,target.endsWith('package.json')?old+' ':old+'\nPUBLIC_CHANGED');
  assert.throws(()=>validate(root,original));put(target,old);
 }
 assert.throws(()=>validate(root,{...original,files:original.files.slice(1)}),{code:'AUTH_RUNTIME_CLOSURE_MISMATCH'});
 const accessorArray=[...original.files];Object.defineProperty(accessorArray,'0',{get(){throw Error('PUBLIC_GETTER_MUST_NOT_RUN');}});assert.throws(()=>validate(root,{...original,files:accessorArray}),{code:'AUTH_RUNTIME_MANIFEST_SCHEMA'});
 assert.throws(()=>validate(root,{...original,files:[{...original.files[0],bytes:0},...original.files.slice(1)]}),{code:'AUTH_RUNTIME_MANIFEST_SCHEMA'});
 assert.throws(()=>validate(root,{...original,extra:true}),{code:'AUTH_RUNTIME_MANIFEST_SCHEMA'});
 assert.throws(()=>validate(root,JSON.stringify(original)+' '),{code:'AUTH_RUNTIME_MANIFEST_CANONICAL'});
 assert.throws(()=>validate(root,JSON.stringify(original).replace('{','{"version":"duplicate",')));
 assert.throws(()=>validate(root,{...original,files:[...original.files].reverse()}),{code:'AUTH_RUNTIME_MANIFEST_SCHEMA'});
 let touched=false;const getter={version:original.version,get files(){touched=true;return original.files;}};
 assert.throws(()=>validate(root,getter),{code:'AUTH_RUNTIME_MANIFEST_SCHEMA'});assert.equal(touched,false);
}));
test('symlink root, ancestor, package alias or resource is refused',()=>withFixture(({root,put})=>{
 const alias=root+'-alias';symlinkSync(root,alias,'dir');try{assert.throws(()=>generate(alias),{code:'AUTH_RUNTIME_SYMLINK'});}finally{rmSync(alias);}
 const ancestor=root+'-ancestor';symlinkSync(dirname(root),ancestor,'dir');try{assert.throws(()=>generate(join(ancestor,root.split('/').at(-1))),{code:'AUTH_RUNTIME_SYMLINK'});}finally{rmSync(ancestor);}
 rmSync(join(root,'node_modules/public-deep'),{recursive:true});symlinkSync(join(root,'node_modules/public-conditional'),join(root,'node_modules/public-deep'),'dir');
 assert.throws(()=>generate(root),{code:'AUTH_RUNTIME_SYMLINK'});
}));
test('unknown dynamic module/resource mechanisms, missing targets and escapes fail closed',()=>withFixture(({root,put})=>{
 for(const body of ["import(process.env.PUBLIC_MODULE);","require('public-conditional');","eval('PUBLIC');","new Function('PUBLIC');","globalThis.eval('PUBLIC');","module.require('public-deep');","import {createRequire as loader} from 'node:module';","import {readFileSync} from 'node:fs'; readFileSync(process.env.PUBLIC_PATH);","import './PUBLIC_missing.js';","import '../../PUBLIC_escape.js';"]){
  put('src/auth-identity-verification.js',body);assert.throws(()=>generate(root));
 }
}));
test('Node condition resolution changes cannot reuse an old closure manifest',()=>withFixture(({root,put})=>{
 const before=generate(root).manifest;
 put('node_modules/public-conditional/package.json',JSON.stringify({name:'public-conditional',type:'module',exports:{node:{import:'./default.js',require:'./require.cjs'},default:'./default.js'}}));
 assert.throws(()=>validate(root,before),{code:'AUTH_RUNTIME_CLOSURE_MISMATCH'});
 const after=generate(root);assert(after.report.edges.some(e=>e.specifier==='public-conditional'&&e.resolved==='node_modules/public-conditional/default.js'));
}));

test('manifest rejects non-ASCII and single-backslash file paths',()=>withFixture(({root,put})=>{
 put('src/PUBLIC-中文.json','{}');assert.throws(()=>generate(root),{code:'AUTH_RUNTIME_ESCAPE'});rmSync(join(root,'src/PUBLIC-中文.json'));
 put('src/PUBLIC'+String.fromCharCode(92)+'alias.json','{}');assert.throws(()=>generate(root),{code:'AUTH_RUNTIME_ESCAPE'});
}));

test('required missing files, empty files and nonregular resources fail closed',()=>withFixture(({root,put})=>{
 put('src/PUBLIC_empty.json','');assert.throws(()=>generate(root),{code:'AUTH_RUNTIME_EMPTY_FILE'});rmSync(join(root,'src/PUBLIC_empty.json'));
 const path='native/original-ide-auth-proof-dispatch.mjs',saved=readFileSync(join(root,path));rmSync(join(root,path));assert.throws(()=>generate(root));put(path,saved);
 symlinkSync(join(root,'package.json'),join(root,'src/PUBLIC_resource.json'));assert.throws(()=>generate(root),{code:'AUTH_RUNTIME_SYMLINK'});
}));
