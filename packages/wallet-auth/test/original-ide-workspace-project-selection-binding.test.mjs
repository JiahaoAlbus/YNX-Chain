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
 const root=mkdtempSync(join(tmpdir(),'ynx-PUBLIC-workspace-selector-'));
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
const names=['acquireOriginalIDEWorkspaceProjectSelection','readOriginalIDEWorkspaceProjectSelection','closeOriginalIDEWorkspaceProjectSelection'];
const args=[['/PUBLIC/workspace','/PUBLIC/profile','PUBLIC-local-id'],[{}],[{}]];
test('PUBLIC workspace selector imports remain cold',()=>run("throw Error('PUBLIC_MUST_NOT_LOAD');",`for(const name of ${JSON.stringify(names)})assert.equal(typeof api[name],'function');`));
test('PUBLIC exact launch operands, unread same partial, original frozen DATA and undefined cleanup',()=>run(`
const ref=new Proxy(Object.freeze({}),{get(){throw Error('PUBLIC_PARTIAL_MUST_NOT_READ');}}),calls=[],data=Object.freeze({projectId:'PUBLIC-canonical',publisherId:null,projectRevision:'18446744073709551615',catalogRevision:'2',expiresMS:9000});module.exports={ref,calls,data,acquireOriginalIDEWorkspaceProjectSelection(workspace,profile,id){if(arguments.length!==3||workspace!=='/PUBLIC/workspace'||profile!=='/PUBLIC/profile'||id!=='PUBLIC-local-id')throw Error('PUBLIC_OPERANDS');calls.push('acquire');return ref;},readOriginalIDEWorkspaceProjectSelection(owner){if(arguments.length!==1||owner!==ref)throw Error('PUBLIC_OWNER');calls.push('read');return data;},closeOriginalIDEWorkspaceProjectSelection(owner){if(arguments.length!==1||owner!==ref)throw Error('PUBLIC_OWNER');calls.push('close');return undefined;}};
`,`process.argv[1]='/PUBLIC/unrelated.mjs';const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs');const ref=api.acquireOriginalIDEWorkspaceProjectSelection('/PUBLIC/workspace','/PUBLIC/profile','PUBLIC-local-id');assert.equal(ref,native.ref);assert.deepEqual(native.calls,['acquire']);const data=api.readOriginalIDEWorkspaceProjectSelection(ref);assert.equal(data,native.data);assert.equal(data.publisherId,null);assert.equal(Object.isFrozen(data),true);assert.equal('authorized'in data,false);assert.equal('dataOnly'in data,false);assert.deepEqual(native.calls,['acquire','read']);assert.equal(api.closeOriginalIDEWorkspaceProjectSelection(ref),undefined);assert.deepEqual(native.calls,['acquire','read','close']);`));
test('PUBLIC strict argument counts reject before Native loading',()=>run("throw Error('PUBLIC_MUST_NOT_LOAD');",`for(const args of [[],['w'],['w','p'],['w','p','id','provider']])assert.throws(()=>api.acquireOriginalIDEWorkspaceProjectSelection(...args),{code:'IDE_WORKSPACE_PROJECT_ARGUMENTS'});for(const name of ['readOriginalIDEWorkspaceProjectSelection','closeOriginalIDEWorkspaceProjectSelection'])for(const args of [[],[{},'extra']])assert.throws(()=>api[name](...args),{code:'IDE_WORKSPACE_PROJECT_ARGUMENTS'});`));
test('PUBLIC absent original module or callee preserves unavailable versus failure',()=>{
for(const body of [null,'module.exports={};'])run(body,`assert.equal(api.acquireOriginalIDEWorkspaceProjectSelection('w','p','id'),null);for(const name of ['readOriginalIDEWorkspaceProjectSelection','closeOriginalIDEWorkspaceProjectSelection'])assert.throws(()=>api[name]({}),{code:'IDE_WORKSPACE_PROJECT_IMPLEMENTATION_NOT_SUPPLIED'});`);
});
test('PUBLIC fixed path rejects extension fallback and ignores provider environment',()=>run(null,`process.env.YNX_ORIGINAL_NATIVE_MODULE='/PUBLIC/foreign.cjs';assert.equal(api.acquireOriginalIDEWorkspaceProjectSelection('w','p','id'),null);`,{suffixBody:"throw Error('PUBLIC_FALLBACK_FORBIDDEN');"}));
test('PUBLIC callbacks preserve arbitrary falsy failures and do not retry',()=>{
for(const literal of ['undefined','null','false','0',"''"])run(`const counts={};module.exports={counts};for(const name of ${JSON.stringify(names)})module.exports[name]=function(){counts[name]=(counts[name]||0)+1;throw ${literal};};`,`const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs'),args=${JSON.stringify(args)};for(const [i,name]of ${JSON.stringify(names)}.entries()){let caught=false;try{api[name](...args[i]);}catch(cause){caught=true;assert.equal(cause,${literal});}assert.equal(caught,true);assert.equal(native.counts[name],1);}`);
});
test('PUBLIC load, transitive and getter failures are not swallowed',()=>{
run("throw Object.assign(Error('PUBLIC_LOAD_FAILURE'),{code:'ERR_DLOPEN_FAILED'});","assert.throws(()=>api.acquireOriginalIDEWorkspaceProjectSelection('w','p','id'),{code:'ERR_DLOPEN_FAILED'});");
run("require('./PUBLIC_missing_dependency.cjs');","assert.throws(()=>api.acquireOriginalIDEWorkspaceProjectSelection('w','p','id'),{code:'MODULE_NOT_FOUND'});");
for(const [i,name]of names.entries())run(`Object.defineProperty(module.exports,${JSON.stringify(name)},{get(){throw 0;}});`,`let caught=false;try{api[${JSON.stringify(name)}](...${JSON.stringify(args[i])});}catch(cause){caught=true;assert.equal(cause,0);}assert.equal(caught,true);`);
});
test('PUBLIC partial and sticky UNKNOWN remain closable without automatic retry',()=>run(`const ref=Object.freeze({}),first=Object.freeze({PUBLIC:'FIRST_UNKNOWN'}),calls=[];module.exports={ref,first,calls,acquireOriginalIDEWorkspaceProjectSelection(){calls.push('acquire');return ref;},readOriginalIDEWorkspaceProjectSelection(){calls.push('read');throw first;},closeOriginalIDEWorkspaceProjectSelection(){calls.push('close');throw first;}};`,`const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs'),ref=api.acquireOriginalIDEWorkspaceProjectSelection('w','p','id');assert.equal(ref,native.ref);for(const action of [()=>api.readOriginalIDEWorkspaceProjectSelection(ref),()=>api.closeOriginalIDEWorkspaceProjectSelection(ref)]){let caught=false;try{action();}catch(cause){caught=true;assert.equal(cause,native.first);}assert.equal(caught,true);}assert.deepEqual(native.calls,['acquire','read','close']);`));
