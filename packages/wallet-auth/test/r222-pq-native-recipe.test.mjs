import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {originalAuthNativeBuildPlan} from '../../../apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs';
test('normal original user addon selects actual PQ Source exactly once, without a second loader',()=>{
 const p=originalAuthNativeBuildPlan('arm64','/PUBLIC-PINNED-NODE-HEADERS');
 assert.equal(p.sources.filter(x=>x.endsWith('/original-pq-host-catalog-source.mm')).length,1);
 assert.equal(p.sources.filter(x=>x.endsWith('/original-auth-identity-node.mm')).length,1);
 assert.equal(p.commands.length,1);assert.ok(p.commands[0].argv.includes('-DNAPI_VERSION=8'));
 const binding=fs.readFileSync(new URL('../../../apps/wallet-desktop/native/original-auth-identity-node.mm',import.meta.url),'utf8');assert.equal(binding.split('#include "original-pq-host-catalog-source-owner.inc.mm"').length,2);
 const facade=fs.readFileSync(new URL('../src/original-pq-host-catalog-source.js',import.meta.url),'utf8');assert.match(facade,/original-auth-identity-private-joint-registration/);
 const manifest=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));assert.ok(manifest.files.includes('native/original-pq-host-catalog-source-contract.mjs'));
 assert.ok(manifest.files.includes('src')); // private facade is included, not publicly granted
});
