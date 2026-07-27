# YNX Finance Integration Handoff

## Authority and scope

- Product owner: `24-finance`
- Branch: `codex/final-finance`
- Protected implementation commit: `23bcdea565bcfcb7d211512e654f916faf817df3`
- Contract: `release/integration/finance-contract.json`
- Product identity: `ynx-finance-v1` / `com.ynxweb4.finance`
- Network: `ynx_6423-1`; native Testnet asset: `YNXT`
- Boundary: read-only portfolio analysis and private planning. Finance does not hold keys, custody assets, execute trades, sign transactions or become a second Exchange, DEX, Quant, Wallet, Oracle or Economics authority.

## Current local contract

Finance locally verifies canonical Wallet sessions and accepts only the authorized account identity returned by central introspection. Its source adapters now use a common status envelope with explicit source, version, `asOf`, timestamp semantics, bounded coverage, synchronization state and error information.

Explorer data is accepted only after `/health` reports an operational service and the `YNXT` native symbol. The response then carries the Explorer release/commit, RPC height, indexed height, lag and truthful synchronization status. Health failure, native-asset mismatch or account mismatch prevents Finance from accepting balance or activity evidence.

The Finance activity API remains explicitly bounded to the latest 100 indexed transactions because the current Explorer contract has no account-history cursor. Finance-side page cursors are opaque HMAC-SHA-256 tokens bound to the Wallet account, offset and current activity snapshot. Tamper, cross-account reuse, unsupported version and changed snapshot fail closed. `YNX_FINANCE_CURSOR_SIGNING_KEY` is an operator-managed secret and must be shared consistently across deployed Finance API replicas. Key rotation intentionally invalidates outstanding cursors.

Pay receipts remain server-to-server and require `X-YNX-Pay-Key`. The key never belongs in the client or repository. A failed or unauthorized Pay response becomes an unavailable source state; it never creates a placeholder receipt or marks an asset event settled.

Finance state recovery is now locally implemented at the protected commit. Backup envelopes are versioned, bounded and HMAC-SHA-256 authenticated; they are not encrypted. Verification rejects wrong keys, tamper, unknown fields, unsupported versions and unsafe paths. Restore is an offline operator action that preserves the current private state with hash/byte evidence, atomically installs and reopens the snapshot, emits a private receipt and rolls back automatically on post-write verification or receipt failure. Security/SRE acceptance, encrypted storage/retention policy, deployed restore drill and measured RTO/RPO remain pending.

## Required owner inputs

### 02 Wallet/Auth

Merge `apps/finance/integration/wallet-auth/registry-entry.json`, preserve its exact callback, scopes, bundle and device algorithm, deploy persistent replay/revocation storage, then run:

`installed Finance → Wallet approval → device proof → product session → Finance API introspection → revoke → rejection`

Until direct evidence exists, `integratedCentral=false`.

### 04 Pay

Freeze an authenticated read contract for owned receipt, refund and dispute records. Provide an operator secret reference for staging smoke, never the secret itself in Git or chat. Finance needs direct evidence for an authorized owned receipt and dispute link; the existing public smoke proves only the expected unauthorized failure.

### 07 Exchange

Publish a versioned, read-only account contract for authorized subaccounts, balances, positions, open orders, fills, fees, funding, realized/unrealized PnL and withdrawal/settlement status. Every record needs source version, `asOf`, coverage and failure semantics. Finance will not accept withdrawal capability or implement execution.

### 27 DEX

Publish a versioned, read-only contract for authorized strategy vaults, pool/LP positions, swaps, fees, impermanent-loss inputs, redemption and emergency-exit evidence. All actions remain Wallet/DEX deep links.

### 08 Quant Lab

Publish a versioned read model for strategy hash/version, mandate, venue, capital, realized/unrealized/net PnL, drawdown, fees, risk events, pause/revoke and exit evidence. Finance consumes evidence only and does not create a second Quant Engine.

### 17 Economics

Publish a public, versioned contract for issuance, burn, staking, treasury, service fee and reserve evidence. Finance must never infer fiat value, market cap, APY, revenue or guarantee from YNXT quantities alone.

### 12 Explorer

The current Finance adapter consumes `/health`, `/api/accounts/{address}` and `/api/txs?limit=100`. The next required improvement is a canonical account-history cursor with tamper and cross-account rejection. Until then, complete history and opening-balance claims remain prohibited.

### 13 Monitor / 26 Data Fabric

Accept Finance health, source availability, lag, request/error/audit IDs, restore evidence and canonical read events after the observability slice is implemented. Finance does not yet claim central Monitor or Data Fabric integration.

### 28 Website / 29 Integration / 30 Security-SRE

Website owns the final `/finance` public route and SEO. Integration owns shared Testnet protocol freeze and end-to-end proof. Security/SRE must review the separate backup-authentication key, encrypted storage and retention policy, execute an isolated deployed restore drill, set RTO/RPO targets, validate artifact provenance and control production signing/release gates. Local recovery tests do not imply that acceptance.

## Negative test vectors

Machine-readable vectors are in `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`. Required rejection cases include:

- wrong Wallet product, bundle, device, scope or revoked session;
- unavailable or mismatched Explorer health;
- account evidence for a different Wallet account;
- activity cursor tamper, account reuse or stale snapshot;
- missing/invalid Pay credential;
- caller-supplied identity that differs from the introspected Wallet account;
- any Exchange/DEX/Quant adapter that exposes asset execution or withdrawal authority;
- any source record missing truthful provenance or failure semantics.

## Release truth

Local implementation and tests are true; prior Android local install evidence remains true. Central integration, staging/public deployment, hosted download, production signing and store release remain false. See `apps/finance/product-release.json` for the exact machine-readable state.
