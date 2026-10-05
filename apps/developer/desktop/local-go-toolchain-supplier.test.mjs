import{fileURLToPath}from'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import{constants}from'node:fs';import{createHash}from'node:crypto';
import{execFile as callbackExecFile}from'node:child_process';import{promisify}from'node:util';
import{prepareLocalGoToolchain}from'./local-go-toolchain-supplier.mjs';
const base='/Volumes/Data/Users/huangjiahao/.ynx-ide-build-artifacts-v2-20261005';
const selectedRoot='/opt/homebrew/Cellar/go/1.25.7_1/libexec',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const execFile=promisify(callbackExecFile);
const helperQA=await fs.mkdtemp(path.join(base,'go-supplier-path-helper-'));await fs.chmod(helperQA,0o700);const pathIdentityHelper=path.join(helperQA,'workspace-path-identity');await execFile('/usr/bin/clang',['-mmacosx-version-min=13.5',fileURLToPath(new URL('./macos/workspace-path-identity.c',import.meta.url)),'-o',pathIdentityHelper]);
async function fixture(){const qa=await fs.mkdtemp(path.join(base,'go-supplier-qa-'));await fs.chmod(qa,0o700);const support=path.join(qa,'support'),project=path.join(qa,'project');await fs.mkdir(support,{mode:0o700});await fs.mkdir(project,{mode:0o700});return{qa,support,project,options:{pathIdentityHelper,selectedRoot,supportRoot:support,writableRoots:[project]}};}
test('real full Go closure publishes, verifies versions/LICENSE and reuses exact private snapshot',{timeout:300000},async()=>{
 const h=await fixture();console.log('GO_SUPPLIER_QA',h.qa);// Only the disposable child changes its own umask. The App/process settings
 // and selected installed source are unchanged. Descriptor chmod preserves
 // exact SDK modes even under restrictive launch environments.
 const script=`import{prepareLocalGoToolchain}from ${JSON.stringify(new URL('./local-go-toolchain-supplier.mjs',import.meta.url).href)};process.umask(0o077);const cancel=new AbortController();const result=await prepareLocalGoToolchain({...${JSON.stringify(h.options)},signal:cancel.signal,onProgress:event=>{if(event.phase==='published')cancel.abort();}});if(!cancel.signal.aborted)throw Error('publication cancel was not observed');console.log(JSON.stringify(result));`;const {stdout}=await execFile(process.execPath,['--input-type=module','-e',script],{timeout:180000,maxBuffer:16384});const result=JSON.parse(stdout);assert.match(result.version,/go1.25.7 darwin\/arm64/);assert.equal(result.sha,'f088799ea6fa0e837755306c027d75345e761b3cd1b2a7db45c41ec14bd6500f');
 const receipt=JSON.parse(await fs.readFile(result.distributionPath,'utf8'));assert.ok(receipt.files.length>14000);assert.equal(receipt.source.path,selectedRoot);assert.deepEqual(await fs.readFile(path.join(result.root,'LICENSE')),await fs.readFile('/opt/homebrew/Cellar/go/1.25.7_1/LICENSE'));assert.equal(receipt.license.sha256,sha(await fs.readFile(path.join(result.root,'LICENSE'))));
 const inode=(await fs.stat(result.root)).ino;assert.deepEqual(await prepareLocalGoToolchain(h.options),result);assert.equal((await fs.stat(result.root)).ino,inode);
 const canceled=new AbortController();canceled.abort();await assert.rejects(prepareLocalGoToolchain({...h.options,signal:canceled.signal}));assert.equal((await fs.stat(result.root)).ino,inode);
 await fs.writeFile(path.join(h.qa,'observation.json'),JSON.stringify({result,source:selectedRoot,files:receipt.files.length,sourceTreeSha256:receipt.treeSha256,reuseSameInode:true,cancelRetainsPublished:true},null,2)+'\n',{flag:'wx',mode:0o600});
 // A manifest is never sufficient evidence: actual bytes are always rechecked.
 const damaged=path.join(result.root,'src/fmt/print.go'),original=await fs.readFile(damaged);await fs.writeFile(damaged,Buffer.concat([original,Buffer.from('\n// QA damage\n')]));await assert.rejects(prepareLocalGoToolchain(h.options),/snapshot is incomplete or changed/);assert.match(await fs.readFile(damaged,'utf8'),/QA damage/);
 await fs.writeFile(damaged,original);await fs.rename(result.distributionPath,path.join(h.qa,'retained-distribution.json'));await assert.rejects(prepareLocalGoToolchain(h.options),/metadata is missing/);assert.ok(await fs.stat(result.root));const originalReceipt=await fs.readFile(path.join(h.qa,'retained-distribution.json'));await fs.writeFile(result.distributionPath,'{bad metadata',{mode:0o600});await assert.rejects(prepareLocalGoToolchain(h.options),SyntaxError);assert.equal(await fs.readFile(result.distributionPath,'utf8'),'{bad metadata');await fs.writeFile(result.distributionPath,originalReceipt);assert.deepEqual(await prepareLocalGoToolchain(h.options),result);
});
test('real source inventory changes and cancellation are rejected; only unpublished stages are removed',{timeout:300000},async()=>{
 const h=await fixture();console.log('GO_MUTATION_QA',h.qa);const source=path.join(h.qa,'selected-go');await fs.cp(selectedRoot,source,{recursive:true,mode:constants.COPYFILE_FICLONE});await fs.chmod(source,0o700);await fs.copyFile('/opt/homebrew/Cellar/go/1.25.7_1/LICENSE',path.join(source,'LICENSE'));const options={...h.options,selectedRoot:source};
 const cases=[
  {name:'changed',apply:()=>fs.appendFile(path.join(source,'README.md'),'\nQA source change\n')},
  {name:'added',apply:()=>fs.writeFile(path.join(source,'NEW_QA_FILE'),'QA',{flag:'wx'})},
  {name:'late-added',phase:'before-publish',apply:()=>fs.writeFile(path.join(source,'LATE_QA_FILE'),'QA',{flag:'wx'})},
  {name:'replaced-directory',phase:'before-publish',apply:async()=>{const old=path.join(h.qa,'preserved-fmt');await fs.rename(path.join(source,'src/fmt'),old);await fs.cp(old,path.join(source,'src/fmt'),{recursive:true});}},
  {name:'deleted',apply:()=>fs.rename(path.join(source,'README.md'),path.join(h.qa,'preserved-deleted-readme'))},
 ];
 // Each change occurs after the initial inventory and before copying. No
 // modified installed source or previously published snapshot is used here.
 for(const example of cases){await assert.rejects(prepareLocalGoToolchain({...options,onProgress:async event=>{if(event.phase===(example.phase||'source-scanned'))await example.apply();}}),/source changed|inventory|directory changed|ENOENT/);const entries=await fs.readdir(path.join(h.support,'toolchains/go'));assert.deepEqual(entries,[]);}
 const abort=new AbortController();await assert.rejects(prepareLocalGoToolchain({...options,signal:abort.signal,onProgress:event=>{if(event.phase==='source-scanned')abort.abort();}}));assert.deepEqual(await fs.readdir(path.join(h.support,'toolchains/go')),[]);
 const copiedAbort=new AbortController();await assert.rejects(prepareLocalGoToolchain({...options,signal:copiedAbort.signal,onProgress:event=>{if(event.phase==='copied')copiedAbort.abort();}}));assert.deepEqual(await fs.readdir(path.join(h.support,'toolchains/go')),[]);
 // Symlink closure and source directory replacement cannot be admitted.
 await fs.symlink(path.join(source,'bin/go'),path.join(source,'unsafe-link'));await assert.rejects(prepareLocalGoToolchain(options),/unsafe|noncanonical/);
});
test('private support overlap, aliases, group-write ancestors and nonprivate roots fail closed',async()=>{
 const h=await fixture();await assert.rejects(prepareLocalGoToolchain({...h.options,writableRoots:[h.qa]}),/covered by a project/);
 const alias=path.join(h.qa,'support-link');await fs.symlink(h.support,alias);await assert.rejects(prepareLocalGoToolchain({...h.options,supportRoot:alias}),/canonical/);
 await fs.chmod(h.qa,0o775);await assert.rejects(prepareLocalGoToolchain(h.options),/ancestors are writable/);await fs.chmod(h.qa,0o700);
 await fs.chmod(h.support,0o755);await assert.rejects(prepareLocalGoToolchain(h.options),/private directory/);
});
