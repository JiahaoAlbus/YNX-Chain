import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const source = stripTypeScriptTypes(await readFile(new URL('../frontend/src/desktop/host-commands.ts', import.meta.url), 'utf8'));
const { createHostCommands, installHostCommands } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function fixture() {
  const win = { location: { origin: 'https://developer.ynxweb4.com', pathname: '/' } }; win.top = win.self = win;
  const calls = [], state = { projectId:'one',revision:1,activePath:'main.cpp',dirtyPaths:['main.cpp'],editorReady:true,readOnly:false };
  const actions = {state:()=>({...state}),save:async()=>{calls.push('save');return {saved:true,localSaved:true,remoteSaved:false}},newFile:async path=>{calls.push(['create',path]);return null},importProject:async(...args)=>{calls.push(args);return {cancelled:false,error:null}},exportProject:()=>({filename:'project.json',content:'{}'})};
  return {win,calls,state,actions,dispatch:createHostCommands(win,actions)};
}
test('top document and exact origin/port/path are required before any action',async()=>{
  for(const change of [f=>f.win.top={},f=>f.win.location.origin='https://evil.example',f=>f.win.location.origin='https://developer.ynxweb4.com:444',f=>f.win.location.pathname='/runtime/previews/test/']) {
    const f=fixture();change(f);for(const command of ['state','save','new-file','import-project','export-project'])assert.equal((await f.dispatch({command})).status,'blocked');assert.deepEqual(f.calls,[]);
  }
});
test('invalid or coerced commands and extra payload fields have no side effects',async()=>{
  const f=fixture();for(const input of [null,[],1,'save',{command:{toString(){throw Error('must not coerce')}}},{command:'save',script:'x'},{command:'run'},{command:'import-project',filename:'../p',content:'{}'},{command:'new-file',path:3}])assert.equal((await f.dispatch(input)).status,'blocked');assert.deepEqual(f.calls,[]);
});
test('save waits for actual persistence acknowledgement and exposes local/remote distinction',async()=>{
  const f=fixture();let release;f.actions.save=()=>new Promise(resolve=>{release=resolve});let completed=false;
  const pending=f.dispatch({command:'save'}).then(v=>{completed=true;return v});await Promise.resolve();assert.equal(completed,false);
  release({saved:true,localSaved:true,remoteSaved:false});const result=await pending;assert.equal(result.status,'handled');assert.equal(result.localSaved,true);assert.equal(result.remoteSaved,false);
});
test('failed and changed-workspace save results cannot report success',async()=>{
  const f=fixture();f.actions.save=async()=>({saved:false,localSaved:true,remoteSaved:false});assert.equal((await f.dispatch({command:'save'})).status,'failed');
  f.actions.save=async()=>{throw Error('quota')};assert.equal((await f.dispatch({command:'save'})).status,'failed');
});
test('only one mutating host action runs while state stays readable',async()=>{
  const f=fixture();let release;f.actions.save=()=>new Promise(resolve=>{release=resolve});const pending=f.dispatch({command:'save'});
  assert.equal((await f.dispatch({command:'new-file',path:'x'})).reason,'command-busy');assert.equal((await f.dispatch({command:'state'})).status,'handled');release({saved:true});await pending;assert.equal((await f.dispatch({command:'new-file',path:'x'})).status,'handled');
});
test('navigation during asynchronous save rejects the stale acknowledgement',async()=>{
  const f=fixture();f.actions.save=async()=>{f.win.location.origin='https://evil.example';return {saved:true}};assert.equal((await f.dispatch({command:'save'})).reason,'document-changed');
});
test('read-only import and create are blocked, export and local save remain available',async()=>{
  const f=fixture();f.state.readOnly=true;for(const command of ['new-file','import-project'])assert.equal((await f.dispatch({command})).reason,'read-only');assert.deepEqual(f.calls,[]);assert.equal((await f.dispatch({command:'export-project'})).status,'handled');
});
test('cancel and validation errors preserve the existing workspace and cannot claim import success',async()=>{
  const f=fixture();f.actions.importProject=async()=>({cancelled:true,error:null});const input={command:'import-project',filename:'project.json',content:'{}'};
  assert.equal((await f.dispatch(input)).status,'cancelled');assert.deepEqual(f.state.dirtyPaths,['main.cpp']);f.actions.importProject=async()=>({cancelled:false,error:'unsafe path'});assert.equal((await f.dispatch(input)).status,'failed');assert.equal(f.state.revision,1);
});
test('UTF-8 import/export byte bounds are enforced before data crosses the native boundary',async()=>{
  const f=fixture(),content='€'.repeat(800000);assert.equal((await f.dispatch({command:'import-project',filename:'project.json',content})).status,'blocked');assert.deepEqual(f.calls,[]);f.actions.exportProject=()=>({filename:'p.json',content});assert.equal((await f.dispatch({command:'export-project'})).reason,'export-too-large');
});
test('bridge cleanup restores exactly the previous handler',()=>{
  const f=fixture(),old=()=>{};f.win.__ynxDesktopHost=old;const cleanup=installHostCommands(f.win,f.actions);cleanup();assert.equal(f.win.__ynxDesktopHost,old);const another=installHostCommands(f.win,f.actions),replacement=()=>{};f.win.__ynxDesktopHost=replacement;another();assert.equal(f.win.__ynxDesktopHost,replacement);
});
