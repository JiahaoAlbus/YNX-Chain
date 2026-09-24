# YNX Test Market (6423 QA only)

This package defines valueless `TEST-AAPL` and `tUSD` test assets and a bilateral same-chain DvP settlement contract. Neither asset represents a real security, dollar, USDC or USDT. Caps, issuer/admin roles, pause, mint and redemption support bounded QA inventory. The settlement requires separate seller and buyer EIP-712 signatures, binds the exact order and chain, accounts for partial fills and fees, and rolls back all token transfers if any leg fails. Cancel, expiry and per-party nonce assignment prevent replay. The fee recipient is explicit and receives tUSD in the same transaction.

From the repository root after `npm ci --ignore-scripts`, run:

```sh
cd contracts/ynx-test-market
../../node_modules/.bin/hardhat build --config hardhat.config.js
../../node_modules/.bin/hardhat run test-market.mjs --config hardhat.config.js --network qa6423
../../node_modules/.bin/hardhat run dry-run.mjs --config hardhat.config.js --network qa6423
```

The network above is an ephemeral local Hardhat simulation with chain ID 6423. `deployment-manifest.dry-run.json` contains bytecode hashes and required constructor inputs but no invented public addresses. Its values are reproducible from pinned root dependencies and Solidity 0.8.24. Do not publish this as a live deployment. The current public YNX 6423 node rejects arbitrary CREATE, so real deployment and transaction/state verification remain blocked on a separately authorized consensus/runtime decision. No existing chain state is reset or migrated by this package.

The issuer should be a dedicated, access-controlled QA role; admin and fee recipient should be distinct controlled accounts in a real QA deployment. Only publish addresses and allow Finance/Wallet to activate the market after real 6423 receipts, before/after balances, allowance checks, and reconciliation are recorded. This package never handles broker orders, real funds or Live/Mainnet.
