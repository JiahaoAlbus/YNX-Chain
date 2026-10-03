import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertFrozenCardBuildInputs} from '../scripts/card-build-source-freeze.mjs';

test('clean committed Card product inputs pass',()=>{
  assert.doesNotThrow(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:[]}));
});
test('untracked implementation, assets, config and dependency inputs fail closed',()=>{
  for(const relative of ['App.tsx','index.ts','src/hosted.ts','assets/brand.png','public/runtime-identity.json','server/backend.ts','package-lock.json','tsconfig.json','scripts/prepare.mjs','test/gate.mjs']){
    assert.throws(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:['apps/card/'+relative]}),/CARD_BUILD_UNTRACKED_PRODUCT_INPUT/);
  }
});
test('evidence and disposable output do not falsely prevent a source-bound build',()=>{
  assert.doesNotThrow(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:['apps/card/evidence/run/manifest.json','apps/card/release/receipt.md','apps/card/dist-web/index.html','apps/card/deployment-envelope/package.json','apps/card/node_modules/package/index.js','apps/card/.expo/state.json','apps/card/coverage/report.html']}));
});
test('staged or unstaged tracked changes remain forbidden, including release configuration',()=>{
  assert.throws(()=>assertFrozenCardBuildInputs({trackedChanges:['apps/card/vercel.json'],untrackedPaths:[]}),/CARD_BUILD_TRACKED_SOURCE_DIRTY/);
});
test('unknown scope and malformed status fail closed rather than being ignored',()=>{
  assert.throws(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:['packages/wallet-auth/src/index.js']}),/CARD_BUILD_SOURCE_PATH_INVALID/);
  assert.throws(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:null}),/CARD_BUILD_SOURCE_STATUS_INVALID/);
  assert.throws(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:[null]}),/CARD_BUILD_SOURCE_PATH_INVALID/);
});
test('lookalike output names cannot bypass the source gate',()=>{
  for(const path of ['apps/card/evidence.ts','apps/card/release.ts','apps/card/dist-web.ts','apps/card/.expo.ts'])assert.throws(()=>assertFrozenCardBuildInputs({trackedChanges:[],untrackedPaths:[path]}),/CARD_BUILD_UNTRACKED_PRODUCT_INPUT/);
});
