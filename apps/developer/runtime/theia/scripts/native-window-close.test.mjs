import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const module = {exports:{}};
vm.runInNewContext(await readFile(new URL('../../ynx-workbench/lib/native-window-close.js', import.meta.url),'utf8'),{module,require});
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
