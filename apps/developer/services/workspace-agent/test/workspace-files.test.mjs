import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {materializeSnapshot,readTextSnapshot,safeWorkspaceJoin} from '../src/workspace-files.mjs';
const snapshot=files=>({name:'qa',files,folders:[],open:Object.keys(files),active:Object.keys(files)[0]||''});
async function fixture(t){const base=await mkdtemp(join(tmpdir(),'ynx-file-boundary-'));t.after(()=>rm(base,{recursive:true,force:true}));const root=join(base,'root'),outside=join(base,'outside');await mkdir(root);await mkdir(outside);return {root,outside};}
test('materialize refuses a preexisting parent symlink and never creates external file',async t=>{
 const {root,outside}=await fixture(t);await symlink(outside,join(root,'link'));
 await assert.rejects(materializeSnapshot(root,snapshot({'link/escape.txt':'private project content'})),{code:'workspace_symlink'});
 assert.deepEqual(await readdir(outside),[]);
});
test('workspace paths must be normalized relative paths',()=>{
 for(const path of ['../escape','a/../b','/absolute','a//b','a/./b','a\\b','.', '', 'a\u0000b','C:/project/file','main.cpp:stream'])assert.throws(()=>safeWorkspaceJoin('/project',path),{code:'workspace_escape'});
 assert.equal(safeWorkspaceJoin('/project','src/main.cpp'),'/project/src/main.cpp');
});
test('materialize refuses a symlink workspace root',async t=>{
 const {root,outside}=await fixture(t);const alias=join(root,'alias');await symlink(outside,alias);
 await assert.rejects(materializeSnapshot(alias,snapshot({'file.txt':'data'})),{code:'workspace_symlink'});
 assert.deepEqual(await readdir(outside),[]);
});
test('ordinary nested, empty and Unicode contents round trip without overwriting existing files',async t=>{
 const {root}=await fixture(t);const original=snapshot({'src/main.cpp':'hello 世界\n','empty.txt':''});
 await materializeSnapshot(root,original);assert.deepEqual(await readTextSnapshot(root,original),{...original,folders:['src']});
 await assert.rejects(materializeSnapshot(root,snapshot({'empty.txt':'overwrite'})),{code:'EEXIST'});
 assert.equal(await readFile(join(root,'empty.txt'),'utf8'),'');
});
