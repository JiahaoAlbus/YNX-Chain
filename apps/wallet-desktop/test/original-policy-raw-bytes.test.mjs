// Install in apps/wallet-desktop/test; existing npm/CI test glob picks it up.
// Helpers below are test-only, installed under test/fixtures/raw-policy-bytes.
import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,symlinkSync}from'node:fs';
import{spawnSync}from'node:child_process';import{dirname,join}from'node:path';import{fileURLToPath}from'node:url';import{tmpdir}from'node:os';
test('new exact policy HTTP operand controls through original installed SDK',()=>{
 const here=dirname(fileURLToPath(import.meta.url)),project=dirname(here),helpers=join(here,'fixtures/raw-policy-bytes'),out=mkdtempSync(join(tmpdir(),'ynx-raw-policy-ci-'));
 mkdirSync(join(out,'src'));mkdirSync(join(out,'node_modules/@ynx-chain'),{recursive:true});
 const sdk=dirname(dirname(fileURLToPath(import.meta.resolve('@ynx-chain/wallet-auth/pq-wallet-policy'))));symlinkSync(sdk,join(out,'node_modules/@ynx-chain/wallet-auth'),'dir');
 for(const name of['operator-query.mjs','operator-packet.mjs','transaction-resource.mjs','operator-projection.mjs','comet-projection.mjs','operator-policy-original.mjs']){
  let text=readFileSync(join(project,'src/original-policy-supplier',name),'utf8');
  if(name==='operator-query.mjs'){assert(text.includes("import {request} from 'node:https';"));text=text.replace("import {request} from 'node:https';","import {request} from '../mock-https.mjs';");}
  writeFileSync(join(out,'src',name),text);
 }
 copyFileSync(join(helpers,'controls.mjs'),join(out,'controls.test.mjs'));copyFileSync(join(helpers,'mock-https.mjs'),join(out,'mock-https.mjs'));copyFileSync(join(here,'fixtures/comet-account-fbec-public.json'),join(out,'fixture.json'));
 // This is an independent test run, not a recursive node:test worker. Keep
 // all other environment entries; do not silently count a zero-case child.
 const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
 const r=spawnSync(process.execPath,['--test','--test-reporter=tap',join(out,'controls.test.mjs')],{env:childEnv,encoding:null,timeout:30000,maxBuffer:8<<20});writeFileSync(join(out,'stdout'),r.stdout??'');writeFileSync(join(out,'stderr'),r.stderr??'');
 assert.equal(r.status,0,'actual new controls failed; raw evidence '+out);assert.match(String(r.stdout),/# pass 9/);
});
