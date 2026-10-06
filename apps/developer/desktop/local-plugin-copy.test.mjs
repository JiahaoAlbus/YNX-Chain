import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {preparePrivatePluginCopy} from './local-plugin-copy.mjs';
const base=process.env.TMPDIR || (await import("node:os")).tmpdir();
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
