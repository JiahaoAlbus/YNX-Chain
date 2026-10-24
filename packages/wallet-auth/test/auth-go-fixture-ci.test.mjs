import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {prepareAuthGoFixtureCIData} from '../scripts/auth-go-fixture-ci.mjs';
const goPrefix='internal/developerauthority/',testFile=goPrefix+'original_source_process_test.go';
const old='const fixtureNode = "/Users/huangjiahao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"',hash=b=>createHash('sha256').update(b).digest('hex');
// PUBLIC dummy Go/JSON/SQL only. This suite never invokes Go or a server.
function fixture(run){const root=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-auth-go-CI-PUBLIC-'))),fixtureRoot=path.join(root,'original'),outputRoot=path.join(root,'prepared');fs.mkdirSync(fixtureRoot);const files=[];
 const put=(name,raw)=>{const file=path.join(fixtureRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);files.push({path:name,bytes:Buffer.byteLength(raw),sha256:hash(raw)});};
 put(testFile,'package original\n'+old+'\n// PUBLIC test-only constant\n');for(let i=0;i<26;i++)put(goPrefix+'source_'+i+'.go','package original\n// unchanged PUBLIC production '+i+'\n');put('packages/wallet-auth/test/fixtures/native-control-public-interop.json','{"PUBLIC":true}');put('packages/wallet-auth/test/fixtures/native-control-154a7b211-public-interop.json','{"PUBLIC":true}');put(goPrefix+'control_capture_schema.sql','-- PUBLIC unchanged SQL\n');
 const input={fixtureRoot,files,nodeExecutable:fs.realpathSync(process.execPath),outputRoot},call=()=>prepareAuthGoFixtureCIData(input),repin=name=>{const raw=fs.readFileSync(path.join(fixtureRoot,name)),p=files.find(p=>p.path===name);p.bytes=raw.length;p.sha256=hash(raw);};
 try{return run({root,fixtureRoot,outputRoot,files,input,call,repin});}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('PUBLIC CI copy changes only one exact test Node constant and preserves all original/production bytes',()=>fixture(({fixtureRoot,outputRoot,files,call,input})=>{
 const result=call();assert.equal(result.preparedFiles.length,30);assert.equal(result.testOnlyNodeConstant.replacements,1);assert.equal(result.originalProductionUnchanged,true);assert.equal(result.GoExecuted,false);assert.equal(result.Source,false);assert.equal(result.Root,false);assert.equal(result.Native,false);assert.ok(Object.isFrozen(result.preparedFiles[0]));
 for(const pin of files){const original=fs.readFileSync(path.join(fixtureRoot,pin.path)),prepared=fs.readFileSync(path.join(outputRoot,pin.path));assert.equal(hash(original),pin.sha256);if(pin.path===testFile)assert.equal(prepared.toString(),original.toString().replace(old,'const fixtureNode = '+JSON.stringify(input.nodeExecutable)));else assert.ok(prepared.equals(original));}
 assert.throws(call,{code:'EEXIST'});
}));
test('CI fixture refuses tamper, path escape, duplicates and extras before making output',()=>{
 fixture(({fixtureRoot,call,outputRoot})=>{fs.appendFileSync(path.join(fixtureRoot,goPrefix+'source_0.go'),'tamper');assert.throws(call,{code:'AUTH_GO_FIXTURE_INPUT_DIFFERS'});assert.ok(!fs.existsSync(outputRoot));});
 fixture(({files,call})=>{files[0].path='../outside.go';assert.throws(call,{code:'AUTH_GO_FIXTURE_PATH'});});
 fixture(({files,call})=>{files[1]={...files[0]};assert.throws(call,{code:'AUTH_GO_FIXTURE_SCOPE'});});
 fixture(({fixtureRoot,call})=>{fs.writeFileSync(path.join(fixtureRoot,'extra.go'),'package original');assert.throws(call,{code:'AUTH_GO_FIXTURE_EXTRA_OR_MISSING'});});
});
test('CI fixture rejects source symlinks, output aliases, another Node and excessive material',()=>{
 fixture(({fixtureRoot,call})=>{const file=path.join(fixtureRoot,goPrefix+'source_0.go');fs.unlinkSync(file);fs.symlinkSync('source_1.go',file);assert.throws(call,{code:'AUTH_GO_FIXTURE_SYMLINK'});});
 fixture(({input,fixtureRoot,call})=>{input.outputRoot=path.join(fixtureRoot,'copy');assert.throws(call,{code:'AUTH_GO_FIXTURE_OUTPUT_SCOPE'});});
 fixture(({root,input,call})=>{const alias=path.join(root,'node-alias');fs.symlinkSync(input.nodeExecutable,alias);input.nodeExecutable=alias;assert.throws(call,{code:'AUTH_GO_FIXTURE_NODE'});});
 fixture(({files,call})=>{files[0].bytes=2097153;assert.throws(call,{code:'AUTH_GO_FIXTURE_PIN'});});
});
test('CI fixture requires the exact single real test constant, without touching a production constant',()=>{
 for(const text of ['package original\n',old+'\n'+old+'\n','package original\n// '+old+'\n'])fixture(({fixtureRoot,repin,call})=>{fs.writeFileSync(path.join(fixtureRoot,testFile),text);repin(testFile);assert.throws(call,{code:'AUTH_GO_FIXTURE_NODE_CONSTANT'});});
 fixture(({fixtureRoot,repin,outputRoot,call})=>{const file=goPrefix+'source_0.go';fs.writeFileSync(path.join(fixtureRoot,file),'package original\n'+old+'\n');repin(file);call();assert.ok(fs.readFileSync(path.join(fixtureRoot,file)).equals(fs.readFileSync(path.join(outputRoot,file))));});
});
test('normal fixture CLI only prepares a fresh exclusive copy and reports false execution flags',()=>fixture(({root,input,outputRoot})=>{
 const request=path.join(root,'request.json'),{outputRoot:unused,...body}=input;fs.writeFileSync(request,JSON.stringify(body));const script=fileURLToPath(new URL('../scripts/auth-go-fixture-ci.mjs',import.meta.url)),r=JSON.parse(execFileSync(process.execPath,[script,'--request',request,'--output',outputRoot],{encoding:'utf8'}));assert.equal(r.prepared,true);assert.equal(r.GoExecuted,false);assert.equal(r.GoServer,false);assert.equal(r.production,false);assert.equal(r.originalFiles.length,30);
}));
test('formal fixture layout requires the exact Go prefix, SQL path and two PUBLIC JSON leaves',()=>{
 fixture(({files,call})=>{files[1].path='source_0.go';assert.throws(call,{code:'AUTH_GO_FIXTURE_SCOPE'});});
 fixture(({files,call})=>{files.find(p=>p.path.endsWith('.sql')).path=goPrefix+'other.sql';assert.throws(call,{code:'AUTH_GO_FIXTURE_SCOPE'});});
 fixture(({files,call})=>{files.find(p=>p.path.endsWith('native-control-public-interop.json')).path='packages/wallet-auth/test/fixtures/other-public.json';assert.throws(call,{code:'AUTH_GO_FIXTURE_SCOPE'});});
});
