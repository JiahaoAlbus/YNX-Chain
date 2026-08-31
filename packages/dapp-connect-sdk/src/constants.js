export const YNX_TESTNET = Object.freeze({
  cosmosChainId: "ynx_6423-1",
  evmChainId: 6423,
  evmChainHex: "0x1917",
  nativeAsset: "YNXT",
  externalAccountFormat: "0x-prefixed EVM account only"
});

export const WALLET_PROTOCOL_REFERENCE = Object.freeze({
  version: "p0-wallet-connection-v1",
  sourceCommit: "66003e76e804da16d472255efde50cb879055b96",
  contractPath: "packages/wallet-auth/integration/p0-wallet-connectivity-candidate.json"
});

export const EIP1193_METHODS = Object.freeze({
  accounts: "eth_requestAccounts",
  chainId: "eth_chainId",
  addChain: "wallet_addEthereumChain",
  switchChain: "wallet_switchEthereumChain",
  sign: "personal_sign",
  signTypedData: "eth_signTypedData_v4",
  sendTransaction: "eth_sendTransaction"
});
