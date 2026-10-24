import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createModelRouter } from '../src/router.mjs';

test('unconfigured YNX catalog has no implicit third-party model or recommended families', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {createModelRouter} from ${JSON.stringify(new URL('../src/router.mjs', import.meta.url).href)};
    let calls=0;
    const router=createModelRouter({fetchImpl:async()=>{calls++;throw Error('No network allowed');}});
    const catalog=router.catalog();
    let code;
    try { await router.generate({prompt:'Write a greeting'}); } catch(error) {code=error.code;}
    console.log(JSON.stringify({catalog,calls,code}));
  `], { encoding: 'utf8', env: { ...process.env, YNX_CODE_HOSTED_AI_MODEL: '' } });
  assert.equal(child.status, 0, child.stderr);
  const value = JSON.parse(child.stdout);
  assert.equal(value.catalog.hosted.configuredModel, null);
  assert.equal(value.catalog.hosted.model, null);
  assert.equal(value.catalog.hosted.generationAvailable, false);
  assert.deepEqual(value.catalog.localFamilies, []);
  assert.equal(value.calls, 0);
  assert.equal(value.code, 'model_supply_not_supplied');
});

test('explicit model configuration remains configuration, never a verified YNX model or generation grant', () => {
  const catalog = createModelRouter({hostedModel:'PUBLIC-explicit-model'}).catalog();
  assert.equal(catalog.hosted.configuredModel, 'PUBLIC-explicit-model');
  assert.equal(catalog.hosted.model, null);
  assert.equal(catalog.hosted.modelConfidence, 'unknown');
  assert.equal(catalog.hosted.generationAvailable, false);
});
