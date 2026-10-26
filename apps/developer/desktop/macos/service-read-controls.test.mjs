import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,lstat,mkdtemp,rm,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const include=process.env.YNX_IDE_SERVICE_OBSERVER_NATIVE_INCLUDE;
const platformSkip=process.platform!=='darwin'?'Requires the macOS Native controls.':false;
test('actual typed observer caller preserves partial and cleanup custody (PUBLIC fake Source)',{skip:platformSkip||(!include?'Exact SDK47 observer header not supplied; no Native acceptance claimed.':false),timeout:30000},async()=>{
 const file=path.join(include,'original-ide-project-app-observer.h'),st=await lstat(file),raw=await readFile(file);
 assert.ok(st.isFile()&&!st.isSymbolicLink());assert.equal(raw.length,605);assert.equal(createHash('sha256').update(raw).digest('hex'),'0258d7ff9de2e41613ee7f1ece8483350636b4e74b0dfd47ad76fafcb3cea64a');
 const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'ynx-public-observer-control-'));
 try{
  const binary=path.join(root,'control'),source=fileURLToPath(new URL('./project-service-observation-controlled-test.mm',import.meta.url));
  execFileSync('/usr/bin/clang++',['-fobjc-arc','-std=c++17','-mmacosx-version-min=15.0','-I'+include,'-framework','Foundation',source,'-o',binary],{timeout:20000,stdio:'pipe'});
  assert.match(execFileSync(binary,[],{timeout:5000,encoding:'utf8'}),/PUBLIC_OBSERVER_CALLER_7_CONTROLS_PASS_NO_SOURCE_NO_HTTP/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('actual Native signer bounds reviewed reads and rejects malformed payloads (ephemeral test key, no Keychain or HTTP)',{skip:platformSkip,timeout:30000},async()=>{
 const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'ynx-public-read-proof-control-'));
 try{
  const binary=path.join(root,'control'),source=fileURLToPath(new URL('./service-read-proof-controlled-test.mm',import.meta.url));
  execFileSync('/usr/bin/clang++',['-fobjc-arc','-std=c++17','-mmacosx-version-min=15.0','-framework','Foundation','-framework','Security',source,'-o',binary],{timeout:20000,stdio:'pipe'});
  assert.match(execFileSync(binary,['ports'],{timeout:5000,encoding:'utf8'}),/PRIVATE_READ_PORTS_EXACT_EXISTING_SESSION_GET_ONLY_PASS/);
  assert.match(execFileSync(binary,['read-only'],{timeout:5000,encoding:'utf8'}),/INDEPENDENT_READ_APPROVAL_GET_ONLY_NOT_LOGIN_PASS/);
  assert.match(execFileSync(binary,['malformed'],{timeout:5000,encoding:'utf8'}),/MALFORMED_PROOF_REFUSED_WITHOUT_EXCEPTION/);
  assert.match(execFileSync(binary,[],{timeout:5000,encoding:'utf8'}),/PUBLIC_NATIVE_SERVICE_READ_PROOF_CONTROLS_PASS_NO_ROOT_NO_KEYCHAIN_NO_HTTP/);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('actual private child frame parser separates ordinary stderr from private DATA',{skip:platformSkip,timeout:30000},async()=>{
 const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'ynx-public-read-channel-control-'));
 try{
  const binary=path.join(root,'control'),source=fileURLToPath(new URL('./service-read-channel-controlled-test.m',import.meta.url));
  execFileSync('/usr/bin/clang',['-fobjc-arc','-mmacosx-version-min=15.0','-framework','Foundation',source,'-o',binary],{timeout:20000,stdio:'pipe'});
  assert.match(execFileSync(binary,[path.join(root,'PUBLIC.log')],{timeout:5000,encoding:'utf8'}),/ACTUAL_PRIVATE_CHILD_FRAME_CONTROLS_PASS_NO_SECRET_LOGGING/);
 }finally{await rm(root,{recursive:true,force:true});}
});
