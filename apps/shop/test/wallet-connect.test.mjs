import test from 'node:test';
import assert from 'node:assert/strict';
import { clearWalletSession, standardConnection, startWalletAuth } from '../wallet-auth.js';

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
