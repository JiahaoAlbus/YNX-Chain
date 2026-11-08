import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {BUNDLES,stagePublicRuntime} from './prepare-public-runtime.mjs';
const root=import.meta.dirname,originals=JSON.parse(fs.readFileSync(root+'/ORIGINALS.json'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('portable package has exact two soleSDK fixture mirrors and six closed bundles',()=>{
 assert.equal(originals.sdkCommit,'d269e8798fdcdc55379760a90fa1813550177591');assert.equal(BUNDLES.length,6);
 for(const r of originals.sdkFixtures){const b=fs.readFileSync(path.join(root,r.testOnlyMirror));assert.equal(b.length,r.bytes);assert.equal(hash(b),r.sha256)}
});
test('portable Go/JS fixture inputs avoid workstation paths and keep empty-env facts bootstrap',()=>{
 const go=fs.readFileSync(root+'/go/packages/auth-grant-runtime/go/public_qualified_receiver_candidate.go','utf8');
 const p08=fs.readFileSync(root+'/go/internal/aiproduct/link_qualified_receiver_candidate_test.go','utf8');
 const js=fs.readFileSync(root+'/public-fixture.mjs','utf8');
 for(const text of [go,p08,js])assert.doesNotMatch(text,/\/Users\/huangjiahao|\/Volumes\/|\/opt\/homebrew/);
 assert.match(go,/os\.Getenv\("PUBLIC_RECEIVER_NODE"\)/);assert.match(go,/"PUBLICSDKRoot": root/);
 assert.match(go,/exec\.Command\(receiverNode/);assert.match(go,/candidateShellQuote\(receiverNode\)/);
 assert.match(p08,/os\.MkdirTemp\(os\.Getenv\("LINK_RECEIVER_CANDIDATE_SOCKET_ROOT"\)/);
 assert.match(js,/testConfig\.PUBLICSDKRoot/);assert.match(js,/PUBLIC_SDK_ROOT_CHANGED/);
 assert.doesNotMatch(js,/process\.env/);
});
test('stager rejects a mismatched original before creating output',()=>{
 const base=fs.mkdtempSync(path.join(root,'fs-control-'));try{
 const dirs=['sdk','fixtures','safe','evidence'].map(n=>{const p=path.join(base,n);fs.mkdirSync(p,{mode:0o700});return p});
 const runner=path.join(base,'runner.mjs');fs.writeFileSync(runner,'PUBLIC');fs.writeFileSync(path.join(dirs[0],'package.json'),'{}');
 const before=fs.readdirSync(dirs[2]);assert.throws(()=>stagePublicRuntime({sdkRoot:dirs[0],fixturesRoot:dirs[1],safeParent:dirs[2],evidence:dirs[3],runner},{sdkRequired:[{relativePath:'package.json',bytes:2,sha256:'0'.repeat(64)}],sdkFixtures:[],authRunner:{bytes:6,sha256:hash(Buffer.from('PUBLIC'))}}),/pin mismatch/);assert.deepEqual(fs.readdirSync(dirs[2]),before);
 }finally{fs.rmSync(base,{recursive:true})}
});
test('stager rejects a symlink safe parent before creating output',()=>{
 const base=fs.mkdtempSync(path.join(root,'fs-control-'));try{
 const target=path.join(base,'target');fs.mkdirSync(target);const alias=path.join(base,'alias');fs.symlinkSync(target,alias);
 const before=fs.readdirSync(target);assert.throws(()=>stagePublicRuntime({sdkRoot:base,fixturesRoot:base,safeParent:alias,evidence:base,runner:path.join(base,'never')},originals),/canonical absolute/);assert.deepEqual(fs.readdirSync(target),before);
 }finally{fs.rmSync(base,{recursive:true})}
});
test('mechanical staging copies only the closed provider families and both soleSDK fixtures',()=>{
 const base=fs.mkdtempSync(path.join(root,'fs-control-'));try{
 const dirs=Object.fromEntries(['sdk','fixtures','safe','evidence'].map(n=>{const p=path.join(base,n);fs.mkdirSync(p,{mode:0o700});return[n,p]}));
 for(const n of ['native','src'])fs.mkdirSync(path.join(dirs.sdk,n));
 const make=(rel,body)=>{const p=path.join(dirs.sdk,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);return{relativePath:rel,bytes:Buffer.byteLength(body),sha256:hash(Buffer.from(body))}};
 const required=[make('package.json','{"PUBLIC":true}'),make('native/public.mjs','// PUBLIC fixture metadata only'),make('src/public.js','// PUBLIC fixture metadata only')];
 for(const b of BUNDLES)make('node_modules/'+b+'/package.json','{}');make('node_modules/foreign-provider/package.json','{}');
 const fixtureNames=['task-read-receiver-source.fixture.mjs','source-v2-public.fixture.mjs'];for(const f of fixtureNames)fs.writeFileSync(path.join(dirs.fixtures,f),'// PUBLIC');
 const runner=path.join(base,'runner.mjs');fs.writeFileSync(runner,'// ORIGINAL PUBLIC');
 const result=stagePublicRuntime({sdkRoot:dirs.sdk,fixturesRoot:dirs.fixtures,safeParent:dirs.safe,evidence:dirs.evidence,runner},{sdkCommit:'PUBLIC-ONLY',sdkRequired:required,sdkFixtures:fixtureNames.map(relativePath=>({relativePath,bytes:9,sha256:hash(Buffer.from('// PUBLIC'))})),authRunner:{bytes:18,sha256:hash(Buffer.from('// ORIGINAL PUBLIC'))}});
 assert.equal(result.cryptoExecuted,false);assert.equal(result.RootAdmission,false);assert.equal(result.copies.length,12);assert.equal(fs.existsSync(path.join(result.root,'node_modules/foreign-provider')),false);for(const f of fixtureNames)assert.equal(fs.readFileSync(path.join(result.root,'test/fixtures',f),'utf8'),'// PUBLIC');
 }finally{fs.rmSync(base,{recursive:true})}
});
