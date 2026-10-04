import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyOrdinaryConsumer} from './consumer-handoff-checks.mjs';
const manifest=JSON.parse(readFileSync(new URL('../integration/activity-consumer-inputs-20261004.json',import.meta.url)));
const paths=['web/app.js','web/index.html','tests/overview-source-browser.test.mjs','evidence/activity-identity-ambiguity-20261004.md'].map(p=>'apps/finance/'+p);
const forbidden=['packages/wallet-auth','apps/finance/web/wallet-auth.js','apps/finance/web/wallet-auth-entry.js','apps/finance/web/evm-read-session.js','apps/finance/server','internal/finance','go.mod','go.sum'];
test('Finance activity handoff binds exact ordinary source objects, ancestry and read-only diff',()=>verifyOrdinaryConsumer(manifest,'finance',paths,forbidden));
test('Finance handoff rejects wrong custody, cross-owner paths, mutable command or promoted gates',()=>{
  for(const change of [m=>m.sourceTree='0'.repeat(40),m=>m.objects[0].sha256='0'.repeat(64),m=>m.objects[0].bytes++,m=>m.objects[1]=m.objects[0],m=>m.objects[0].path='apps/finance/web/wallet-auth.js',m=>m.readOnlyDiffArgv[1]='apply',m=>m.preserveSharedGraph=false,m=>m.truth.deployed=true,m=>m.forbiddenReplacementPaths=[]]){
    const m=structuredClone(manifest);change(m);assert.throws(()=>verifyOrdinaryConsumer(m,'finance',paths,forbidden));
  }
});
