import test from 'node:test';
import assert from 'node:assert/strict';
import { copy } from './copy';
import { locales } from './i18n';

test('known dynamic labels translate while protocol and arbitrary evidence remain exact',()=>{
  for(const locale of locales){
    for(const value of ['ACKNOWLEDGE','APPROVE ROLLBACK PROPOSAL','incident:manage','/ops/incidents','YNX Wallet','MetaMask','constructor','__proto__','evidence://local-user-title'])assert.equal(copy(value,locale),value);
    for(const key of ['finalityHeight','canonicalHeight','indexedHeight','indexLag','blockIntervalSeconds','peerCount'])assert.notEqual(copy(key,locale),key,`${locale}:${key}`);
  }
  assert.equal(copy('operator','zh-CN'),'操作员');
  assert.notEqual(copy('critical','zh-CN'),'critical');
});
