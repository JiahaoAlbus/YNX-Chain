# Quant authoritative Provider consumption — 2026-08-22

Quant now consumes the Provider discovery/connect-state package freshly packed from the accepted Wallet/Auth repository source `98c6d5d784d212df8981a53b17118a511e246ad2`, whose authoritative repository tree is `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee` and whose associated evidence is `c3ab255c32bdeb9c8e056882c315f8ad43c29c7f`.

The prior record's package-subtree reference is not used as authority by this checkpoint. The replacement archive was produced by `npm pack --ignore-scripts` from `packages/wallet-auth` at that exact source commit, then pinned in Quant's file dependency and lockfile.

| Binding | Value |
| --- | --- |
| vendored archive | `vendor/ynx-chain-wallet-auth-1.1.0-provider-connect-state-p0.tgz` |
| archive SHA-256 | `7daad592f6d8aec7419f29cbba18cb2458053e673788c690613038983a7da34c` |
| archive bytes | `139938` |
| lockfile SHA-512 integrity | `sha512-h7G+Cv/LLEW2QOrag4XAL1hqoF3WqqwT+C5tbZ4FroJxVzXdS0wsbxet60qwsqLLJBVYgADWgja/EaOz7nqBgA==` |
| rebuilt wallet bundle SHA-256 | `27b66df6e56a06936b5632dd0857708eb2213e9f1ced7b4af5b6a76d518de589` |
| rebuilt wallet bundle bytes | `75235` |

The Web flow remains selected-provider EIP-6963/EIP-1193 only: YNX Wallet and MetaMask are distinct, and `web/ynx-testnet.js` now enforces switch → `4902` add → re-switch → `eth_chainId === 0x1917` **before** the product can request an account. This prevents a permission prompt from being issued to a provider on the wrong chain. A browser RPC probe is not a precondition; its degradation cannot erase an established Standard Wallet state. New visitors default to English while an explicit saved language choice remains respected. No-provider actions stay in-page with official YNX Wallet and MetaMask download routes.

The focused unit test exercises the full missing-chain sequence with a fake selected provider. Browser validation remains limited to non-sensitive no-provider fallback; it does not prove account approval, a public runtime binding, installed Wallet behavior, callback, signing, strategy execution, or trade.

Local browser validation verifies the in-page, no-provider fallbacks and English default. It is not direct Provider approval, a public runtime binding, an installed Wallet proof, a callback, signing, strategy execution, or a trade. Under Router gate `875be208e8a7ddb60345d55b93fc299949664e5c`, the sole remaining executable blocker for a direct Quant E2E envelope is a fresh, Quant-only signed public deployment lease binding the current runtime target, rollback state, and this exact source/artifact; no such lease is held.
