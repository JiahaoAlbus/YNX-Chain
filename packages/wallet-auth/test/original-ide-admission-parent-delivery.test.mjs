import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
// Exact source body with PUBLIC fixed-selection/process lexical stand-ins.
// No product graph/native parent/FD/source/key/runtime is actually executed.
const source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8');
const moduleURL=new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url).href;
function fixture(selection,entry='/PUBLIC/Resources/server.mjs',native={},loaded=[]){
  const ctx=vm.createContext({originalIDEServiceAdmissionStartupSelection:selection,URL,fileURLToPath,resolve,dirname,join,moduleURL,createRequire:()=>path=>{loaded.push(path);return native;},process:{argv:['PUBLIC_NODE',entry]}});
  vm.runInContext(source.replace(/^import .*;$/mg,'').replaceAll('import.meta.url','moduleURL').replaceAll('export ','')+'\nthis.acquire=acquireOriginalIDEAdmissionParentDelivery',ctx);return ctx.acquire;
}
test('PUBLIC normal fixed null returns null; no descriptor or graph acquisition',async()=>{
  assert.equal(await fixture(null)('file:///PUBLIC/Resources/server.mjs'),null);
});
test('PUBLIC configured receipt/PID/path identity does not self-qualify an OS parent',async()=>{
  await assert.rejects(fixture({PUBLIC:'INSTALLED_SERVICE_SELECTION_STANDIN'})('file:///PUBLIC/Resources/server.mjs'),{code:'IDE_ORIGINAL_PARENT_QUALIFICATION_NOT_SUPPLIED'});
});
test('PUBLIC configured entry must be actual own server; other path/host/query/hash rejected',async()=>{
  for(const input of ['file:///PUBLIC/Resources/other.mjs','file://attacker/PUBLIC/Resources/server.mjs','file:///PUBLIC/Resources/server.mjs?source=x','file:///PUBLIC/Resources/server.mjs#grant','https://example.test/server.mjs',null])await assert.rejects(fixture({PUBLIC:'STANDIN'})(input),{code:'IDE_ADMISSION_RUNNING_ENTRY_MISMATCH'});
  await assert.rejects(fixture({PUBLIC:'STANDIN'},'/OTHER/server.mjs')('file:///PUBLIC/Resources/server.mjs'),{code:'IDE_ADMISSION_RUNNING_ENTRY_MISMATCH'});
});
test('PUBLIC fixed supplier exports exact actual Node factory without altering original four-op validator',()=>{
  const supplier=readFileSync(new URL('../scripts/ynx-ide-service-admission-supplier.mjs',import.meta.url),'utf8');
  assert(supplier.includes("export {acquireOriginalIDEAdmissionParentDelivery} from '../src/original-ide-admission-parent-delivery.js';"));
  assert(supplier.includes('prepareOriginalIDEServiceAdmissionStartup(selection,runningBackendModuleURL,()=>new Date())'));
});
test('PUBLIC normal caller selects the fixed Native callee and returns its exact owner untouched',async()=>{
  const loaded=[],calls=[],owner={descriptor:4,assertCurrent(){throw Error('adapter must not enter current');},close(){throw Error('adapter must not select cleanup');}};
  const native={acquireOriginalIDEAdmissionParentDelivery(entry){calls.push(entry);return owner;}};
  const acquire=fixture({PUBLIC:'CONFIGURED'},'/PUBLIC/Resources/server.mjs',native,loaded);
  assert.equal(await acquire('file:///PUBLIC/Resources/server.mjs'),owner);
  assert.deepEqual(calls,['file:///PUBLIC/Resources/server.mjs']);
  assert.deepEqual(loaded,[fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',moduleURL))]);
});
test('PUBLIC partial Native owner remains reachable without assertCurrent, close or another acquisition',async()=>{
  let selected=0;const owner={descriptor:-1,assertCurrent(){throw false;},close(){throw 0;}};
  const acquire=fixture({PUBLIC:'CONFIGURED'},'/PUBLIC/Resources/server.mjs',{acquireOriginalIDEAdmissionParentDelivery(){selected++;return owner;}});
  const actual=await acquire('file:///PUBLIC/Resources/server.mjs');
  assert.equal(actual,owner);assert.equal(selected,1);assert.equal(actual.descriptor,-1);
});
test('PUBLIC callee first falsy failure is preserved with no retry',async()=>{
  let calls=0;const acquire=fixture({PUBLIC:'CONFIGURED'},'/PUBLIC/Resources/server.mjs',{acquireOriginalIDEAdmissionParentDelivery(){calls++;throw false;}});
  await assert.rejects(acquire('file:///PUBLIC/Resources/server.mjs'),error=>error===false);assert.equal(calls,1);
});
test('PUBLIC null and invalid entry never load the Native implementation',async()=>{
  const loaded=[];const native={acquireOriginalIDEAdmissionParentDelivery(){throw Error('must not enter');}};
  assert.equal(await fixture(null,'/PUBLIC/Resources/server.mjs',native,loaded)('file:///PUBLIC/Resources/server.mjs'),null);
  await assert.rejects(fixture({PUBLIC:'CONFIGURED'},'/PUBLIC/Resources/server.mjs',native,loaded)('file:///PUBLIC/Resources/other.mjs'),{code:'IDE_ADMISSION_RUNNING_ENTRY_MISMATCH'});
  assert.deepEqual(loaded,[]);
});
