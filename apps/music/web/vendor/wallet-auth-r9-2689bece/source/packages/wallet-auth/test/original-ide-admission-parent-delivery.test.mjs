import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
// Exact source body with PUBLIC fixed-selection/process lexical stand-ins.
// No product graph/native parent/FD/source/key/runtime is actually executed.
const source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8');
function fixture(selection,entry='/PUBLIC/Resources/server.mjs'){
  const ctx=vm.createContext({originalIDEServiceAdmissionStartupSelection:selection,URL,fileURLToPath,resolve,dirname,join,process:{argv:['PUBLIC_NODE',entry]}});
  vm.runInContext(source.replace(/^import .*;$/mg,'').replace('export ','')+'\nthis.acquire=acquireOriginalIDEAdmissionParentDelivery',ctx);return ctx.acquire;
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
