import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {preparePrivatePluginCopy,verifiedPluginSessionExit} from './local-plugin-copy.mjs';
const base=process.env.TMPDIR || (await import("node:os")).tmpdir();
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
