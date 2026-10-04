import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:4*1024*1024});
const manifest=JSON.parse(readFileSync(new URL('../integration/market-consumer-inputs-20261004.json',import.meta.url)));
const paths=['web/app.js','web/index.html','tests/preview-market-lifecycle-browser.test.mjs','tests/cache-version-browser.test.mjs','tests/locale-browser.test.mjs','tests/candles-browser.test.mjs','evidence/preview-market-lifecycle-20261004.md','evidence/normal-cache-consumer-public-gap-20261004.md'].map(p=>'apps/exchange/'+p);
const forbidden=['packages/wallet-auth','apps/exchange/web/wallet-connect.js','apps/exchange/web/wallet-connect-entry.js','apps/exchange/web/private-session.js','apps/exchange/server','internal/exchangeproduct','go.mod','go.sum'];
function verify(m){
  // This immutable handoff describes an earlier ordinary-hunk review, not
  // current working bytes or current release status. Inspect its Git objects
  // directly; the current runtime graph has its own independent asset gate.
  assert.equal(m.schemaVersion,'ynx-ordinary-consumer-inputs-v1');assert.equal(m.productId,'exchange');
  assert.equal(m.classification,'ORDINARY_HUNKS_NOT_FORMAL_RUNTIME');assert.equal(m.integrationMode,'ORDINARY_HUNKS_ONLY');
  assert.equal(m.releaseAuthority,'wallet_release_owner');assert.equal(m.preserveSharedGraph,true);assert.equal(m.publisherMustRebuildFinalAssetPins,true);
  for(const key of ['sourceCommit','sourceTree','reviewedBaseCommit'])assert.match(m[key],/^[a-f0-9]{40}$/);
  assert.equal(git(['rev-parse',m.sourceCommit+'^{tree}']).toString().trim(),m.sourceTree);
  git(['merge-base','--is-ancestor',m.reviewedBaseCommit,m.sourceCommit]);
  assert.deepEqual(m.objects.map(o=>o.path),paths);assert.deepEqual(m.forbiddenReplacementPaths,forbidden);
  assert.deepEqual(m.readOnlyDiffArgv,['git','diff',m.reviewedBaseCommit,m.sourceCommit,'--',...paths]);
  assert.deepEqual(m.truth,{formalResourceGatePassed:false,runtimeBuilt:false,deployed:false,installed:false,actualProviderApproved:false,privateSessionVerified:false,transactionsVerified:false,productComplete:false});
  assert.ok(m.releaseBlockers.length>0);
  for(const object of m.objects){
    assert.match(object.blob,/^[a-f0-9]{40}$/);assert.match(object.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(object.bytes)&&object.bytes>0);
    assert.equal(git(['rev-parse',m.sourceCommit+':'+object.path]).toString().trim(),object.blob);
    const bytes=git(['cat-file','blob',object.blob]);assert.equal(bytes.length,object.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),object.sha256);
  }
  const html=git(['show',m.sourceCommit+':apps/exchange/web/index.html']).toString();
  assert.ok(html.includes('/app.js?v='+m.objects.find(o=>o.path==='apps/exchange/web/app.js').sha256));
  assert.equal(m.runtimeConsumerCheckpoint,'97a259368d533d97e1fcc5396e04663df19e7a12');
  for(const p of paths.slice(0,2))assert.equal(execFileSync('git',['rev-parse',m.runtimeConsumerCheckpoint+':'+p],{encoding:'utf8'}).trim(),m.objects.find(o=>o.path===p).blob,'test-only successor must not relabel changed runtime bytes');
}
test('historical Exchange handoff preserves exact Git objects without relabeling current runtime',()=>verify(manifest));
test('Exchange handoff rejects shared replacement, wrong identity, command or release promotion',()=>{
  for(const change of [m=>m.sourceTree='0'.repeat(40),m=>m.objects[0].sha256='0'.repeat(64),m=>m.objects[0].bytes++,m=>m.objects[1]=m.objects[0],m=>m.objects[0].path='apps/exchange/web/wallet-connect.js',m=>m.readOnlyDiffArgv[1]='apply',m=>m.runtimeConsumerCheckpoint=m.sourceCommit,m=>m.truth.runtimeBuilt=true,m=>m.forbiddenReplacementPaths=[]]){
    const m=structuredClone(manifest);change(m);assert.throws(()=>verify(m));
  }
});
