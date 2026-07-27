# YNX DEX integration handoff

## Identity

- Product owner: YNX 27
- Source commit: `4d9f9c807efb2529836a1324b17c697e91a23421`
- Branch: `codex/final-dex`
- Release: `0.1.0-testnet-preview.1`
- Phase: FREEZE
- Product status: ACTIVE
- Network target: YNX Testnet, chain ID 6423
- Deployment status: not deployed

The machine-readable authority is `release/integration/ynx-dex-contract.json`. Cross-product acceptance vectors are in `CROSS_PRODUCT_TEST_VECTORS.json`.

## Delivered local surfaces

- Constant-product Factory, Pool, Router and Quoter.
- Separate two-asset StableSwap Factory and Pool family.
- User-owned Strategy Vault with typed CPMM actions and direct StableSwap exact-input, exact-output, add-liquidity and remove-liquidity actions.
- FairFlow intent/solver candidate.
- LP protection and depeg circuit-breaker candidate.
- Source-labelled Indexer API and cursor/state schema v5.
- JavaScript SDK main entry and `@ynx-chain/dex-sdk/stable-vault` subpath.
- Independent Web/PWA preview and unsigned local artifacts.

All listed components are local candidates. None is a verified public deployment, audited Mainnet protocol, hosted download or production-signed release.

## Wallet and approval freeze candidate

- Product client: `ynx-dex-web-v1`
- Bundle: `com.ynxweb4.dex.web`
- Device algorithm: `p256-sha256`
- Candidate scopes:
  - `account:read`
  - `dex:fairflow:intent`
  - `dex:positions:read`
  - `dex:transaction:request`
  - `dex:vault:execute`

Vault execution requires the approval scope set to contain exactly `dex:vault:execute`. Approval identity binds chain ID, product client, Vault, engine, nonce domain, action nonce, request digest, issue time and expiry. Wrong product, bundle, device, scope, chain, Vault, engine, nonce, digest, expiry or revocation must fail before transport.

## StableSwap Vault boundary

- Pool permission is owner-controlled and binds the exact `ynx-stableswap-v1` pool kind, factory code and token pair.
- Each action addresses one direct pool. Multi-hop execution is decomposed into separately quoted and separately approved direct actions.
- The Vault grants no standing pool approval. Exact token or LP balances are transferred and balance deltas are checked.
- Fee-on-transfer tokens are rejected atomically at Vault ingress.
- Output and LP positions remain in the user Vault.
- Owner withdrawal, pause, revoke, kill and emergency exit remain available.
- Engine actions remain bounded by nonce, deadline, capital, gas, frequency, slippage, impact, daily loss, drawdown, Oracle age and depeg limits.

## Owner actions required

### YNX 02 Wallet/Auth

Register the exact product tuple and scopes, then run all Wallet vectors. Return exact source/version and introspection/revoke evidence. Do not introduce a compatibility login or broad wildcard scope.

### YNX 08 Quant Engine

Consume only typed SDK requests. The Quant owner controls strategy templates, research, optimization and capital allocation. DEX owns execution and reconciliation only. No key custody, arbitrary recipient, owner mutation or unrestricted approval is permitted.

### YNX 19 Oracle

Freeze the Testnet Oracle contract and reviewed asset policy. Every fact must include source, asOf, version and failure; confidence/coverage apply where relevant. StableSwap deployment additionally needs reviewed peg/rate and depeg-pause policy.

### YNX 26 Data Fabric

Accept canonical event identity and reorg/idempotency semantics. Do not classify principal as revenue or infer fees absent confirmed event evidence.

### YNX 12 / 13 / 15 / 24

Explorer must reconcile exact receipts; Monitor must validate non-static health/ready/version and alerts; Trust must preserve unaudited/undeployed/unsigned status; Finance must separate principal, realized pool fee, incentives and user-approved charge classes.

### YNX 29 Integration

Freeze one version for scopes, events, errors, schema and deployment addresses. Execute the cross-product vectors in dependency order and record owner acceptance.

### YNX 30 Security/SRE

Run audit, secret, dependency, license, SAST/DAST and artifact/provenance gates. Approve secure signer, immutable hosting, signing classification, backup/restore and public status evidence.

### YNX 28 Website

Consume `public-product-metadata.json` for `/dex`. Keep Website publication independent from runtime public deployment. Do not expose internal paths or publish download/runtime links before immutable probes exist.

## Release evidence

- Aggregate manifest SHA-256: `80beb665aca3f49c55951e96acf63d2e1f1b10308e0c93f4208ae4f1c1934b5e`, 6162 bytes.
- PWA bundle SHA-256: `dba64322521d52faa0ef5e66e297a7911bc1204dd2c7f1a75d986527bd57c669`, 331755 bytes, unsigned local build.
- SDK package SHA-256: `fae8db1d106e7c82ddad2c030c207551155fe3075b4ccedabead23efd17603a5`, 21765 bytes, unsigned local package.
- No immutable artifact URL, install/cold-start evidence or production signature exists.

## Required acceptance order

1. Wallet/Auth and Oracle contract freeze.
2. Security review of source, artifacts, signer path and deployment inputs.
3. Testnet deploy and source verification.
4. Indexer ingestion, restart/reorg and restore drill.
5. Quant execution vectors and Vault failure/recovery vectors.
6. Explorer, Monitor, Trust, Finance and Data Fabric reconciliation.
7. Public artifact/runtime probes.
8. Website consumption and SEO deployment.

The DEX remains fail closed at each missing dependency. A local pass, deployment transaction, Website page or artifact upload does not satisfy later gates.
