import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const source=await readFile(new URL('./package-local-macos.sh',import.meta.url),'utf8');
function fragment(name){const begin='# YNX_MACOS_'+name+'_BEGIN',end='# YNX_MACOS_'+name+'_END';assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);return source.slice(source.indexOf(begin)+begin.length,source.indexOf(end));}
const selection=fragment('PACKAGE_STAGE_SELECTION'),boundary=fragment('APP_STAGE_BOUNDARY');
async function fixture(work){const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-app-stage-'))),app=join(root,'PUBLIC.app');await mkdir(join(app,'Contents/Resources'),{recursive:true});await writeFile(join(app,'Contents/Resources/build-provenance.json'),JSON.stringify({sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40)}));try{await work({root,app});}finally{await rm(root,{recursive:true,force:true});}}
function run(f,value){const env={...process.env,PATH:dirname(process.execPath)+':/usr/bin:/bin',PUBLIC_APP:f.app,PUBLIC_ROOT:f.root};delete env.YNX_DEVELOPER_MACOS_PACKAGE_STAGE;if(value!==undefined)env.YNX_DEVELOPER_MACOS_PACKAGE_STAGE=value;
 // Execute the exact production selector and App boundary, not a copied branch.
 // App build/sign checks are ordering assertions below, not claimed fixture QA.
 return spawnSync('/bin/bash',['-c',`set -euo pipefail\napp="$PUBLIC_APP"\nroot="$PUBLIC_ROOT"\nsource_commit=${'a'.repeat(40)}\nsource_tree=${'b'.repeat(40)}\n${selection}\n${boundary}\nprintf '%s\\n' DMG_STAGE_SENTINEL\n`],{env,encoding:'utf8'});}
test('App boundary follows unchanged mandatory checks and precedes original image producer',()=>{
 const at=source.indexOf('# YNX_MACOS_APP_STAGE_BOUNDARY_BEGIN');
 for(const check of ['node scripts/build-output-root.mjs verify "$root"','node scripts/package-macos-branding.mjs verify-app "$app"','/usr/bin/codesign --verify --deep --strict "$app"'])assert.ok(source.lastIndexOf(check,at)>=0,check);
 assert.ok(at<source.indexOf('dmg_root="$root/dmg-root"'));
 assert.ok(source.includes('node scripts/package-macos-branding.mjs dmg "$dmg_root" "$branding_root" "$dmg"'));
 assert.doesNotMatch(boundary,/hdiutil|createBrandedDmg|cp -cR/);
 assert.ok(source.indexOf('# YNX_MACOS_PACKAGE_STAGE_SELECTION_BEGIN')<source.indexOf('repo_root='),'invalid stage must fail before build inputs/tests');
});
test('explicit App stage stops before DMG and records that images and publication were not completed',()=>fixture(async f=>{const r=run(f,'app');assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/DMG_STAGE_SENTINEL/);const receipt=JSON.parse(await readFile(join(f.root,'app-stage.json'),'utf8'));assert.equal(receipt.stage,'app');assert.equal(receipt.requestedStage,'app');assert.deepEqual(receipt.dmg,{state:'not-requested',created:false,mounted:false});assert.match(receipt.signing,/not Developer ID/);assert.equal(receipt.sourceCommit,'a'.repeat(40));}));
for(const mode of [undefined,'full'])test('normal '+String(mode)+' stage preserves continuation into original DMG path',()=>fixture(async f=>{const r=run(f,mode);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/DMG_STAGE_SENTINEL/);const receipt=JSON.parse(await readFile(join(f.root,'app-stage.json'),'utf8'));assert.equal(receipt.dmg.state,'pending');assert.equal(receipt.dmg.created,false);assert.equal(receipt.dmg.mounted,false);}));
for(const mode of ['','APP','skip-security','app;echo BAD'])test('invalid explicit stage '+JSON.stringify(mode)+' refuses before output',()=>fixture(async f=>{const r=run(f,mode);assert.equal(r.status,2);assert.doesNotMatch(r.stdout,/DMG_STAGE_SENTINEL|BAD/);await assert.rejects(stat(join(f.root,'app-stage.json')),{code:'ENOENT'});}));
test('App provenance drift refuses the boundary instead of emitting a success receipt',()=>fixture(async f=>{await writeFile(join(f.app,'Contents/Resources/build-provenance.json'),JSON.stringify({sourceCommit:'c'.repeat(40),sourceTree:'b'.repeat(40)}));const r=run(f,'app');assert.notEqual(r.status,0);assert.match(r.stderr,/provenance differs/);await assert.rejects(stat(join(f.root,'app-stage.json')),{code:'ENOENT'});}));
test('stage receipt cannot replace a previous result',()=>fixture(async f=>{assert.equal(run(f,'app').status,0);const before=await readFile(join(f.root,'app-stage.json'));const result=run(f,'app');assert.notEqual(result.status,0);assert.deepEqual(await readFile(join(f.root,'app-stage.json')),before);}));
