import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const module = {exports:{}};
vm.runInNewContext(await readFile(new URL('../../ynx-workbench/lib/native-window-close.js', import.meta.url),'utf8'),{module,require,setTimeout,clearTimeout});
const {NativeWindowClose}=module.exports;
test('native close waits for standard shutdown and rejects cancellation or failure',async()=>{
  const messages=[],target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>messages.push(value)}}}};
  let resolve,reason;const windows={isSafeToShutDown:value=>{reason=value;return new Promise(done=>resolve=done);}};
  const close=new NativeWindowClose(windows,target);close.onStart();
  const requestId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',pending=target.__ynxLocalWorkbenchClose(requestId);
  await Promise.resolve();
  assert.equal(reason,require('@theia/core/lib/common/frontend-application-state').StopReason.Close);assert.equal(messages.length,0);
  resolve(false);await pending;assert.equal(messages[0].accepted,false);assert.equal(messages[0].requestId,requestId);
  windows.isSafeToShutDown=async()=>{throw Error('save failed');};await target.__ynxLocalWorkbenchClose(requestId);assert.equal(messages[1].accepted,false);
  windows.isSafeToShutDown=async()=>true;await target.__ynxLocalWorkbenchClose(requestId);assert.equal(messages[2].accepted,true);
  await target.__ynxLocalWorkbenchClose('untrusted request');assert.equal(messages.length,3);
  close.onStop();assert.equal(target.__ynxLocalWorkbenchClose,undefined);
});
test('ordinary browser workbench exposes no native close hook',()=>{
  const target={};new NativeWindowClose({},target).onStart();assert.equal(target.__ynxLocalWorkbenchClose,undefined);
});
test('native close persists layout before shutdown and after saved editor changes',async()=>{
  const events=[],messages=[],application={};
  const target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>messages.push(value)}}}};
  const storage={flush:async()=>events.push('flush')};
  const close=new NativeWindowClose({isSafeToShutDown:async()=>{events.push('shutdown');return true;}},target,{storeLayout:app=>{assert.equal(app,application);events.push('layout');}},storage);
  close.onStart(application);
  close.onDidInitializeLayout();
  await target.__ynxLocalWorkbenchClose('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.deepEqual(events,['layout','flush','shutdown','layout','flush']);assert.equal(messages[0].accepted,true);
  events.length=0;storage.flush=async()=>{throw Error('profile write failed');};
  await target.__ynxLocalWorkbenchClose('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.deepEqual(events,['layout']);assert.equal(messages[1].accepted,false);
});
test('closing during native startup preserves the previously saved layout',async()=>{
  const messages=[],target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>messages.push(value)}}}};
  const layout={shouldStoreLayout:true,storeLayout:()=>assert.fail('startup shell must not overwrite saved layout')};
  const close=new NativeWindowClose({isSafeToShutDown:async()=>true},target,layout,{flush:async()=>{}});
  close.onStart({});assert.equal(layout.shouldStoreLayout,false);
  await target.__ynxLocalWorkbenchClose('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.equal(messages[0].accepted,true);assert.equal(layout.shouldStoreLayout,false);
  close.onDidInitializeLayout();assert.equal(layout.shouldStoreLayout,true);
});
function debugFixture({request='launch',reply=async()=>{},save=async()=>{},safe=true}={}) {
 const messages=[],events=[],listeners=new Set();
 const target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:m=>messages.push(m)}}}};
 const session={id:'owned',configuration:{request},isStopping:false,sendRequest:async(command,args)=>{events.push([command,args]);await reply();}};
 const manager={sessions:[session],onDidDestroyDebugSession:fn=>{listeners.add(fn);return{dispose:()=>listeners.delete(fn)};},debug:{terminateDebugSession:async()=>{events.push('adapter-stop');manager.sessions=[];for(const fn of listeners)fn(session);}}};
 const errors=[];
 const windows={allowVetoes:true,logger:{error:(...values)=>errors.push(values)},isSafeToShutDown:async()=>{windows.allowVetoes=false;return safe;}};
 const close=new NativeWindowClose(windows,target,undefined,{flush:save},undefined,()=>manager,20);close.onStart();
 return {messages,events,session,manager,windows,errors,run:()=>target.__ynxLocalWorkbenchClose('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')};
}
test('cancel and save failure never stop a debug session',async()=>{
 for(const options of [{safe:false},{save:async()=>{throw Error('save failed')}}]){const f=debugFixture(options);await f.run();assert.equal(f.messages[0].accepted,false);assert.equal(f.events.length,0);assert.equal(f.windows.allowVetoes,true);}
});
test('launch disconnect acknowledgement precedes adapter teardown and native acceptance',async()=>{
 let reply;const f=debugFixture({reply:()=>new Promise(r=>reply=r)}),pending=f.run();
 await new Promise(r=>setTimeout(r,1));assert.equal(f.messages.length,0);assert.equal(f.events[0][0],'disconnect');assert.equal(f.events[0][1].terminateDebuggee,true);assert.equal(f.events.length,1);
 reply();await pending;assert.equal(f.events[1],'adapter-stop');assert.equal(f.manager.sessions.length,0);assert.equal(f.messages[0].accepted,true);
});
test('attach disconnect preserves the external target',async()=>{
 const f=debugFixture({request:'attach'});await f.run();assert.equal(f.events[0][1].terminateDebuggee,false);assert.equal(f.messages[0].accepted,true);
});
test('debug rejection or timeout keeps window open and allows retry without force killing',async()=>{
 for(const reply of [async()=>{throw Error('refused')},()=>new Promise(()=>{})]){const f=debugFixture({reply});await f.run();assert.equal(f.messages[0].accepted,false);assert.equal(f.events.length,1);assert.equal(f.session.isStopping,false);assert.equal(f.windows.allowVetoes,true);f.session.sendRequest=async()=>{};await f.run();assert.equal(f.messages[1].accepted,true);}
});
test('adapter acknowledgement alone does not claim a remaining session was removed',async()=>{
 const f=debugFixture();f.manager.debug.terminateDebugSession=async()=>{};await f.run();assert.equal(f.messages[0].accepted,false);assert.equal(f.manager.sessions.length,1);
});
test('disconnect failure preserves exact cause and stage, remains vetoed and permits retry',async()=>{
 for(const cause of [Error('TEST_ONLY_DISCONNECT_FAILED'),undefined,null,false,0,'']){
  const f=debugFixture({reply:async()=>{throw cause}});await f.run();
  assert.equal(f.messages[0].accepted,false);assert.equal(f.manager.sessions.length,1);
  assert.equal(f.events.length,1);assert.equal(f.session.isStopping,false);assert.equal(f.windows.allowVetoes,true);
  assert.equal(f.errors.length,1);assert.equal(f.errors[0][0],'Native window close failed');
  assert.equal(f.errors[0][1].stage,'debug-session-shutdown');assert.equal(f.errors[0][2],cause);
  f.session.sendRequest=async()=>{};await f.run();assert.equal(f.messages[1].accepted,true);
 }
});
test('failed diagnostic logging cannot accept shutdown or prevent an explicit retry',async()=>{
 const cause=Error('TEST_ONLY_DISCONNECT_FAILED'),f=debugFixture({reply:async()=>{throw cause}});
 f.windows.logger.error=()=>{throw Error('TEST_ONLY_LOGGER_FAILED')};
 await assert.doesNotReject(f.run());assert.equal(f.messages[0].accepted,false);
 assert.equal(f.manager.sessions.length,1);assert.equal(f.session.isStopping,false);assert.equal(f.windows.allowVetoes,true);
 f.session.sendRequest=async()=>{};await f.run();assert.equal(f.messages[1].accepted,true);
});
