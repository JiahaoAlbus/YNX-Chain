import {StandardWalletConnection} from '../../../packages/dapp-connect-sdk/src/provider.js';
import {discoverEIP6963} from '../../../packages/dapp-connect-sdk/src/discovery.js';
import {YNX_TESTNET} from '../../../packages/dapp-connect-sdk/src/constants.js';

async function providers(windowLike) {
  const announced = await discoverEIP6963(windowLike, {timeoutMs: 220});
  const injected = windowLike.ethereum;
  if (injected?.request && !announced.some((entry) => entry.provider === injected)) {
    announced.push({
      info: {uuid: 'legacy-injected', name: injected.isMetaMask ? 'MetaMask' : 'Injected wallet'},
      provider: injected,
    });
  }
  return announced;
}

function choose(entries, preference) {
  const pattern = preference === 'metamask' ? /metamask/i : /ynx/i;
  return entries.find((entry) => pattern.test(entry.info?.name || '')) || (preference === 'ynx' ? entries[0] : null);
}

export async function connectStandardWallet(windowLike, preference = 'ynx') {
  const runtime = windowLike.YNX_RESOURCE_RUNTIME;
  if (!runtime || runtime.manifestStatus !== 'ACCEPTED_BUNDLED_CONSUMER_CONTRACT') {
    throw new Error('The accepted YNX endpoint manifest is unavailable. Wallet connection stopped safely.');
  }
  const entry = choose(await providers(windowLike), preference);
  if (!entry) throw new Error(preference === 'metamask'
    ? 'MetaMask was not detected. Install MetaMask or connect YNX Wallet.'
    : 'YNX Wallet was not detected. Download YNX Wallet or use MetaMask.');
  const connection = new StandardWalletConnection(entry.provider, {chain: YNX_TESTNET});
  const connected = await connection.connect();
  await connection.ensureYNXTestnet({addChain: {
    chainId: runtime.evmChainHex,
    chainName: 'YNX Testnet',
    nativeCurrency: {name: 'YNX Testnet', symbol: runtime.nativeAsset, decimals: 18},
    rpcUrls: [runtime.evmRpc],
    blockExplorerUrls: [runtime.explorer],
  }});
  return {connection, connected, providerName: entry.info?.name || 'EVM Wallet'};
}

export const productSessionBoundary = Object.freeze({
  state: 'PRIVATE_SERVICE_DEGRADED',
  localFallbackCreated: false,
  privateSettlementEnabled: false,
});
