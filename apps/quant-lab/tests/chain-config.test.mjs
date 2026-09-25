import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const text = await Promise.all([
  'web/wallet-auth-entry.js',
  'web/ynx-testnet.js',
  'web/wallet-auth.js',
  'integration/wallet-registry-entry.json'
].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));

test('Quant executable chain configuration is pinned to YNX Testnet only', () => {
  for (const value of text) {
    assert.doesNotMatch(value, /\b9102\b|0x238e/i);
  }
  assert.match(text[0], /mountPrivateSession/);
  assert.match(text[2], /ynx_6423-1/);
  assert.match(text[1], /METAMASK_EVM_CHAIN/);
  assert.match(text[1], /metamask-evm-adapter\.js/);
  assert.match(text[2], /0x1917/);
});
