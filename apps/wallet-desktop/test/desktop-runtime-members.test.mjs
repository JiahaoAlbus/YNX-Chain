import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertCanonicalRuntimeMembers,assertExcludedRuntimeNotTracked,UNFROZEN_POLICY_INPUT,UNFROZEN_POLICY_PACK_FILTER} from '../scripts/desktop-runtime-members.mjs';
import {assertSDKRuntimePackCoverage} from '../scripts/release-provenance.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url)),app=path.join(root,'apps/wallet-desktop'),metadata=fs.readFileSync(path.join(app,'package.json'));
test('membership readback reports the complete foreign runtime set without granting any namespace exemption',()=>{
 const allowed=new Set(['code/apps/wallet-desktop/src/main.mjs']),foreign=[{path:'code/'+UNFROZEN_POLICY_INPUT,type:'file',bytes:8799,sha256:'f76fe1b4805e4a4163bf2155c26612ce215ef3cdf181169c4b35876435cd3e80'},{path:'code/packages/wallet-auth/native/other.mjs',type:'file',bytes:1,sha256:'0'.repeat(64)}],rows=[{path:'code/apps/wallet-desktop/src/main.mjs',type:'file'},...foreign];
 assert.throws(()=>assertCanonicalRuntimeMembers(rows,allowed),e=>{assert.equal(e.unlistedRuntimeMembers.length,2);assert.deepEqual(e.unlistedRuntimeMembers.map(r=>r.path),foreign.map(r=>r.path));assert(Object.isFrozen(e.unlistedRuntimeMembers));return true});
 assertCanonicalRuntimeMembers(rows.slice(0,1),allowed);assert.equal(allowed.size,1);
});
test('normal pack filter excludes exactly the unfrozen leftover and keeps every frozen policy source selected',()=>{
 const pkg=JSON.parse(metadata),{FileMatcher}=createRequire(import.meta.url)('app-builder-lib/out/fileMatcher'),selected=new FileMatcher(app,'/PUBLIC/not-an-output',v=>v,pkg.build.files).createFilter(),stat={isDirectory:()=>false};
 assert(pkg.build.files.includes(UNFROZEN_POLICY_PACK_FILTER));assert.equal(selected(path.join(app,UNFROZEN_POLICY_INPUT.slice('apps/wallet-desktop/'.length)),stat),false);
 const names=execFileSync('git',['ls-tree','-r','--name-only','33edc5e92def9405b1ee77b58ae269ca653b7bfb','--','apps/wallet-desktop/src/original-policy-supplier'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.mjs'));
 assert.equal(names.length,16);for(const name of names)assert.equal(selected(path.join(root,name),stat),true,name);
 assert.equal(selected(path.join(app,'src/original-policy-supplier/unlisted-other.mjs'),stat),true,'other foreign files remain strict readback refusals');
});
test('normal preflight refuses a future committed source that conflicts with this finite exclusion',t=>{
 assert.doesNotThrow(()=>assertExcludedRuntimeNotTracked([]));assert.throws(()=>assertExcludedRuntimeNotTracked([UNFROZEN_POLICY_INPUT]),/Committed runtime conflicts/);
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-runtime-exclusion-'));t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
 for(const[name,bytes]of [[UNFROZEN_POLICY_INPUT,Buffer.from('PUBLIC source only')],['apps/wallet-desktop/package.json',metadata]]){const file=path.join(fixture,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 const git=(...a)=>execFileSync('git',a,{cwd:fixture,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','Future tracked runtime cannot be silently excluded');
 assert.throws(()=>assertSDKRuntimePackCoverage(path.join(fixture,'apps/wallet-desktop'),'HEAD'),/Committed runtime conflicts with finite build exclusion/);
});
