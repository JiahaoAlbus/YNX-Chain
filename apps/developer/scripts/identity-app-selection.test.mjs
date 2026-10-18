import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOriginalIdentityAppSources} from './package-identity-admission-source.mjs';
const header={path:'packages/wallet-auth/native/original-ide-identity-launch-holder.h',bytes:1897,sha256:'a788b5290c58d8140eef80cf7176653b0019e0a9922cc90d017b30f845d38ce2'};
const body={path:'packages/wallet-auth/native/original-ide-identity-launch-holder.mm',bytes:14709,sha256:'6db6ea2f3cc63a2a95cd0557754f035f51549ac6fa5d8f1373a0072a98467fa1'};
test('App holder selection rejects the old closure, header-only and modified implementations',()=>{
  for(const rows of [[],[header],[body],[header,{...body,bytes:14710}],[{...header,sha256:'0'.repeat(64)},body],[header,header,body]])
    assert.throws(()=>validateOriginalIdentityAppSources({nativeSources:rows,nativeBuildInputs:[]}),/source selection differs/);
});
test('App holder cannot be spliced into the Node NAPI component recipe',()=>{
  for(const row of [header,body])assert.throws(()=>validateOriginalIdentityAppSources({nativeSources:[header,body],nativeBuildInputs:[row]}),/must not be added/);
});
test('exact App-only sources preserve the separate existing Node component closure',()=>{
  const nativeBuildInputs=[{path:'apps/wallet-desktop/native/original-auth-identity-node.mm',bytes:1,sha256:'1'.repeat(64)}];
  const before=JSON.stringify(nativeBuildInputs);
  assert.equal(validateOriginalIdentityAppSources({nativeSources:[header,body],nativeBuildInputs}).length,2);
  assert.equal(JSON.stringify(nativeBuildInputs),before);
});
