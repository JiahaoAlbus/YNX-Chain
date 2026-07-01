# Wallet Integration Guide

YNX Testnet targets MetaMask custom networks, Rabby custom networks, OKX Wallet custom networks, WalletConnect readiness, EIP-1193, EIP-155, ethers.js, viem, and web3.js.

Default wallet support must not be claimed until each wallet independently accepts the network.

Verification command:

```bash
make wallet-integration-check
```

This starts or reuses a local YNX Testnet endpoint, checks `eth_chainId`, `net_version`, `eth_blockNumber`, validates YNX Testnet metadata, and emits a `wallet_addEthereumChain` compatible object with native currency `YNXT`.
