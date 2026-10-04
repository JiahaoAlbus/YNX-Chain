import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../integration/recovery-consumer-inputs-20261004.json',import.meta.url)));
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:4*1024*1024});
const paths=['web/app.js','web/index.html','web/styles.css','tests/business-flow.test.mjs','tests/research-recovery-browser.test.mjs','tests/cache-version-browser.test.mjs'].map(p=>'apps/quant-lab/'+p);
function verify(m){
  assert.equal(m.schemaVersion,'ynx-quant-recovery-consumer-inputs-v1');
  assert.equal(m.classification,'ORDINARY_CONSUMER_HUNKS_NOT_RUNTIME_OR_INSTALLER');
  assert.equal(m.integrationMode,'ORDINARY_HUNKS_ONLY');assert.equal(m.releaseAuthority,'wallet_release_owner');
  assert.equal(m.preserveSharedGraph,true);assert.equal(m.publisherMustRebuildFinalAssetPins,true);
  assert.equal(git(['rev-parse',m.sourceCommit+'^{tree}']).toString().trim(),m.sourceTree);
  git(['merge-base','--is-ancestor',m.reviewedBaseCommit,m.sourceCommit]);
  assert.deepEqual(m.objects.map(o=>o.path).sort(),paths.slice().sort());
  assert.deepEqual(m.truth,{runtimeBuilt:false,deployed:false,installed:false,actualProviderApproved:false,privateSessionVerified:false,transactionsVerified:false,productComplete:false});
  for(const o of m.objects){
    assert.equal(git(['rev-parse',m.sourceCommit+':'+o.path]).toString().trim(),o.blob);
    const bytes=git(['cat-file','blob',o.blob]);
    assert.equal(bytes.length,o.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),o.sha256);
    assert.ok(lstatSync(root+o.path).isFile()&&!lstatSync(root+o.path).isSymbolicLink());assert.deepEqual(readFileSync(root+o.path),bytes);
  }
  const html=readFileSync(root+'apps/quant-lab/web/index.html','utf8');
  for(const name of ['app.js','styles.css'])assert.ok(html.includes('/'+name+'?v='+m.objects.find(o=>o.path.endsWith('/'+name)).sha256));
}
test('recovery handoff binds six exact inherited consumer objects and final content pins',()=>verify(manifest));
test('recovery handoff rejects wrong bytes, tree, duplicate, shared path or promoted release truth',()=>{
  for(const mutate of [m=>m.objects[0].sha256='0'.repeat(64),m=>m.sourceTree='0'.repeat(40),m=>m.objects[1]=m.objects[0],m=>m.objects[0].path='apps/quant-lab/web/wallet-auth.js',m=>m.truth.deployed=true]){
    const changed=structuredClone(manifest);mutate(changed);assert.throws(()=>verify(changed));
  }
});
