import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { configurePython } = createRequire(import.meta.url)('../../../native/ynx-tools/src/python-setup.cjs');
async function fixture(t) {
  const path = await realpath(await mkdtemp('/private/tmp/ynx-python-setup-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const folder = { uri: { scheme: 'file', fsPath: path } }, updates = [], commands = [];
  const settings = { unrelated: 'preserved' };
  const api = { ConfigurationTarget: { WorkspaceFolder: 3 },
    workspace: { isTrusted: true, workspaceFolders: [folder], getConfiguration(section, uri) {
      assert.equal(section, 'python'); assert.equal(uri, folder.uri);
      return { async update(key, value, target) { assert.equal(target, 3); settings[key] = value; updates.push(key); } };
    } },
    extensions: { getExtension: id => id === 'ms-python.python' ? {} : undefined },
    window: { showQuickPick: async items => items[0] },
    commands: { executeCommand: async name => commands.push(name) } };
  const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: path };
  return { api, env, updates, commands, settings };
}
test('project-scoped Jedi setup preserves unrelated settings and opens native interpreter UI', async t => {
  const f = await fixture(t); await configurePython(f.api, f.env);
  assert.deepEqual(f.updates, ['languageServer', 'useEnvironmentsExtension']);
  assert.equal(f.settings.unrelated, 'preserved'); assert.equal(f.settings.languageServer, 'Jedi');
  assert.deepEqual(f.commands, ['python.setInterpreter']);
});
test('cancelled setup performs no writes or interpreter command', async t => {
  const f = await fixture(t); f.api.window.showQuickPick = async () => undefined;
  await configurePython(f.api, f.env); assert.deepEqual(f.updates, []); assert.deepEqual(f.commands, []);
});
test('changed workspace, restricted trust and missing Python reject before writing', async t => {
  const f = await fixture(t);
  f.api.workspace.isTrusted = false; await assert.rejects(configurePython(f.api, f.env), /trusted/);
  f.api.workspace.isTrusted = true; f.api.extensions.getExtension = () => undefined;
  await assert.rejects(configurePython(f.api, f.env), /Install/);
  f.api.extensions.getExtension = () => ({});
  f.api.window.showQuickPick = async items => { f.env.YNX_LOCAL_WORKSPACE += '-changed'; return items[0]; };
  await assert.rejects(configurePython(f.api, f.env), /trusted/); assert.deepEqual(f.updates, []);
});
test('installed environment extension is preserved', async t => {
  const f = await fixture(t); f.api.extensions.getExtension = () => ({});
  await configurePython(f.api, f.env); assert.deepEqual(f.updates, ['languageServer']);
});

for(const [label,change]of [
 ['trust is revoked',f=>{f.api.workspace.isTrusted=false;}],
 ['workspace instance changes',f=>{f.api.workspace.workspaceFolders=[{uri:{...f.api.workspace.workspaceFolders[0].uri}}];}],
 ['runtime project changes',f=>{f.env.YNX_LOCAL_WORKSPACE+='-retired';}],
])test('no stale configuration writes when '+label+' during asynchronous path checks',async t=>{
 const f=await fixture(t);let picked=false,scheduled=false,trusted=true;
 Object.defineProperty(f.api.workspace,'isTrusted',{get(){
  if(picked&&!scheduled){scheduled=true;queueMicrotask(()=>change(f));}
  return trusted;
 },set(value){trusted=value;}});
 f.api.window.showQuickPick=async items=>{picked=true;return items[0];};
 await assert.rejects(configurePython(f.api,f.env),/trusted/);
 assert.equal(scheduled,true);assert.deepEqual(f.updates,[]);assert.deepEqual(f.commands,[]);
 assert.equal(f.settings.unrelated,'preserved');
});

test('trust revoked at the validation caller continuation prevents the first write',async t=>{
 const f=await fixture(t);let picked=false,checks=0,trusted=true;
 Object.defineProperty(f.api.workspace,'isTrusted',{get(){
  if(picked&&++checks===2)queueMicrotask(()=>{trusted=false;});
  return trusted;
 }});
 f.api.window.showQuickPick=async items=>{picked=true;return items[0];};
 await assert.rejects(configurePython(f.api,f.env),/trusted/);
 assert.deepEqual(f.updates,[]);assert.deepEqual(f.commands,[]);
});
