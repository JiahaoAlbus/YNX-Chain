import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXCHANGE_RUNTIME_WEB_ASSETS,verifyExchangeVersionedAssets,verifyExchangeIntroductionAssets} from '../web/verify-versioned-assets.mjs';
const root=new URL('../web/',import.meta.url);
const staged=new Map(EXCHANGE_RUNTIME_WEB_ASSETS.map(name=>[name,readFileSync(new URL(name,root))]));
test('complete runtime graph validates every packaged asset',()=>{
  assert.deepEqual([...staged.keys()].sort(),['index.html','styles.css','wallet-connect.js','app.js','ui-preferences.js','market-data.js','order-preview.js','private-session.js','locale.js','command-review.js','command-copy.js','venue-config.js','ynx-logo.png','ynx-favicon.png','introduction.html','introduction.css','introduction.js','exchange-workspace-preview.png'].sort());
  assert.deepEqual(verifyExchangeVersionedAssets(staged.get('index.html').toString(),staged.get('app.js').toString(),name=>staged.get(name)),{status:'pass',pageAssets:4,moduleAssets:7});
  assert.deepEqual(verifyExchangeIntroductionAssets(staged.get('introduction.html').toString(),name=>staged.get(name)),{status:'pass',assets:5});
  const introOnly=new Set(['introduction.html','introduction.css','introduction.js','exchange-workspace-preview.png']);
  for(const missing of EXCHANGE_RUNTIME_WEB_ASSETS.filter(name=>name!=='index.html'&&!introOnly.has(name))){
    assert.throws(()=>verifyExchangeVersionedAssets(staged.get('index.html').toString(),staged.get('app.js').toString(),name=>name===missing?Buffer.from('missing'):staged.get(name)),/HASH_MISMATCH/);
  }
  for(const missing of ['introduction.css','introduction.js','exchange-workspace-preview.png','ynx-logo.png','ynx-favicon.png'])assert.throws(()=>verifyExchangeIntroductionAssets(staged.get('introduction.html').toString(),name=>name===missing?Buffer.from('missing'):staged.get(name)),/ASSET_INVALID/);
});
test('packager source preserves reviewed bundles and guards source/overwrite/symlink',()=>{
  const source=readFileSync(new URL('../scripts/package-runtime-candidate.mjs',import.meta.url),'utf8');
  for(const fragment of ['for(const name of EXCHANGE_RUNTIME_WEB_ASSETS)','lstat(absolute)','requires a clean source worktree','source changed during runtime packaging','flag:"wx"','data.equals(expected)'])assert.ok(source.includes(fragment),fragment);
  assert.doesNotMatch(source,/esbuild|wallet-connect-entry|private-session-entry/);
});
