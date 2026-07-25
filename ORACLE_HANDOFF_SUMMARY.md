# YNX Oracle & Market Data — Active Handoff

**Branch:** `codex/final-oracle-market-data`  
**Lifecycle:** Active — RECOVER / PROTECT  
**Authority:** YNX Oracle & Market Data owns canonical price and market-data facts for downstream products.

## Verified local baseline

- The Go runtime contains signed observation validation, replay protection, provider registry loading, normalized and aggregate persistence, correction events, historical replay, circuit breaking, and fail-closed quality states.
- Public runtime endpoints include `/health`, `/version`, `/prices`, `/markets`, `/providers`, `/status`, `/history`, `/corrections`, and a sanitized `/metrics` response.
- Internal Prometheus metrics remain separated from the public HTTP surface.
- The targeted race suite for `internal/oracle`, `internal/oracle/providers`, and `sdk/oracle/go` passes locally.

## Current truth

The long-term goal is not complete. The following release states remain false until direct evidence exists:

- `integratedCentral`
- `deployedStaging`
- `deployedPublic`
- `downloadHosted`
- `productionSigned`
- `storeReleased`

No approved production provider is active for `YNXT/YUSD_TEST`, no public Oracle API has been verified, and no consumer-owner acceptance evidence has been returned. Runtime publication therefore remains fail-closed or explicitly source-limited.

## Immediate continuation

1. Preserve and push the verified public-runtime endpoint slice.
2. Freeze the canonical market-data contract, error taxonomy, quality states, and provider registry schema.
3. Continue into market-type-specific aggregation, Index/Mark/Funding derivation, DEX TWAP and reorg semantics, persistent correction/replay verification, and consumer fail-closed adapters.
4. Produce direct Testnet evidence only from real responses, artifacts, commits, and consumer validation.

## External inputs that may eventually block activation

Provider credentials, redistribution rights, reporter signer custody, Governance approval, central consumer contracts, public deployment authority, DNS, and stablecoin attestation providers must be supplied through secure operator workflows. Secrets must never be pasted into chat or committed to the repository.
