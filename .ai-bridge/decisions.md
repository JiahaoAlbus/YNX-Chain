# YNX DEX decisions

## 2026-07-27 — StableSwap Vault execution is direct and typed

The Strategy Vault supports one reviewed StableSwap pool per approved action. Multi-hop StableSwap execution is represented as separately quoted, separately approved direct actions rather than a generic arbitrary-call router. This preserves exact pool/token/method, action nonce, approval digest and risk accounting boundaries.

## 2026-07-27 — No standing approval to Stable pools

The Vault transfers exact input or LP balances to the reviewed pool and verifies the pool balance delta. It does not grant unlimited or persistent token approval to a Stable pool. Fee-on-transfer assets are rejected atomically at Vault ingress and cannot enter the strategy asset set through a successful deposit.

## 2026-07-27 — SDK extension uses an explicit subpath

The Stable Vault adapter is exported as `@ynx-chain/dex-sdk/stable-vault`. The existing main SDK entry remains backward-compatible. This also avoids modifying a file that the workspace secret scanner falsely classified as containing secret-like values; no safety gate was disabled or bypassed.

## 2026-07-27 — Release source is the runtime commit

`product-release.json` and regenerated artifacts bind to runtime source commit `4d9f9c807efb2529836a1324b17c697e91a23421`. Later evidence-only commits may update hashes, matrices and handoffs but must not alter runtime source without advancing the bound source commit and rerunning all gates.

## 2026-07-27 — Product remains ACTIVE

Local tested components do not imply Testnet, central, public, hosted, signed, audited or production status. `implementedLocal` and `testedLocal` remain component-scoped; top-level product completion flags remain false.
