// PUBLIC temporary fixed-layout resource seam only; no genuine Native Source,
// credentials, account recovery, key custody or installed qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../src/original-ide-admission-parent-delivery.js',import.meta.url),'utf8');
const selection=readFileSync(new URL('../scripts/original-ide-service-admission-native-selection.mjs',import.meta.url),'utf8');
function run(nativeBody,checks,suffixBody){
 const root=mkdtempSync(join(tmpdir(),'ynx-public-native-binding-'));
 try{
  for(const dir of ['packages/wallet-auth/src','packages/wallet-auth/scripts','apps/wallet-desktop/native','Resources'])mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  // Only the test copy's fixed Native operand changes, to a CommonJS seam.
  writeFileSync(join(root,'packages/wallet-auth/src/original-ide-admission-parent-delivery.js'),source.replaceAll('../../../apps/wallet-desktop/native/original-auth-identity.node','../../../apps/wallet-desktop/native/original-auth-identity.cjs'));
  writeFileSync(join(root,'packages/wallet-auth/scripts/original-ide-service-admission-native-selection.mjs'),selection);
  if(nativeBody!==null)writeFileSync(join(root,'apps/wallet-desktop/native/original-auth-identity.cjs'),nativeBody);
  if(suffixBody!==undefined)writeFileSync(join(root,'apps/wallet-desktop/native/original-auth-identity.cjs.js'),suffixBody);
  const server=join(root,'Resources/server.mjs');
  writeFileSync(server,`import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import * as api from '../packages/wallet-auth/src/original-ide-admission-parent-delivery.js';
const entry=pathToFileURL(process.argv[1]).href;
const require=createRequire(import.meta.url);
${checks}\n`);
  const result=spawnSync(process.execPath,[server],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('fixed Native discovery refuses wrong running entries before loading resources',()=>run("throw Error('PUBLIC_MUST_NOT_LOAD');",`
for(const invalid of [null,42,'https://example.test/server.mjs','file://host/server.mjs',entry+'?x=1',entry+'#x',entry.replace('server.mjs','other.mjs')])assert.throws(()=>api.acquireOriginalIDENativeAuthBinding(invalid),{code:'IDE_ADMISSION_RUNNING_ENTRY_MISMATCH'});
`));
test('missing direct fixed module is unavailable',()=>run(null,`assert.equal(api.acquireOriginalIDENativeAuthBinding(entry),null);`));
for(const body of ['module.exports={};','module.exports={getOriginalIDENativeAuthBinding(){return null;}};','module.exports={getOriginalIDENativeAuthBinding(){return {};}};','module.exports={getOriginalIDENativeAuthBinding(){return {receiveOriginalIDEIdentity(){},recoverOriginalIDEIdentity(){}};}};'])test('missing getter or incomplete callback table is unavailable '+body,()=>run(body,`assert.equal(api.acquireOriginalIDENativeAuthBinding(entry),null);`));
test('null old parent selection does not prevent same-table synchronous discovery or invoke constructors',()=>run(`
let calls=0;const table=Object.freeze({receiveOriginalIDEIdentity(){throw Error('PUBLIC_CTOR_MUST_NOT_RUN');},recoverOriginalIDEIdentity(){throw Error('PUBLIC_CTOR_MUST_NOT_RUN');},acquireOriginalIDEProtectedKeyCall(){throw Error('PUBLIC_CTOR_MUST_NOT_RUN');}});
module.exports={table,count:()=>calls,getOriginalIDENativeAuthBinding(entry){if(arguments.length!==1||!entry.endsWith('/Resources/server.mjs'))throw Error('PUBLIC_BAD_ENTRY');calls++;return table;}};
`,`
assert.equal(await api.acquireOriginalIDEAdmissionParentDelivery(entry),null);
const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs');
const binding=api.acquireOriginalIDENativeAuthBinding(entry);
assert.equal(binding,native.table);assert.equal(binding.then,undefined);assert.equal(native.count(),1);
`));
for(const literal of ['undefined','false','0',"'PUBLIC_FIRST_CAUSE'"])test('Native getter preserves exact thrown '+literal,()=>run(`module.exports={getOriginalIDENativeAuthBinding(){throw ${literal};}};`,`
let caught=false;try{api.acquireOriginalIDENativeAuthBinding(entry);}catch(cause){caught=true;assert.equal(cause,${literal});}assert.equal(caught,true);
`));
test('addon load failure is not converted to unavailable',()=>run("throw Object.assign(Error('PUBLIC_ADDON_FAILURE'),{code:'ERR_DLOPEN_FAILED'});",`assert.throws(()=>api.acquireOriginalIDENativeAuthBinding(entry),{code:'ERR_DLOPEN_FAILED',message:'PUBLIC_ADDON_FAILURE'});`));
test('transitive module absence after fixed target resolve is not hidden',()=>run("require('./PUBLIC_missing_dependency.cjs');",`assert.throws(()=>api.acquireOriginalIDENativeAuthBinding(entry),{code:'MODULE_NOT_FOUND'});`));

test('fixed loader never accepts Node extension fallback as the Native target',()=>run(null,`assert.equal(api.acquireOriginalIDENativeAuthBinding(entry),null);`,"export function getOriginalIDENativeAuthBinding(){return {receiveOriginalIDEIdentity(){},recoverOriginalIDEIdentity(){},acquireOriginalIDEProtectedKeyCall(){}};}"));
