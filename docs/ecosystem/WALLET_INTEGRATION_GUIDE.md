# Wallet Integration Guide

YNX Testnet supports an EIP-3085 custom-network payload and a bounded EIP-1193 add/switch helper. This is custom-network compatibility, not default support from MetaMask, Rabby, OKX Wallet, WalletConnect, or another wallet vendor.

```js
import {ensureYNXTestnet} from "@ynx-chain/sdk";

const result = await ensureYNXTestnet(window.ethereum);
console.log(result.chainId, result.added, result.switched);
```

The helper:

- reads `eth_chainId`;
- switches with `wallet_switchEthereumChain` when the chain is known;
- on provider error `4902`, adds the exact metadata-bound network with `wallet_addEthereumChain`, explicitly switches, and rechecks the selected chain;
- preserves user-rejection and unsupported-method errors;
- fails if the provider reports a different chain after switching;
- never calls `eth_requestAccounts`, requests a seed phrase/private key, or submits a transaction.

Verification commands:

```bash
make wallet-integration-check
make chainlist-candidate-check
make chainlist-live-check
```

The local wallet check covers add, switch, already-selected, rejection, unsupported method, post-switch mismatch, and missing-provider paths. The live check validates public metadata without invoking a wallet or requesting an account.

Default wallet support must not be claimed until each wallet vendor independently accepts the exact network entry and an independent client verifies it.
