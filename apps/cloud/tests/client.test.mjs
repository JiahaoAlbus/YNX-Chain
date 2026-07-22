import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Cloud uses canonical Wallet, memory-only sessions, recovery and explicit AI consent',async()=>{
  const js=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  assert.match(js,/selected-context consent/i);assert.match(js,/window\.ynxWallet\?\.authorize/);assert.match(js,/YNX_PRODUCT_SESSION_CHALLENGE_V1/);assert.match(js,/session\/challenge/);
  assert.match(js,/addEventListener\('offline'/);assert.match(js,/indexedDB\.open/);assert.match(js,/permanentDelete/);assert.doesNotMatch(js,/sessionStorage|local-smoke-device|dev-signed|requestSession/);
  assert.doesNotMatch(js,/recovery.?key.*localStorage/i);assert.match(js,/provider.*model/i);assert.match(js,/Cancel generation/);assert.match(js,/rejected/);
});
