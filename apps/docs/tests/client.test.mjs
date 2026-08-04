import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Docs protects canonical auth, autosave, conflict recovery, AI review and delete',async()=>{
  const js=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  assert.match(js,/window\.ynxWallet\?\.authorize/);assert.match(js,/YNX_PRODUCT_SESSION_CHALLENGE_V1/);assert.doesNotMatch(js,/sessionStorage|local-smoke-device|dev-signed|requestSession/);
  assert.match(js,/baseVersion/);assert.match(js,/status===409/);assert.match(js,/offline draft/i);assert.match(js,/nothing was overwritten/i);assert.match(js,/Cancel generation/);assert.match(js,/decision:'rejected'/);assert.match(js,/DELETE/);
});
