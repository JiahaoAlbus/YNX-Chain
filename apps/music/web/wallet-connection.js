import {discoverEIP6963} from './ynx-dapp-connect-sdk/discovery.js';
import {DAppConnectError} from './ynx-dapp-connect-sdk/errors.js';
import {StandardWalletConnection} from './ynx-dapp-connect-sdk/provider.js';

export const WALLET_INSTALLATION_OPTIONS = Object.freeze({
  ynx: 'https://www.ynxweb4.com/dapp/download#wallet',
  metamask: 'https://metamask.io/download/',
});

export const YNX_TESTNET_ADD_CHAIN = Object.freeze({
  chainId: '0x1917',
  chainName: 'YNX Testnet',
  nativeCurrency: Object.freeze({name: 'YNX Testnet', symbol: 'YNXT', decimals: 18}),
  rpcUrls: Object.freeze(['https://evm.ynxweb4.com']),
  blockExplorerUrls: Object.freeze(['https://explorer.ynxweb4.com']),
});

const identity = detail => `${detail?.info?.name ?? ''} ${detail?.info?.rdns ?? ''}`.toLowerCase();
const isYNX = detail => identity(detail).includes('ynx');
const isMetaMask = detail => identity(detail).includes('metamask') || detail?.provider?.isMetaMask === true;

export async function connectMusicWallet(choice, windowLike = window, {timeoutMs = 250} = {}) {
  const announced = await discoverEIP6963(windowLike, {timeoutMs});
  const matches = announced.filter(choice === 'ynx' ? isYNX : isMetaMask);
  if (matches.length > 1) throw new DAppConnectError('AMBIGUOUS_WALLET', `More than one ${choice === 'ynx' ? 'YNX Wallet' : 'MetaMask'} provider was announced.`);
  const injected = choice === 'metamask' && windowLike?.ethereum?.isMetaMask
    ? {provider: windowLike.ethereum, info: {name: 'MetaMask', rdns: 'io.metamask'}}
    : null;
  const selected = matches[0] ?? injected;
  if (!selected) throw new DAppConnectError('WALLET_NOT_INSTALLED', `${choice === 'ynx' ? 'YNX Wallet' : 'MetaMask'} was not found.`, {details: WALLET_INSTALLATION_OPTIONS});
  const connection = new StandardWalletConnection(selected.provider);
  const connected = await connection.connect();
  await connection.ensureYNXTestnet({addChain: YNX_TESTNET_ADD_CHAIN});
  const chainId = String(await selected.provider.request({method: 'eth_chainId'})).toLowerCase();
  if (chainId !== '0x1917') throw new DAppConnectError('WRONG_CHAIN', 'Wallet did not remain on YNX Testnet.');
  return Object.freeze({
    account: connected.account,
    chainId,
    connection,
    walletName: selected.info?.name || (choice === 'ynx' ? 'YNX Wallet' : 'MetaMask'),
    standardConnection: 'CONNECTED',
    productSession: 'PRIVATE_SERVICE_DEGRADED',
  });
}
