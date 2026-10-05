import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createBuildTasks, installedCompiler, readGeneratedTasks } = require('./build-tasks.cjs');
const runtime={clangd:'/Library/Developer/CommandLineTools/usr/bin/clangd',sysroot:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',language:'cpp'};
test('existing trusted CLT alias produces process tasks with separate argument boundaries and native build dependency',async()=>{
  const tool=await installedCompiler(runtime),root=await mkdtemp('/private/tmp/ynx-cpp-tasks-');
  const result=await createBuildTasks(root,tool),json=JSON.parse(await readFile(result.path));
  assert.equal(result.created,true);assert.equal(json.tasks[0].type,'process');
  assert.equal(json.tasks[0].command,'/Library/Developer/CommandLineTools/usr/bin/clang++');
  assert.equal(json.tasks[0].args[3],tool.sdk);assert.ok(json.tasks[0].args.includes('${file}'));
  assert.deepEqual(json.tasks[1].dependsOn,[json.tasks[0].label]);assert.equal(json.tasks[0].group.isDefault,true);
});
test('existing commented user tasks are opened without modification',async()=>{
 const root=await mkdtemp('/private/tmp/ynx-cpp-tasks-existing-');await mkdir(join(root,'.vscode'));
 const path=join(root,'.vscode/tasks.json'),bytes='// user tasks\n{ "version": "2.0.0", "tasks": [] }\n';await writeFile(path,bytes);
 assert.equal((await createBuildTasks(root,await installedCompiler(runtime))).created,false);assert.equal(await readFile(path,'utf8'),bytes);
});
test('configuration folder and file links cannot create or open outside project',async()=>{
 const root=await mkdtemp('/private/tmp/ynx-cpp-tasks-links-'),outside=await mkdtemp('/private/tmp/ynx-cpp-tasks-outside-');
 await symlink(outside,join(root,'.vscode'));await assert.rejects(createBuildTasks(root,{}),/outside this project/);
 const root2=await mkdtemp('/private/tmp/ynx-cpp-tasks-filelink-');await mkdir(join(root2,'.vscode'));const target=join(outside,'tasks.json');await writeFile(target,'preserve');await symlink(target,join(root2,'.vscode/tasks.json'));
 await assert.rejects(createBuildTasks(root2,{}),/not a regular project file/);assert.equal(await readFile(target,'utf8'),'preserve');
});
test('project-supplied language server and external SDK cannot select an executable',async()=>{
 await assert.rejects(installedCompiler({...runtime,clangd:'/private/tmp/project/clangd'}),/no supported local/);
 await assert.rejects(installedCompiler({...runtime,sysroot:'/usr'}),/outside/);
 const c=await installedCompiler({...runtime,language:'c'});assert.equal(c.compiler,'/Library/Developer/CommandLineTools/usr/bin/clang');
});
test('exact generated config snapshot rejects extra fields, comments, changed bytes and oversized files',async()=>{
 const root=await mkdtemp('/private/tmp/ynx-cpp-tasks-snapshot-'),tool=await installedCompiler(runtime);
 const {path}=await createBuildTasks(root,tool),original=await readFile(path);
 const snapshot=await readGeneratedTasks(root,path,tool);assert.ok(snapshot);
 const config=JSON.parse(original);config.tasks[0].detail='user field';await writeFile(path,JSON.stringify(config));
 assert.equal(await readGeneratedTasks(root,path,tool),undefined);await assert.rejects(readGeneratedTasks(root,path,tool,snapshot.digest),/changed/);
 await writeFile(path,'// user comment\n'+original);assert.equal(await readGeneratedTasks(root,path,tool),undefined);
 await writeFile(path,' '.repeat(65537));assert.equal(await readGeneratedTasks(root,path,tool),undefined);
 await writeFile(path,original);assert.equal((await readGeneratedTasks(root,path,tool,snapshot.digest)).digest,snapshot.digest);
});
