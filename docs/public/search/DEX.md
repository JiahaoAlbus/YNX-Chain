# YNX DEX

| Field | Value |
| --- | --- |
| Version | 1.1.0-candidate |
| Effective date | 2026-08-09 |
| Evidence source commit | `3553ae926e7f2144de7bd7f5a4d4919ebe6a25cf` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Canonical | `https://ynxweb4.com/dex` |
| Title | YNX DEX — Testnet Integration, Liquidity and Wallet Safety |
| Meta description | Learn the YNX DEX candidate boundaries for contracts, token lists, liquidity, route review, Wallet approval and public evidence. |
| H1 | YNX DEX |

## Direct answer

YNX DEX now has a consensus-native Testnet implementation candidate. Assets,
balances, constant-product pools, LP shares, exact-input and exact-output swaps,
YNXT lot escrow and audit events are part of application state version 13. This
is not yet a claim of a deployed public pool, funded liquidity or production
trading.

## Contract and token gate

The native implementation uses canonical signed application actions rather than
an unverified router address. Every mutation is bound to chain ID 6423, signer,
nonce, fee and canonical payload; pool actions also bind pool, assets, amount,
slippage limit and deadline. Public release still requires the matching chain
and gateway build to be deployed and explorer-visible.

## Liquidity truth

A pool address does not prove usable liquidity. Liquidity claims require source,
observation time, reserves, token identity, price range, depth, fee, volume
method, slippage, lock/withdrawal, impermanent-loss risk and evidence ID. Test
fixtures and simulated quotes are not public liquidity.

## Wallet and Bridge

The user Wallet signs the exact route, inputs, minimum output, deadline, fee and
approved contracts. A DEX frontend or AI cannot hold user keys or widen approval.
Bridge routes are external dependencies and remain unavailable unless the exact
route, contracts, finality, provider and recovery are approved.

## Current status

Chain-core and gateway tests cover create, transfer, cross-block empty-pool
commit, add/remove liquidity, exact-input/output swaps, expiry rejection,
AppHash migration and total-supply/lot reconciliation. Funded pools, public
deployment, independent audit and production signing are not established by
this page.

## Related pages

- [YNX Wallet](/wallet)
- [What is YNXT?](/what-is-ynxt)
- [YNX Quant](/quant)
- [YNX Security](/security)
- [FAQ](/faq)

## Change log

- 1.1.0-candidate (2026-08-09): Added truthful consensus-native DEX and gateway
  behavior, state invariants and remaining public-deployment gates.
- 1.0.0-candidate (2026-07-22): Initial contract, token, liquidity, Wallet,
  Bridge, status and risk page.
