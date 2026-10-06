import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {preparePrivatePluginCopy,verifiedPluginSessionExit} from './local-plugin-copy.mjs';
const base=await realpath(process.env.TMPDIR || (await import("node:os")).tmpdir());
test('reaped PID exit-zero and late close are not descendant cleanup receipts',()=>{
 for(const cleanupStdout of [undefined,'','YNX_PROCESS_TREE_CLEANUP_VERIFIED','other\n']) assert.equal(verifiedPluginSessionExit({backendClosed:true,cleanupStdout}),false);
 assert.equal(verifiedPluginSessionExit({backendClosed:false,cleanupStdout:'YNX_PROCESS_TREE_CLEANUP_VERIFIED\n'}),false);
 assert.equal(verifiedPluginSessionExit({backendClosed:true,cleanupStdout:'YNX_PROCESS_TREE_CLEANUP_VERIFIED\n'}),true);
});
test('copy ENOSPC cleans only unpublished partial copy and permits retry',async t=>{
 const root=await mkdtemp(join(base,'partial-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'extensions-active'));await writeFile(join(root,'extensions-active','state'),'retain');
 const failure=Object.assign(Error('disk full'),{code:'ENOSPC'});
 await assert.rejects(preparePrivatePluginCopy(root,async session=>{await mkdir(join(session,'plugins'));await writeFile(join(session,'plugins','partial'),'partial');throw failure;}),e=>e===failure&&!e.pluginCopyCleanupError);
 assert.deepEqual(await readdir(root),['extensions-active']);
 const plugins=await preparePrivatePluginCopy(root,async session=>{await mkdir(join(session,'plugins'));await writeFile(join(session,'plugins','entry'),'ok');});
 assert.equal(await readFile(join(plugins,'entry'),'utf8'),'ok');
 assert.equal(await readFile(join(root,'extensions-active','state'),'utf8'),'retain');
});
test('replacement symlink never deletes unrelated project',async t=>{
 const root=await mkdtemp(join(base,'replaced-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const other=join(root,'project');await mkdir(other);await writeFile(join(other,'source'),'retain');
 const failure=Error('copy failed');
 await assert.rejects(preparePrivatePluginCopy(root,async session=>{await rename(session,session+'-old');await symlink(other,session);throw failure;}),e=>e===failure&&/identity changed/.test(e.pluginCopyCleanupError.message));
 assert.equal(await readFile(join(other,'source'),'utf8'),'retain');
});
test('verification or receipt failure also releases unpublished staging',async t=>{
 const root=await mkdtemp(join(base,'verify-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await assert.rejects(preparePrivatePluginCopy(root,async session=>{await mkdir(join(session,'plugins'));throw Error('digest mismatch');}),/digest mismatch/);
 assert.deepEqual(await readdir(root),[]);
});
async function fixture(t) {
 const root=await mkdtemp(join(base,'plugin-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const copy=await preparePrivatePluginCopy(root,async session=>{await mkdir(join(session,'plugins'));await writeFile(join(session,'plugins','entry'),'owned');},{lifecycle:true});
 return {root,copy};
}
test('normal verified session shutdown removes only owned copy; close is idempotent',async t=>{
 const {root,copy}=await fixture(t);await mkdir(join(root,'extensions-other'));await writeFile(join(root,'extensions-other','entry'),'other');
 copy.beginLaunch();assert.equal(await copy.cleanup(),false);assert.equal(await readFile(join(copy.plugins,'entry'),'utf8'),'owned');
 const closing=copy.cleanup({confirmedSessionExited:true});assert.equal(copy.cleanup({confirmedSessionExited:true}),closing);assert.equal(await closing,true);
 assert.equal(await copy.cleanup(),true);assert.deepEqual(await readdir(root),['extensions-other']);
 assert.throws(()=>copy.beginLaunch(),/cannot be launched again/);
});
test('startup failure before launch releases prepared copy and blocks late launch',async t=>{
 const {root,copy}=await fixture(t);const closed=copy.cleanup();assert.throws(()=>copy.beginLaunch(),/cannot be launched again/);assert.equal(await closed,true);assert.deepEqual(await readdir(root),[]);
});
test('unknown exit and live session keep copy until all-session proof arrives',async t=>{
 const {copy}=await fixture(t);copy.beginLaunch();assert.equal(await copy.cleanup({confirmedSessionExited:false}),false);
 assert.equal(await copy.cleanup(),false);assert.equal(await readFile(join(copy.plugins,'entry'),'utf8'),'owned');
 assert.equal(await copy.cleanup({confirmedSessionExited:true}),true);
});
test('successful-copy replacement inode is retained even with confirmed shutdown',async t=>{
 const {copy}=await fixture(t);copy.beginLaunch();const original=copy.plugins.slice(0,-'/plugins'.length);
 await rename(original,original+'-retained');await mkdir(original);await writeFile(join(original,'replacement'),'retain');
 await assert.rejects(copy.cleanup({confirmedSessionExited:true}),/identity changed/);
 assert.equal(await readFile(join(original,'replacement'),'utf8'),'retain');assert.equal(await readFile(join(original+'-retained','plugins','entry'),'utf8'),'owned');
});

test('capacity preflight reports bounded copy fallback and shortfall without creating a partial copy',async t=>{
 const {assertPluginCopyCapacity}=await import('./local-plugin-copy.mjs');const root=await mkdtemp(join(base,'plugin-space-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source');await mkdir(source);await writeFile(join(source,'entry'),'small');
 const low=async()=>({bsize:4096n,bavail:1n});
 await assert.rejects(assertPluginCopyCapacity(root,source,{filesystem:low,reserveBytes:8192}),error=>error.code==='YNX_PLUGIN_COPY_SPACE'&&error.requiredBytes==='16384'&&error.availableBytes==='4096'&&error.missingBytes==='12288'&&/Free at least/.test(error.message));
 assert.deepEqual(await readdir(root),['source']);
 const ok=await assertPluginCopyCapacity(root,source,{filesystem:async()=>({bsize:4096n,bavail:10n}),reserveBytes:8192});assert.equal(ok.requiredBytes,'16384');assert.equal(ok.files,1);
});
test('preflight source rejection occurs before prepare or partial directory creation',async t=>{
 const root=await mkdtemp(join(base,'plugin-space-source-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'real'));await symlink(join(root,'real'),join(root,'link'));let prepared=false;
 await assert.rejects(preparePrivatePluginCopy(root,async()=>{prepared=true},{source:join(root,'link')}),/must not contain links/);
 assert.equal(prepared,false);assert.deepEqual((await readdir(root)).sort(),['link','real']);
});

test('native clone has isolated inode and bytes; unsupported fallback requires full budget',async t=>{
 const {copyPrivatePluginTree}=await import('./local-plugin-copy.mjs');
 const {stat}=await import('node:fs/promises');
 const root=await mkdtemp(join(base,'clone-owned-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source');await mkdir(source);await writeFile(join(source,'file'),Buffer.alloc(4*1024*1024,42));
 const helper=process.env.YNX_CLONE_TEST_HELPER || join(root,'clone-helper');
 if(!process.env.YNX_CLONE_TEST_HELPER)await (await import('../runtime/theia/scripts/process-helper-build.mjs')).buildProcessHelper({output:helper});
 const target=join(root,'actual');await copyPrivatePluginTree(source,target,{helper});
 assert.notEqual((await stat(join(source,'file'))).ino,(await stat(join(target,'file'))).ino);
 assert.deepEqual(await readFile(join(source,'file')),await readFile(join(target,'file')));
 await writeFile(join(target,'file'),'changed');assert.equal((await stat(join(source,'file'))).size,4*1024*1024);
 const budgets=[];
 await copyPrivatePluginTree(source,join(root,'fallback'),{run:async()=>{throw Object.assign(Error('unsupported'),{code:78});},capacity:async(_p,_s,opts)=>{budgets.push(!!opts?.clone);}});
 assert.deepEqual(budgets,[true,false]);assert.deepEqual(await readFile(join(source,'file')),await readFile(join(root,'fallback/file')));
 const denied=join(root,'denied');
 await assert.rejects(copyPrivatePluginTree(source,denied,{run:async()=>{throw Object.assign(Error('unsupported'),{code:78});},capacity:async(_p,_s,opts)=>{if(!opts?.clone)throw Object.assign(Error('space'),{code:'YNX_PLUGIN_COPY_SPACE'});}}),{code:'YNX_PLUGIN_COPY_SPACE'});
 assert.deepEqual(await readdir(denied),[]);
 let count=0;await assert.rejects(copyPrivatePluginTree(source,join(root,'full'),{run:async()=>{throw Object.assign(Error('full'),{code:73});},capacity:async()=>{count++;}}),{code:'ENOSPC'});assert.equal(count,1);
 await symlink(join(source,'file'),join(source,'link'));
 await assert.rejects(copyPrivatePluginTree(source,join(root,'linked'),{helper}));
});

test('launcher maps only classified plugin space preparation to native exit 74',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('./code-server.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('}).catch(error => {')+19,source.indexOf('\n    });',source.indexOf('}).catch(error => {')));
 const exits=[];const run=runInNewContext('(error)=>{'+body+'}',{console:{error(){}},process:{exit(code){exits.push(code);throw code;}}});
 for(const code of ['ENOSPC','YNX_PLUGIN_COPY_SPACE'])assert.throws(()=>run({code,pluginPreparationSpace:true}),e=>e===74);
 for(const error of [{code:'ENOSPC'},{code:74},{code:'OTHER',pluginPreparationSpace:true}])assert.throws(()=>run(error),e=>e===error);
 assert.deepEqual(exits,[74,74]);
});
