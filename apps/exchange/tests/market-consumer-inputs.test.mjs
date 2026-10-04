import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyOrdinaryConsumer} from '../../finance/tests/consumer-handoff-checks.mjs';
const manifest=JSON.parse(readFileSync(new URL('../integration/market-consumer-inputs-20261004.json',import.meta.url)));
const paths=['web/app.js','web/index.html','tests/preview-market-lifecycle-browser.test.mjs','tests/cache-version-browser.test.mjs','tests/locale-browser.test.mjs','tests/candles-browser.test.mjs','evidence/preview-market-lifecycle-20261004.md','evidence/normal-cache-consumer-public-gap-20261004.md'].map(p=>'apps/exchange/'+p);
const forbidden=['packages/wallet-auth','apps/exchange/web/wallet-connect.js','apps/exchange/web/wallet-connect-entry.js','apps/exchange/web/private-session.js','apps/exchange/server','internal/exchangeproduct','go.mod','go.sum'];
function verify(m){
  verifyOrdinaryConsumer(m,'exchange',paths,forbidden);
  assert.equal(m.runtimeConsumerCheckpoint,'97a259368d533d97e1fcc5396e04663df19e7a12');
  for(const p of paths.slice(0,2))assert.equal(execFileSync('git',['rev-parse',m.runtimeConsumerCheckpoint+':'+p],{encoding:'utf8'}).trim(),m.objects.find(o=>o.path===p).blob,'test-only successor must not relabel changed runtime bytes');
}
test('Exchange market handoff preserves exact reviewed UI ancestry and independent runtime checkpoint',()=>verify(manifest));
test('Exchange handoff rejects shared replacement, wrong identity, command or release promotion',()=>{
  for(const change of [m=>m.sourceTree='0'.repeat(40),m=>m.objects[0].sha256='0'.repeat(64),m=>m.objects[0].bytes++,m=>m.objects[1]=m.objects[0],m=>m.objects[0].path='apps/exchange/web/wallet-connect.js',m=>m.readOnlyDiffArgv[1]='apply',m=>m.runtimeConsumerCheckpoint=m.sourceCommit,m=>m.truth.runtimeBuilt=true,m=>m.forbiddenReplacementPaths=[]]){
    const m=structuredClone(manifest);change(m);assert.throws(()=>verify(m));
  }
});
