// The accepted SDK is source-bound in this monorepo and intentionally is not
// republished as a second Governance-owned wallet implementation.
// @ts-expect-error accepted source-only SDK has no TypeScript declaration bundle yet
import { discoverEIP6963 } from '../../../../packages/dapp-connect-sdk/src/discovery.js';
// @ts-expect-error accepted source-only SDK has no TypeScript declaration bundle yet
import { StandardWalletConnection } from '../../../../packages/dapp-connect-sdk/src/provider.js';

export const YNX_WALLET_DOWNLOAD_URL = 'https://ynxweb4.com/dapp/download#wallet';
export const YNX_EXPLORER_URL = 'https://explorer.ynxweb4.com';

export type WalletChoice = 'ynx' | 'metamask';

type EIP1193Provider = {
  isMetaMask?: boolean;
  request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type AnnouncedProvider = {
  info: { name?: string; rdns?: string; uuid?: string };
  provider: EIP1193Provider;
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const addYNXChain = Object.freeze({
  chainId: '0x1917',
  chainName: 'YNX Testnet',
  nativeCurrency: { name: 'YNX Testnet', symbol: 'YNXT', decimals: 18 },
  rpcUrls: ['https://evm.ynxweb4.com'],
  blockExplorerUrls: [YNX_EXPLORER_URL],
});

function isYNXWallet(candidate: AnnouncedProvider): boolean {
  const identity = `${candidate.info.name ?? ''} ${candidate.info.rdns ?? ''}`.toLowerCase();
  return identity.includes('ynx');
}

function isMetaMask(candidate: AnnouncedProvider): boolean {
  const identity = `${candidate.info.name ?? ''} ${candidate.info.rdns ?? ''}`.toLowerCase();
  return identity.includes('metamask') || candidate.provider.isMetaMask === true;
}

export type StandardConnectionResult = {
  account: string;
  chainId: string;
  walletName: string;
  state: 'STANDARD_CONNECTED';
};

export async function connectStandardWallet(
  windowLike: Window,
  choice: WalletChoice,
): Promise<StandardConnectionResult> {
  const discovered = await discoverEIP6963(windowLike, { timeoutMs: 80 }) as AnnouncedProvider[];
  const selected = choice === 'ynx'
    ? discovered.find(isYNXWallet)
    : discovered.find(isMetaMask) ?? (windowLike.ethereum?.isMetaMask ? {
      info: { name: 'MetaMask' },
      provider: windowLike.ethereum,
    } : undefined);

  if (!selected) {
    const error = new Error(choice === 'ynx' ? 'YNX Wallet was not found.' : 'MetaMask was not found.');
    error.name = 'WalletNotFoundError';
    throw error;
  }

  const connection = new StandardWalletConnection(selected.provider);
  const connected = await connection.connect() as { account: string; chainId: string; state: 'STANDARD_CONNECTED' };
  await connection.ensureYNXTestnet({ addChain: addYNXChain });
  const finalChainId = String(await selected.provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (finalChainId !== '0x1917') throw new Error('Wallet did not remain on YNX Testnet (0x1917).');

  return {
    account: connected.account,
    chainId: finalChainId,
    walletName: selected.info.name ?? (choice === 'ynx' ? 'YNX Wallet' : 'MetaMask'),
    state: 'STANDARD_CONNECTED',
  };
}
