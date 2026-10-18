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
test('Wallet identity factory returns same Native partial before any readiness assertion',()=>run(`
const partial=Object.freeze({assertReady(){throw Error('PUBLIC_MUST_NOT_ASSERT');},status(){return {userApproved:false};}});let calls=0;
module.exports={partial,count:()=>calls,acquireOriginalIDEWalletIdentitySource(){if(arguments.length!==0)throw Error('PUBLIC_BAD_ARITY');calls++;return partial;}};
`,`const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs');const owner=api.acquireOriginalIDEWalletIdentitySource();assert.equal(owner,native.partial);assert.equal(native.count(),1);`));
test('Wallet recognizer delegates identity to original Native rather than JS shape',()=>run(`
const actual=Object.freeze({});module.exports={actual,isOriginalIDEWalletIdentitySource(value){if(arguments.length!==1)throw Error('PUBLIC_BAD_ARITY');return value===actual;}};
`,`const native=require('../apps/wallet-desktop/native/original-auth-identity.cjs');assert.equal(api.isOriginalIDEWalletIdentitySource(native.actual),true);assert.equal(api.isOriginalIDEWalletIdentitySource({}),false);assert.equal(api.isOriginalIDEWalletIdentitySource({assertReady(){},current(){}}),false);`));
test('missing fixed module or old module lacks Wallet identity authority',()=>{
 for(const body of [null,'module.exports={};'])run(body,`assert.equal(api.acquireOriginalIDEWalletIdentitySource(),null);assert.equal(api.isOriginalIDEWalletIdentitySource({}),false);`);
});
test('Wallet calls reject extra selector arguments before loading Native',()=>run("throw Error('PUBLIC_MUST_NOT_LOAD');",`
assert.throws(()=>api.acquireOriginalIDEWalletIdentitySource({provider:'PUBLIC'}),{code:'IDE_IDENTITY_WALLET_SOURCE_ARGUMENTS_INVALID'});
assert.throws(()=>api.isOriginalIDEWalletIdentitySource(),{code:'IDE_IDENTITY_WALLET_SOURCE_ARGUMENTS_INVALID'});
assert.throws(()=>api.isOriginalIDEWalletIdentitySource({},5),{code:'IDE_IDENTITY_WALLET_SOURCE_ARGUMENTS_INVALID'});
`));
for(const literal of ['undefined','false','0',"'PUBLIC_FIRST_CAUSE'"])test('Wallet factory and recognizer retain exact thrown '+literal,()=>run(`module.exports={acquireOriginalIDEWalletIdentitySource(){throw ${literal};},isOriginalIDEWalletIdentitySource(){throw ${literal};}};`,`for(const fn of [()=>api.acquireOriginalIDEWalletIdentitySource(),()=>api.isOriginalIDEWalletIdentitySource({})]){let caught=false;try{fn();}catch(error){caught=true;assert.equal(error,${literal});}assert(caught);}`));
test('Wallet fixed loader refuses extension fallback',()=>run(null,`assert.equal(api.acquireOriginalIDEWalletIdentitySource(),null);assert.equal(api.isOriginalIDEWalletIdentitySource({}),false);`,"throw Error('PUBLIC_FALLBACK_MUST_NOT_LOAD');"));
test('Native identity recognizer cannot return truthy nonboolean approval',()=>run(`module.exports={isOriginalIDEWalletIdentitySource(){return 'PUBLIC-true';}};`,`assert.throws(()=>api.isOriginalIDEWalletIdentitySource({}),{code:'IDE_IDENTITY_WALLET_SOURCE_RECOGNITION_INVALID'});`));
