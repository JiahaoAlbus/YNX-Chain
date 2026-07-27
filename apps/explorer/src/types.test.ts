import assert from 'node:assert/strict';
import test from 'node:test';
import { summaryChainID, summaryLatestHeight, summaryNetworkName, type Summary } from './types';

test('reads the canonical Go Explorer summary schema', () => {
  const summary: Summary = {
    rpcHeight: 6423,
    indexedHeight: 6422,
    syncLagBlocks: 1,
    network: { name: 'YNX Testnet', slug: 'testnet', chainId: 6423, nativeCurrencySymbol: 'YNXT' }
  };
  assert.equal(summaryLatestHeight(summary), 6423);
  assert.equal(summaryNetworkName(summary), 'YNX Testnet');
  assert.equal(summaryChainID(summary), 6423);
});

test('keeps legacy dashboard summaries readable during migration', () => {
  const summary: Summary = { latestHeight: 41, network: 'ynx_6423-1', chainId: 6423 };
  assert.equal(summaryLatestHeight(summary), 41);
  assert.equal(summaryNetworkName(summary), 'ynx_6423-1');
  assert.equal(summaryChainID(summary), 6423);
});
