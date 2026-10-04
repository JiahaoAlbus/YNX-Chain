import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:4*1024*1024});
// Evidence custody only; this does not apply patches, compose SDKs or publish.
export function verifyOrdinaryConsumer(m,product,paths,forbidden){
  assert.equal(m.schemaVersion,'ynx-ordinary-consumer-inputs-v1');assert.equal(m.productId,product);
  assert.equal(m.classification,'ORDINARY_HUNKS_NOT_FORMAL_RUNTIME');assert.equal(m.integrationMode,'ORDINARY_HUNKS_ONLY');
  assert.equal(m.releaseAuthority,'wallet_release_owner');assert.equal(m.preserveSharedGraph,true);assert.equal(m.publisherMustRebuildFinalAssetPins,true);
  for(const key of ['sourceCommit','sourceTree','reviewedBaseCommit'])assert.match(m[key],/^[a-f0-9]{40}$/);
  assert.equal(git(['rev-parse',m.sourceCommit+'^{tree}']).toString().trim(),m.sourceTree);
  git(['merge-base','--is-ancestor',m.reviewedBaseCommit,m.sourceCommit]);
  assert.deepEqual(m.objects.map(o=>o.path),paths);assert.deepEqual(m.forbiddenReplacementPaths,forbidden);
  assert.deepEqual(m.readOnlyDiffArgv,['git','diff',m.reviewedBaseCommit,m.sourceCommit,'--',...paths]);
  assert.deepEqual(m.truth,{formalResourceGatePassed:false,runtimeBuilt:false,deployed:false,installed:false,actualProviderApproved:false,privateSessionVerified:false,transactionsVerified:false,productComplete:false});
  assert.ok(m.releaseBlockers.length>0);
  for(const o of m.objects){
    assert.ok(o.path.startsWith('apps/'+product+'/')&&!o.path.includes('..'));
    assert.match(o.blob,/^[a-f0-9]{40}$/);assert.match(o.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(o.bytes)&&o.bytes>0);
    assert.equal(git(['rev-parse',m.sourceCommit+':'+o.path]).toString().trim(),o.blob);
    const b=git(['cat-file','blob',o.blob]);assert.equal(b.length,o.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),o.sha256);
    assert.ok(lstatSync(root+o.path).isFile()&&!lstatSync(root+o.path).isSymbolicLink());assert.deepEqual(readFileSync(root+o.path),b);
  }
  const html=readFileSync(root+'apps/'+product+'/web/index.html','utf8');
  assert.ok(html.includes('/app.js?v='+m.objects.find(o=>o.path==='apps/'+product+'/web/app.js').sha256));
}
