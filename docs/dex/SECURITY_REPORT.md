# YNX DEX security report

## Current classification

Local engineering candidate; Testnet-only; not independently audited. `mainnet=false`, `audited=false`, `productionLiquidity=false`.

## Enforced boundaries

- Factory rejects zero, identical, non-contract and non-allow-listed tokens.
- Pools are immutable, lock reentrant entry, use balance deltas, burn minimum initial liquidity and reject zero-liquidity/zero-output execution.
- Public `sync()` accepts balance donations but rejects reserve decreases, preventing a negative rebase from being legitimized as a new reserve baseline.
- Router caps paths at four hops, rejects repeated adjacent tokens, unknown pools, expired deadlines, excessive input and insufficient output.
- Protocol fees accrue separately from LP reserves and can only be claimed by the publicly delayed factory recipient.
- Factory governance changes require a two-day delay. No admin function transfers reserves, burns another account's LP or changes existing pool fee arithmetic.
- Account positions require canonical Wallet session introspection with exact DEX client, bundle and least-privilege scopes. Missing central introspection fails closed.
- Indexer ingestion uses a separate constant-time key check, strict JSON schemas, 32 KiB bounds, atomic persistence, HMAC integrity and idempotency. Its EVM poller checks chain identity, confirmation depth and bounded ranges, HMAC-signs the cursor and pool registry, and rewinds/rescans on a confirmed block-hash mismatch.
- Token decimals, names and symbols come only from the strict owner-reviewed Testnet token list; event logs cannot inject metadata.
- AI risk explanation sends only selected quote context after permission through a same-origin canonical gateway, rejects cross-origin providers, validates an NDJSON stream, supports cancellation and review, and hash-chains local audit entries. It has no signing/submission capability and returns honest unavailable/429/timeout/empty/interrupted errors.
- Browser bundles contain no Wallet/provider/deployer/database secret and never receive a Wallet private key or recovery material.

## Verified local tests

- Contract deployment, allow-list, pool registry, liquidity add/remove, direct and multi-hop exact-input/output, 100 exact rounding differential vectors, slippage/deadline rollback, four-hop cap, delayed governance, fee claim permissions, cumulative-price advance, malicious reentrancy, taxed-input rollback, negative-rebase sync rejection and uint112 overflow rollback.
- SDK deterministic route choice, exact-input/output arithmetic, slippage bounds, transaction builders, stale/no-route/schema rejection and 500 deterministic invariant/rounding vectors.
- Indexer restart, HMAC tamper, conflicting replay, 40 concurrent atomic writes, strict request/token schemas, ingestion and Wallet authorization, plus confirmed fake-EVM discovery/decoding, cursor restart and block-hash reorganization recovery under the race detector.
- Web production build and 16 unit/integration tests for empty/error truth, SDK quote review, Wallet fail-closed behavior, AI stream/429/empty/cancel/cross-origin/audit tamper, twelve locale catalogs and Arabic RTL. Ten Chromium E2E project cases pass and two project-inapplicable cases skip across desktop/mobile quote, pool/liquidity, AI unavailable, offline Service Worker cold reload, responsive overflow and labelled visual evidence.

## Open security work

- Independent Solidity and economic audit; formal specification; broader Foundry/Echidna fuzz and differential comparison.
- ERC-777 hooks, false/malformed token return data, non-standard decimals, gas griefing and reorganization recovery against a real node. Fee-on-transfer and rebasing tokens remain explicitly unsupported despite adversarial rollback tests.
- Production TWAP consumers, token-decimal normalization and real-node manipulation validation; the local raw-Q112 API enforces a 60-second minimum observation interval and the contract runner covers prior-interval manipulation behavior.
- Owner multisig/timelock ceremony, deployment source/bytecode verification, rollback migration rehearsal and incident response drill.
- Canonical Wallet verifier/registry integration and cross-product replay/tamper vectors on the integrated commit.
- Dependency advisory: the current Hardhat 3.9.0 development toolchain resolves `adm-zip <0.6.0` and npm reports a high-severity crafted-ZIP denial-of-service advisory with no available upstream fix. It is dev-only and excluded from runtime images; release must reassess or replace the toolchain.

No audit, MEV elimination or mainnet safety claim is made.
