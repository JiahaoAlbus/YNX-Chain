import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXCHANGE_RUNTIME_WEB_ASSETS,verifyExchangeVersionedAssets} from '../web/verify-versioned-assets.mjs';
const root=new URL('../web/',import.meta.url);
const staged=new Map(EXCHANGE_RUNTIME_WEB_ASSETS.map(name=>[name,readFileSync(new URL(name,root))]));
test('complete runtime graph validates every packaged asset',()=>{
  assert.equal(staged.size,14);
  assert.deepEqual(verifyExchangeVersionedAssets(staged.get('index.html').toString(),staged.get('app.js').toString(),name=>staged.get(name)),{status:'pass',pageAssets:4,moduleAssets:7});
  for(const missing of EXCHANGE_RUNTIME_WEB_ASSETS.filter(name=>name!=='index.html')){
    assert.throws(()=>verifyExchangeVersionedAssets(staged.get('index.html').toString(),staged.get('app.js').toString(),name=>name===missing?Buffer.from('missing'):staged.get(name)),/HASH_MISMATCH/);
  }
});
test('packager source preserves reviewed bundles and guards source/overwrite/symlink',()=>{
  const source=readFileSync(new URL('../scripts/package-runtime-candidate.mjs',import.meta.url),'utf8');
  for(const fragment of ['for(const name of EXCHANGE_RUNTIME_WEB_ASSETS)','lstat(absolute)','requires a clean source worktree','source changed during runtime packaging','flag:"wx"','data.equals(expected)'])assert.ok(source.includes(fragment),fragment);
  assert.doesNotMatch(source,/esbuild|wallet-connect-entry|private-session-entry/);
});
