import assert from 'node:assert/strict';
import test from 'node:test';
import {connectStandardWallet, productSessionBoundary} from '../web/wallet-connectivity.js';

class BrowserTarget extends EventTarget {
  constructor(provider, name = 'YNX Wallet') {
    super();
    this.YNX_RESOURCE_RUNTIME = {
      manifestStatus: 'ACCEPTED_BUNDLED_CONSUMER_CONTRACT', evmChainHex: '0x1917',
      nativeAsset: 'YNXT', evmRpc: 'https://evm.ynxweb4.com', explorer: 'https://explorer.ynxweb4.com',
    };
    this.addEventListener('eip6963:requestProvider', () => this.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {info: {uuid: 'ynx-test-provider', name}, provider},
    })));
  }
}

test('accepted SDK connects a standard 0x account without Product Session', async () => {
  const calls = [];
  const provider = {request: async ({method}) => {
    calls.push(method);
    if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
    if (method === 'eth_chainId') return '0x1917';
    throw new Error(`unexpected ${method}`);
  }};
  const result = await connectStandardWallet(new BrowserTarget(provider));
  assert.equal(result.connected.state, 'STANDARD_CONNECTED');
  assert.equal(result.connected.account, '0x1111111111111111111111111111111111111111');
  assert.deepEqual(calls, ['eth_requestAccounts', 'eth_chainId', 'eth_chainId']);
  assert.deepEqual(productSessionBoundary, {state: 'PRIVATE_SERVICE_DEGRADED', localFallbackCreated: false, privateSettlementEnabled: false});
});

test('missing provider does not fabricate an account or private session', async () => {
  const target = new EventTarget();
  target.YNX_RESOURCE_RUNTIME = {manifestStatus: 'ACCEPTED_BUNDLED_CONSUMER_CONTRACT'};
  await assert.rejects(connectStandardWallet(target), /not detected/);
  assert.equal(productSessionBoundary.localFallbackCreated, false);
});
