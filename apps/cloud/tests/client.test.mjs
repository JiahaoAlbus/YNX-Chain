import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Cloud uses accepted Standard Wallet, memory-only private state, recovery and explicit AI consent',async()=>{
  const js=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  assert.match(js,/selected-context consent/i);assert.match(js,/StandardWalletConnection/);assert.match(js,/discoverEIP6963/);assert.match(js,/ensureYNXTestnet/);
  assert.match(js,/No local or canned session was created/);assert.doesNotMatch(js,/window\.ynxWallet\?\.authorize|YNX_PRODUCT_SESSION_CHALLENGE_V1|generateKey|session\/challenge/);
  assert.match(js,/YNX_CLOUD_RUNTIME\.apiBase/);assert.doesNotMatch(js,/cloud\/api\/v1/);
  assert.match(html,/Connect YNX Wallet/);assert.match(html,/Connect MetaMask/);assert.match(html,/Download YNX Wallet/);assert.match(html,/Continue with public preview/);
  assert.match(js,/addEventListener\('offline'/);assert.match(js,/indexedDB\.open/);assert.match(js,/permanentDelete/);assert.doesNotMatch(js,/sessionStorage|local-smoke-device|dev-signed|requestSession/);
  assert.doesNotMatch(js,/recovery.?key.*localStorage/i);assert.match(js,/provider.*model/i);assert.match(js,/Cancel generation/);assert.match(js,/rejected/);
});
