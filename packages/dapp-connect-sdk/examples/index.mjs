import {DAppConnectClient, StandardWalletConnection, createSiweMessage, discoverEIP6963} from "../src/index.js";

// Each example receives a real EIP-1193 provider or approved adapter. None holds a key.
export const examples = Object.freeze({
  plainEip1193: async provider => new StandardWalletConnection(provider).connect(),
  walletConnect: async (adapter, request) => new DAppConnectClient().connectWallet({walletConnect: adapter, request}),
  siwe: ({domain, address, uri, nonce}) => createSiweMessage({domain, address, uri, nonce}),
  firstPartyProductSession: async (provider, complete) => { const client = new DAppConnectClient({provider}); await client.connectWallet(); return client.upgradeToYNXProductSession({complete}); },
  externalWalletToYNX: async provider => { const client = new DAppConnectClient({provider}); await client.connectWallet(); return client.switchChain(); },
  ynxWalletToExternalEvm: async provider => new StandardWalletConnection(provider).connect(),
  faucetDeepLink: async (client, target) => client.openWalletFaucet(target),
  gatewayDownDegradation: async (provider, complete) => { const client = new DAppConnectClient({provider}); await client.connectWallet(); return client.upgradeToYNXProductSession({complete}); },
  multiWalletEip6963: async (windowLike, options) => discoverEIP6963(windowLike, options)
});
