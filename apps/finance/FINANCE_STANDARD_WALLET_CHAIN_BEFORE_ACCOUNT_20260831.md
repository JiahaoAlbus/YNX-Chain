# Finance Standard Wallet chain-before-account boundary — 2026-08-31

Finance's browser adapter continues to consume the accepted `StandardWalletConnection` API, while enforcing product-side selected-provider chain validation before it asks the Wallet for an account.

1. The user-selected EIP-1193 provider receives `wallet_switchEthereumChain` for `0x1917`.
2. Only error `4902` enables the fixed YNX Testnet `wallet_addEthereumChain`, followed by a second switch.
3. Finance reads and verifies `eth_chainId`.
4. Only then does `StandardWalletConnection.connect()` request `eth_requestAccounts`.

If the provider remains on another chain, the adapter raises `WRONG_CHAIN` and does not request an account. This remains independent of the Finance Product API (`PENDING`) and private Product Session (`UNAVAILABLE`): neither is created, revived, or implied by a Standard Wallet connection.

## Local evidence

- `npm test`: 20/20 pass, including missing-chain add/re-switch and wrong-chain no-account-request VM tests.
- `npm run security`: 280 Finance text files pass the security gate.

This checkpoint is source/test evidence only. It does not establish a public runtime binding, installed Wallet approval/rejection/callback, Product Session, account ownership, signing, custody, transaction, or deployment result. A separate fresh Finance deployment lease and visible verification are still required.
