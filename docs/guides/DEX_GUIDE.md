# YNX DEX Guide

Status: consensus-native Testnet implementation candidate; public deployment and funded liquidity are not yet evidenced

YNX Chain application state version 13 implements a constant-product Testnet DEX directly in consensus. Assets, account balances, pools, LP shares, swaps and audit events are committed into AppHash. Native YNXT reserves leave the user account and enter a pool escrow whose original supply lots remain traceable; state validation rejects any reserve, lot, token-supply or LP-share mismatch.

Supported signed actions are asset create/mint/transfer, pool create, liquidity add/remove, exact-input swap and exact-output swap. Pool pairs have deterministic asset ordering, a bounded fee tier, deadlines, minimum-output or maximum-input limits, overflow-safe integer arithmetic and exact-ratio liquidity additions. Asset issuers may mint only their own Testnet asset up to its committed maximum supply. DEX actions cannot mint native YNXT.

The CometBFT-backed HTTP gateway exposes signed mutation routes under `/dex/assets` and `/dex/pools`, with read routes for assets, address balances, pools and events. A successful HTTP response is returned only after the action is committed and its ABCI record and audit event match the signed transaction. The gateway does not accept private keys or seed phrases; Wallet signs the canonical action locally.

There is no claim of public liquidity merely because this implementation and its tests exist. Public availability requires deployment of application state version 13 and the matching gateway, a funded Testnet pool created by real signed actions, explorer-visible transaction evidence and a frontend that reads the public gateway. Until those gates pass, public pool, price, volume and TVL values must remain unavailable rather than simulated.

Review contract verification, allowance amount, route, minimum received and failure behavior. Approval, submission, inclusion and settlement are different states. Revoke unused allowances and mandates. Risks include smart-contract defects, malicious tokens, MEV, oracle/bridge failure, impermanent loss, slippage and total loss. Current release/download/public states remain false.
