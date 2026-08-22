import test from 'node:test';
import assert from 'node:assert/strict';
import { clearWalletSession, onStandardConnectionChange, restoreStandardConnection, standardConnection, startWalletAuth } from '../wallet-auth.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

test('MetaMask connection requests account and adds then switches YNX Testnet', async () => {
  const calls = [];
  let chainId = '0x1';
  const provider = {
    isMetaMask: true,
    async request(payload) {
      calls.push(payload);
      if (payload.method === 'eth_requestAccounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return chainId;
      if (payload.method === 'wallet_switchEthereumChain' && chainId !== '0x1917') {
        if (!calls.some(call => call.method === 'wallet_addEthereumChain')) throw Object.assign(new Error('unknown chain'), { code: 4902 });
        chainId = '0x1917';
        return null;
      }
      if (payload.method === 'wallet_addEthereumChain') return null;
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const connection = await startWalletAuth('buyer', { wallet: 'metamask', scope: { ethereum: provider }, waitMs: 0 });
  assert.deepEqual(connection, { account: ACCOUNT, chainId: '0x1917', wallet: 'metamask', transport: 'eip-1193' });
  assert.equal(standardConnection(), connection);
  assert.deepEqual(calls.map(call => call.method), ['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId']);
  assert.deepEqual(calls.find(call => call.method === 'wallet_addEthereumChain').params[0], {
    chainId: '0x1917',
    chainName: 'YNX Testnet',
    nativeCurrency: { name: 'YNX Testnet', symbol: 'YNXT', decimals: 18 },
    rpcUrls: ['https://evm.ynxweb4.com'],
    blockExplorerUrls: ['https://explorer.ynxweb4.com'],
  });
  clearWalletSession();
});

test('Web connection never substitutes MetaMask when YNX Wallet was explicitly chosen', async () => {
  const provider = { isMetaMask: true, request: async () => [ACCOUNT] };
  await assert.rejects(
    startWalletAuth('buyer', { wallet: 'ynx', scope: { ethereum: provider }, waitMs: 0 }),
    error => error.code === 'YNX_WALLET_NOT_FOUND' && error.fallbackURL === 'https://www.ynxweb4.com/dapp/download',
  );
  assert.equal(standardConnection(), null);
});

test('YNX Wallet provider connects without a custom-scheme navigation', async () => {
  const calls = [];
  const provider = {
    isYNXWallet: true,
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_requestAccounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return '0x1917';
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const connection = await startWalletAuth('buyer', { wallet: 'ynx', scope: { ethereum: provider }, waitMs: 0 });
  assert.equal(connection.wallet, 'ynx-wallet');
  assert.deepEqual(calls, ['eth_requestAccounts', 'eth_chainId']);
  clearWalletSession();
});

test('refresh restores an already-approved account without prompting again', async () => {
  const calls = [];
  const provider = {
    isMetaMask: true,
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_accounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return '0x1917';
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const connection = await restoreStandardConnection({ scope: { ethereum: provider }, waitMs: 0 });
  assert.deepEqual(connection, { account: ACCOUNT, chainId: '0x1917', wallet: 'metamask', transport: 'eip-1193' });
  assert.deepEqual(calls, ['eth_accounts', 'eth_chainId']);
  assert.equal(calls.includes('eth_requestAccounts'), false);
  clearWalletSession();
});

test('account and chain events update or invalidate the standard connection', async () => {
  const listeners = new Map();
  const provider = {
    isMetaMask: true,
    on(event, listener) { listeners.set(event, listener); },
    removeListener(event) { listeners.delete(event); },
    async request(payload) {
      if (payload.method === 'eth_requestAccounts') return [ACCOUNT];
      if (payload.method === 'eth_chainId') return '0x1917';
      throw new Error(`Unexpected method ${payload.method}`);
    },
  };
  const observed = [];
  const unsubscribe = onStandardConnectionChange(value => observed.push(value));
  await startWalletAuth('buyer', { wallet: 'metamask', scope: { ethereum: provider }, waitMs: 0 });
  const next = '0x2222222222222222222222222222222222222222';
  listeners.get('accountsChanged')([next]);
  assert.equal(standardConnection().account, next);
  listeners.get('chainChanged')('0x1');
  assert.equal(standardConnection(), null);
  assert.equal(observed.at(-1), null);
  unsubscribe();
});

