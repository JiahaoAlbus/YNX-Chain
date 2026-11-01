// PUBLIC fixed-module seam only; no genuine Source, Native admission, key,
// publisher authority, user data, network or actual cleanup effect is produced.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8');
const selection=readFileSync(new URL('../scripts/original-ide-service-admission-native-selection.mjs',import.meta.url),'utf8');
function run(nativeBody,checks,{suffixBody}={}){
 const root=mkdtempSync(join(tmpdir(),'ynx-PUBLIC-project-reader-'));
 try{
  for(const dir of ['packages/wallet-auth/src','packages/wallet-auth/scripts','apps/wallet-desktop/native','Resources'])mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  // Only this isolated PUBLIC copy changes the fixed Native operand to CJS.
  writeFileSync(join(root,'packages/wallet-auth/src/original-ide-admission-parent-delivery.js'),source.replaceAll('../../../apps/wallet-desktop/native/original-auth-identity.node','../../../apps/wallet-desktop/native/original-auth-identity.cjs'));
  writeFileSync(join(root,'packages/wallet-auth/scripts/original-ide-service-admission-native-selection.mjs'),selection);
  if(nativeBody!==null)writeFileSync(join(root,'apps/wallet-desktop/native/original-auth-identity.cjs'),nativeBody);
  if(suffixBody!==undefined)writeFileSync(join(root,'apps/wallet-desktop/native/original-auth-identity.cjs.js'),suffixBody);
  const server=join(root,'Resources/server.mjs');
  writeFileSync(server,`import assert from 'node:assert/strict';import {createRequire} from 'node:module';import * as api from '../packages/wallet-auth/src/original-ide-admission-parent-delivery.js';const require=createRequire(import.meta.url);\n${checks}\n`);
  const result=spawnSync(process.execPath,[server],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr||result.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
const names=['acquireOriginalIDEProjectAuthority','readOriginalIDECurrentProject','readOriginalIDECurrentPublisher','closeOriginalIDEProjectAuthority'];
const operands=[[],[{},'PUBLIC-project'],[{},'PUBLIC-project','PUBLIC-publisher'],[{}]];
test('PUBLIC reader exports stay cold without loading or constructing Native',()=>run(`throw Error('PUBLIC_MUST_NOT_LOAD');`,`for(const name of ${JSON.stringify(names)})assert.equal(typeof api[name],'function');`));
test('PUBLIC same partial and frozen DATA pass through with exact argument order and undefined cleanup',()=>run(`
const ref=new Proxy(Object.freeze({}),{get(){throw Error('PUBLIC_PARTIAL_MUST_NOT_INSPECT');}}),calls=[],principal=Object.freeze({accountGeneration:'18446744073709551615',expiresMS:10}),project=Object.freeze({projectId:'PUBLIC-project',projectRevision:'3',expiresMS:10}),publisher=Object.freeze({publisherId:'PUBLIC-publisher',revision:'4',expiresMS:10}),publisherOriginal=new Uint8Array([1,2,3]),projectData=Object.freeze({principal,project,expiresMS:10}),publisherData=Object.freeze({principal,project,publisher,publisherOriginal,expiresMS:10});
module.exports={ref,calls,projectData,publisherData,acquireOriginalIDEProjectAuthority(){if(arguments.length!==0)throw Error('PUBLIC_ARGC');calls.push('acquire');return ref;},readOriginalIDECurrentProject(owner,id){if(arguments.length!==2||owner!==ref||id!=='PUBLIC-project')throw Error('PUBLIC_PROJECT_ORDER');calls.push('project');return projectData;},readOriginalIDECurrentPublisher(owner,projectID,publisherID){if(arguments.length!==3||owner!==ref||projectID!=='PUBLIC-project'||publisherID!=='PUBLIC-publisher')throw Error('PUBLIC_PUBLISHER_ORDER');calls.push('publisher');return publisherData;},closeOriginalIDEProjectAuthority(owner){if(arguments.length!==1||owner!==ref)throw Error('PUBLIC_CLOSE_ARGUMENTS');calls.push('close');return undefined;}};
`,`process.argv[1]='/PUBLIC/unrelated-script.mjs';const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs');const owner=api.acquireOriginalIDEProjectAuthority();assert.equal(owner,native.ref);assert.deepEqual(native.calls,['acquire']);assert.equal(api.readOriginalIDECurrentProject(owner,'PUBLIC-project'),native.projectData);const data=api.readOriginalIDECurrentPublisher(owner,'PUBLIC-project','PUBLIC-publisher');assert.equal(data,native.publisherData);assert.equal(data.publisherOriginal,native.publisherData.publisherOriginal);assert.equal(Object.isFrozen(data),true);assert.equal('authorized'in data,false);assert.equal('dataOnly'in data,false);assert.deepEqual(native.calls,['acquire','project','publisher']);assert.equal(api.closeOriginalIDEProjectAuthority(owner),undefined);assert.deepEqual(native.calls,['acquire','project','publisher','close']);`));
test('PUBLIC strict argc rejects before loading the fixed Native module',()=>run(`throw Error('PUBLIC_MUST_NOT_LOAD');`,`const bad=[[[{}]],[[],[{}],[{},'p','extra']],[[],[{},'p'],[{},'p','q','extra']],[[],[{},'extra']]];for(const [i,name]of ${JSON.stringify(names)}.entries())for(const args of bad[i])assert.throws(()=>api[name](...args),{code:'IDE_PROJECT_ARGUMENTS_INVALID'});`));
test('PUBLIC missing module or callee is null only for acquire; read and cleanup throw',()=>{
 for(const body of [null,'module.exports={};'])run(body,`assert.equal(api.acquireOriginalIDEProjectAuthority(),null);const args=${JSON.stringify(operands)};for(let i=1;i<4;i++)assert.throws(()=>api[${JSON.stringify(names)}[i]](...args[i]),{code:'IDE_PROJECT_IMPLEMENTATION_NOT_SUPPLIED'});`);
});
test('PUBLIC fixed loader refuses extension fallback and ignores caller provider environment',()=>run(null,`process.env.YNX_ORIGINAL_NATIVE_MODULE='/PUBLIC/foreign.cjs';assert.equal(api.acquireOriginalIDEProjectAuthority(),null);`,{suffixBody:`throw Error('PUBLIC_FALLBACK_FORBIDDEN');`}));
test('PUBLIC every direct callback preserves arbitrary falsy cause without retry',()=>{
 for(const literal of ['undefined','null','false','0',"''"])run(`const counts={};module.exports={counts};for(const name of ${JSON.stringify(names)})module.exports[name]=function(){counts[name]=(counts[name]||0)+1;throw ${literal};};`,`const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs'),args=${JSON.stringify(operands)};for(const [i,name]of ${JSON.stringify(names)}.entries()){let caught=false;try{api[name](...args[i]);}catch(cause){caught=true;assert.equal(cause,${literal});}assert.equal(caught,true);assert.equal(native.counts[name],1);}`);
});
test('PUBLIC original load, transitive and getter failures are not hidden',()=>{
 run(`throw Object.assign(Error('PUBLIC_LOAD_FAILURE'),{code:'ERR_DLOPEN_FAILED'});`,`assert.throws(()=>api.acquireOriginalIDEProjectAuthority(),{code:'ERR_DLOPEN_FAILED'});`);
 run(`require('./PUBLIC_missing_dependency.cjs');`,`assert.throws(()=>api.acquireOriginalIDEProjectAuthority(),{code:'MODULE_NOT_FOUND'});`);
 for(const [i,name]of names.entries())run(`Object.defineProperty(module.exports,${JSON.stringify(name)},{get(){throw false;}});`,`let caught=false;try{api[${JSON.stringify(name)}](...${JSON.stringify(operands[i])});}catch(cause){caught=true;assert.equal(cause,false);}assert.equal(caught,true);`);
});
test('PUBLIC retained partial UNKNOWN is not retried or converted into cleanup success',()=>run(`const ref=Object.freeze({}),first=Object.freeze({PUBLIC:'FIRST_UNKNOWN'}),calls=[];module.exports={ref,first,calls,acquireOriginalIDEProjectAuthority(){calls.push('acquire');return ref;},readOriginalIDECurrentProject(){calls.push('project');throw first;},closeOriginalIDEProjectAuthority(){calls.push('close');throw first;}};`,`const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs'),owner=api.acquireOriginalIDEProjectAuthority();assert.equal(owner,native.ref);for(const action of [()=>api.readOriginalIDECurrentProject(owner,'PUBLIC-project'),()=>api.closeOriginalIDEProjectAuthority(owner)]){let caught=false;try{action();}catch(cause){caught=true;assert.equal(cause,native.first);}assert.equal(caught,true);}assert.deepEqual(native.calls,['acquire','project','close']);`));
